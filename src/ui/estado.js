// Única fuente del estado de la app y su persistencia (elecciones del paso 2 e impresoras propias).
// Flujo: los módulos de la interfaz importan `estado` (un solo objeto, por referencia) y lo leen en el
// momento, sin cachearlo; `cargarPreferencias` lo rellena al arrancar y `guardar*` lo envían a IndexedDB.
// No toca el DOM al importarse.

import { COLORES_FILAMENTO } from '../motor/tipos-linea.js';
import * as transformar from '../motor/transformar.js';
import {
    buscarImpresora,
    existeImpresora,
    ponerImpresorasPropias,
    IMPRESORA_INICIAL,
    materiales,
    opciones,
    valoresDeCalidad,
} from '../perfiles/perfiles.js';
import { validarAvanzado } from './avanzado.js';
import * as almacen from '../almacen.js';

/**
 * Estado único de la app (claves documentadas en docs/MAPA.md, sección 3).
 * @type {object}
 */
export const estado = {
    paso: 1,
    nombre: '', // nombre del archivo STL
    stl: null, // ArrayBuffer original (se copia en cada laminado)
    vista: null, // { triangulos, tamano } (tamaño original, sin transformar)
    rotacion: transformar.identidad(), // rotaciones del modelo en la cama (matriz 3×3)
    escala: 1, // escala uniforme (1 = 100 %)
    eligiendoCara: false,
    impresoraId: IMPRESORA_INICIAL,
    propias: [], // datos de "Mi impresora" (guardados en el celu)
    calidad: 'normal',
    material: 'pla',
    soportes: false,
    personal: {}, // ajustes de "Personalizar" que el usuario cambió (el resto sale de la calidad)
    avanzado: {}, // ajustes de "Avanzado" que el usuario cambió (ver src/ui/avanzado.js)
    cambios: [], // cambios por altura (ADR 0002, ver src/ui/cambios.js); no se persiste: dependen del modelo
    resultado: null, // { gcode, info, archivo, impresoraId }
    pausas: new Map(), // capa -> { capa, offset, z }: pausas para cambiar filamento
    coloresFilamento: [...COLORES_FILAMENTO], // color de cada filamento (1º, 2º, ...) en la vista previa
    modoColor: 'tipo', // vista previa coloreada por 'tipo' de línea o por 'filamento'
    cancelar: null, // AbortController del laminado en curso
};

/**
 * Matriz 3×3 final del modelo: primero las rotaciones, después la escala.
 * @returns {number[][]}
 */
export function matrizModelo() {
    return transformar.multiplicar(transformar.escala(estado.escala), estado.rotacion);
}

/**
 * Valores de relleno/paredes/adhesión actuales: los de la calidad pisados por `estado.personal`.
 * @returns {{patron:string, densidad:number, paredes:number, arriba:number, abajo:number, adhesion:string}}
 */
export function valoresActuales() {
    return { ...valoresDeCalidad(estado.impresoraId, estado.calidad), ...estado.personal };
}

/**
 * Publica `estado.propias` en perfiles y las guarda en IndexedDB.
 * @returns {Promise<void>}
 */
export async function guardarPropias() {
    ponerImpresorasPropias(estado.propias);
    await almacen.guardarAjuste('impresorasPropias', estado.propias).catch(() => {});
}

/**
 * Guarda las elecciones del paso 2 en IndexedDB (sin esperar, errores ignorados).
 * @returns {void}
 */
export function guardarPreferencias() {
    const { impresoraId, calidad, material, soportes, personal, avanzado } = estado;
    almacen
        .guardarAjuste('preferencias', { impresoraId, calidad, material, soportes, personal, avanzado })
        .catch(() => {});
}

/**
 * Lee impresoras propias y preferencias; descarta lo que ya no existe y valida `avanzado`.
 * @returns {Promise<void>}
 */
export async function cargarPreferencias() {
    estado.propias = (await almacen.leerAjuste('impresorasPropias').catch(() => null)) || [];
    ponerImpresorasPropias(estado.propias);
    const p = await almacen.leerAjuste('preferencias').catch(() => null);
    if (!p) return;
    // Sólo usamos lo que todavía existe (puede haber cambiado algún perfil).
    if (existeImpresora(p.impresoraId)) estado.impresoraId = p.impresoraId;
    if (buscarImpresora(estado.impresoraId).calidades[p.calidad]) estado.calidad = p.calidad;
    if (materiales[p.material]) estado.material = p.material;
    estado.soportes = !!p.soportes;
    // Del personalizado, sólo lo que sigue siendo válido.
    const pers = p.personal || {};
    if (opciones.patrones[pers.patron]) estado.personal.patron = pers.patron;
    if (opciones.adhesiones[pers.adhesion]) estado.personal.adhesion = pers.adhesion;
    for (const clave of ['densidad', 'paredes', 'arriba', 'abajo']) {
        if (typeof pers[clave] === 'number') estado.personal[clave] = pers[clave];
    }
    estado.avanzado = validarAvanzado(p.avanzado);
}
