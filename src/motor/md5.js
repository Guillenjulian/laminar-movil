// MD5 incremental (RFC 1321), sin imports y sin DOM, para el .gcode.md5 del .gcode.3mf de Bambu (ADR 0005).
// Existe porque WebCrypto no ofrece MD5. Flujo: `agregar` va completando bloques de 64 bytes y procesa cada uno
// con `bloque` (64 rondas con las tablas K y S); `hex` cierra con el relleno (0x80, ceros y largo en bits) y
// devuelve el resumen. Todo con enteros de 32 bits (`| 0`), sin armar strings por byte.

// K[i] = floor(2^32 × |sen(i + 1)|) y S = rotaciones por ronda, según el RFC
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
const S = new Uint8Array([
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
    21,
]);

// Si la máquina es big-endian hay que dar vuelta los bytes de las palabras leídas directo del buffer del usuario
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * Procesa un bloque de 64 bytes (16 palabras little-endian) y actualiza el estado en el lugar.
 * @param {Int32Array} estado A, B, C, D
 * @param {Int32Array} m el bloque como 16 palabras
 */
function bloque(estado, m) {
    let a = estado[0],
        b = estado[1],
        c = estado[2],
        d = estado[3];
    for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) {
            f = (b & c) | (~b & d);
            g = i;
        } else if (i < 32) {
            f = (d & b) | (~d & c);
            g = (5 * i + 1) & 15;
        } else if (i < 48) {
            f = b ^ c ^ d;
            g = (3 * i + 5) & 15;
        } else {
            f = c ^ (b | ~d);
            g = (7 * i) & 15;
        }
        const suma = (a + f + K[i] + m[g]) | 0;
        a = d;
        d = c;
        c = b;
        b = (b + ((suma << S[i]) | (suma >>> (32 - S[i])))) | 0;
    }
    estado[0] += a;
    estado[1] += b;
    estado[2] += c;
    estado[3] += d;
}

/**
 * MD5 incremental sobre bytes (RFC 1321). Mismo resultado que `crypto.createHash('md5')`.
 * Los trozos pueden ser de cualquier tamaño; el resultado no depende de cómo se parta el contenido.
 */
export class Md5 {
    constructor() {
        this.estado = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
        this.pendiente = new Uint8Array(64); // bytes que todavía no completan un bloque
        this.palabras = new Int32Array(16);
        this.vista = new DataView(this.pendiente.buffer);
        this.largo = 0; // bytes recibidos (Number: alcanza hasta 2^53)
        this.cerrado = false;
    }

    /**
     * Suma bytes al cálculo.
     * @param {Uint8Array} trozo bytes a sumar; se pueden dar en varios trozos de cualquier tamaño
     * @returns {Md5} this (encadenable)
     */
    agregar(trozo) {
        if (this.cerrado) throw new Error('El MD5 ya está cerrado.');
        const enBloque = this.largo & 63;
        this.largo += trozo.length;
        let pos = 0;
        if (enBloque) {
            // primero completo el bloque que quedó a medias
            pos = Math.min(64 - enBloque, trozo.length);
            this.pendiente.set(trozo.subarray(0, pos), enBloque);
            if (enBloque + pos < 64) return this;
            this.procesarPendiente();
        }
        pos = this.bloquesEnteros(trozo, pos);
        this.pendiente.set(trozo.subarray(pos));
        return this;
    }

    /** Procesa todos los bloques completos de `trozo` desde `pos`; devuelve dónde quedó. */
    bloquesEnteros(trozo, pos) {
        const completos = (trozo.length - pos) >> 6;
        const base = trozo.byteOffset + pos;
        if (completos && LITTLE_ENDIAN && (base & 3) === 0) {
            // camino rápido: leo las palabras directo del buffer, sin copiar
            const palabras = new Int32Array(trozo.buffer, base, completos * 16);
            for (let i = 0; i < completos; i++) bloque(this.estado, palabras.subarray(i * 16, i * 16 + 16));
        } else {
            for (let i = 0; i < completos; i++) {
                this.pendiente.set(trozo.subarray(pos + i * 64, pos + i * 64 + 64));
                this.procesarPendiente();
            }
        }
        return pos + completos * 64;
    }

    /** Procesa `pendiente` (64 bytes) leyéndolo como little-endian sin importar el endian de la máquina. */
    procesarPendiente() {
        for (let i = 0; i < 16; i++) this.palabras[i] = this.vista.getInt32(i * 4, true);
        bloque(this.estado, this.palabras);
    }

    /**
     * Cierra el cálculo. No se puede volver a llamar a `agregar` después.
     * @param {boolean} [mayusculas=false] true para devolver el resumen en mayúsculas
     * @returns {string} 32 caracteres hexadecimales
     */
    hex(mayusculas = false) {
        if (!this.cerrado) {
            const enBloque = this.largo & 63;
            this.pendiente[enBloque] = 0x80;
            this.pendiente.fill(0, enBloque + 1);
            if (enBloque >= 56) {
                // el largo no entra: va en un bloque extra
                this.procesarPendiente();
                this.pendiente.fill(0);
            }
            // largo en bits, 64 bits little-endian
            this.vista.setUint32(56, (this.largo * 8) >>> 0, true);
            this.vista.setUint32(60, Math.floor(this.largo / 536870912) >>> 0, true);
            this.procesarPendiente();
            this.cerrado = true;
        }
        let salida = '';
        for (let i = 0; i < 16; i++) {
            const byte = (this.estado[i >> 2] >>> ((i & 3) * 8)) & 255;
            salida += (byte < 16 ? '0' : '') + byte.toString(16);
        }
        return mayusculas ? salida.toUpperCase() : salida;
    }
}

/**
 * Atajo de una sola pasada.
 * @param {Uint8Array} bytes contenido completo
 * @returns {string} 32 hex en minúsculas
 */
export function md5Hex(bytes) {
    return new Md5().agregar(bytes).hex();
}
