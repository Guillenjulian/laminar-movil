// Pruebas del MD5 incremental (Node, sin navegador): vectores de RFC 1321, igualdad con node:crypto en bordes de
// bloque y con 5 MB pseudoaleatorios, independencia del troceado, mayúsculas y cierre.

import { createHash } from 'node:crypto';
import { Md5, md5Hex } from '../../src/motor/md5.js';

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
    vectoresYBordes(revisar);
    troceado(revisar);
    cierre(revisar);
    rendimiento(revisar);
}
