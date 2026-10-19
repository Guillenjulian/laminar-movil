// Formatos de números y textos para mostrar, según el idioma activo (ADR 0008, B.5 y B.6): es-AR "1.234,5" y
// en-US "1,234.5". El locale y los textos se piden en cada llamada (nunca al importar), así un cambio de idioma
// se nota en la próxima llamada.
import { localeActual, t } from './idioma.js';

const num = (n, decimales = 0) =>
    n.toLocaleString(localeActual(), { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

/** Número con exactamente `decimales` decimales. @param {number} n @param {number} [decimales] @returns {string} */
export const numero = num;

/** Número con hasta `maximo` decimales, sin rellenar con ceros: 1,5 · 2 · 0,05.
 *  @param {number} n @param {number} maximo @returns {string} */
export const numeroHasta = (n, maximo) => n.toLocaleString(localeActual(), { maximumFractionDigits: maximo });

export function milimetros(tam) {
    return t('formato.milimetros', { x: num(tam.x, 1), y: num(tam.y, 1), z: num(tam.z, 1) });
}

export function triangulos(n) {
    if (n >= 1e6) return t('formato.triangulos.millones', { n: num(n / 1e6, 1) });
    if (n >= 1e4) return t('formato.triangulos.miles', { n: num(Math.round(n / 1000)) });
    return t('formato.triangulos.cantidad', { n, c: num(n) }); // `n` elige el plural, `c` es lo que se ve
}

export function duracion(segundos) {
    const min = Math.round(segundos / 60);
    if (min < 60) return t('formato.duracion.minutos', { min });
    return t('formato.duracion.horas', { h: Math.floor(min / 60), min: min % 60 });
}

// Gramos de filamento: largo (mm) × sección (mm²) = volumen; × densidad (g/cm³).
export function gramos(mm, diametro = 1.75, densidad = 1.24 /* PLA, g/cm³ */) {
    const volumenCm3 = (Math.PI * (diametro / 2) ** 2 * mm) / 1000;
    return volumenCm3 * densidad;
}

// Filamento: largo en metros y peso aproximado en gramos (la densidad depende del material).
export function filamento(mm, diametro = 1.75, densidad = 1.24 /* PLA, g/cm³ */) {
    return t('formato.filamento', { m: num(mm / 1000, 2), g: num(gramos(mm, diametro, densidad)) });
}

// Plata en pesos, sin decimales: "$ 1.234" (es) o "ARS 1,234" (en).
export function pesos(n) {
    return t('formato.pesos', { n: num(Math.round(n)) });
}

export function bytes(n) {
    if (n >= 1e6) return t('formato.bytes.mb', { n: num(n / 1e6, 1) });
    return t('formato.bytes.kb', { n: num(Math.max(1, Math.round(n / 1000))) });
}
