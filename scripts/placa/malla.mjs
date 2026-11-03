// Ayudas para revisar mallas de las pruebas de la placa QR.

// Mínimo y máximo de un eje (0 = X, 1 = Y, 2 = Z).
export function rango(v, k) {
    let min = Infinity,
        max = -Infinity;
    for (let i = k; i < v.length; i += 3) {
        if (v[i] < min) min = v[i];
        if (v[i] > max) max = v[i];
    }
    return [min, max];
}

/** Aristas dirigidas sin su opuesta (0 = malla cerrada y orientada). */
export function cerrada(v) {
    const p = i => `${v[i].toFixed(4)},${v[i + 1].toFixed(4)},${v[i + 2].toFixed(4)}`;
    const cuenta = new Map();
    for (let i = 0; i < v.length; i += 9) {
        for (const [a, b] of [
            [0, 3],
            [3, 6],
            [6, 0],
        ]) {
            const k = `${p(i + a)}|${p(i + b)}`;
            cuenta.set(k, (cuenta.get(k) || 0) + 1);
        }
    }
    let sueltas = 0;
    for (const [k, n] of cuenta) {
        const [a, b] = k.split('|');
        if ((cuenta.get(`${b}|${a}`) || 0) !== n) sueltas++;
    }
    return sueltas;
}

/**
 * Vista de arriba de la placa como imagen RGBA: negro donde hay relieve (tapas por encima de la base),
 * blanco donde no. `ppm` píxeles por mm.
 * @returns {{data: Uint8ClampedArray, width: number, height: number}}
 */
export function vistaDeArriba(v, ppm, ancho = 100, alto = 150) {
    const W = ancho * ppm,
        H = alto * ppm;
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let i = 0; i < v.length; i += 9) {
        const z = [v[i + 2], v[i + 5], v[i + 8]];
        if (Math.min(...z) < 2 || Math.max(...z) - Math.min(...z) > 1e-6) continue; // sólo tapas de relieve
        const pts = [0, 3, 6].map(o => [v[i + o] * ppm, (alto - v[i + o + 1]) * ppm]);
        rellenarTriangulo(data, W, H, pts);
    }
    return { data, width: W, height: H };
}

function rellenarTriangulo(data, W, H, [a, b, c]) {
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const lado = (p, q, x, y) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const [px, py] = [x + 0.5, y + 0.5];
            const s1 = lado(a, b, px, py),
                s2 = lado(b, c, px, py),
                s3 = lado(c, a, px, py);
            if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0))
                data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
        }
    }
}
