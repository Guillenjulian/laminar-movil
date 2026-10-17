// Decimación de mallas por "agrupamiento en grilla" (vertex clustering).
//
// Idea: se divide el espacio en cubitos de lado `celda`; todos los vértices
// que caen en el mismo cubito se funden en uno (el promedio). Los triángulos
// que quedan con dos vértices iguales desaparecen. Es rápido, usa poca
// memoria y alcanza para impresión 3D mientras la celda sea chica comparada
// con la boquilla. No es tan prolijo como otros métodos (QEM), pero es simple.

// Devuelve null si no hace falta decimar; si no, { vertices, original, final, celda }.
export function decimar(vertices, maxTriangulos, alProgresar = () => {}) {
    const original = vertices.length / 9;
    if (original <= maxTriangulos) return null;

    const caja = medirCaja(vertices);
    const area = medirArea(vertices);

    // Estimación inicial: en una superficie, cada celda aporta ~2 triángulos.
    let celda = Math.sqrt((2 * area) / maxTriangulos);
    let resultado;
    for (let intento = 0; intento < 8; intento++) {
        alProgresar(intento / 8);
        resultado = agrupar(vertices, celda, caja);
        if (resultado.triangulos <= maxTriangulos) break;
        // Si quedaron de más, agrandamos la celda en proporción y probamos de nuevo.
        celda *= Math.sqrt(resultado.triangulos / maxTriangulos) * 1.05;
    }
    alProgresar(1);
    return { vertices: resultado.vertices, original, final: resultado.triangulos, celda };
}

function medirCaja(v) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            if (v[i + k] < min[k]) min[k] = v[i + k];
            if (v[i + k] > max[k]) max[k] = v[i + k];
        }
    }
    return { min, max };
}

function medirArea(v) {
    let area = 0;
    for (let i = 0; i < v.length; i += 9) {
        const ax = v[i + 3] - v[i], ay = v[i + 4] - v[i + 1], az = v[i + 5] - v[i + 2];
        const bx = v[i + 6] - v[i], by = v[i + 7] - v[i + 1], bz = v[i + 8] - v[i + 2];
        const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
        area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    }
    return area;
}

function agrupar(v, celda, { min, max }) {
    const inv = 1 / celda;
    const nx = Math.floor((max[0] - min[0]) * inv) + 1;
    const ny = Math.floor((max[1] - min[1]) * inv) + 1;

    // 1. Asignar cada vértice a su celda y acumular posiciones para promediar.
    const celdas = new Map();          // clave de celda -> índice de vértice nuevo
    let sumas = new Float64Array(3 * 1024);
    let cuenta = new Uint32Array(1024);
    const indice = new Uint32Array(v.length / 3);
    for (let j = 0, i = 0; i < v.length; i += 3, j++) {
        const ix = Math.floor((v[i] - min[0]) * inv);
        const iy = Math.floor((v[i + 1] - min[1]) * inv);
        const iz = Math.floor((v[i + 2] - min[2]) * inv);
        const clave = ix + nx * (iy + ny * iz);
        let id = celdas.get(clave);
        if (id === undefined) {
            id = celdas.size;
            celdas.set(clave, id);
            if (id >= cuenta.length) {
                // agrandar los arreglos al doble
                const s = new Float64Array(sumas.length * 2); s.set(sumas); sumas = s;
                const c = new Uint32Array(cuenta.length * 2); c.set(cuenta); cuenta = c;
            }
        }
        sumas[id * 3] += v[i]; sumas[id * 3 + 1] += v[i + 1]; sumas[id * 3 + 2] += v[i + 2];
        cuenta[id]++;
        indice[j] = id;
    }

    // 2. Rearmar triángulos, salteando los degenerados y los repetidos.
    const vistos = new Set();
    const tris = [];
    for (let j = 0; j < indice.length; j += 3) {
        const a = indice[j], b = indice[j + 1], c = indice[j + 2];
        if (a === b || b === c || a === c) continue;
        const ordenados = [a, b, c].sort((x, y) => x - y).join(',');
        if (vistos.has(ordenados)) continue;
        vistos.add(ordenados);
        tris.push(a, b, c);
    }

    // 3. Escribir el resultado con las posiciones promedio.
    const salida = new Float32Array(tris.length * 3);
    for (let t = 0; t < tris.length; t++) {
        const id = tris[t], n = cuenta[id];
        salida[t * 3] = sumas[id * 3] / n;
        salida[t * 3 + 1] = sumas[id * 3 + 1] / n;
        salida[t * 3 + 2] = sumas[id * 3 + 2] / n;
    }
    return { vertices: salida, triangulos: tris.length / 3 };
}
