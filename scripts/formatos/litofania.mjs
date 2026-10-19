// Pruebas de la litofanía (Node, sin navegador): malla cerrada, característica de Euler, medidas, espesor según el gris,
// volumen, relieve, marco, paso a STL, resolución y errores de espesores o imagen.

import { escribirSTL } from '../../src/motor/formatos.js';
import { generarLitofania, resolucionLitofania, MARCO_MM } from '../../src/motor/litofania.js';
import { leerSTL } from '../../src/motor/stl.js';
import { casi, caja, texto, volumen, revisarCerrada, error } from './ayudas.mjs';

// Gradiente horizontal de 60 × 40 px: negro a la izquierda, blanco a la derecha.
const W = 60,
    H = 40;
const grises = new Uint8Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) grises[j * W + i] = Math.round((255 * i) / (W - 1));
const opciones = { grises, ancho: W, alto: H, anchoMm: 59, minMm: 0.8, maxMm: 3.2 };

// espesor en cada punto de arriba: el máximo a la izquierda (negro), el mínimo a la derecha (blanco)
const alturaEn = (v, x) => {
    let z = -Infinity;
    for (let i = 0; i < v.length; i += 3) if (casi(v[i], x)) z = Math.max(z, v[i + 2]);
    return z;
};

function litofaniaBase(revisar) {
    const lito = generarLitofania(opciones);
    const cl = caja(lito);
    const cerrada = revisarCerrada(lito);
    revisar(
        'litofanía: malla cerrada (cada arista en 2 triángulos, sentidos opuestos)',
        cerrada.malas === 0,
        `${cerrada.aristas} aristas, ${cerrada.malas} malas, ${lito.length / 9} triángulos`,
    );
    // Euler para una superficie cerrada sin agujeros: V - A + C = 2
    const vertices = new Set();
    for (let i = 0; i < lito.length; i += 3) vertices.add(`${lito[i]},${lito[i + 1]},${lito[i + 2]}`);
    revisar('litofanía: característica de Euler = 2', vertices.size - cerrada.aristas + lito.length / 9 === 2);
    revisar(
        'litofanía: medidas 59 × 39 × 3,2 mm',
        casi(cl.x, 59) && casi(cl.y, 39) && casi(cl.z, 3.2) && casi(cl.min[2], 0),
        texto(cl),
    );
    revisar(
        'litofanía: lo oscuro es grueso (3,2 mm) y lo claro fino (0,8 mm)',
        casi(alturaEn(lito, 0), 3.2) && casi(alturaEn(lito, 59), 0.8),
        `${alturaEn(lito, 0)} / ${alturaEn(lito, 59)}`,
    );
    const vol = volumen(lito);
    const esperado = (59 * 39 * (0.8 + 3.2)) / 2;
    revisar(
        'litofanía: volumen positivo (normales hacia afuera) y ≈ ancho × alto × espesor medio',
        vol > 0 && Math.abs(vol - esperado) / esperado < 0.01,
        `${vol.toFixed(1)} mm³ (esperado ${esperado.toFixed(1)})`,
    );
    return lito;
}

function variantes(revisar) {
    const relieve = generarLitofania({ ...opciones, tipo: 'relieve' });
    revisar('relieve: lo claro queda alto', casi(alturaEn(relieve, 0), 0.8) && casi(alturaEn(relieve, 59), 3.2));
    revisar('relieve: malla cerrada y volumen positivo', revisarCerrada(relieve).malas === 0 && volumen(relieve) > 0);

    const conMarco = generarLitofania({ ...opciones, marco: true });
    const cm = caja(conMarco);
    revisar(
        `con marco: ${MARCO_MM} mm más de cada lado, al espesor máximo`,
        casi(cm.x, 59 + 2 * MARCO_MM) &&
            casi(cm.y, 39 + 2 * MARCO_MM) &&
            casi(alturaEn(conMarco, 0), 3.2) &&
            casi(alturaEn(conMarco, cm.max[0]), 3.2),
        texto(cm),
    );
    revisar(
        'con marco: malla cerrada y volumen positivo',
        revisarCerrada(conMarco).malas === 0 && volumen(conMarco) > 0,
    );
}

export async function probarLitofania({ revisar }) {
    console.log('\n▶ Litofanía');
    const lito = litofaniaBase(revisar);
    variantes(revisar);

    const stlLito = escribirSTL(lito);
    revisar('litofanía a STL binario', leerSTL(stlLito).length === lito.length);

    const r1 = resolucionLitofania(4000, 3000, 100);
    const r2 = resolucionLitofania(1000, 4000, 300);
    revisar('resolución: ~0,25 mm por píxel', r1.ancho === 401 && r1.alto === 301, `${r1.ancho} × ${r1.alto}`);
    revisar(
        'resolución: como mucho 500 px de lado',
        r2.ancho <= 500 && r2.alto <= 500 && r2.alto >= 490,
        `${r2.ancho} × ${r2.alto}`,
    );

    const e9 = await error(() => generarLitofania({ ...opciones, minMm: 3, maxMm: 1 }));
    revisar('litofanía con espesores al revés', /máximo tiene que ser mayor/.test(e9), `"${e9}"`);
    const e10 = await error(() => generarLitofania({ ...opciones, ancho: 1, alto: 1 }));
    revisar('litofanía con imagen de 1 píxel', /demasiado chica/.test(e10), `"${e10}"`);
}
