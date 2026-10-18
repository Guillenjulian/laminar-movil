// Ajustes generales de la app.

/**
 * Máximo de triángulos que se lamina sin simplificar la malla (del conjunto, copias incluidas). Depende de la
 * RAM del equipo (navigator.deviceMemory sólo existe en Chrome/Android; en iPhone y Firefox usamos el valor intermedio).
 * @returns {number}
 */
export function maxTriangulos() {
    const gb = navigator.deviceMemory;
    if (gb && gb <= 2) return 100_000;
    if (gb && gb <= 4) return 200_000;
    if (gb && gb >= 8) return 500_000;
    return 250_000;
}

/**
 * Máximo de tramos para la vista previa capa por capa (cada uno ocupa 18 bytes).
 * Si el G-code tiene más, se muestran sólo las primeras capas que entren.
 * @returns {number}
 */
export function maxSegmentosVista() {
    const gb = navigator.deviceMemory;
    if (gb && gb <= 2) return 1_000_000;
    if (gb && gb <= 4) return 2_000_000;
    if (gb && gb >= 8) return 6_000_000;
    return 3_000_000;
}

/** Máximo de piezas distintas que se pueden cargar a la vez (ADR 0003). */
export const MAX_PIEZAS = 8;

/** Separación (mm) entre piezas y entre el bloque de piezas y el borde de la cama al acomodarlas (ADR 0003). */
export const SEPARACION_PIEZAS_MM = 10;

/**
 * Máximo de copias totales (suma de las copias de todas las piezas) según la RAM del equipo:
 * 2 GB o menos: 6, hasta 4 GB: 12, 8 GB o más: 24, sin dato o intermedio: 16.
 * @returns {number}
 */
export function maxCopias() {
    const gb = navigator.deviceMemory;
    if (gb && gb <= 2) return 6;
    if (gb && gb <= 4) return 12;
    if (gb && gb >= 8) return 24;
    return 16;
}
