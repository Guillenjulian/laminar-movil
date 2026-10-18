// Torres de calibración (temperatura y retracción): mallas puras, sin imports ni DOM.
//
// Flujo: opciones -> validar -> contorno 2D + triangulación de la cara -> extruir() -> Float32Array
// de triángulos [x,y,z ×3] en mm (como leerSTL/generarLitofania). La malla queda cerrada (cada arista
// compartida por exactamente 2 triángulos) y con las caras hacia afuera (antihorario visto desde afuera).
// Todas las torres apoyan en Z = 0. Ver ADR 0002, sección 6.

function medida(valor, nombre, def, max) {
    const n = valor === undefined ? def : valor;
    if (!(n > 0 && n <= max)) throw new Error(`${nombre} tiene que ser mayor que 0 y hasta ${max} mm.`);
    return n;
}

/** Bloques de una torre: [{ desdeMm, hastaMm }] de abajo hacia arriba.
 *  @param {{ bloques?: number, altoBloqueMm?: number }} [op] bloques 3..8 (def 5), altoBloqueMm 6..15 (def 10)
 *  @returns {{ desdeMm: number, hastaMm: number }[]} */
export function bloquesDeTorre(op) {
    const { bloques = 5, altoBloqueMm = 10 } = op ?? {};
    if (!Number.isInteger(bloques) || bloques < 3 || bloques > 8) {
        throw new Error('La cantidad de bloques tiene que ser un entero entre 3 y 8.');
    }
    if (!(altoBloqueMm >= 6 && altoBloqueMm <= 15)) {
        throw new Error('El alto del bloque tiene que estar entre 6 y 15 mm.');
    }
    return Array.from({ length: bloques }, (_, i) => ({ desdeMm: i * altoBloqueMm, hastaMm: (i + 1) * altoBloqueMm }));
}

// Extruye un polígono 2D (`tris` son índices sobre `anillo`, antihorario) de w = 0 a w = prof.
// `mapa(u, v, w)` lo ubica en el espacio; `espejo` invierte el giro si el mapa es un espejo.
// Devuelve triángulos [[p, q, r], ...] con p = [x, y, z].
function extruir(anillo, tris, prof, mapa, espejo) {
    const salida = [];
    const poner = (a, b, c) => salida.push(espejo ? [a, c, b] : [a, b, c]);
    const en = (i, w) => mapa(anillo[i][0], anillo[i][1], w);
    for (const [a, b, c] of tris) {
        poner(en(a, prof), en(b, prof), en(c, prof)); // tapa de w = prof: antihorario
        poner(en(a, 0), en(c, 0), en(b, 0)); // tapa de w = 0: al revés
    }
    anillo.forEach((_, i) => {
        const j = (i + 1) % anillo.length;
        poner(en(i, 0), en(j, 0), en(j, prof));
        poner(en(i, 0), en(j, prof), en(i, prof));
    });
    return salida;
}

function aFloat32(triangulos) {
    const v = new Float32Array(triangulos.length * 9);
    triangulos.forEach((t, i) => t.forEach((p, k) => v.set(p, i * 9 + k * 3)));
    return v;
}

// Silueta (x, z) de la torre de temperatura. Anillo antihorario: (0,0), derecha hacia arriba (por bloque:
// vertical, punta del voladizo, escalón de vuelta) y la cara izquierda lisa hacia abajo.
// Cada bloque se parte en un rectángulo y un abanico (el trozo del voladizo es convexo).
function siluetaTemperatura(bloques, ancho, voladizo) {
    const anillo = [
        [0, 0],
        [ancho, 0],
    ];
    const izq = [[0, 0]]; // cara izquierda, de abajo hacia arriba
    for (const { hastaMm: z1 } of bloques) {
        anillo.push([ancho, z1 - voladizo], [ancho + voladizo, z1], [ancho, z1]);
        izq.push([0, z1 - voladizo], [0, z1]);
    }
    const total = anillo.length + izq.length - 1;
    anillo.push(...izq.slice(1).reverse());
    const iz = k => (k === 0 ? 0 : total - k); // índice en el anillo del k-ésimo punto de la izquierda
    const tris = [];
    bloques.forEach((_, b) => {
        const r = 2 + 3 * b; // vértice derecho de abajo (esquina del bloque anterior)
        const [kA, kM, kT] = [2 * b, 2 * b + 1, 2 * b + 2];
        const abajo = b === 0 ? 1 : r - 1;
        tris.push([iz(kA), abajo, r], [iz(kA), r, iz(kM)]);
        tris.push([iz(kM), r, r + 1], [iz(kM), r + 1, r + 2], [iz(kM), r + 2, iz(kT)]);
    });
    return { anillo, tris };
}

/** Torre de temperatura: UNA sola silueta extruida en Y. Cara izquierda lisa; la derecha, por bloque:
 *  vertical hasta (alto - voladizo), luego 45° hacia afuera `voladizoMm` y un escalón plano de vuelta.
 *  @param {{ bloques?: number, altoBloqueMm?: number, anchoMm?: number, profundidadMm?: number,
 *            voladizoMm?: number }} [op] bloques 3..8 (def 5), altoBloqueMm 6..15 (def 10), anchoMm 20,
 *            profundidadMm 15, voladizoMm 5 (menor que el alto del bloque)
 *  @returns {{ vertices: Float32Array, alturaMm: number, bloques: {desdeMm:number,hastaMm:number}[] }} */
export function generarTorreTemperatura(opciones) {
    const op = opciones ?? {};
    const bloques = bloquesDeTorre(op);
    const ancho = medida(op.anchoMm, 'El ancho', 20, 200);
    const prof = medida(op.profundidadMm, 'La profundidad', 15, 200);
    const voladizo = medida(op.voladizoMm, 'El voladizo', 5, 50);
    if (voladizo >= bloques[0].hastaMm) throw new Error('El voladizo tiene que ser menor que el alto del bloque.');
    const { anillo, tris } = siluetaTemperatura(bloques, ancho, voladizo);
    const mapa = (u, v, w) => [u, w, v]; // silueta en (x, z), profundidad en Y (un espejo)
    const vertices = aFloat32(extruir(anillo, tris, prof, mapa, true));
    return { vertices, alturaMm: bloques.at(-1).hastaMm, bloques };
}

/** Torre de retracción: DOS columnas cuadradas de `ladoMm` separadas `separacionMm` (hueco entre caras en
 *  X) y de altura bloques × altoBloqueMm: el viaje entre columnas en cada capa provoca los hilitos.
 *  @param {{ bloques?: number, altoBloqueMm?: number, ladoMm?: number, separacionMm?: number }} [op]
 *         ladoMm def 10, separacionMm def 35
 *  @returns {{ vertices: Float32Array, alturaMm: number, bloques: {desdeMm:number,hastaMm:number}[] }} */
export function generarTorreRetraccion(opciones) {
    const op = opciones ?? {};
    const bloques = bloquesDeTorre(op);
    const lado = medida(op.ladoMm, 'El lado de la columna', 10, 100);
    const separacion = medida(op.separacionMm, 'La separación', 35, 200);
    const alturaMm = bloques.at(-1).hastaMm;
    const triangulos = [];
    for (const x0 of [0, lado + separacion]) {
        const anillo = [
            [x0, 0],
            [x0 + lado, 0],
            [x0 + lado, lado],
            [x0, lado],
        ];
        triangulos.push(
            ...extruir(
                anillo,
                [
                    [0, 1, 2],
                    [0, 2, 3],
                ],
                alturaMm,
                (u, v, w) => [u, v, w],
                false,
            ),
        );
    }
    return { vertices: aFloat32(triangulos), alturaMm, bloques };
}
