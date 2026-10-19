// Única fuente del estado de la app y su persistencia (elecciones del paso 2 e impresoras propias).
// Flujo: los módulos de la interfaz importan `estado` (un solo objeto, por referencia) y lo leen en el
// momento, sin cachearlo; `cargarPreferencias` lo rellena al arrancar y `guardar*` lo envían a IndexedDB.
// Las piezas de la cama viven en `estado.piezas` (ADR 0003); `nombre`, `stl`, `vista`, `rotacion` y `escala`
// son accesores de la pieza activa, así que el código de un solo modelo no cambia.
// No toca el DOM al importarse.

import { COLORES_FILAMENTO } from '../motor/tipos-linea.js';
import * as transformar from '../motor/transformar.js';
import {
    buscarImpresora,
    existeImpresora,
    idVigente,
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
    // nombre, stl, vista, rotacion y escala son accesores de la pieza activa (se definen abajo).
    piezas: [], // Pieza[] (ADR 0003, sección 1); vacío = sin modelo
    activa: null, // id de la pieza que editan escala, rotación y "apoyar cara" (null = la primera)
    entra: true, // resultado del último acomodo en la cama (true si no hay piezas)
    eligiendoCara: false,
    impresoraId: IMPRESORA_INICIAL,
    propias: [], // datos de "Mi impresora" (guardados en el celu)
    calidad: 'normal',
    material: 'pla',
    soportes: false,
    personal: {}, // ajustes de "Personalizar" que el usuario cambió (el resto sale de la calidad)
    avanzado: {}, // ajustes de "Avanzado" que el usuario cambió (ver src/ui/avanzado.js)
    cambios: [], // cambios por altura (ADR 0002, ver src/ui/cambios.js); no se persiste: dependen del modelo
    torre: null, // torre de calibración cargada como modelo (ADR 0002, ver ui/torres.js); no se persiste
    resultado: null, // { gcode, info, archivo, impresoraId }
    pausas: new Map(), // capa -> { capa, offset, z }: pausas para cambiar filamento
    coloresFilamento: [...COLORES_FILAMENTO], // color de cada filamento (1º, 2º, ...) en la vista previa
    modoColor: 'tipo', // vista previa coloreada por 'tipo' de línea o por 'filamento'
    cancelar: null, // AbortController del laminado en curso
};

/**
 * Una pieza de la cama (ADR 0003, sección 1).
 * @typedef {object} Pieza
 * @property {number} id secuencial desde 1, nunca se reutiliza en la sesión
 * @property {string} nombre nombre del archivo
 * @property {ArrayBuffer} stl STL original (se copia en cada laminado)
 * @property {{triangulos:number, tamano:{x:number,y:number,z:number}}} vista
 * @property {number[]} rotacion matriz 3×3 en 9 números
 * @property {number} escala uniforme, 0,01 a 20
 * @property {number} copias entero >= 1
 * @property {'modelo'|'litofania'|'torre'} origen
 * @property {{x:number,y:number}[]} posiciones centro de cada copia en mm (no se persiste)
 * @property {{x:number,y:number,z:number}} [tamano] medida real ya transformada (la guarda la UI desde el visor)
 */

let ultimoId = 0;

/**
 * Crea una pieza con id nuevo, una copia y posición `{0,0}`.
 * @param {{nombre:string, stl:ArrayBuffer, vista:object, transformacion?:{rotacion:number[], escala:number}, origen?:string}} d
 * @returns {Pieza}
 */
export function crearPieza(d) {
    const { rotacion, escala } = d.transformacion ?? {};
    return {
        id: ++ultimoId,
        nombre: d.nombre,
        stl: d.stl,
        vista: d.vista,
        rotacion: rotacion ? [...rotacion] : transformar.identidad(),
        escala: escala ?? 1,
        copias: 1,
        origen: d.origen ?? 'modelo',
        posiciones: [{ x: 0, y: 0 }],
    };
}

/**
 * La pieza de `estado.activa` (o la primera si es null o ya no existe).
 * @returns {Pieza|null}
 */
export function piezaActiva() {
    return estado.piezas.find(p => p.id === estado.activa) ?? estado.piezas[0] ?? null;
}

/**
 * Matriz 3×3 de una pieza: primero las rotaciones, después la escala.
 * @param {Pieza} p
 * @returns {number[]}
 */
export function matrizPieza(p) {
    return transformar.multiplicar(transformar.escala(p.escala), p.rotacion);
}

/**
 * Matriz 3×3 final de la pieza activa (identidad si no hay pieza).
 * @returns {number[]}
 */
export function matrizModelo() {
    const p = piezaActiva();
    return p ? matrizPieza(p) : transformar.identidad();
}

/**
 * Suma de `copias` de todas las piezas.
 * @returns {number}
 */
export function copiasTotales() {
    return estado.piezas.reduce((suma, p) => suma + p.copias, 0);
}

/**
 * Arma el argumento `piezas` de `laminar`: copia cada `stl`, matriz de 9 números y posiciones.
 * @returns {{stl:ArrayBuffer, transformacion:number[], posiciones:{x:number,y:number}[]}[]}
 */
export function piezasParaMotor() {
    return estado.piezas.map(p => ({
        stl: p.stl.slice(0),
        transformacion: matrizPieza(p),
        posiciones: p.posiciones.map(q => ({ ...q })),
    }));
}

/**
 * Define un accesor de `estado` sobre la pieza activa (sin pieza: `inicial()` y el setter no hace nada).
 * @param {string} clave campo de la pieza
 * @param {() => *} inicial valor que devuelve el getter si no hay pieza
 * @returns {PropertyDescriptor}
 */
function accesor(clave, inicial) {
    return {
        enumerable: true,
        get: () => piezaActiva()?.[clave] ?? inicial(),
        set: valor => {
            const p = piezaActiva();
            if (p) p[clave] = valor;
        },
    };
}

Object.defineProperties(estado, {
    nombre: accesor('nombre', () => ''),
    stl: accesor('stl', () => null),
    vista: accesor('vista', () => null),
    rotacion: accesor('rotacion', transformar.identidad),
    escala: accesor('escala', () => 1),
});

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
    if (existeImpresora(p.impresoraId)) estado.impresoraId = idVigente(p.impresoraId);
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
