// Contornos de una máscara de píxeles (sin DOM: corre en workers y en Node).
//
// Responsabilidad: pasar una máscara binaria (1 = tinta) a polígonos con agujeros, listos para
// extruir. Lo usa la placa QR (ver placa-qr.js) para pasar a relieve los textos recortados de una
// imagen.
//
// Flujo: trazarBordes (bordes entre píxel con tinta y sin tinta, encadenados en lazos) ->
// simplificar (Ramer-Douglas-Peucker: la escalera de píxeles pasa a diagonales) -> agrupar (cada
// agujero va con el contorno que lo encierra). Coordenadas: x a la derecha, y hacia abajo, en píxeles
// de la máscara.

/**
 * Lazos cerrados que separan la tinta del fondo. Los contornos de afuera giran en un sentido y los de
 * los agujeros en el otro (ver `area`). Dos píxeles que se tocan sólo por la esquina quedan en lazos
 * distintos.
 * @param {Uint8Array} mascara ancho × alto, 1 = tinta.
 * @param {number} ancho
 * @param {number} alto
 * @returns {number[][]} cada lazo como [x0, y0, x1, y1, ...] (sin repetir el primer punto).
 */
export function trazarBordes(mascara, ancho, alto) {
    mascara = sinDiagonales(mascara, ancho, alto);
    const tinta = (x, y) => x >= 0 && y >= 0 && x < ancho && y < alto && mascara[y * ancho + x] === 1;
    const W = ancho + 1;
    const salen = new Map(); // vértice -> lados que salen de él: [dx, dy]
    const agregar = (x, y, dx, dy) => {
        const k = y * W + x;
        if (!salen.has(k)) salen.set(k, []);
        salen.get(k).push([dx, dy]);
    };
    // La tinta queda siempre a la derecha del sentido de avance (con y hacia abajo).
    for (let y = 0; y < alto; y++) {
        for (let x = 0; x < ancho; x++) {
            if (!tinta(x, y)) continue;
            if (!tinta(x, y - 1)) agregar(x, y, 1, 0);
            if (!tinta(x + 1, y)) agregar(x + 1, y, 0, 1);
            if (!tinta(x, y + 1)) agregar(x + 1, y + 1, -1, 0);
            if (!tinta(x - 1, y)) agregar(x, y + 1, 0, -1);
        }
    }
    const lazos = [];
    for (const [inicio, lados] of salen) {
        while (lados.length) lazos.push(seguirLazo(salen, inicio, lados.pop(), W));
    }
    return lazos;
}

// Copia de la máscara sin píxeles que se tocan sólo por la esquina: en cada cuadro de 2 × 2 en diagonal
// rellena uno de los vacíos. Así ningún lazo comparte vértices con otro y, al simplificar, los
// contornos no se pisan (un contorno pisado deja la malla abierta).
function sinDiagonales(mascara, ancho, alto) {
    const m = mascara.slice();
    // Rellenar un píxel puede armar otra diagonal con la fila de arriba: se repite hasta que no cambie nada.
    for (let cambio = true; cambio;) {
        cambio = false;
        for (let y = 0; y + 1 < alto; y++) {
            for (let x = 0; x + 1 < ancho; x++) {
                const i = y * ancho + x;
                const [a, b, c, d] = [m[i], m[i + 1], m[i + ancho], m[i + ancho + 1]];
                if (a && d && !b && !c) m[i + 1] = cambio = 1;
                else if (b && c && !a && !d) m[i] = cambio = 1;
            }
        }
    }
    return m;
}

// Recorre un lazo desde `inicio` saliendo por `lado`, consumiendo los lados que usa. En un vértice con
// dos salidas dobla hacia la tinta (a la derecha), así los píxeles en diagonal quedan separados.
function seguirLazo(salen, inicio, lado, W) {
    const puntos = [];
    let k = inicio;
    let [dx, dy] = lado;
    for (;;) {
        puntos.push(k % W, Math.floor(k / W));
        k += dy * W + dx;
        if (k === inicio) return puntos;
        const opciones = salen.get(k);
        const i = elegirSalida(opciones, dx, dy);
        [dx, dy] = opciones.splice(i, 1)[0];
    }
}

function elegirSalida(opciones, dx, dy) {
    const preferidas = [
        [-dy, dx], // a la derecha
        [dx, dy], // derecho
        [dy, -dx], // a la izquierda
    ];
    for (const [px, py] of preferidas) {
        const i = opciones.findIndex(([ox, oy]) => ox === px && oy === py);
        if (i >= 0) return i;
    }
    return 0;
}

/**
 * Área con signo (fórmula del cordón). Con y hacia abajo, los contornos de tinta de trazarBordes dan
 * positivo y los agujeros, negativo.
 * @param {number[]} p lazo [x0, y0, ...]
 * @returns {number}
 */
export function area(p) {
    let s = 0;
    for (let i = 0, n = p.length; i < n; i += 2) {
        const j = (i + 2) % n;
        s += p[i] * p[j + 1] - p[j] * p[i + 1];
    }
    return s / 2;
}

/**
 * Simplifica un lazo cerrado con Ramer-Douglas-Peucker: saca los puntos que se apartan menos de
 * `tolerancia` de la recta entre sus vecinos. Deja al menos 3 puntos.
 * @param {number[]} p lazo [x0, y0, ...]
 * @param {number} tolerancia en las mismas unidades que p.
 * @returns {number[]}
 */
export function simplificar(p, tolerancia) {
    const n = p.length / 2;
    if (n <= 3) return p.slice();
    // Partimos el lazo en el punto más lejano al primero y simplificamos las dos mitades.
    let lejos = 0;
    let max = -1;
    for (let i = 1; i < n; i++) {
        const d = (p[2 * i] - p[0]) ** 2 + (p[2 * i + 1] - p[1]) ** 2;
        if (d > max) [max, lejos] = [d, i];
    }
    const quedan = new Uint8Array(n);
    quedan[0] = quedan[lejos] = 1;
    rdp(p, 0, lejos, tolerancia * tolerancia, quedan);
    rdp(p, lejos, n, tolerancia * tolerancia, quedan);
    const salida = [];
    for (let i = 0; i < n; i++) if (quedan[i]) salida.push(p[2 * i], p[2 * i + 1]);
    return salida.length >= 6 ? salida : p.slice();
}

// Marca en `quedan` los puntos entre a y b (b puede ser n: vuelve al 0) que hay que conservar.
function rdp(p, a, b, tol2, quedan) {
    const n = p.length / 2;
    const pila = [[a, b]];
    while (pila.length) {
        const [i, j] = pila.pop();
        const ax = p[2 * i],
            ay = p[2 * i + 1],
            bx = p[2 * (j % n)],
            by = p[2 * (j % n) + 1];
        let max = -1;
        let k = -1;
        for (let m = i + 1; m < j; m++) {
            const d = distancia2(p[2 * m], p[2 * m + 1], ax, ay, bx, by);
            if (d > max) [max, k] = [d, m];
        }
        if (k >= 0 && max > tol2) {
            quedan[k] = 1;
            pila.push([i, k], [k, j]);
        }
    }
}

// Distancia al cuadrado del punto (x, y) al segmento a-b.
function distancia2(x, y, ax, ay, bx, by) {
    const vx = bx - ax,
        vy = by - ay;
    const l2 = vx * vx + vy * vy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
    return (x - ax - t * vx) ** 2 + (y - ay - t * vy) ** 2;
}

/**
 * Junta cada agujero con el contorno de afuera más chico que lo encierra.
 * @param {number[][]} lazos salida de trazarBordes (simplificada o no).
 * @returns {{afuera: number[], agujeros: number[][]}[]}
 */
export function agrupar(lazos) {
    const formas = lazos.filter(l => area(l) > 0).map(afuera => ({ afuera, agujeros: [], a: area(afuera) }));
    formas.sort((f, g) => f.a - g.a); // de la más chica a la más grande
    for (const hueco of lazos.filter(l => area(l) < 0)) {
        const [x, y] = puntoDelHueco(hueco);
        const duena = formas.find(f => adentro(f.afuera, x, y));
        if (duena) duena.agujeros.push(hueco);
    }
    return formas.map(({ afuera, agujeros }) => ({ afuera, agujeros }));
}

// Un punto apenas adentro del hueco: el medio del primer lado, corrido hacia la izquierda (la tinta va a
// la derecha). Un vértice del hueco no sirve: puede caer justo sobre el contorno de afuera.
function puntoDelHueco(h) {
    const dx = h[2] - h[0],
        dy = h[3] - h[1];
    const l = Math.hypot(dx, dy) || 1;
    return [(h[0] + h[2]) / 2 + (dy / l) * 1e-3, (h[1] + h[3]) / 2 - (dx / l) * 1e-3];
}

// Punto en polígono (par-impar).
function adentro(p, x, y) {
    let dentro = false;
    for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) {
        const xi = p[i],
            yi = p[i + 1],
            xj = p[j],
            yj = p[j + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
}

/**
 * Grosor medio de los trazos de una máscara: 2 × área / perímetro (en píxeles). Para trazos finos
 * (letras) da aproximadamente su ancho.
 * @param {Uint8Array} m máscara ancho × alto, 1 = tinta.
 * @returns {number} 0 si no hay tinta.
 */
export function grosorMedio(m, ancho, alto) {
    let superficie = 0,
        borde = 0;
    const tinta = (x, y) => x >= 0 && y >= 0 && x < ancho && y < alto && m[y * ancho + x] === 1;
    for (let y = 0; y < alto; y++) {
        for (let x = 0; x < ancho; x++) {
            if (!tinta(x, y)) continue;
            superficie++;
            borde += !tinta(x - 1, y) + !tinta(x + 1, y) + !tinta(x, y - 1) + !tinta(x, y + 1);
        }
    }
    return borde ? (2 * superficie) / borde : 0;
}

/**
 * Engorda la tinta `r` píxeles para cada lado (dilatación con un cuadrado de 2r + 1).
 * @param {Uint8Array} m máscara ancho × alto, 1 = tinta.
 * @param {number} r píxeles (entero >= 0).
 * @returns {Uint8Array} máscara nueva.
 */
export function engordar(m, ancho, alto, r) {
    if (r <= 0) return m;
    const horizontal = new Uint8Array(m.length);
    for (let y = 0; y < alto; y++) pasada(m, horizontal, y * ancho, 1, ancho, r);
    const salida = new Uint8Array(m.length);
    for (let x = 0; x < ancho; x++) pasada(horizontal, salida, x, ancho, alto, r);
    return salida;
}

// Una línea (fila o columna) de la dilatación: cuenta la tinta dentro de la ventana de ±r.
function pasada(origen, destino, inicio, paso, largo, r) {
    let suma = 0;
    for (let i = 0; i < Math.min(r, largo); i++) suma += origen[inicio + i * paso];
    for (let i = 0; i < largo; i++) {
        if (i + r < largo) suma += origen[inicio + (i + r) * paso];
        if (i - r - 1 >= 0) suma -= origen[inicio + (i - r - 1) * paso];
        destino[inicio + i * paso] = suma > 0 ? 1 : 0;
    }
}
