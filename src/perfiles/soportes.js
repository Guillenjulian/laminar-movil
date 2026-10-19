// Tipo de soporte (ADR 0004): 'no' | 'normal' | 'arbol'. Puro, sin imports.
//
// Antes `soportes` era un boolean; `normalizarSoportes` migra lo viejo y `procesoDeSoportes` traduce el tipo a las
// claves de proceso de Kiri (las mismas que ya usaba `armarConfiguracion`, más `sliceSupportTree` para el árbol).

/** @typedef {'no'|'normal'|'arbol'} TipoSoporte */
export const TIPOS_SOPORTE = ['no', 'normal', 'arbol'];

/**
 * Lleva a un tipo válido lo que venga: `true` es 'normal', los tres textos pasan tal cual y todo lo demás
 * (`false`, `undefined`, `null`, números, textos raros) es 'no'.
 * @param {unknown} v  boolean viejo o texto
 * @returns {TipoSoporte}
 */
export function normalizarSoportes(v) {
    if (v === true) return 'normal';
    return TIPOS_SOPORTE.includes(/** @type {any} */ (v)) ? /** @type {TipoSoporte} */ (v) : 'no';
}

/**
 * Claves de proceso de Kiri para el tipo (se normaliza antes, así que acepta lo viejo también).
 * @param {unknown} tipo
 * @returns {object}  {} | {sliceSupportType:'automatic'} | {sliceSupportType:'automatic', sliceSupportTree:true}
 */
export function procesoDeSoportes(tipo) {
    const t = normalizarSoportes(tipo);
    if (t === 'normal') return { sliceSupportType: 'automatic' };
    if (t === 'arbol') return { sliceSupportType: 'automatic', sliceSupportTree: true };
    return {};
}

/**
 * Texto para el resumen del paso 4.
 * @param {unknown} tipo
 * @returns {string}  '' | ' · con soportes' | ' · soportes árbol'
 */
export function etiquetaSoportes(tipo) {
    const t = normalizarSoportes(tipo);
    if (t === 'normal') return ' · con soportes';
    return t === 'arbol' ? ' · soportes árbol' : '';
}
