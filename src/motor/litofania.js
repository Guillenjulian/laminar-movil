// Litofanía (o relieve) a partir de una imagen en escala de grises.
//
// Arma una malla cerrada "acostada" sobre la cama:
//   - arriba, una superficie con un vértice por píxel, a la altura que sale del gris;
//   - abajo, una base plana en Z = 0 (un abanico desde el centro);
//   - alrededor, paredes que unen el borde de arriba con el de abajo.
// Cada arista queda compartida por exactamente 2 triángulos y todas las caras
// miran hacia afuera (vistas desde afuera, los vértices van en sentido antihorario).
//
// Litofanía: lo oscuro queda grueso (a contraluz se ve oscuro). Relieve: lo claro queda alto.

// Opciones:
//   grises: Uint8Array de ancho × alto (0 = negro, 255 = blanco), fila 0 = arriba de la foto
//   ancho, alto: tamaño en píxeles (mínimo 2 × 2)
//   anchoMm: ancho de la imagen en mm (el alto sale de la proporción)
//   minMm, maxMm: espesor mínimo y máximo
//   tipo: 'litofania' | 'relieve'
//   marco: true para agregar un borde de 2 mm al espesor máximo alrededor
// Devuelve un Float32Array de triángulos (como leerSTL).
export const MARCO_MM = 2;

export function generarLitofania({ grises, ancho, alto, anchoMm, minMm, maxMm, tipo = 'litofania', marco = false }) {
    validarOpciones({ grises, ancho, alto, anchoMm, minMm, maxMm });

    const paso = anchoMm / (ancho - 1); // mm entre píxeles vecinos
    // Con marco, agregamos k píxeles de cada lado al espesor máximo.
    const k = marco ? Math.max(1, Math.round(MARCO_MM / paso)) : 0;
    const W = ancho + 2 * k,
        H = alto + 2 * k;
    const z = calcularAlturas({ grises, ancho, alto, minMm, maxMm, tipo }, k, W, H);

    const borde = 2 * (W - 1) + 2 * (H - 1); // vértices del contorno
    const triangulos = 2 * (W - 1) * (H - 1) + borde + 2 * borde;
    const malla = nuevaMalla(new Float32Array(triangulos * 9), { paso, W, H, z });

    agregarSuperficie(malla);
    const contorno = armarContorno(W, H);
    agregarBase(malla, contorno);
    agregarParedes(malla, contorno);
    return malla.v;
}

function validarOpciones({ grises, ancho, alto, anchoMm, minMm, maxMm }) {
    if (!(ancho >= 2 && alto >= 2) || !grises || grises.length < ancho * alto) {
        throw new Error('La imagen es demasiado chica para hacer una litofanía.');
    }
    if (!(anchoMm > 0)) throw new Error('El ancho tiene que ser mayor que 0.');
    if (!(minMm > 0)) throw new Error('El espesor mínimo tiene que ser mayor que 0.');
    if (!(maxMm >= minMm)) throw new Error('El espesor máximo tiene que ser mayor o igual que el mínimo.');
}

// Alturas en una grilla W × H (con `k` píxeles de marco de cada lado). La fila
// r = 0 es el frente de la cama (Y = 0), así que la fila 0 de la foto (arriba)
// va al fondo (Y máximo): vista desde arriba, la imagen se lee derecha.
function calcularAlturas({ grises, ancho, alto, minMm, maxMm, tipo }, k, W, H) {
    const z = new Float32Array(W * H).fill(maxMm);
    const rango = maxMm - minMm;
    for (let j = 0; j < alto; j++) {
        const r = H - 1 - k - j;
        for (let i = 0; i < ancho; i++) {
            const g = grises[j * ancho + i] / 255;
            z[r * W + i + k] = tipo === 'relieve' ? minMm + rango * g : maxMm - rango * g;
        }
    }
    return z;
}

// Buffer de triángulos con un cursor: `punto` agrega un vértice y `arriba` uno de la superficie.
function nuevaMalla(v, { paso, W, H, z }) {
    let o = 0;
    const punto = (x, y, zz) => {
        v[o++] = x;
        v[o++] = y;
        v[o++] = zz;
    };
    return {
        v,
        W,
        H,
        punto,
        X: i => i * paso,
        Y: r => r * paso,
        arriba: (i, r) => punto(i * paso, r * paso, z[r * W + i]),
    };
}

// Superficie de arriba (mira a +Z: antihorario visto desde arriba).
function agregarSuperficie({ W, H, arriba }) {
    for (let r = 0; r < H - 1; r++) {
        for (let i = 0; i < W - 1; i++) {
            arriba(i, r);
            arriba(i + 1, r);
            arriba(i + 1, r + 1);
            arriba(i, r);
            arriba(i + 1, r + 1);
            arriba(i, r + 1);
        }
    }
}

// Contorno en sentido antihorario visto desde arriba: frente, derecha, fondo, izquierda.
function armarContorno(W, H) {
    const contorno = [];
    for (let i = 0; i < W - 1; i++) contorno.push([i, 0]);
    for (let r = 0; r < H - 1; r++) contorno.push([W - 1, r]);
    for (let i = W - 1; i > 0; i--) contorno.push([i, H - 1]);
    for (let r = H - 1; r > 0; r--) contorno.push([0, r]);
    return contorno;
}

// Base (mira a -Z): abanico desde el centro, en sentido horario visto desde arriba.
function agregarBase({ W, H, X, Y, punto }, contorno) {
    const cx = X(W - 1) / 2,
        cy = Y(H - 1) / 2;
    for (let n = 0; n < contorno.length; n++) {
        const [i1, r1] = contorno[n],
            [i2, r2] = contorno[(n + 1) % contorno.length];
        punto(cx, cy, 0);
        punto(X(i2), Y(r2), 0);
        punto(X(i1), Y(r1), 0);
    }
}

// Paredes: para cada tramo p -> q del contorno, el exterior queda a la derecha.
function agregarParedes({ X, Y, punto, arriba }, contorno) {
    for (let n = 0; n < contorno.length; n++) {
        const [i1, r1] = contorno[n],
            [i2, r2] = contorno[(n + 1) % contorno.length];
        punto(X(i1), Y(r1), 0);
        punto(X(i2), Y(r2), 0);
        arriba(i2, r2);
        punto(X(i1), Y(r1), 0);
        arriba(i2, r2);
        arriba(i1, r1);
    }
}

// Tamaño en píxeles para muestrear la foto: ~0,25 mm por píxel y como mucho
// `maxPx` de lado (para no reventar la memoria del celu).
export function resolucionLitofania(anchoImagen, altoImagen, anchoMm, mmPorPixel = 0.25, maxPx = 500) {
    const proporcion = altoImagen / anchoImagen;
    let ancho = Math.round(anchoMm / mmPorPixel) + 1;
    ancho = Math.min(ancho, maxPx, Math.floor((maxPx - 1) / proporcion) + 1);
    ancho = Math.max(2, ancho);
    const alto = Math.max(2, Math.round((ancho - 1) * proporcion) + 1);
    return { ancho, alto };
}
