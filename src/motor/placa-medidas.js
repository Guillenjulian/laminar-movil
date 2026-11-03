// Medidas y alturas de la placa QR (ver placa-qr.js). Módulo aparte y sin dependencias para que la UI
// las use sin cargar el generador de QR.

export const PLACA = { ancho: 100, alto: 150, base: 1.6, relieve: 2.2, destacado: 2.6 };
/** Alturas (mm) donde hay que cambiar el filamento y el color de cada tramo, de abajo hacia arriba. */
export const PAUSAS_PLACA = [PLACA.base, PLACA.relieve];
export const COLORES_PLACA = ['#ffffff', '#1a1a1a', '#7a1228'];
/** "Sólo QR": cuadrado con el QR adelante y los renglones de arriba de la lámina grabados atrás. */
export const CUADRADO = { ancho: 100, alto: 100, margen: 5, grabado: 0.6 };

/** Medida, pausas y colores de cada formato (lo que la vista previa necesita para poner las pausas solas). */
export const FORMATOS = {
    placa: { ancho: PLACA.ancho, alto: PLACA.alto, pausas: PAUSAS_PLACA, colores: COLORES_PLACA },
    cuadrado: { ancho: CUADRADO.ancho, alto: CUADRADO.alto, pausas: [PLACA.base], colores: COLORES_PLACA.slice(0, 2) },
};

const ENTRE_PLACAS = 3; // mm entre placas de una misma cama
const BORDE_CAMA = 5; // mm libres entre las placas y el borde de la cama

/**
 * Cuántas placas entran en la cama y dónde va cada una (esquina de abajo a la izquierda, en mm, relativa
 * al conjunto; el laminador lo centra en la cama). Prueba las placas paradas y acostadas (giradas 90°)
 * y se queda con la que entran más.
 * @param {{x: number, y: number}} cama medida de la cama en mm.
 * @param {{ancho: number, alto: number}} [medida] de cada pieza (por defecto, la placa de 100 × 150).
 * @returns {{x: number, y: number, girar: boolean}[]} un lugar por placa que entra (vacío si no entra ninguna).
 */
export function lugaresEnCama(cama, medida = PLACA) {
    const opciones = [false, true].map(girar => {
        const [w, h] = girar ? [medida.alto, medida.ancho] : [medida.ancho, medida.alto];
        const cuantas = (largo, lado) =>
            Math.max(0, Math.floor((largo - 2 * BORDE_CAMA + ENTRE_PLACAS) / (lado + ENTRE_PLACAS)));
        const [columnas, filas] = [cuantas(cama.x, w), cuantas(cama.y, h)];
        const lugares = [];
        for (let f = 0; f < filas; f++)
            for (let c = 0; c < columnas; c++)
                lugares.push({ x: c * (w + ENTRE_PLACAS), y: f * (h + ENTRE_PLACAS), girar });
        return lugares;
    });
    return opciones[1].length > opciones[0].length ? opciones[1] : opciones[0];
}
