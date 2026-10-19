// Varias piezas, copias y acomodo en el paso 1 (ADR 0003, T8, T9, T10 y T11).
//
// Flujo: con el cubo cargado, "Agregar cubo de ejemplo" suma una segunda pieza (2 chips numeradas, la nueva
// activa y con el foco); su escala se ve en #datosModelo (que sale del visor) y en una captura del visor;
// tocar la chip 1 la vuelve activa y la escala muestra la suya; quitar la 2 vuelve a una pieza sin chips
// (el visor ya no la dibuja y el foco va a "Agregar pieza"). Después: quitar la activa cuando es la primera,
// el tope de MAX_PIEZAS (8) y que con una torre no se vea "Agregar pieza". Al final (T9), laminado: 2 cubos
// se laminan acomodados (2 grupos de extrusión en la capa 2, en las X de `acomodar`, y "2 piezas" en el
// resumen), dos agrandadas hasta que no entran dan el aviso "No entran todas en la cama" con "Siguiente"
// deshabilitado (T10; el error del paso 3 queda como red de seguridad), y
// una sola que no entra da el mensaje detallado del worker ("El modelo mide … no entra en la cama").
//
// Precondición: paso 1 con el cubo de ejemplo cargado (una sola pieza, sin chips), escala 100 %.
// Deja: paso 1 con el cubo de ejemplo cargado (una sola pieza, sin chips), escala 100 %.

import fs from 'node:fs';
import { acomodar } from '../../src/motor/piezas.js';
import { SEPARACION_PIEZAS_MM } from '../../src/config.js';
import { puntosDeCapa } from '../lib/gcode.mjs';
import { esperarVisor } from '../lib/visor.mjs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarPiezas(ctx) {
    await probarAgregarYElegir(ctx);
    await probarQuitar(ctx);
    await probarTope(ctx);
    await probarTorre(ctx);
    await probarLaminarVarias(ctx);
    await probarNoEntra(ctx);
    await probarUnaNoEntra(ctx);
}

const chips = pagina => pagina.locator('#listaPiezas .chip');
const pulsadas = pagina => chips(pagina).evaluateAll(b => b.map(x => x.getAttribute('aria-pressed')).join());
/** Cantidad de piezas que tiene el visor (data-piezas del canvas, ver visor.js). */
const enVisor = async pagina => {
    await esperarVisor(pagina, '#visor');
    return pagina.evaluate(() => Number(document.querySelector('#visor canvas').dataset.piezas));
};
const medidas = pagina => pagina.textContent('#datosModelo').then(t => t.split(' · ')[0]);

/** Suma el cubo de ejemplo como pieza nueva y espera a que haya `n` chips. */
async function agregarCubo(pagina, n) {
    await pagina.tap('#agregarEjemplo');
    await pagina.waitForFunction(k => document.querySelectorAll('#listaPiezas .chip').length === k, n);
}

async function probarAgregarYElegir(ctx) {
    const { page: pagina, ok: revisar, visible } = ctx;
    revisar(
        'una pieza: sin chips y con "Agregar pieza"',
        !(await visible('#listaPiezas')) && (await visible('#agregarPieza')),
    );
    revisar('una pieza: ni siquiera hay chips en el DOM', (await chips(pagina).count()) === 0);
    revisar('el visor tiene 1 pieza', (await enVisor(pagina)) === 1);
    await agregarCubo(pagina, 2);
    revisar('el visor tiene 2 piezas al agregar', (await enVisor(pagina)) === 2);
    revisar('2 chips, la nueva es la activa', (await pulsadas(pagina)) === 'false,true', await pulsadas(pagina));
    revisar(
        'foco en la chip nueva',
        await pagina.evaluate(() => document.activeElement === document.querySelectorAll('#listaPiezas .chip')[1]),
    );
    revisar(
        'chips numeradas y botón de quitar con aria-label',
        (await chips(pagina).nth(1).textContent()) === '2. cubo-20mm.stl' &&
            (await pagina.getAttribute('#listaPiezas li:nth-child(2) .chip-quitar', 'aria-label')) ===
                'Quitar pieza 2, cubo-20mm.stl',
    );
    revisar('aria-live anuncia "Pieza agregada"', /Pieza agregada/.test(await pagina.textContent('#avisoPiezas')));

    await probarEscalaPieza2(ctx);
}

/** Escala de la pieza 2 (activa) y su efecto en el visor; luego alterna la activa con las chips. */
async function probarEscalaPieza2({ page: pagina, ok: revisar }) {
    await pagina.fill('#escala', '150');
    await pagina.locator('#escala').blur();
    revisar(
        'escala de la pieza 2 en el visor (150 %)',
        (await medidas(pagina)) === '30,0 × 30,0 × 30,0 mm',
        await medidas(pagina),
    );

    await pagina.tap('#listaPiezas li:nth-child(1) .chip');
    revisar('tocar la chip 1: pasa a activa', (await pulsadas(pagina)) === 'true,false', await pulsadas(pagina));
    revisar(
        'la escala muestra la de la pieza 1 (100 %, 20 mm)',
        (await pagina.inputValue('#escala')) === '100' && (await medidas(pagina)) === '20,0 × 20,0 × 20,0 mm',
    );
    await pagina.tap('#listaPiezas li:nth-child(2) .chip');
    revisar(
        'la pieza 2 conserva su escala (150 %, 30 mm)',
        (await pagina.inputValue('#escala')) === '150' && (await medidas(pagina)) === '30,0 × 30,0 × 30,0 mm',
    );
}

async function probarQuitar({ page: pagina, ok: revisar, visible }) {
    await pagina.tap('#listaPiezas li:nth-child(2) .chip-quitar');
    revisar(
        'quitar la 2: una sola pieza y sin chips',
        !(await visible('#listaPiezas')) && (await chips(pagina).count()) === 0,
    );
    revisar(
        'foco en "Agregar pieza" al quedar sin chips',
        await pagina.evaluate(() => document.activeElement?.id === 'agregarArchivo'),
    );
    revisar('aria-live anuncia "Pieza quitada"', /Pieza quitada/.test(await pagina.textContent('#avisoPiezas')));
    revisar(
        'queda la primera, a 100 % y 20 mm',
        (await pagina.inputValue('#escala')) === '100' && (await medidas(pagina)) === '20,0 × 20,0 × 20,0 mm',
    );
    revisar('el visor quedó con 1 pieza al quitar la 2', (await enVisor(pagina)) === 1);

    // Quitar la activa cuando es la primera: la 2 pasa a ser la única, con su escala.
    await agregarCubo(pagina, 2);
    await pagina.fill('#escala', '150');
    await pagina.locator('#escala').blur();
    await pagina.tap('#listaPiezas li:nth-child(1) .chip');
    await pagina.tap('#listaPiezas li:nth-child(1) .chip-quitar');
    revisar(
        'quitar la primera (activa): queda la otra sin chips y 1 pieza en el visor',
        !(await visible('#listaPiezas')) && (await enVisor(pagina)) === 1,
    );
    revisar(
        'la que queda es la pieza 2: 150 % y 30 mm en el visor',
        (await pagina.inputValue('#escala')) === '150' && (await medidas(pagina)) === '30,0 × 30,0 × 30,0 mm',
        await medidas(pagina),
    );
    await pagina.tap('#restablecerModelo');
}

async function probarTope({ page: pagina, ok: revisar }) {
    for (let n = 2; n <= 8; n++) await agregarCubo(pagina, n);
    const deshabilitados = await pagina.evaluate(
        () => document.getElementById('agregarArchivo').disabled && document.getElementById('agregarEjemplo').disabled,
    );
    revisar(
        'tope de 8 piezas: botones deshabilitados con texto que lo explica',
        deshabilitados &&
            /Máximo 8/.test(await pagina.textContent('#agregarArchivo')) &&
            /Máximo 8/.test(await pagina.textContent('#agregarEjemplo')),
    );
    revisar('el visor tiene 8 piezas en el tope', (await enVisor(pagina)) === 8);
    for (let n = 7; n >= 1; n--) await pagina.tap('#listaPiezas li:nth-child(1) .chip-quitar');
    revisar('quitadas 7, el visor queda con 1 pieza', (await enVisor(pagina)) === 1);
    revisar(
        'al quitar, vuelve "Agregar pieza" habilitado',
        (await pagina.isEnabled('#agregarArchivo')) &&
            (await pagina.textContent('#agregarArchivo')) === 'Agregar pieza',
    );
}

async function probarTorre({ page: pagina, ok: revisar, visible, elegirArchivo }) {
    await pagina.tap('#otroModelo');
    await pagina.tap('#botonTorre');
    await pagina.tap('#formTorre button[type="submit"]');
    await pagina.waitForFunction(
        () => document.getElementById('nombreModelo').textContent === 'Torre de temperatura',
        null,
        {
            timeout: 60000,
        },
    );
    revisar('con una torre no se ve "Agregar pieza"', !(await visible('#agregarPieza')));
    revisar('con una torre no se ven las copias', !(await visible('#copiasPieza')));
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    revisar('de vuelta al cubo: vuelve "Agregar pieza"', await visible('#agregarPieza'));
}

export const CAMA = 220; // Ender 3 V3 SE, origen en la esquina: el centro de la cama es (110, 110)

/** X de las extrusiones de la capa `n` del G-code (coordenadas de cama). */
export const xDeCapa = (gcode, n) => puntosDeCapa(gcode, n).map(p => p.x);

/** Con 2 cubos de 20 mm: lamina, y revisa los 2 grupos de extrusión de la capa 2 y el resumen del paso 4. */
async function probarLaminarVarias({ page: pagina, ok: revisar, esperarResultado }) {
    await pagina.tap('#agregarEjemplo');
    await pagina.waitForFunction(() => document.querySelectorAll('#listaPiezas .chip').length === 2);
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const huella = { x: 20, y: 20 };
    const esperado = acomodar([huella, huella], { x: CAMA, y: CAMA }, SEPARACION_PIEZAS_MM).posiciones;
    const xs = xDeCapa(fs.readFileSync(await descarga.path(), 'utf8'), 2);
    const centros = esperado.map(p => CAMA / 2 + p.x);
    const grupos = centros.map(c => xs.filter(x => Math.abs(x - c) < 11));
    revisar(
        'varias piezas G-code: la capa 2 tiene extrusiones y todas caen en uno de los 2 grupos',
        xs.length > 0 && grupos[0].length + grupos[1].length === xs.length && grupos.every(g => g.length > 0),
        `${xs.length} extrusiones, grupos ${grupos.map(g => g.length)}`,
    );
    revisar(
        'varias piezas G-code: cada grupo ocupa su cubo de 20 mm, centrado en la X de acomodar',
        grupos.every((g, i) => Math.min(...g) >= centros[i] - 10.5 && Math.max(...g) <= centros[i] + 10.5) &&
            grupos.every(g => Math.max(...g) - Math.min(...g) > 15),
        grupos.map((g, i) => `${Math.min(...g)}..${Math.max(...g)} (centro ${centros[i]})`).join(' | '),
    );
    const resumen = await pagina.textContent('#resumen');
    revisar('varias piezas: el resumen del paso 4 dice "2 piezas"', /2 piezas/.test(resumen), resumen);
    await pagina.goBack();
    await pagina.goBack();
}

/** Agranda la pieza 2 hasta que el conjunto no entra: aviso y "Siguiente" deshabilitado (el paso 3 ya no se alcanza). */
async function probarNoEntra({ page: pagina, ok: revisar, visible }) {
    await pagina.fill('#escala', '1000'); // 20 mm -> 200 mm: cada una entra sola, juntas no
    await pagina.locator('#escala').blur();
    revisar(
        'varias piezas: si no entran, aviso "No entran todas en la cama…" y "Siguiente" deshabilitado',
        (await visible('#avisoEntran')) &&
            /^No entran todas en la cama/.test(await pagina.textContent('#avisoEntran')) &&
            (await pagina.isDisabled('#siguiente')),
        await pagina.textContent('#avisoEntran'),
    );
    await pagina.tap('#restablecerModelo');
    revisar(
        'varias piezas: al achicarla vuelven a entrar (sin aviso y "Siguiente" habilitado)',
        !(await visible('#avisoEntran')) && (await pagina.isEnabled('#siguiente')),
    );
    await pagina.tap('#listaPiezas li:nth-child(2) .chip-quitar');
    revisar(
        'varias piezas: restaurado un cubo de 20 mm a 100 %',
        (await pagina.inputValue('#escala')) === '100' && (await medidas(pagina)) === '20,0 × 20,0 × 20,0 mm',
        await medidas(pagina),
    );
}

/** Una sola pieza que no entra: no la frena paso3 y el worker da su mensaje detallado. */
async function probarUnaNoEntra({ page: pagina, ok: revisar }) {
    await pagina.fill('#escala', '2000'); // 20 mm -> 400 mm
    await pagina.locator('#escala').blur();
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await pagina.waitForSelector('#errorLaminado:not([hidden])', { timeout: 20000 });
    const texto = await pagina.textContent('#errorLaminado');
    revisar(
        'una pieza que no entra: mensaje detallado del worker',
        /^El modelo mide .* no entra en la cama \(/.test(texto),
        texto,
    );
    await pagina.tap('#cancelar');
    await pagina.goBack();
    await pagina.tap('#restablecerModelo');
    revisar('una pieza que no entra: restaurada a 100 %', (await pagina.inputValue('#escala')) === '100');
}
