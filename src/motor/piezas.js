// Varias piezas o copias en la cama: funciones puras, sin imports ni DOM (ADR 0003, secciones 2 y 6).
//
//   acomodar            huellas rectangulares -> posiciones en la cama (método de estantes)
//   repartirTriangulos  tope de triángulos por pieza para que el conjunto con copias no pase del máximo
//   validarCantidad     mensaje de error si hay demasiadas piezas o copias

const MIN_TRIANGULOS = 500;

// Estantes a lo largo del eje `a` (el otro eje es `b`). `dim[i] = [a, b]` de cada huella. Devuelve
// esquinas [a0, b0] por índice de entrada, el tamaño del bloque y los índices que se pasan de la cama.
function estantes(dim, limA, limB, sep) {
    const orden = dim.map((_, i) => i).sort((i, j) => dim[j][1] - dim[i][1] || dim[j][0] - dim[i][0] || i - j);
    const esquinas = [];
    const estante = []; // índices del estante abierto
    let usado = 0;
    let y = 0;
    let alto = 0;
    let ancho = 0;
    const fuera = new Set();
    const cerrar = () => {
        if (y + alto > limB) estante.forEach(i => fuera.add(i));
        estante.length = 0;
    };
    for (const i of orden) {
        const [a, b] = dim[i];
        if (estante.length && usado + sep + a > limA) {
            cerrar();
            y += alto + sep;
            usado = 0;
            alto = 0;
        }
        const a0 = estante.length ? usado + sep : 0;
        esquinas[i] = [a0, y];
        estante.push(i);
        usado = a0 + a;
        alto = Math.max(alto, b);
        ancho = Math.max(ancho, usado);
        if (usado > limA) fuera.add(i);
    }
    cerrar();
    return { esquinas, ancho, alto: y + alto, fuera: [...fuera].sort((p, q) => p - q) };
}

// Una variante: `girar` intercambia los ejes (estantes a lo largo de Y). Centros relativos al centro del bloque.
function variante(huellas, cama, sep, girar) {
    const dim = huellas.map(h => (girar ? [h.y, h.x] : [h.x, h.y]));
    const r = girar ? estantes(dim, cama.y - sep, cama.x - sep, sep) : estantes(dim, cama.x - sep, cama.y - sep, sep);
    const posiciones = huellas.map((h, i) => {
        const [a0, b0] = r.esquinas[i];
        const ca = a0 + dim[i][0] / 2 - r.ancho / 2;
        const cb = b0 + dim[i][1] / 2 - r.alto / 2;
        return girar ? { x: cb, y: ca } : { x: ca, y: cb };
    });
    return { posiciones, fuera: r.fuera, alto: girar ? r.ancho : r.alto };
}

/**
 * Acomoda huellas rectangulares en la cama con el método de estantes (filas), sin rotarlas.
 * Una sola huella queda en el centro y entra si cabe sin margen; con varias, el bloque tiene que ser
 * `<= cama - separacion` en ambos ejes. Prueba estantes a lo largo de X y de Y y se queda con la variante
 * que deja menos huellas afuera y, a igual cantidad, la de menor fondo de bloque (empate: la de X).
 * @param {{x:number, y:number}[]} huellas ancho y fondo (mm) de cada copia ya transformada, en el orden de entrada
 * @param {{x:number, y:number}} cama ancho y fondo de la cama (mm)
 * @param {number} separacion mm libres entre huellas y entre el bloque y el borde
 * @returns {{posiciones: {x:number,y:number}[], entra: boolean, fuera: number[]}}
 *   `posiciones[i]` es el centro de `huellas[i]` en mm, relativo al centro de la cama; `fuera` son los índices
 *   (de la entrada) de las huellas que se pasan de la cama, vacío si `entra`. Una huella con medidas no finitas
 *   (NaN, Infinity) cuenta como `fuera`; si la cama o la separación no son finitas, todas.
 */
export function acomodar(huellas, cama, separacion) {
    const camaOk = [cama.x, cama.y, separacion].every(Number.isFinite);
    const mala = huellas.map(h => !camaOk || !Number.isFinite(h.x) || !Number.isFinite(h.y));
    const sanas = huellas.map((h, i) => (mala[i] ? { x: 0, y: 0 } : h));
    const malas = mala.flatMap((m, i) => (m ? [i] : []));
    const r = camaOk
        ? acomodarSanas(sanas, cama, separacion)
        : { posiciones: sanas.map(() => ({ x: 0, y: 0 })), fuera: [] };
    const fuera = [...new Set([...r.fuera, ...malas])].sort((p, q) => p - q);
    return { posiciones: r.posiciones, entra: fuera.length === 0, fuera };
}

// `acomodar` con medidas finitas: una huella sola o las dos variantes de estantes.
function acomodarSanas(huellas, cama, separacion) {
    if (huellas.length === 1) {
        const dentro = huellas[0].x <= cama.x && huellas[0].y <= cama.y;
        return { posiciones: [{ x: 0, y: 0 }], fuera: dentro ? [] : [0] };
    }
    const a = variante(huellas, cama, separacion, false);
    const b = variante(huellas, cama, separacion, true);
    return b.fuera.length < a.fuera.length || (b.fuera.length === a.fuera.length && b.alto < a.alto) ? b : a;
}

/**
 * Tope de triángulos de cada pieza para que el conjunto (con copias) no pase de `maximo`. Reparto
 * proporcional: cada pieza conserva `min(triangulos[i], floor(maximo * triangulos[i] / total) / copias[i])`,
 * con total = Σ triangulos[k] × copias[k]; nunca menos de 500 por pieza (salvo que la pieza ya tenga menos).
 * @param {number[]} triangulos triángulos de cada pieza
 * @param {number[]} copias copias de cada pieza
 * @param {number} maximo tope del conjunto
 * @returns {number[]|number} tope por pieza (puede no ser entero: quien lo usa aplica `Math.floor`), o `Infinity`
 *   si el total ya entra
 */
export function repartirTriangulos(triangulos, copias, maximo) {
    const total = triangulos.reduce((s, t, i) => s + t * copias[i], 0);
    if (total <= maximo) return Infinity;
    return triangulos.map((t, i) =>
        Math.min(t, Math.max(MIN_TRIANGULOS, Math.floor((maximo * t) / total) / copias[i])),
    );
}

/**
 * Texto de error (en español) si hay demasiadas piezas o copias.
 * @param {number} piezas cantidad de piezas distintas
 * @param {number} copias cantidad total de copias
 * @param {number} maxPiezas máximo de piezas distintas
 * @param {number} maxCopias máximo de copias totales
 * @returns {string|null} el mensaje, o `null` si está bien
 */
export function validarCantidad(piezas, copias, maxPiezas, maxCopias) {
    if (piezas > maxPiezas) return `Podés cargar hasta ${maxPiezas} piezas distintas.`;
    if (copias > maxCopias) return `Podés poner hasta ${maxCopias} copias en total.`;
    return null;
}
