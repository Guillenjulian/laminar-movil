// Lectura de G-code compartida por las pruebas (test:app y test:motor).

/**
 * Extrusiones de la capa de Kiri `;LAYER:n`, en las coordenadas del G-code.
 * @param {string|string[]} gcode texto completo o sus líneas
 * @param {number} n número de capa (`;LAYER:n`)
 * @returns {{x:number, y:number}[]} punto final de cada `G1 … X/Y … E` de esa capa
 */
export function puntosDeCapa(gcode, n) {
    const salida = [];
    let dentro = false;
    let x = 0;
    let y = 0;
    for (const l of typeof gcode === 'string' ? gcode.split('\n') : gcode) {
        const capa = l.match(/^;LAYER:(\d+)/);
        if (capa) dentro = +capa[1] === n;
        if (!/^G[01] /.test(l)) continue;
        x = +(l.match(/ X(-?[\d.]+)/)?.[1] ?? x);
        y = +(l.match(/ Y(-?[\d.]+)/)?.[1] ?? y);
        if (dentro && /^G1 .*[XY].* E\d/.test(l)) salida.push({ x, y });
    }
    return salida;
}
