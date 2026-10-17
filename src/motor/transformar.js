// Transformaciones del modelo: escala, rotaciones de a 90° y "apoyar cara".
//
// Todo son funciones puras sobre matrices de 3×3 guardadas en un Array de 9
// números, fila por fila (row-major):
//
//     [a, b, c,
//      d, e, f,     →   x' = a·x + b·y + c·z, etc.
//      g, h, i]
//
// La matriz lleva coordenadas del modelo original a coordenadas en la
// impresora (Z para arriba). No hay traslación: de centrar el modelo en la
// cama y apoyarlo en Z=0 se encarga el laminador después de transformar.

export function identidad() {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

// a·b: primero se aplica b y después a.
export function multiplicar(a, b) {
    const r = new Array(9);
    for (let f = 0; f < 3; f++) {
        for (let c = 0; c < 3; c++) {
            r[f * 3 + c] = a[f * 3] * b[c] + a[f * 3 + 1] * b[3 + c] + a[f * 3 + 2] * b[6 + c];
        }
    }
    return r;
}

// Rotación de `veces` × 90° alrededor de `eje` ('x', 'y' o 'z'), en sentido
// antihorario mirando desde la punta positiva del eje (regla de la mano
// derecha). Usamos tablas en vez de Math.cos para que los valores sean
// exactos (0, 1, -1) y no aparezcan cosas como 6e-17.
export function rotacion90(eje, veces = 1) {
    const k = ((veces % 4) + 4) % 4;
    const c = [1, 0, -1, 0][k];
    const s = [0, 1, 0, -1][k];
    let m;
    if (eje === 'x') m = [1, 0, 0, 0, c, -s, 0, s, c];
    else if (eje === 'y') m = [c, 0, s, 0, 1, 0, -s, 0, c];
    else if (eje === 'z') m = [c, -s, 0, s, c, 0, 0, 0, 1];
    else throw new Error(`Eje desconocido: ${eje}`);
    return m.map(v => v || 0); // sin -0
}

// Escala uniforme (1 = tamaño original).
export function escala(s) {
    return [s, 0, 0, 0, s, 0, 0, 0, s];
}

// Rotación R tal que R·normal apunta para abajo (0,0,-1): la cara con esa
// normal queda apoyada en la cama. `normal` no hace falta que sea unitaria.
//
// Usamos la fórmula de Rodrigues para llevar el vector n̂ al vector d = (0,0,-1)
// por el camino más corto: eje v = n̂ × d, coseno c = n̂·d y
//     R = I + [v]× + [v]×² / (1 + c)
// La fórmula se vuelve imprecisa cuando n̂ ≈ -d (c ≈ -1, la cara mira para
// arriba), así que si la normal apunta para arriba primero damos media
// vuelta alrededor de X (queda apuntando para abajo) y después corregimos lo
// que falte. Si mira justo para arriba, la media vuelta sola alcanza.
export function rotacionQueApoya(normal) {
    const largo = Math.hypot(normal[0], normal[1], normal[2]);
    if (!(largo > 0)) return identidad();
    const n = [normal[0] / largo, normal[1] / largo, normal[2] / largo];
    if (n[2] > 0) {
        const media = rotacion90('x', 2);
        return multiplicar(rodriguesHaciaAbajo(por(media, n)), media);
    }
    return rodriguesHaciaAbajo(n);
}

// m·p para un punto suelto.
function por(m, p) {
    return [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
        m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
        m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
    ];
}

// Rodrigues para un n̂ unitario con n̂z <= 0 (c >= 0, así que nunca dividimos por ~0).
function rodriguesHaciaAbajo([nx, ny, nz]) {
    const c = -nz; // n̂ · (0,0,-1)
    if (nx === 0 && ny === 0) return identidad(); // ya está apoyada
    // v = n̂ × (0,0,-1) = (-ny, nx, 0)
    const vx = -ny, vy = nx;
    // [v]× (antisimétrica del producto vectorial, con vz = 0)
    const V = [0, 0, vy, 0, 0, -vx, -vy, vx, 0];
    const V2 = multiplicar(V, V);
    const k = 1 / (1 + c);
    return identidad().map((v, i) => v + V[i] + V2[i] * k);
}

export function determinante(m) {
    return m[0] * (m[4] * m[8] - m[5] * m[7])
        - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

// ¿Es la identidad? (con una tolerancia chiquita para errores de redondeo)
export function esIdentidad(m) {
    return identidad().every((v, i) => Math.abs(m[i] - v) < 1e-9);
}

// Aplica m a los vértices [x,y,z, x,y,z, ...] EN EL LUGAR y devuelve el mismo array.
export function aplicar(m, vertices) {
    const v = vertices;
    for (let i = 0; i < v.length; i += 3) {
        const x = v[i], y = v[i + 1], z = v[i + 2];
        v[i] = m[0] * x + m[1] * y + m[2] * z;
        v[i + 1] = m[3] * x + m[4] * y + m[5] * z;
        v[i + 2] = m[6] * x + m[7] * y + m[8] * z;
    }
    // Una matriz con determinante negativo es un espejo: da vuelta el sentido
    // de los triángulos y las normales quedarían para adentro. Para
    // corregirlo intercambiamos el 2º y 3er vértice de cada triángulo.
    // (Todavía no ofrecemos espejar, pero queda resuelto.)
    if (determinante(m) < 0) {
        for (let i = 0; i + 8 < v.length; i += 9) {
            for (let k = 3; k < 6; k++) {
                const t = v[i + k];
                v[i + k] = v[i + k + 3];
                v[i + k + 3] = t;
            }
        }
    }
    return v;
}

// Tamaño { x, y, z } de la caja del modelo ya transformado, SIN modificar los
// vértices. Sirve para mostrar medidas y ver si entra en la cama.
export function medir(m, vertices) {
    const v = vertices;
    if (!v.length) return { x: 0, y: 0, z: 0 };
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < v.length; i += 3) {
        const x = v[i], y = v[i + 1], z = v[i + 2];
        const tx = m[0] * x + m[1] * y + m[2] * z;
        const ty = m[3] * x + m[4] * y + m[5] * z;
        const tz = m[6] * x + m[7] * y + m[8] * z;
        if (tx < x0) x0 = tx;
        if (tx > x1) x1 = tx;
        if (ty < y0) y0 = ty;
        if (ty > y1) y1 = ty;
        if (tz < z0) z0 = tz;
        if (tz > z1) z1 = tz;
    }
    return { x: x1 - x0, y: y1 - y0, z: z1 - z0 };
}
