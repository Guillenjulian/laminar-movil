// Catálogo de impresoras: los JSON de src/perfiles/impresoras/, las impresoras propias del usuario, la búsqueda
// y lo que se lee de un perfil (pausa, valores de la calidad).
// Responsabilidad: saber qué impresoras hay y encontrar una por id. No arma configuraciones (eso es perfiles.js,
// que re-exporta todo lo de acá). Para sumar una impresora alcanza con agregar un JSON (se detecta solo, ver LEEME.md).
// Importa sólo `generico.js` (el perfil de "Mi impresora") y materiales.json; no importa perfiles.js, así que no hay ciclos.
//
// Hay tres tipos de impresora (campo `estado`):
//   revisado  -> perfiles hechos a mano en src/perfiles/impresoras/*.json
//   importado -> traídos de Kiri:Moto (src/perfiles/impresoras/kiri/), sin revisar
//   propio    -> creados por el usuario con "Mi impresora" (guardados en el celu)

import materiales from './materiales.json';
import { perfilPropio } from './generico.js';

// Vite junta todos los JSON de las carpetas en tiempo de build.
const archivos = import.meta.glob('./impresoras/**/*.json', { eager: true, import: 'default' });
const todas = Object.values(archivos).map(i => ({ estado: 'revisado', ...i }));
// Un revisado puede tapar a su equivalente importado (`reemplaza: [ids]`) para que el modelo no salga dos veces.
const reemplazos = new Map(
    todas.flatMap(i => (i.estado === 'revisado' ? i.reemplaza || [] : []).map(viejo => [viejo, i.id])),
);
const tapadas = new Set(reemplazos.keys());
const incluidas = todas.filter(i => !tapadas.has(i.id));

export const IMPRESORA_INICIAL = 'creality-ender-3-v3-se';
const ORDEN = { propio: 0, revisado: 1, importado: 2 };

let propias = [];

/**
 * Guarda las impresoras del usuario como perfiles completos (reemplaza las anteriores).
 * @param {object[]} lista datos del formulario "Mi impresora" (ver `perfilPropio` en generico.js)
 */
export function ponerImpresorasPropias(lista) {
    propias = lista.map(perfilPropio);
}

/**
 * Todas las impresoras: primero las propias, después las revisadas y al final las importadas
 * (dentro de cada grupo, por marca y nombre). Las importadas tapadas por un revisado no salen.
 * @returns {object[]} perfiles de impresora
 */
export function listaImpresoras() {
    return [...propias, ...incluidas].sort(
        (a, b) =>
            ORDEN[a.estado] - ORDEN[b.estado] ||
            (a.marca || '').localeCompare(b.marca || '') ||
            a.nombre.localeCompare(b.nombre),
    );
}

/**
 * Id que corresponde hoy a uno guardado: el de un importado tapado devuelve el de su revisado; otro id, el mismo.
 * @param {string} id id guardado
 * @returns {string} id vigente
 */
export function idVigente(id) {
    return reemplazos.get(id) ?? id;
}

/**
 * Dice si hay una impresora con ese id (tomando en cuenta `idVigente`).
 * @param {string} id id guardado
 * @returns {boolean} true si existe
 */
export function existeImpresora(id) {
    const vigente = idVigente(id);
    return listaImpresoras().some(i => i.id === vigente);
}

/**
 * Busca una impresora por id. Si no existe devuelve la inicial y, si tampoco, la primera de la lista.
 * @param {string} id id guardado (puede ser uno tapado: se pasa por `idVigente`)
 * @returns {object} perfil de impresora
 */
export function buscarImpresora(id) {
    const lista = listaImpresoras();
    const vigente = idVigente(id);
    return lista.find(i => i.id === vigente) || lista.find(i => i.id === IMPRESORA_INICIAL) || lista[0];
}

/**
 * G-code que se inserta para pausar en una capa (cambio de filamento).
 * @param {object} imp perfil de impresora (`pausa`)
 * @returns {string[]} líneas de G-code; `['M600']` si el perfil no define otras
 */
export function lineasPausa(imp) {
    return imp.pausa?.length ? imp.pausa : ['M600'];
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
