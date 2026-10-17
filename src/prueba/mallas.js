// Mallas sintéticas para probar el motor (sólo las usa prueba-motor.html).
// Todas devuelven un ArrayBuffer con un STL binario.

function aSTL(triangulos) {
    const n = triangulos.length / 9;
    const buf = new ArrayBuffer(84 + n * 50);
    const d = new DataView(buf);
    d.setUint32(80, n, true);
    for (let t = 0; t < n; t++) {
        let o = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++, o += 4) d.setFloat32(o, triangulos[t * 9 + k], true);
    }
    return buf;
}

// Esfera UV con ~4·L² triángulos (L=550 da ~1,2 millones).
export function esfera(radio = 40, L = 550) {
    const tris = new Float32Array(4 * L * L * 9);
    let i = 0;
    const p = (a, b) => {
        const th = (a / L) * Math.PI, ph = (b / (2 * L)) * 2 * Math.PI;
        return [radio * Math.sin(th) * Math.cos(ph), radio * Math.sin(th) * Math.sin(ph), radio * Math.cos(th) + radio];
    };
    const tri = (a, b, c) => { for (const v of [a, b, c]) for (const x of v) tris[i++] = x; };
    for (let a = 0; a < L; a++) {
        for (let b = 0; b < 2 * L; b++) {
            const p1 = p(a, b), p2 = p(a + 1, b), p3 = p(a + 1, b + 1), p4 = p(a, b + 1);
            tri(p1, p2, p3);
            tri(p1, p3, p4);
        }
    }
    return aSTL(tris.subarray(0, i));
}

function caja(x0, y0, z0, x1, y1, z1) {
    const q = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    return f.flatMap(t => t.flatMap(v => q[v]));
}

// Una "T": columna de 10×10×20 con una tapa de 50×10×3 arriba (voladizos de 20 mm).
export function te() {
    return aSTL(new Float32Array([...caja(-5, -5, 0, 5, 5, 20), ...caja(-25, -5, 20, 25, 5, 23)]));
}
