// PNG mínimo en escala de grises para las pruebas de litofanía.

import zlib from 'node:zlib';

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
});

function crc(bytes) {
    let c = 0xffffffff;
    for (const x of bytes) c = TABLA_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function bloque(tipo, datos) {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(cuerpo));
    return Buffer.concat([largo, cuerpo, c]);
}

/**
 * PNG de 8 bits en escala de grises.
 * @param {number} ancho
 * @param {number} alto
 * @param {(x: number, y: number) => number} gris valor 0–255 de cada píxel
 * @returns {Buffer}
 */
export function pngGrises(ancho, alto, gris) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(ancho, 0);
    ihdr.writeUInt32BE(alto, 4);
    ihdr[8] = 8; // 8 bits por píxel, tipo 0 = escala de grises
    const filas = Buffer.alloc((ancho + 1) * alto); // cada fila empieza con el filtro 0
    for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) filas[y * (ancho + 1) + 1 + x] = gris(x, y);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        bloque('IHDR', ihdr),
        bloque('IDAT', zlib.deflateSync(filas)),
        bloque('IEND', Buffer.alloc(0)),
    ]);
}
