// Lectores de otros formatos de modelo (OBJ y 3MF) y escritor de STL binario.
// Todos devuelven lo mismo que leerSTL: un Float32Array con los vértices de
// cada triángulo en orden [x1,y1,z1, x2,y2,z2, x3,y3,z3, ...], en milímetros.
//
// Corren dentro de un worker (convertir.worker.js). El lector de 3MF está en
// formatos-3mf.js y se re-exporta desde acá.

import { leer3MF } from './formatos-3mf.js';

export { leer3MF, leerXML3MF } from './formatos-3mf.js';

// Lee un modelo según la extensión del nombre. Devuelve una promesa.
export async function leerModelo(nombre, buffer) {
    const ext = extension(nombre);
    if (ext === 'obj') return leerOBJ(buffer);
    if (ext === '3mf') return leer3MF(buffer);
    throw new Error(`No sabemos leer archivos .${ext || '?'}. Elegí un STL, OBJ o 3MF.`);
}

export function extension(nombre) {
    const m = /\.([a-z0-9]+)$/i.exec(nombre || '');
    return m ? m[1].toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// OBJ (Wavefront): líneas "v x y z" y "f a b c ...". Cada índice de cara puede
// venir como "v", "v/vt", "v//vn" o "v/vt/vn"; sólo nos importa el primero.
// Los índices empiezan en 1 y los negativos cuentan desde el último vértice
// leído (-1 = el último). Las caras de más de 3 vértices se triangulan en
// abanico (alcanza para caras convexas, que es lo normal).

export function leerOBJ(entrada) {
    const texto = typeof entrada === 'string' ? entrada : new TextDecoder().decode(entrada);
    const vertices = []; // x, y, z de cada "v"
    const salida = [];
    const lineas = texto.split(/\r?\n/);
    for (let n = 0; n < lineas.length; n++) {
        const linea = lineas[n].trim();
        if (linea.startsWith('v ') || linea.startsWith('v\t')) {
            vertices.push(...leerVerticeOBJ(linea, n));
        } else if (linea.startsWith('f ') || linea.startsWith('f\t')) {
            triangularCaraOBJ(leerCaraOBJ(linea, n, vertices.length / 3), vertices, salida);
        }
    }
    if (salida.length === 0) {
        throw new Error('El archivo no parece un OBJ válido: no tiene caras (líneas "f").');
    }
    return new Float32Array(salida);
}

// "v x y z" -> [x, y, z]. `n` es el número de línea (desde 0) para el error.
function leerVerticeOBJ(linea, n) {
    const p = linea.split(/\s+/);
    const x = +p[1],
        y = +p[2],
        z = +p[3];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(`El OBJ tiene un vértice inválido en la línea ${n + 1}.`);
    }
    return [x, y, z];
}

// "f a b c ..." -> índices (desde 0) de los vértices de la cara. `total` es
// cuántos vértices hay leídos hasta ahora (para los índices negativos).
function leerCaraOBJ(linea, n, total) {
    return linea
        .split(/\s+/)
        .slice(1)
        .map(parte => {
            const i = parseInt(parte.split('/')[0], 10);
            const real = i < 0 ? total + i : i - 1;
            if (!Number.isInteger(i) || i === 0 || real < 0 || real >= total) {
                throw new Error(`El OBJ tiene una cara que apunta a un vértice que no existe (línea ${n + 1}).`);
            }
            return real;
        });
}

// Triangula la cara en abanico y agrega las coordenadas a `salida`.
// Una cara de 1 o 2 vértices no es un triángulo: se ignora.
function triangularCaraOBJ(indices, vertices, salida) {
    if (indices.length < 3) return;
    for (let k = 1; k < indices.length - 1; k++) {
        for (const i of [indices[0], indices[k], indices[k + 1]]) {
            salida.push(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
        }
    }
}

// ---------------------------------------------------------------------------
// STL binario: 80 bytes de encabezado, la cantidad de triángulos y 50 bytes por
// triángulo (normal + 3 vértices + 2 bytes sin uso).

export function escribirSTL(v, encabezado = 'Laminar Movil') {
    const n = v.length / 9;
    const buffer = new ArrayBuffer(84 + n * 50);
    const datos = new DataView(buffer);
    const texto = new TextEncoder().encode(encabezado.slice(0, 80));
    new Uint8Array(buffer, 0, texto.length).set(texto);
    datos.setUint32(80, n, true);
    let o = 84;
    for (let t = 0; t < n; t++) {
        const i = t * 9;
        // normal = (b - a) × (c - a), normalizada
        const ux = v[i + 3] - v[i],
            uy = v[i + 4] - v[i + 1],
            uz = v[i + 5] - v[i + 2];
        const wx = v[i + 6] - v[i],
            wy = v[i + 7] - v[i + 1],
            wz = v[i + 8] - v[i + 2];
        let nx = uy * wz - uz * wy,
            ny = uz * wx - ux * wz,
            nz = ux * wy - uy * wx;
        const largo = Math.hypot(nx, ny, nz) || 1;
        nx /= largo;
        ny /= largo;
        nz /= largo;
        datos.setFloat32(o, nx, true);
        datos.setFloat32(o + 4, ny, true);
        datos.setFloat32(o + 8, nz, true);
        o += 12;
        for (let k = 0; k < 9; k++) {
            datos.setFloat32(o, v[i + k], true);
            o += 4;
        }
        o += 2;
    }
    return buffer;
}
