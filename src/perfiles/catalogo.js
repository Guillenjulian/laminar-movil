// Catálogo de impresoras: los JSON de src/perfiles/impresoras/, las impresoras propias del usuario y la búsqueda.
// Responsabilidad: saber qué impresoras hay y encontrar una por id. No arma configuraciones (eso es perfiles.js,
// que re-exporta todo lo de acá). Para sumar una impresora alcanza con agregar un JSON (se detecta solo, ver LEEME.md).
// Importa sólo `generico.js` (el perfil de "Mi impresora"); no importa perfiles.js, así que no hay ciclos.
//
// Hay tres tipos de impresora (campo `estado`):
//   revisado  -> perfiles hechos a mano en src/perfiles/impresoras/*.json
//   importado -> traídos de Kiri:Moto (src/perfiles/impresoras/kiri/), sin revisar
//   propio    -> creados por el usuario con "Mi impresora" (guardados en el celu)

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
