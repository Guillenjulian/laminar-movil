// Lectura del G-code de Kiri por capa, para las pruebas de scripts/motor/. Funciones puras, sin DOM.
// Una "capa" es un bloque `;LAYER:n` de Kiri; su Z es la del primer movimiento de Z del bloque (el techo de la capa).

/**
 * Recorre el G-code y lo ordena por capa de Kiri (`;LAYER:n`).
 * @param {string[]} lineas líneas del G-code
 * @returns {{ capas: object[], extrusiones: object[] }} capas con su Z y sus M104/M106/retracciones;
 *   extrusiones con capa, Z, F vigente y feature
 */
export function porCapa(lineas) {
    const capas = [];
    const extrusiones = [];
    let capa = null;
    let z = 0;
    let f = 0;
    let feature = '';
    lineas.forEach((l, i) => {
        const n = l.match(/^;LAYER:(\d+)/);
        if (n) {
            capa = { n: +n[1], ini: i, z: NaN, filamento: 0, m104: [], m106: [], retracciones: [] };
            capas.push(capa);
            return;
        }
        if (!capa) return;
        if (l.startsWith('; feature')) feature = l.slice(10).trim();
        const mz = l.match(/^G[01] .*?Z(-?[\d.]+)/);
        if (mz) {
            z = +mz[1];
            if (Number.isNaN(capa.z)) capa.z = z;
        }
        f = +(l.match(/ F([\d.]+)/)?.[1] ?? f);
        const t = l.match(/^M104 S(\d+)/);
        if (t) capa.m104.push({ i, temp: +t[1] });
        const v = l.match(/^M106 S(\d+)/);
        if (v) capa.m106.push({ i, valor: +v[1] });
        const r = l.match(/^G1 E-([\d.]+).*; e-retract/)?.[1];
        if (r) capa.retracciones.push(+r);
        const e = l.match(/^G1 .*[XY].* E([\d.]+)/);
        if (e) {
            capa.filamento += +e[1];
            extrusiones.push({ i, capa: capa.n, z, f, feature, e: +e[1] });
        }
    });
    return { capas, extrusiones };
}

/**
 * Suma el filamento extruido (E relativo, mm) de las capas `desde`..`hasta` (inclusive).
 * @param {object[]} capas capas de `porCapa`
 * @param {number} desde primera capa
 * @param {number} hasta última capa
 * @returns {number} mm de filamento
 */
export const filamento = (capas, desde, hasta) =>
    capas.filter(c => c.n >= desde && c.n <= hasta).reduce((s, c) => s + c.filamento, 0);

/**
 * Posiciones (índice de línea) de los `M104 S<temp>`.
 * @param {string[]} lineas líneas del G-code
 * @param {number} temp temperatura pedida
 * @returns {number[]} índices de línea
 */
export const lineasM104 = (lineas, temp) =>
    lineas.map((l, i) => (l.startsWith(`M104 S${temp}`) ? i : -1)).filter(i => i >= 0);

/** Línea de fecha que Kiri escribe en el encabezado: lo único que cambia entre dos corridas iguales. */
export const FECHA = /^; \w{3} \w{3} \d+ \d{4} .*$/m;

/**
 * Saca la línea de fecha del encabezado para comparar dos G-code.
 * @param {string} g G-code completo
 * @returns {string} el G-code sin esa línea
 */
export const sinFecha = g => g.replace(FECHA, '');

/**
 * Redondea a 3 decimales (para comparar sumas de E).
 * @param {number} n número
 * @returns {number} redondeado
 */
export const redondear = n => Math.round(n * 1000) / 1000;

/**
 * F más alto (mm/min) por feature de Kiri (`shells`, `sparse infill`...) en una capa.
 * @param {object[]} extrusiones extrusiones de `porCapa`
 * @param {number} capa índice de capa
 * @returns {Record<string, number>} F máximo por feature
 */
export function fPorFeature(extrusiones, capa) {
    const m = {};
    for (const x of extrusiones.filter(x => x.capa === capa)) m[x.feature] = Math.max(m[x.feature] || 0, x.f);
    return m;
}
