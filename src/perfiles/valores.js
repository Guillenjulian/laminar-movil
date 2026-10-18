// Lo que se lee de un perfil de impresora: pausa, valores de la calidad y valores de fábrica de Avanzado.
// Responsabilidad: consultas de sólo lectura sobre un perfil (y el material, para Avanzado). No arma la
// configuración del motor (eso es perfiles.js, que re-exporta todo lo de acá).
// Importa `catalogo.js` (para buscar la impresora) y materiales.json; no importa perfiles.js, así que no hay ciclos.

import materiales from './materiales.json';
import { buscarImpresora } from './catalogo.js';

/**
 * G-code que se inserta para pausar en una capa (cambio de filamento).
 * @param {object} imp perfil de impresora (`pausa`)
 * @returns {string[]} líneas de G-code; `['M600']` si el perfil no define otras
 */
export function lineasPausa(imp) {
    return imp.pausa?.length ? imp.pausa : ['M600'];
}

/**
 * Contenedor de salida de la impresora (ADR 0005).
 * @param {object} imp perfil de impresora (`salida`)
 * @returns {'gcode'|'gcode.3mf'} `'gcode'` si el perfil no dice nada o dice cualquier otra cosa
 */
export function salidaDe(imp) {
    return imp?.salida === 'gcode.3mf' ? 'gcode.3mf' : 'gcode';
}

/**
 * Proceso de la impresora con el de la calidad encima (si la calidad no existe, la normal).
 * @param {object} imp perfil de impresora (`proceso`, `calidades`)
 * @param {string} calidad `rapido`, `normal` o `detalle`
 * @returns {object} claves de Kiri
 */
export function procesoDeCalidad(imp, calidad) {
    return { ...imp.proceso, ...(imp.calidades[calidad] || imp.calidades.normal).proceso };
}

/**
 * Valores que trae la calidad elegida (para mostrarlos en "Personalizar").
 * @param {string} impresoraId id de la impresora
 * @param {string} calidad `rapido`, `normal` o `detalle`
 * @returns {{ patron: string, densidad: number, paredes: number, arriba: number, abajo: number, adhesion: string }}
 */
export function valoresDeCalidad(impresoraId, calidad) {
    const imp = buscarImpresora(impresoraId);
    const p = procesoDeCalidad(imp, calidad);
    return {
        patron: p.sliceFillType || 'hex',
        densidad: p.sliceFillSparse ?? 0.2,
        paredes: p.sliceShells ?? 3,
        arriba: p.sliceTopLayers ?? 3,
        abajo: p.sliceBottomLayers ?? 3,
        adhesion: imp.adhesion || 'falda',
    };
}

/**
 * Extrusor Bowden: la impresora retrae más de 2 mm.
 * @param {number | undefined} retraccionMm retracción en mm
 * @returns {boolean} true si es Bowden
 */
export const esBowden = retraccionMm => retraccionMm > 2;

/**
 * Valores "de fábrica" de Avanzado para la impresora, calidad y material elegidos (lo que se usa si el
 * usuario no toca nada). Las temperaturas se recortan a los límites de la impresora.
 * @param {string} impresoraId id de la impresora
 * @param {string} calidad `rapido`, `normal` o `detalle`
 * @param {string} material clave de materiales.json (si no existe, `pla`)
 * @returns {object} valores de Avanzado (jarron, costura, retraccion, zHop, tempBoquilla, ventilador...)
 */
export function valoresDeAvanzado(impresoraId, calidad, material) {
    const imp = buscarImpresora(impresoraId);
    const p = procesoDeCalidad(imp, calidad);
    const mat = (materiales[material] || materiales.pla).proceso;
    const { hotendMax = Infinity, camaMax = Infinity } = imp.limites || {};
    return {
        jarron: false,
        alturaVariable: false,
        costura: 'ultima',
        // si el perfil no las define, valen las de Kiri (defaults.js)
        retraccion: p.outputRetractDist ?? 1.5,
        zHop: p.zHopDistance ?? 0.2,
        coasting: p.outputCoastDist ?? 0,
        wipe: p.outputRetractWipe ?? 0,
        compAgujeros: 0,
        compExterior: 0,
        velocidad: 100,
        tempBoquilla: Math.min(mat.outputTemp, hotendMax),
        tempCama: Math.min(mat.outputBedTemp, camaMax),
        ventilador: Math.round(((mat.outputFanSpeed ?? 255) * 100) / 255),
    };
}
