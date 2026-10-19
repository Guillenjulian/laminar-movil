// Niveles de simplificación del lector de recorridos (ADR 0006, decisión 2). Puro, sin imports.
// Cuanto mayor el nivel, más tramos casi alineados se unen. El nivel 0 es el comportamiento de siempre.

/**
 * Un elemento por nivel (0 a 3): `desvio` es cuánto (mm) se puede apartar de la recta cualquiera de los puntos
 * que se sacan; `largoCurva` es el largo máximo (mm) de un tramo unido que no es recto.
 * @type {ReadonlyArray<{desvio: number, largoCurva: number}>}
 */
export const NIVELES = [
    { desvio: 0.02, largoCurva: 3 },
    { desvio: 0.08, largoCurva: 10 },
    { desvio: 0.15, largoCurva: 20 },
    { desvio: 0.3, largoCurva: 40 },
];

/**
 * Fracción de tramos que deja cada nivel respecto del 0 (valores prudentes: el peor de 5 G-codes sintéticos, ver ADR 0006 §2).
 * @type {ReadonlyArray<number>}
 */
export const REDUCCION = [1, 0.88, 0.7, 0.52];

/**
 * Nivel más bajo, mayor que `desde`, con el que se espera que entren `proyectado` tramos en `maxSegmentos`
 * (con 10 % de margen); si ninguno alcanza, el 3.
 * @param {number} proyectado tramos que daría el nivel `desde`
 * @param {number} maxSegmentos
 * @param {0|1|2} desde
 * @returns {1|2|3}
 */
export function siguienteNivel(proyectado, maxSegmentos, desde) {
    for (let n = desde + 1; n < 3; n++) {
        if ((proyectado * REDUCCION[n]) / REDUCCION[desde] <= 0.9 * maxSegmentos) return n;
    }
    return 3;
}
