// Placa QR: arma la malla de una placa de 100 × 150 mm con un código QR y los textos recortados de la
// imagen de una lámina (sin DOM: corre en el worker de conversión y en Node).
//
// Responsabilidad: ubicar los textos y el QR en la placa (`disenarPlaca`) y extruirlos (`generarPlaca`).
// El análisis de la imagen (qué es texto, de qué color, dónde está el QR) se hace en la UI
// (ui/placa-imagen.js), que manda las máscaras de los textos ya recortadas.
//
// Alturas, pensadas para un solo extrusor con cambios de filamento (ver PAUSAS_PLACA):
//   0 a 1,6 mm base (blanco) · hasta 2,2 mm QR, marco y textos (negro) · hasta 2,6 mm textos destacados
//   (bordó): como se mira de arriba, cada cosa se ve del color de su última capa.

import qrcode from 'qrcode-generator';
import { trazarBordes, simplificar, agrupar, area, grosorMedio, engordar } from './contornos.js';
import { extruir, rectangulo } from './extruir.js';

import { PLACA } from './placa-medidas.js';

const MARGEN = 8; // del borde de la placa a los textos (mm)
const MARCO = 2; // ancho del marco (mm)
const ANCHO_TEXTO = 90; // ningún renglón pasa de este ancho (mm)
const QR_MAX = 78; // lado máximo del QR (mm)
const QR_MIN = 40;
const GROSOR_MINIMO = 0.6; // mm: los trazos más finos se engordan (con boquilla de 0,4 mm, si no, se pierden)
const SEPARACION = 6; // entre el QR y los textos (mm): deja el margen blanco que necesita el lector

/**
 * Matriz de módulos del QR (true = negro), con corrección de errores M.
 * @param {string} texto lo que lleva el código (un link, por ejemplo).
 * @returns {boolean[][]}
 */
export function matrizQr(texto) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const q = qrcode(0, 'M');
    q.addData(texto, 'Byte');
    q.make();
    const n = q.getModuleCount();
    return Array.from({ length: n }, (_, f) => Array.from({ length: n }, (_, c) => q.isDark(f, c)));
}

// Alto de un grupo de renglones (en píxeles de la imagen) y su primera y última fila.
function extension(bandas) {
    if (!bandas.length) return { desde: 0, hasta: 0, alto: 0 };
    const desde = Math.min(...bandas.map(b => b.y0));
    const hasta = Math.max(...bandas.map(b => b.y0 + b.alto));
    return { desde, hasta, alto: hasta - desde };
}

/**
 * Ubica los renglones y el QR en la placa. Los renglones conservan su tamaño y separación relativos
 * (escala única, la que lleva el renglón más ancho a 90 mm); los de arriba del QR se apoyan en el margen
 * de arriba y los de abajo en el de abajo.
 * @param {{ancho: number}} imagen medida de la imagen en píxeles.
 * @param {{x0:number, y0:number, ancho:number, alto:number, arriba:boolean}[]} bandas renglones (px).
 * @returns {{escala: number, aMm: (b: object, x: number, y: number) => number[], qr: {x:number, y:number, lado:number}}}
 */
export function disenarPlaca(imagen, bandas) {
    const masAncho = Math.max(1, ...bandas.map(b => b.ancho));
    // El renglón más ancho ocupa ANCHO_TEXTO, sin agrandar más de 1,4 veces lo que daría la lámina a 100 mm.
    const escala = Math.min((1.4 * PLACA.ancho) / imagen.ancho, ANCHO_TEXTO / masAncho);
    const arriba = extension(bandas.filter(b => b.arriba));
    const abajo = extension(bandas.filter(b => !b.arriba));
    const techo = PLACA.alto - MARGEN - arriba.alto * escala - SEPARACION;
    const piso = MARGEN + abajo.alto * escala + SEPARACION;
    const lado = Math.min(QR_MAX, techo - piso, PLACA.ancho - 2 * MARGEN);
    if (lado < QR_MIN) throw new Error('Los textos de la lámina ocupan demasiado: no queda lugar para el QR.');
    const aMm = (b, x, y) => [
        PLACA.ancho / 2 + (x - imagen.ancho / 2) * escala,
        b.arriba ? PLACA.alto - MARGEN - (y - arriba.desde) * escala : MARGEN + (abajo.hasta - y) * escala,
    ];
    return { escala, aMm, qr: { x: (PLACA.ancho - lado) / 2, y: (piso + techo - lado) / 2, lado } };
}

// Cajas del QR: una por tramo horizontal de módulos negros. Se pisan 0,01 mm con la fila de al lado para
// que el laminador las una sin rendijas.
function cajasQr(modulos, { x, y, lado }, salida) {
    const n = modulos.length;
    const m = lado / n;
    for (let f = 0; f < n; f++) {
        const techo = y + lado - f * m;
        for (let c = 0; c < n; c++) {
            if (!modulos[f][c]) continue;
            let fin = c;
            while (fin + 1 < n && modulos[f][fin + 1]) fin++;
            extruir(
                rectangulo(x + c * m, techo - m - 0.01, x + (fin + 1) * m, techo + 0.01),
                PLACA.base,
                PLACA.relieve,
                salida,
            );
            c = fin;
        }
    }
}

// Formas de un renglón en mm: contornos de su máscara (k píxeles de máscara por píxel de imagen).
function formasDeBanda(b, aMm, escala) {
    const k = b.escala;
    const tolerancia = 0.75; // en píxeles de máscara
    const minima = (0.25 / escala) ** 2 * k * k; // descarta motas de menos de 0,25 × 0,25 mm
    const [W, H] = [b.ancho * k, b.alto * k];
    const mmPorPixel = escala / k;
    const falta = GROSOR_MINIMO - grosorMedio(b.mascara, W, H) * mmPorPixel;
    const mascara = falta > 0 ? engordar(b.mascara, W, H, Math.round(falta / 2 / mmPorPixel)) : b.mascara;
    const lazos = trazarBordes(mascara, W, H)
        .map(l => simplificar(l, tolerancia))
        .filter(l => Math.abs(area(l)) >= minima);
    const pasar = l => {
        const r = [];
        for (let i = 0; i < l.length; i += 2) r.push(...aMm(b, b.x0 + l[i] / k, b.y0 + l[i + 1] / k));
        return r;
    };
    return agrupar(lazos).map(f => ({ afuera: pasar(f.afuera), agujeros: f.agujeros.map(pasar) }));
}

/**
 * Vértices (9 números por triángulo, en mm) de la placa completa.
 * @param {object} o
 * @param {string} o.texto lo que lleva el QR.
 * @param {{ancho:number, alto:number}} o.imagen medida de la imagen original (px).
 * @param {boolean} o.marco si la lámina tenía marco (se dibuja uno de 2 mm).
 * @param {{x0:number, y0:number, ancho:number, alto:number, arriba:boolean, destacado:boolean, escala:number, mascara:Uint8Array}[]} o.bandas
 *   renglones de texto: posición y medida en la imagen, máscara de (ancho·escala) × (alto·escala).
 * @returns {Float32Array}
 */
export function generarPlaca({ texto, imagen, marco, bandas }) {
    const d = disenarPlaca(imagen, bandas);
    const v = [];
    const { ancho: A, alto: H } = PLACA;
    extruir(rectangulo(0, 0, A, H), 0, PLACA.base, v);
    if (marco) {
        const anillo = {
            afuera: rectangulo(0, 0, A, H).afuera,
            agujeros: [rectangulo(MARCO, MARCO, A - MARCO, H - MARCO).afuera],
        };
        extruir(anillo, PLACA.base, PLACA.relieve, v);
    }
    cajasQr(matrizQr(texto), d.qr, v);
    for (const b of bandas) {
        const tope = b.destacado ? PLACA.destacado : PLACA.relieve;
        for (const f of formasDeBanda(b, d.aMm, d.escala)) extruir(f, PLACA.base, tope, v);
    }
    return new Float32Array(v);
}

/**
 * Varias placas en una sola malla, cada una en su lugar (ver lugaresEnCama en placa-medidas.js).
 * @param {object[]} placas datos de generarPlaca, uno por placa.
 * @param {{x: number, y: number, girar: boolean}[]} lugares al menos tantos como placas.
 * @returns {Float32Array}
 */
export function generarPlacas(placas, lugares) {
    const partes = placas.map((p, i) => ubicar(generarPlaca(p), lugares[i]));
    const v = new Float32Array(partes.reduce((n, p) => n + p.length, 0));
    let desde = 0;
    for (const p of partes) {
        v.set(p, desde);
        desde += p.length;
    }
    return v;
}

// Mueve (y, si hace falta, gira 90° en sentido antihorario) los vértices de una placa a su lugar.
// Girar es una rotación: no cambia el sentido de los triángulos.
function ubicar(v, { x, y, girar }) {
    for (let i = 0; i < v.length; i += 3) {
        const [px, py] = girar ? [PLACA.alto - v[i + 1], v[i]] : [v[i], v[i + 1]];
        v[i] = px + x;
        v[i + 1] = py + y;
    }
    return v;
}
