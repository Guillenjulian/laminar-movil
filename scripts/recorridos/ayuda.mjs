// Ayudas de las pruebas del lector de recorridos (G-codes sintéticos y offsets a mano).
// El lector de la vista previa es un worker: lo cargamos en Node simulando `self`.
globalThis.self ??= {};
const { leer } = await import('../../src/motor/recorridos.worker.js');

export { leer };

/** Une las líneas en un G-code. */
export const armar = lineas => lineas.join('\n') + '\n';

/** Offset en el texto (en caracteres) de la línea `i`: suma de lo que miden las anteriores. */
export const offsetDe = (lineas, i) => lineas.slice(0, i).reduce((suma, l) => suma + l.length + 1, 0);

/** Lee y devuelve los campos como arrays comunes, para comparar con valores escritos a mano. */
export function leerPlano(lineas, tope = Infinity) {
    const r = leer(armar(lineas), tope);
    return {
        ...r,
        pos: Array.from(r.posiciones),
        tip: Array.from(r.tipos),
        ini: Array.from(r.inicioCapa),
        pausas: Array.from(r.pausaCapa),
        z: Array.from(r.zCapa),
        col: Array.from(r.colores),
    };
}
