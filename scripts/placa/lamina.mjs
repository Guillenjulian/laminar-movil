// Lámina sintética para las pruebas de la placa QR: 320 × 358 px como la de un punto de control, con
// marco azul, dos renglones arriba del QR (el primero bordó) y dos abajo (gris y azul). Los "renglones"
// son letras de bloques con agujeros (una O cuadrada), para probar contornos con huecos.

import { matrizQr } from '../../src/motor/placa-qr.js';

export const URL_PRUEBA = 'https://ejemplo.com.ar/fichar?objetivo=0d16bfae-dd7c-4b43-92e9-58dbb24acdbd';

const ANCHO = 320,
    ALTO = 358;
const AZUL = [22, 51, 94],
    BORDO = [122, 18, 40],
    GRIS = [186, 186, 186],
    NEGRO = [0, 0, 0];

// Un renglón de "letras": bloques de alto `alto` con una O (cuadrado con agujero) cada tres.
function renglon(pintar, x0, y0, letras, alto, color) {
    const ancho = Math.round(alto * 0.7);
    for (let i = 0; i < letras; i++) {
        const x = x0 + i * (ancho + 3);
        pintar(x, y0, ancho, alto, color);
        if (i % 3 === 0) pintar(x + 3, y0 + 3, ancho - 6, alto - 6, [255, 255, 255]);
    }
}

/**
 * @param {{sinQr?: boolean}} [opciones]
 * @returns {{data: Uint8ClampedArray, width: number, height: number}}
 */
export function laminaSintetica({ sinQr = false } = {}) {
    const data = new Uint8ClampedArray(ANCHO * ALTO * 4).fill(255);
    const pintar = (x, y, w, h, [r, g, b]) => {
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) data.set([r, g, b, 255], (j * ANCHO + i) * 4);
    };
    // Marco de 3 px.
    pintar(0, 0, ANCHO, 3, AZUL);
    pintar(0, ALTO - 3, ANCHO, 3, AZUL);
    pintar(0, 0, 3, ALTO, AZUL);
    pintar(ANCHO - 3, 0, 3, ALTO, AZUL);
    renglon(pintar, 130, 12, 5, 13, BORDO);
    renglon(pintar, 30, 32, 20, 16, AZUL);
    if (!sinQr) {
        const m = matrizQr(URL_PRUEBA);
        const modulo = 4;
        const x0 = Math.round((ANCHO - m.length * modulo) / 2),
            y0 = 75;
        m.forEach((fila, f) =>
            fila.forEach((v, c) => v && pintar(x0 + c * modulo, y0 + f * modulo, modulo, modulo, NEGRO)),
        );
    }
    renglon(pintar, 90, 278, 10, 12, GRIS);
    renglon(pintar, 65, 298, 13, 12, AZUL);
    return { data, width: ANCHO, height: ALTO };
}
