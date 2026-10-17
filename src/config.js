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
