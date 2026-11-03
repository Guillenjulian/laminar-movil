// Análisis de la imagen de una lámina con QR, para la placa QR (ver motor/placa-qr.js).
//
// Responsabilidad: a partir de los píxeles RGBA de la lámina, encontrar el QR (jsQR), sacar el marco,
// partir el resto de la tinta en renglones de texto, ver cuáles son "destacados" (rojizos: van en bordó)
// y recortar la máscara de cada renglón, agrandada, para pasarla a relieve.
// No toca el DOM: recibe `{ data, width, height }` (como un ImageData), así corre también en Node.

import jsQR from 'jsqr';

const CLARO = 232; // luminancia desde la que un píxel cuenta como fondo
const MM_POR_PIXEL_MASCARA = 0.08; // resolución de las máscaras en la placa
const UMBRAL = 0.42; // un poco menos que la mitad: engorda apenas los trazos finos, para que se puedan imprimir

/**
 * Luminancia de cada píxel, con la transparencia apoyada sobre blanco.
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @returns {Float32Array}
 */
export function luminancias(img) {
    const n = img.width * img.height;
    const lum = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
        const a = img.data[p + 3] / 255;
        const y = 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2];
        lum[i] = y * a + 255 * (1 - a);
    }
    return lum;
}

/**
 * Busca el QR. Devuelve su texto y la caja que ocupa (px, con un margen de un módulo y medio), o null.
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @returns {{texto: string, caja: {x0:number, y0:number, x1:number, y1:number}}|null}
 */
export function buscarQr(img) {
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    if (!r || !r.data) return null;
    const l = r.location;
    const esquinas = [l.topLeftCorner, l.topRightCorner, l.bottomLeftCorner, l.bottomRightCorner];
    const xs = esquinas.map(p => p.x),
        ys = esquinas.map(p => p.y);
    const lado = Math.max(...xs) - Math.min(...xs);
    const margen = (lado / (r.version * 4 + 17)) * 1.5;
    const caja = {
        x0: Math.max(0, Math.floor(Math.min(...xs) - margen)),
        y0: Math.max(0, Math.floor(Math.min(...ys) - margen)),
        x1: Math.min(img.width, Math.ceil(Math.max(...xs) + margen)),
        y1: Math.min(img.height, Math.ceil(Math.max(...ys) + margen)),
    };
    return { texto: r.data, caja };
}

// Borra (pone en blanco) las filas y columnas del borde que son casi todas tinta: el marco de la lámina.
// Devuelve si encontró alguno.
function quitarMarco(lum, w, h) {
    const tintaFila = y => lum.subarray(y * w, (y + 1) * w).filter(v => v < CLARO).length;
    const tintaCol = x => {
        let c = 0;
        for (let y = 0; y < h; y++) if (lum[y * w + x] < CLARO) c++;
        return c;
    };
    const blanquearFila = y => lum.fill(255, y * w, (y + 1) * w);
    const blanquearCol = x => {
        for (let y = 0; y < h; y++) lum[y * w + x] = 255;
    };
    let hay = false;
    const limite = Math.ceil(Math.min(w, h) * 0.05);
    for (const [fila, total, cuenta, blanquear] of [
        [i => i, h, tintaFila, blanquearFila],
        [i => h - 1 - i, h, tintaFila, blanquearFila],
        [i => i, w, tintaCol, blanquearCol],
        [i => w - 1 - i, w, tintaCol, blanquearCol],
    ]) {
        const largo = total === h ? w : h;
        for (let i = 0; i < limite && cuenta(fila(i)) > largo * 0.8; i++) {
            blanquear(fila(i));
            hay = true;
        }
    }
    return hay;
}

// Tramos de filas con tinta: [{y0, y1}] (y1 excluida).
function tramosDeFilas(lum, w, h) {
    const tramos = [];
    let desde = -1;
    for (let y = 0; y <= h; y++) {
        let tinta = false;
        if (y < h) for (let x = 0; x < w && !tinta; x++) tinta = lum[y * w + x] < CLARO;
        if (tinta && desde < 0) desde = y;
        if (!tinta && desde >= 0) {
            tramos.push({ y0: desde, y1: y });
            desde = -1;
        }
    }
    return tramos;
}

// Junta los tramos chiquitos (acentos sueltos, puntos) con el renglón de al lado si están cerca.
function juntarTramos(tramos) {
    const r = [];
    for (const t of tramos) {
        const ant = r.at(-1);
        const alto = t.y1 - t.y0;
        if (ant) {
            const altoAnt = ant.y1 - ant.y0;
            const cerca = t.y0 - ant.y1 <= 0.4 * Math.max(alto, altoAnt);
            if (cerca && (alto < 0.4 * altoAnt || altoAnt < 0.4 * alto)) {
                ant.y1 = t.y1;
                continue;
            }
        }
        r.push({ ...t });
    }
    return r;
}

// Columnas con tinta dentro de las filas y0..y1: [x0, x1) o null si no hay.
function columnas(lum, w, y0, y1) {
    let x0 = w,
        x1 = -1;
    for (let y = y0; y < y1; y++) {
        for (let x = 0; x < w; x++) {
            if (lum[y * w + x] < CLARO) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
            }
        }
    }
    return x1 < 0 ? null : [x0, x1 + 1];
}

// Color de la tinta de un renglón: promedio de sus píxeles más oscuros. Devuelve [r, g, b] y su luminancia.
function colorDeTinta(img, lum, w, b) {
    const valores = [];
    for (let y = b.y0; y < b.y0 + b.alto; y++)
        for (let x = b.x0; x < b.x0 + b.ancho; x++) if (lum[y * w + x] < CLARO) valores.push(y * w + x);
    valores.sort((i, j) => lum[i] - lum[j]);
    const oscuros = valores.slice(0, Math.max(1, Math.ceil(valores.length * 0.3)));
    const suma = [0, 0, 0];
    for (const i of oscuros) for (let c = 0; c < 3; c++) suma[c] += img.data[4 * i + c];
    const rgb = suma.map(s => s / oscuros.length);
    return { rgb, lum: oscuros.reduce((s, i) => s + lum[i], 0) / oscuros.length };
}

/** Un color cuenta como destacado (bordó) si es claramente rojizo. */
export function esDestacado([r, g, b]) {
    return r - Math.max(g, b) > 40;
}

// Máscara de un renglón agrandada k veces (interpolación bilineal de la "tinta" y umbral UMBRAL).
function mascaraDeBanda(lum, w, b, k, lumTinta) {
    const tinta = (x, y) => {
        const xi = Math.min(Math.max(Math.floor(x), b.x0), b.x0 + b.ancho - 1);
        const yi = Math.min(Math.max(Math.floor(y), b.y0), b.y0 + b.alto - 1);
        return Math.min(1, Math.max(0, (255 - lum[yi * w + xi]) / Math.max(1, 255 - lumTinta)));
    };
    const W = b.ancho * k,
        H = b.alto * k;
    const m = new Uint8Array(W * H);
    for (let v = 0; v < H; v++) {
        const y = b.y0 + (v + 0.5) / k - 0.5;
        const y0 = Math.floor(y),
            fy = y - y0;
        for (let u = 0; u < W; u++) {
            const x = b.x0 + (u + 0.5) / k - 0.5;
            const x0 = Math.floor(x),
                fx = x - x0;
            const arriba = tinta(x0, y0) * (1 - fx) + tinta(x0 + 1, y0) * fx;
            const abajo = tinta(x0, y0 + 1) * (1 - fx) + tinta(x0 + 1, y0 + 1) * fx;
            m[v * W + u] = arriba * (1 - fy) + abajo * fy >= UMBRAL ? 1 : 0;
        }
    }
    return m;
}

/**
 * Analiza una lámina: QR, marco y renglones de texto listos para generarPlaca (ver motor/placa-qr.js).
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @returns {{texto: string, imagen: {ancho:number, alto:number}, marco: boolean, bandas: object[]}|null}
 *   null si la imagen no tiene un QR legible.
 */
export function analizarLamina(img) {
    const qr = buscarQr(img);
    if (!qr) return null;
    const { width: w, height: h } = img;
    const lum = luminancias(img);
    const marco = quitarMarco(lum, w, h);
    for (let y = qr.caja.y0; y < qr.caja.y1; y++) lum.fill(255, y * w + qr.caja.x0, y * w + qr.caja.x1);
    const k = Math.min(6, Math.max(1, Math.round(100 / w / MM_POR_PIXEL_MASCARA)));
    const centroQr = (qr.caja.y0 + qr.caja.y1) / 2;
    const bandas = [];
    for (const t of juntarTramos(tramosDeFilas(lum, w, h))) {
        const cols = columnas(lum, w, t.y0, t.y1);
        if (!cols) continue;
        // Un píxel de aire alrededor, para que el contorno cierre.
        const x0 = Math.max(0, cols[0] - 1),
            y0 = Math.max(0, t.y0 - 1);
        const b = { x0, y0, ancho: Math.min(w, cols[1] + 1) - x0, alto: Math.min(h, t.y1 + 1) - y0 };
        const color = colorDeTinta(img, lum, w, b);
        bandas.push({
            ...b,
            arriba: (t.y0 + t.y1) / 2 < centroQr,
            destacado: esDestacado(color.rgb),
            color: color.rgb.map(Math.round),
            escala: k,
            mascara: mascaraDeBanda(lum, w, b, k, color.lum),
        });
    }
    return { texto: qr.texto, imagen: { ancho: w, alto: h }, marco, bandas };
}
