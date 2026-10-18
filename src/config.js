// Ajustes generales de la app.

// Máximo de triángulos que se lamina sin simplificar la malla. Depende de la
// RAM del equipo (navigator.deviceMemory sólo existe en Chrome/Android; en
// iPhone y Firefox usamos el valor intermedio).
export function maxTriangulos() {
    const gb = navigator.deviceMemory;
    if (gb && gb <= 2) return 100_000;
    if (gb && gb <= 4) return 200_000;
    if (gb && gb >= 8) return 500_000;
    return 250_000;
}

// Máximo de tramos para la vista previa capa por capa (cada uno ocupa 18 bytes).
// Si el G-code tiene más, se muestran sólo las primeras capas que entren.
export function maxSegmentosVista() {
    const gb = navigator.deviceMemory;
    if (gb && gb <= 2) return 1_000_000;
    if (gb && gb <= 4) return 2_000_000;
    if (gb && gb >= 8) return 6_000_000;
    return 3_000_000;
}

// Máximo de piezas distintas en la cama (ADR 0003, sección 6).
export const MAX_PIEZAS = 8;
