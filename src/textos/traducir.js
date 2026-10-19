// Núcleo puro de la traducción (ADR 0008, B.6): sin imports y sin DOM, para probarlo en Node.

/** @typedef {'es' | 'en'} Idioma */
/** @typedef {Record<string, string | { one?: string, other: string }>} Diccionario */
/** @typedef {Record<string, string | number>} Valores */

/** Idiomas disponibles, el primero es el base. @type {readonly Idioma[]} */
export const IDIOMAS = ['es', 'en'];
/** Idioma del HTML y de los respaldos. @type {Idioma} */
export const IDIOMA_BASE = 'es';
/** Locale de Intl y del atributo `lang` de <html>. @type {Record<Idioma, string>} */
export const LOCALES = { es: 'es-AR', en: 'en-US' };

/** Intl.PluralRules por locale (crearlo cuesta). @type {Map<string, Intl.PluralRules>} */
const reglas = new Map();
const tiene = (objeto, clave) => Object.prototype.hasOwnProperty.call(objeto, clave);

/**
 * Reemplaza `{nombre}` por `valores.nombre`. Una variable sin valor queda literal ("{x}") para que se note.
 * @param {string} plantilla
 * @param {Valores | undefined} valores
 * @returns {string}
 */
export function interpolar(plantilla, valores) {
    return plantilla.replace(/\{([a-zA-Z0-9]+)\}/g, (literal, nombre) =>
        valores && tiene(valores, nombre) && valores[nombre] != null ? String(valores[nombre]) : literal,
    );
}

/**
 * Elige la forma de plural con Intl.PluralRules; si la entrada es un texto, la devuelve tal cual.
 * Categorías que no existen en la entrada caen en `other`.
 * @param {string | { one?: string, other: string }} entrada
 * @param {number | string | undefined} n  `valores.n`: debe ser un número; un texto numérico ("3") se convierte con
 *   Number(); cualquier otra cosa (o sin valor) usa `other`
 * @param {Idioma} idioma
 * @returns {string}
 */
export function elegirForma(entrada, n, idioma) {
    if (typeof entrada === 'string') return entrada;
    const cantidad = typeof n === 'string' && n.trim() !== '' ? Number(n) : n;
    if (typeof cantidad !== 'number' || !Number.isFinite(cantidad)) return entrada.other;
    const locale = LOCALES[idioma] ?? LOCALES[IDIOMA_BASE];
    if (!reglas.has(locale)) reglas.set(locale, new Intl.PluralRules(locale));
    const categoria = reglas.get(locale).select(cantidad);
    return tiene(entrada, categoria) && typeof entrada[categoria] === 'string' ? entrada[categoria] : entrada.other;
}

/**
 * Traduce una clave: busca en `diccionario`, luego en `respaldo`; si no está en ninguno devuelve la clave.
 * No escapa nada.
 * @param {Diccionario} diccionario
 * @param {Diccionario} respaldo  puede ser `{}`
 * @param {string} clave
 * @param {Valores | undefined} valores
 * @param {Idioma} idioma
 * @returns {string}
 */
export function traducir(diccionario, respaldo, clave, valores, idioma) {
    const fuente = tiene(diccionario, clave) ? diccionario : tiene(respaldo, clave) ? respaldo : null;
    if (!fuente) return clave;
    // El respaldo está en el idioma base: su plural se elige con las reglas de ese idioma.
    const delIdioma = fuente === diccionario ? idioma : IDIOMA_BASE;
    return interpolar(elegirForma(fuente[clave], valores?.n, delIdioma), valores);
}

/**
 * Idioma a usar: la preferencia guardada si es válida; si no, el primero de `navegador` cuyo código base sea
 * 'es' o 'en'; si no hay ninguno, el idioma base.
 * @param {string | null | undefined} guardado  'es' | 'en' | cualquier otra cosa (se ignora)
 * @param {readonly string[]} navegador  `navigator.languages`
 * @returns {Idioma}
 */
export function elegirIdioma(guardado, navegador) {
    if (IDIOMAS.includes(guardado)) return /** @type {Idioma} */ (guardado);
    for (const codigo of navegador ?? []) {
        const base = String(codigo).toLowerCase().split(/[-_]/)[0];
        if (IDIOMAS.includes(base)) return /** @type {Idioma} */ (base);
    }
    return IDIOMA_BASE;
}

/**
 * Nombres de las variables `{x}` de un texto, sin repetir y en orden de aparición (para las pruebas).
 * @param {string} texto
 * @returns {string[]}
 */
export function variablesDe(texto) {
    return [...new Set([...texto.matchAll(/\{([a-zA-Z0-9]+)\}/g)].map(m => m[1]))];
}
