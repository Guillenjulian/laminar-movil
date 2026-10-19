// Contraste WCAG 2.x (puro, sin DOM). Lo usa scripts/app/accesibilidad.mjs con los colores calculados del navegador.

/** @typedef {{ r: number, g: number, b: number, a: number }} Color canales 0-255 y alfa 0-1 */

function alfa(t) {
    if (t === undefined) return 1;
    return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
}

/**
 * Lee un color como lo devuelve `getComputedStyle`: `rgb()`, `rgba()`, `color(srgb r g b / a)` o `#rrggbb`.
 * @param {string} texto
 * @returns {Color}
 */
export function parsearColor(texto) {
    const t = texto.trim().toLowerCase();
    let m = t.match(/^#([0-9a-f]{6})$/);
    if (m) {
        const n = parseInt(m[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    m = t.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: alfa(m[4]) };
    m = t.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
    if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: alfa(m[4]) };
    throw new Error(`color no reconocido: "${texto}"`);
}

/** Pone `arriba` (con su alfa) sobre `abajo`. */
export function componer(arriba, abajo) {
    const a = arriba.a + abajo.a * (1 - arriba.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mezcla = c => (arriba[c] * arriba.a + abajo[c] * abajo.a * (1 - arriba.a)) / a;
    return { r: mezcla('r'), g: mezcla('g'), b: mezcla('b'), a };
}

/** Luminancia relativa (WCAG) de un color opaco. */
export function luminancia({ r, g, b }) {
    const lineal = v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
}

/**
 * Razón de contraste entre dos colores (1 a 21). Si el primero es translúcido se compone sobre el segundo.
 * @param {string | Color} a
 * @param {string | Color} b
 */
export function ratio(a, b) {
    const fondo = typeof b === 'string' ? parsearColor(b) : b;
    const frente = componer(typeof a === 'string' ? parsearColor(a) : a, fondo);
    const [l1, l2] = [luminancia(frente), luminancia(fondo)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
}

/** Fondo efectivo: compone una cadena de fondos (del elemento hacia la raíz) sobre blanco. */
export function fondoEfectivo(cadena) {
    let fondo = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of [...cadena].reverse()) fondo = componer(parsearColor(c), fondo);
    return fondo;
}
