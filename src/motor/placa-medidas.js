// Medidas y alturas de la placa QR (ver placa-qr.js). Módulo aparte y sin dependencias para que la UI
// las use sin cargar el generador de QR.

export const PLACA = { ancho: 100, alto: 150, base: 1.6, relieve: 2.2, destacado: 2.6 };
/** Alturas (mm) donde hay que cambiar el filamento y el color de cada tramo, de abajo hacia arriba. */
export const PAUSAS_PLACA = [PLACA.base, PLACA.relieve];
export const COLORES_PLACA = ['#ffffff', '#1a1a1a', '#7a1228'];

const ENTRE_PLACAS = 3; // mm entre placas de una misma cama
const BORDE_CAMA = 5; // mm libres entre las placas y el borde de la cama

/**
 * Cuántas placas entran en la cama y dónde va cada una (esquina de abajo a la izquierda, en mm, relativa
 * al conjunto; el laminador lo centra en la cama). Prueba las placas paradas y acostadas (giradas 90°)
 * y se queda con la que entran más.
 * @param {{x: number, y: number}} cama medida de la cama en mm.
 * @returns {{x: number, y: number, girar: boolean}[]} un lugar por placa que entra (vacío si no entra ninguna).
 */
export function lugaresEnCama(cama) {
    const opciones = [false, true].map(girar => {
        const [w, h] = girar ? [PLACA.alto, PLACA.ancho] : [PLACA.ancho, PLACA.alto];
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
