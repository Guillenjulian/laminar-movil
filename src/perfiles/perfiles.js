// Carga los perfiles (impresoras y materiales) y arma la configuración final
// que recibe el motor. Para sumar una impresora alcanza con agregar un JSON
// en src/perfiles/impresoras/ (se detecta solo, ver LEEME.md).
//
// Hay tres tipos de impresora (campo `estado`):
//   revisado  -> perfiles hechos a mano en src/perfiles/impresoras/*.json
//   importado -> traídos de Kiri:Moto (src/perfiles/impresoras/kiri/), sin revisar
//   propio    -> creados por el usuario con "Mi impresora" (guardados en el celu)

import materiales from './materiales.json';
import opciones from './opciones.json';
import { perfilPropio } from './generico.js';

// Vite junta todos los JSON de las carpetas en tiempo de build.
const archivos = import.meta.glob('./impresoras/**/*.json', { eager: true, import: 'default' });
const incluidas = Object.values(archivos).map(i => ({ estado: 'revisado', ...i }));

export const IMPRESORA_INICIAL = 'creality-ender-3-v3-se';
const ORDEN = { propio: 0, revisado: 1, importado: 2 };

let propias = [];

// Las impresoras del usuario (datos del formulario, ver generico.js).
export function ponerImpresorasPropias(lista) {
    propias = lista.map(perfilPropio);
}

// Todas: primero las propias, después las revisadas y al final las importadas.
export function listaImpresoras() {
    return [...propias, ...incluidas].sort((a, b) =>
        ORDEN[a.estado] - ORDEN[b.estado] || (a.marca || '').localeCompare(b.marca || '') || a.nombre.localeCompare(b.nombre));
}

export { materiales, opciones };

export function existeImpresora(id) {
    return listaImpresoras().some(i => i.id === id);
}

// G-code que se inserta para pausar en una capa (cambio de filamento).
export function lineasPausa(imp) {
    return imp.pausa?.length ? imp.pausa : ['M600'];
}

export function buscarImpresora(id) {
    const lista = listaImpresoras();
    return lista.find(i => i.id === id) || lista.find(i => i.id === IMPRESORA_INICIAL) || lista[0];
}

// Saca las claves que empiezan con "_" (son comentarios dentro del JSON).
function sinComentarios(obj) {
    if (Array.isArray(obj)) return obj.map(sinComentarios);
    if (obj && typeof obj === 'object') {
        const limpio = {};
        for (const [k, v] of Object.entries(obj)) {
            if (!k.startsWith('_')) limpio[k] = sinComentarios(v);
        }
        return limpio;
    }
    return obj;
}

// Valores que trae la calidad elegida (para mostrarlos en "Personalizar").
export function valoresDeCalidad(impresoraId, calidad) {
    const imp = buscarImpresora(impresoraId);
    const p = { ...imp.proceso, ...(imp.calidades[calidad] || imp.calidades.normal).proceso };
    return {
        patron: p.sliceFillType || 'hex',
        densidad: p.sliceFillSparse ?? 0.2,
        paredes: p.sliceShells ?? 3,
        arriba: p.sliceTopLayers ?? 3,
        abajo: p.sliceBottomLayers ?? 3,
        adhesion: imp.adhesion || 'falda',
    };
}

// Pasa las opciones de "Personalizar" a claves de Kiri. Sólo las que el
// usuario cambió: el resto queda como lo define la calidad.
function personalAProceso(personal = {}) {
    const proceso = {};
    if (personal.patron) proceso.sliceFillType = personal.patron;
    if (personal.densidad !== undefined) proceso.sliceFillSparse = personal.densidad;
    if (personal.paredes !== undefined) proceso.sliceShells = personal.paredes;
    if (personal.arriba !== undefined) proceso.sliceTopLayers = personal.arriba;
    if (personal.abajo !== undefined) proceso.sliceBottomLayers = personal.abajo;
    return proceso;
}

// Combina, en este orden (lo último gana):
//   proceso base de la impresora → calidad → material → adhesión → personalizado → extras
// y recorta las temperaturas a los límites de la impresora.
// Devuelve { dispositivo, proceso, avisos }.
export function armarConfiguracion({ impresoraId, calidad = 'normal', material = 'pla', soportes = false, personal = {}, extras = {} }) {
    const imp = buscarImpresora(impresoraId);
    const cal = imp.calidades[calidad] || imp.calidades.normal;
    const mat = materiales[material] || materiales.pla;
    const adh = opciones.adhesiones[personal.adhesion || imp.adhesion || 'falda'];

    const dispositivo = sinComentarios(imp.dispositivo);
    const proceso = sinComentarios({
        ...imp.proceso, ...cal.proceso, ...mat.proceso, ...adh.proceso,
        ...personalAProceso(personal),
        ...(soportes ? { sliceSupportType: 'automatic' } : {}),
        ...extras,
    });
    const avisos = [];

    // Avisos del material: el propio (ej. "necesita gabinete") y, para los que
    // no se llevan bien con Bowden (TPU), si la impresora retrae más de 2 mm.
    if (mat.aviso) avisos.push(mat.aviso);
    const retraccion = { ...imp.proceso, ...cal.proceso }.outputRetractDist;
    if (mat.avisoBowden && retraccion > 2) avisos.push(mat.avisoBowden);

    const { hotendMax, camaMax } = imp.limites || {};
    for (const clave of ['outputTemp', 'firstLayerNozzleTemp']) {
        if (hotendMax && proceso[clave] > hotendMax) {
            avisos.push(`La boquilla se limitó a ${hotendMax} °C (máximo de la ${imp.nombre}).`);
            proceso[clave] = hotendMax;
        }
    }
    for (const clave of ['outputBedTemp', 'firstLayerBedTemp']) {
        if (camaMax && proceso[clave] > camaMax) {
            avisos.push(`La cama se limitó a ${camaMax} °C (máximo de la ${imp.nombre}).`);
            proceso[clave] = camaMax;
        }
    }

    proceso.processName = `${imp.nombre} · ${cal.nombre} · ${mat.nombre}`;
    return { dispositivo, proceso, avisos };
}
