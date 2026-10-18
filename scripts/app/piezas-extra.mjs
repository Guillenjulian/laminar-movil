// Huecos de prueba de la app (deuda de pruebas): acomodo con giros que no son de 90° y precio tras recargar.
//
// probarAcomodoConGiros: carga un "techo" (prisma de 40 mm con sección de triángulo rectángulo), le apoya la cara
//   inclinada (giro de 45°, no múltiplo de 90°) y lo gira 90° en Z; agrega una segunda igual, laminan juntas y
//   la capa 2 del G-code tiene que caer en las posiciones de `acomodar` con la huella REAL (la que mide el
//   visor), no con la caja de 8 esquinas, que daría otras X.
//   Precondición: paso 1 con el cubo de ejemplo cargado (una sola pieza, sin chips), escala 100 %.
//   Deja: paso 1 con el cubo de ejemplo cargado (una sola pieza, sin chips), escala 100 %.
//
// probarPrecioTrasRecargar: guarda un precio de PETG, recarga la página y revisa que el precio siga en el paso 2
//   y que el costo del resumen se calcule con él.
//   Precondición: cualquier paso de la app ya cargada con el cubo de ejemplo disponible (paso 1 con modelo).
//   Deja: paso 2 con el cubo cargado y PLA elegido (el precio del PETG queda guardado aparte).

import fs from 'node:fs';
import { acomodar } from '../../src/motor/piezas.js';
import { SEPARACION_PIEZAS_MM } from '../../src/config.js';
import { medir, multiplicar, rotacion90, rotacionQueApoya } from '../../src/motor/transformar.js';
import { CAMA } from './piezas.mjs';

const LARGO = 40;
const LADO = 10 * Math.SQRT2; // cateto del triángulo apoyado: la huella real mide LADO × LARGO
const NORMAL_CARA = [0, -Math.SQRT1_2, Math.SQRT1_2]; // la cara inclinada del frente, como la ve el visor

/** STL binario de un prisma de 40 mm (en X) con sección (0,0), (20,0), (10,10) en (Y, Z): caras a 45°. */
function stlTecho() {
    const seccion = [
        [0, 0],
        [20, 0],
        [10, 10],
    ];
    const v = (x, k) => [x, ...seccion[k]];
    const centro = [LARGO / 2, 10, 10 / 3];
    const tris = [];
    const sumar = (a, b, c) => {
        const u = b.map((n, i) => n - a[i]);
        const w = c.map((n, i) => n - a[i]);
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const hacia = a.reduce((s, _, i) => s + n[i] * ((a[i] + b[i] + c[i]) / 3 - centro[i]), 0);
        tris.push(hacia < 0 ? [a, c, b] : [a, b, c]); // normal hacia afuera
    };
    for (const x of [0, LARGO]) sumar(v(x, 0), v(x, 1), v(x, 2));
    for (const [s, t] of [
        [0, 1],
        [1, 2],
        [2, 0],
    ]) {
        sumar(v(0, s), v(LARGO, s), v(LARGO, t));
        sumar(v(0, s), v(LARGO, t), v(0, t));
    }
    const b = Buffer.alloc(84 + tris.length * 50);
    b.writeUInt32LE(tris.length, 80);
    tris.forEach((t, i) => t.flat().forEach((n, j) => b.writeFloatLE(n, 84 + i * 50 + 12 + j * 4)));
    return b;
}

/** Extrusiones { x, y } de la capa `n` del G-code (coordenadas de cama). */
function puntosDeCapa(gcode, n) {
    const salida = [];
    let dentro = false;
    let x = 0;
    let y = 0;
    for (const l of gcode.split('\n')) {
        const capa = l.match(/^;LAYER:(\d+)/);
        if (capa) dentro = +capa[1] === n;
        if (!/^G[01] /.test(l)) continue;
        x = +(l.match(/ X(-?[\d.]+)/)?.[1] ?? x);
        y = +(l.match(/ Y(-?[\d.]+)/)?.[1] ?? y);
        if (dentro && /^G1 .*[XY].* E\d/.test(l)) salida.push({ x, y });
    }
    return salida;
}

const medidas = pagina => pagina.textContent('#datosModelo').then(t => t.split(' · ')[0]);

/** Apoya la cara que está en el punto (fx, fy) del visor (fracciones del lienzo) y espera a que termine. */
async function apoyarCara(pagina, fx, fy) {
    await pagina.tap('#apoyarCara');
    const l = await pagina.locator('#visor canvas').boundingBox();
    await pagina.touchscreen.tap(l.x + l.width * fx, l.y + l.height * fy);
    await pagina.waitForFunction(() => document.getElementById('ayudaCara').hidden, null, { timeout: 5000 });
}

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarAcomodoConGiros(ctx) {
    const { page: pagina, ok: revisar, elegirArchivo, tmp } = ctx;
    const techo = `${tmp}/techo.stl`;
    fs.writeFileSync(techo, stlTecho());
    await elegirArchivo(techo);
    await apoyarCara(pagina, 0.5, 0.5); // sola, el centro del visor da en la cara inclinada del frente
    await pagina.tap('[data-rotar="z"]');
    revisar(
        'techo: apoyada la cara inclinada (45°) y girada 90° en Z',
        (await medidas(pagina)) === '14,1 × 40,0 × 14,1 mm',
    );
    await pagina.setInputFiles('#archivoPieza', techo);
    await pagina.waitForFunction(() => document.querySelectorAll('#listaPiezas .chip').length === 2);
    await apoyarCara(pagina, 0.62, 0.62); // la segunda queda a la derecha, al frente
    await pagina.tap('[data-rotar="z"]');
    revisar('techo 2: lo mismo que la 1', (await medidas(pagina)) === '14,1 × 40,0 × 14,1 mm', await medidas(pagina));
    const esperado = await laminarYRevisar(ctx);
    revisar(
        'techo: las X reales difieren de las de la caja de 8 esquinas (la prueba lo detectaría)',
        esperado.sensible,
    );
    await volverAlCubo(ctx);
}

/** Posiciones con la huella real y con la caja conservadora de 8 esquinas (la que se descartó). */
function posicionesEsperadas() {
    const acomodo = huella => acomodar([huella, huella], { x: CAMA, y: CAMA }, SEPARACION_PIEZAS_MM).posiciones;
    const esquinas = [];
    for (const i of [-LARGO / 2, LARGO / 2]) {
        for (const j of [-10, 10]) for (const k of [-5, 5]) esquinas.push(i, j, k);
    }
    const m = multiplicar(rotacion90('z'), rotacionQueApoya(NORMAL_CARA));
    const caja = medir(m, esquinas);
    return { real: acomodo({ x: LADO, y: LARGO }), conservadora: acomodo({ x: caja.x, y: caja.y }), caja };
}

/** Lamina las 2 piezas y revisa que la capa 2 caiga en las posiciones reales (± 0,5 mm). */
async function laminarYRevisar({ page: pagina, ok: revisar, esperarResultado }) {
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const { real, conservadora, caja } = posicionesEsperadas();
    const puntos = puntosDeCapa(fs.readFileSync(await descarga.path(), 'utf8'), 2);
    const centros = real.map(p => ({ x: CAMA / 2 + p.x, y: CAMA / 2 + p.y }));
    const grupos = centros.map(c => puntos.filter(p => Math.abs(p.x - c.x) < LADO / 2 + 1.5));
    const caben = grupos[0].length + grupos[1].length === puntos.length && grupos.every(g => g.length > 0);
    revisar('techos: la capa 2 tiene 2 grupos de extrusión, uno por pieza', caben, `${puntos.length} puntos`);
    const info = grupos.map((g, i) => {
        const [x0, x1] = [Math.min(...g.map(p => p.x)), Math.max(...g.map(p => p.x))];
        const [y0, y1] = [Math.min(...g.map(p => p.y)), Math.max(...g.map(p => p.y))];
        return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, ancho: x1 - x0, largo: y1 - y0, i };
    });
    const bien = info.every(
        (g, i) => Math.abs(g.cx - centros[i].x) <= 0.5 && Math.abs(g.cy - centros[i].y) <= 0.5 && g.largo > LARGO - 1,
    );
    revisar(
        'techos: cada grupo está centrado en la X/Y de acomodar con la huella real (± 0,5)',
        bien,
        `centros X ${info.map(g => g.cx.toFixed(2))} (esperado ${centros.map(c => c.x.toFixed(2))}; con la caja de 8 esquinas ${conservadora.map(p => (CAMA / 2 + p.x).toFixed(2))}, huella ${caja.x.toFixed(1)} × ${caja.y.toFixed(1)})`,
    );
    revisar(
        'techos: cada grupo mide lo que la huella real (ancho < 14,2 mm)',
        info.every(g => g.ancho < LADO + 0.1),
    );
    const sensible = conservadora.some((p, i) => Math.abs(p.x - real[i].x) > 1);
    return { sensible };
}

/** Quita la 2ª pieza y vuelve a dejar el cubo de ejemplo, como lo espera el área siguiente. */
async function volverAlCubo({ page: pagina, ok: revisar, elegirArchivo }) {
    await pagina.goBack();
    await pagina.goBack();
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    revisar(
        'vuelve el cubo: una pieza, sin chips, a 100 %',
        (await pagina.locator('#listaPiezas .chip').count()) === 0 && (await pagina.inputValue('#escala')) === '100',
    );
}

/** Texto de una fila ("Costo", "Filamento"…) del resumen del resultado. */
const filaResumen = (pagina, clave) =>
    pagina.$eval(
        '#resumen',
        (dl, k) =>
            [...dl.querySelectorAll('dt')].find(dt => dt.textContent === k)?.nextElementSibling.textContent.trim(),
        clave,
    );

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarPrecioTrasRecargar(ctx) {
    const { page: pagina, ok: revisar, esperarResultado } = ctx;
    await pagina.tap('#siguiente');
    await pagina.tap('label.opcion:has(input[value="petg"])');
    await pagina.fill('#precioRollo', '25000');
    await pagina.locator('#precioRollo').blur();
    await pagina.waitForTimeout(500); // que IndexedDB termine de escribir
    await pagina.reload();
    await pagina.waitForSelector('#ejemplo');
    await pagina.tap('#ejemplo');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'cubo-20mm.stl');
    await pagina.tap('#siguiente');
    await pagina.tap('label.opcion:has(input[value="petg"])');
    revisar('precio del PETG tras recargar: sigue en $ 25000', (await pagina.inputValue('#precioRollo')) === '25000');
    await pagina.tap('#laminar');
    await esperarResultado();
    const [, metros] = (await filaResumen(pagina, 'Filamento')).match(/^([\d,]+) m/) || [];
    const gramos = Math.PI * 0.875 ** 2 * parseFloat(metros.replace(',', '.')) * 1.27;
    const costo = await filaResumen(pagina, 'Costo');
    const pesos = Number((costo.match(/^≈ \$ ([\d.]+)$/)?.[1] || 'NaN').replace(/\./g, ''));
    revisar(
        'costo tras recargar = gramos × 25000 / 1000',
        Math.abs(pesos - gramos * 25) <= 1.5,
        `${costo} (esperado ≈ $ ${(gramos * 25).toFixed(1)})`,
    );
    await pagina.goBack();
    await pagina.tap('label.opcion:has(input[value="pla"])');
}
