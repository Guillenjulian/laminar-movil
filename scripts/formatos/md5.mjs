// Pruebas del MD5 incremental (Node, sin navegador): vectores de RFC 1321, igualdad con node:crypto en bordes de
// bloque y con 5 MB pseudoaleatorios, independencia del troceado, mayúsculas y cierre.

import { createHash } from 'node:crypto';
import { Md5, md5Hex, TABLA_K } from '../../src/motor/md5.js';

const codificar = s => new TextEncoder().encode(s);
const referencia = bytes => createHash('md5').update(bytes).digest('hex');

// pseudoaleatorio con semilla fija (xorshift32)
function aleatorios(n, semilla = 12345) {
    const b = new Uint8Array(n);
    let x = semilla;
    for (let i = 0; i < n; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        b[i] = x & 255;
    }
    return b;
}

function enTrozos(bytes, tam) {
    const m = new Md5();
    for (let i = 0; i < bytes.length; i += tam) m.agregar(bytes.subarray(i, i + tam));
    return m.hex();
}

function vectoresYBordes(revisar) {
    const vectores = [
        ['', 'd41d8cd98f00b204e9800998ecf8427e'],
        ['a', '0cc175b9c0f1b6a831c399e269772661'],
        ['abc', '900150983cd24fb0d6963f7d28e17f72'],
        ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
        ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
        ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
        ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
    ];
    for (const [texto, esperado] of vectores) {
        const real = md5Hex(codificar(texto));
        revisar(`md5: vector RFC 1321 "${texto.slice(0, 20)}"`, real === esperado, real);
    }

    const bordes = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128];
    const malos = bordes.filter(n => md5Hex(aleatorios(n, n + 1)) !== referencia(aleatorios(n, n + 1)));
    revisar('md5: igual a node:crypto con 0 a 128 bytes (bordes de bloque)', malos.length === 0, malos.join());
}

function troceado(revisar) {
    const grande = aleatorios(5 * 1024 * 1024);
    const ref = referencia(grande);
    revisar('md5: 5 MB pseudoaleatorios igual a node:crypto', md5Hex(grande) === ref);
    revisar('md5: 5 MB en trozos de 7 bytes', enTrozos(grande, 7) === ref);
    revisar('md5: 5 MB en trozos de 4 MB', enTrozos(grande, 4 * 1024 * 1024) === ref);
    const chico = aleatorios(1000);
    revisar('md5: 1000 bytes de a 1 byte', enTrozos(chico, 1) === referencia(chico));
    // vista con byteOffset impar: no puede usar el camino rápido y tiene que dar igual
    const desplazado = new Uint8Array(grande.buffer, 1, 100001);
    revisar('md5: vista con byteOffset impar', md5Hex(desplazado) === referencia(desplazado));
}

function cierre(revisar) {
    const abc = new Md5().agregar(codificar('abc'));
    revisar('md5: agregar devuelve el mismo Md5', abc.agregar(new Uint8Array(0)) === abc);
    const mayus = abc.hex(true);
    revisar('md5: hex(true) en mayúsculas', mayus === '900150983CD24FB0D6963F7D28E17F72', mayus);
    revisar('md5: hex repetido da lo mismo', abc.hex() === '900150983cd24fb0d6963f7d28e17f72');
    let mensaje = '';
    try {
        abc.agregar(codificar('x'));
    } catch (e) {
        mensaje = e.message;
    }
    revisar('md5: agregar después de hex tira error', mensaje === 'El MD5 ya está cerrado.', mensaje);
}

function rendimiento(revisar) {
    const g40 = aleatorios(40 * 1024 * 1024, 99);
    const t0 = performance.now();
    const h40 = md5Hex(g40);
    const ms = Math.round(performance.now() - t0);
    revisar('md5: 40 MB igual a node:crypto', h40 === referencia(g40), `(${ms} ms)`);
}

/** @param {{ revisar: (nombre: string, condicion: boolean, detalle?: string) => void }} ctx */
export function probarMd5({ revisar }) {
    console.log('\n▶ MD5');
    vectoresYBordes(revisar);
    troceado(revisar);
    cierre(revisar);
    largoYTabla(revisar);
    rendimiento(revisar);
}

// Referencia independiente (BigInt, sin Int32Array ni tablas del módulo): MD5 de un mensaje de `largo` bytes cuyo
// único bloque en juego es el último, con ceros antes del 0x80 y el estado inicial del RFC. Sirve para fijar `largo`
// a mano (no hay forma de hashear 512 MB reales en una prueba) y ejercitar los 32 bits altos del largo en bits.
function md5SoloRelleno(largo) {
    const M = 0xffffffffn;
    const bloque = new Uint8Array(64);
    bloque[largo % 64] = 0x80;
    new DataView(bloque.buffer).setBigUint64(56, BigInt(largo) * 8n, true);
    const m = Array.from({ length: 16 }, (_, i) => BigInt(new DataView(bloque.buffer).getUint32(i * 4, true)));
    const ini = [0x67452301n, 0xefcdab89n, 0x98badcfen, 0x10325476n];
    let [a, b, c, d] = ini;
    const rot = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) {
        const [f, g] = [
            [(b & c) | (~b & M & d), i],
            [(d & b) | (~d & M & c), (5 * i + 1) % 16],
            [b ^ c ^ d, (3 * i + 5) % 16],
            [c ^ (b | (~d & M)), (7 * i) % 16],
        ][i >> 4];
        const k = BigInt(Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
        const s = BigInt(rot[(i >> 4) * 4 + (i % 4)]);
        const t = (a + f + k + m[g]) & M;
        [a, d, c] = [d, c, b];
        b = (b + (((t << s) | (t >> (32n - s))) & M)) & M;
    }
    return [ini[0] + a, ini[1] + b, ini[2] + c, ini[3] + d]
        .map(w => (w & M).toString(16).padStart(8, '0').match(/../g).reverse().join(''))
        .join('');
}

function largoYTabla(revisar) {
    // largo cerca de 2^32 bits (2^29 bytes) y por encima (2^33 bytes): prueban la palabra alta del largo en bits
    for (const largo of [2 ** 29, 2 ** 29 + 3, 2 ** 33 + 5]) {
        const m = new Md5();
        m.largo = largo;
        const real = m.hex();
        revisar(`md5: largo fijado a ${largo} bytes (palabra alta del largo)`, real === md5SoloRelleno(largo), real);
    }
    const formula = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
    revisar(
        'md5: TABLA_K literal coincide con la fórmula floor(2^32 × |sen(i + 1)|)',
        TABLA_K.every((k, i) => k === formula[i]),
    );
}
