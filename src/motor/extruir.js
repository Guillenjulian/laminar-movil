// Extrusión de polígonos 2D a mallas cerradas (sin DOM: corre en workers y en Node).
//
// Responsabilidad: convertir una forma plana (contorno + agujeros, en mm, con y hacia arriba) en los
// triángulos de un prisma entre dos alturas, con las normales hacia afuera. La usa la placa QR.

import earcut from 'earcut';

// Área con signo con y hacia arriba: positiva si el lazo gira en sentido antihorario.
function areaArriba(p) {
    let s = 0;
    for (let i = 0, n = p.length; i < n; i += 2) {
        const j = (i + 2) % n;
        s += p[i] * p[j + 1] - p[j] * p[i + 1];
    }
    return s / 2;
}

// Saca los puntos repetidos y los alineados con sus vecinos. earcut los descarta al triangular las tapas:
// si las paredes los conservaran, tapas y paredes no compartirían los mismos lados y la malla quedaría
// abierta.
function limpiar(p) {
    let q = p;
    for (let cambio = true; cambio && q.length > 6;) {
        cambio = false;
        const r = [];
        const n = q.length;
        for (let i = 0; i < n; i += 2) {
            const [ax, ay] = r.length ? r.slice(-2) : [q[n - 2], q[n - 1]];
            const [bx, by, cx, cy] = [q[i], q[i + 1], q[(i + 2) % n], q[(i + 3) % n]];
            if (Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) < 1e-9) cambio = true;
            else r.push(bx, by);
        }
        q = r;
    }
    return q;
}

// Copia del lazo girando en el sentido pedido (antihorario = true).
function orientar(p, antihorario) {
    p = limpiar(p);
    if (areaArriba(p) > 0 === antihorario) return p;
    const r = [];
    for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
    return r;
}

/**
 * Agrega a `salida` los triángulos (9 números cada uno) del prisma de una forma entre z0 y z1.
 * Acepta los lazos en cualquier sentido de giro: los ordena acá.
 * @param {{afuera: number[], agujeros: number[][]}} forma lazos [x0, y0, x1, y1, ...] en mm.
 * @param {number} z0 altura de abajo.
 * @param {number} z1 altura de arriba.
 * @param {number[]} salida donde se agregan los vértices.
 * @returns {void}
 */
export function extruir(forma, z0, z1, salida) {
    const afuera = orientar(forma.afuera, true);
    if (afuera.length < 6) return; // se achicó a una línea: no hay nada que extruir
    const anillos = [afuera, ...forma.agujeros.map(h => orientar(h, false)).filter(h => h.length >= 6)];
    const plano = anillos.flat();
    const cortes = [];
    let cuenta = 0;
    for (const a of anillos.slice(0, -1)) cortes.push((cuenta += a.length / 2));
    const tri = earcut(plano, cortes, 2);
    const v = i => [plano[2 * i], plano[2 * i + 1]];
    for (let t = 0; t < tri.length; t += 3) {
        const a = v(tri[t]);
        let [b, c] = [v(tri[t + 1]), v(tri[t + 2])];
        if ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) < 0) [b, c] = [c, b]; // antihorario
        salida.push(a[0], a[1], z1, b[0], b[1], z1, c[0], c[1], z1); // tapa de arriba (mira hacia +z)
        salida.push(a[0], a[1], z0, c[0], c[1], z0, b[0], b[1], z0); // tapa de abajo (mira hacia -z)
    }
    for (const a of anillos) paredes(a, z0, z1, salida);
}

// Paredes de un lazo: contorno antihorario o agujero horario dejan la pieza a la izquierda, así que la
// normal (a la derecha del avance) mira hacia afuera.
function paredes(a, z0, z1, salida) {
    for (let i = 0, n = a.length; i < n; i += 2) {
        const j = (i + 2) % n;
        const [ax, ay, bx, by] = [a[i], a[i + 1], a[j], a[j + 1]];
        salida.push(ax, ay, z0, bx, by, z0, bx, by, z1);
        salida.push(ax, ay, z0, bx, by, z1, ax, ay, z1);
    }
}

/**
 * Rectángulo de x0..x1 × y0..y1 como forma para `extruir`.
 * @returns {{afuera: number[], agujeros: number[][]}}
 */
export function rectangulo(x0, y0, x1, y1) {
    return { afuera: [x0, y0, x1, y0, x1, y1, x0, y1], agujeros: [] };
}
