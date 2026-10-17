// Carga los perfiles (impresoras y materiales) y arma la configuración final
// que recibe el motor. Para sumar una impresora alcanza con agregar un JSON
// en src/perfiles/impresoras/ (se detecta solo, ver LEEME.md).

import materiales from './materiales.json';
import opciones from './opciones.json';

// Vite junta todos los JSON de la carpeta en tiempo de build.
const archivos = import.meta.glob('./impresoras/*.json', { eager: true, import: 'default' });

export const impresoras = Object.values(archivos)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

export { materiales, opciones };

export function buscarImpresora(id) {
    return impresoras.find(i => i.id === id) || impresoras[0];
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
