// Copias en el paso 1 (ADR 0003, T10): el stepper suma copias sin sumar piezas (el visor las dibuja y
// `data-copias` en #listaPiezas las cuenta); 3 copias se laminan en las X de `acomodar`; con copias de más hasta
// que no entran hay aviso "No entran todas en la cama" y "Siguiente" deshabilitado; el tope es `maxCopias()` y
// una pieza agregada aparece en recientes.
//
// Precondición: paso 1 con el cubo de ejemplo cargado (una sola pieza, sin chips), escala 100 %, una copia.
// Deja: paso 1 con el cubo de ejemplo cargado (una sola pieza, sin chips), escala 100 %, una copia.

import fs from 'node:fs';
import path from 'node:path';
import { acomodar } from '../../src/motor/piezas.js';
import { SEPARACION_PIEZAS_MM } from '../../src/config.js';
import { CAMA, xDeCapa } from './piezas.mjs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarCopias(ctx) {
    await probarTresCopias(ctx);
    await probarCopiasNoEntran(ctx);
    await probarTopeCopias(ctx);
    await probarFueraPorPieza(ctx);
    await probarImpresoraChica(ctx);
    await probarReciente(ctx);
}

const chips = pagina => pagina.locator('#listaPiezas .chip');
/** Cantidad de piezas que tiene el visor (data-piezas del canvas, ver visor.js). */
const enVisor = pagina => pagina.evaluate(() => Number(document.querySelector('#visor canvas').dataset.piezas));

const copiasEnVisor = pagina => pagina.evaluate(() => Number(document.getElementById('listaPiezas').dataset.copias));
const numCopias = pagina => pagina.textContent('#copiasNum').then(t => t.trim());

/** 3 copias de un cubo: una sola pieza, 3 copias en el visor y 3 grupos de extrusión en las X de `acomodar`. */
async function probarTresCopias(ctx) {
    const { page: pagina, ok: revisar, visible, esperarResultado } = ctx;
    revisar(
        'copias: el stepper se ve con el cubo, en 1 y con "−" deshabilitado',
        (await visible('#copiasPieza')) &&
            (await numCopias(pagina)) === '1' &&
            (await pagina.isDisabled('#copiasMenos')) &&
            (await pagina.getAttribute('#copiasMas', 'aria-label')) === 'Agregar una copia de cubo-20mm.stl',
    );
    revisar('copias: con una copia el visor no cambia (1 copia)', (await copiasEnVisor(pagina)) === 1);
    await pagina.tap('#copiasMas');
    await pagina.tap('#copiasMas');
    revisar(
        'copias: 3 copias siguen siendo 1 pieza (sin chips) pero el visor tiene 3 copias',
        (await numCopias(pagina)) === '3' &&
            (await enVisor(pagina)) === 1 &&
            (await copiasEnVisor(pagina)) === 3 &&
            (await chips(pagina).count()) === 0,
        `${await numCopias(pagina)} / ${await copiasEnVisor(pagina)}`,
    );
    revisar('copias: ya entran (sin aviso, "Siguiente" habilitado)', await entranTodas(ctx));
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const huella = { x: 20, y: 20 };
    const esperado = acomodar([huella, huella, huella], { x: CAMA, y: CAMA }, SEPARACION_PIEZAS_MM).posiciones;
    const xs = xDeCapa(fs.readFileSync(await descarga.path(), 'utf8'), 2);
    const centros = esperado.map(p => CAMA / 2 + p.x);
    const grupos = centros.map(c => xs.filter(x => Math.abs(x - c) < 11));
    revisar(
        'copias G-code: la capa 2 tiene 3 grupos, cada uno en la X de acomodar',
        xs.length > 0 && grupos.every(g => g.length > 0) && grupos.reduce((n, g) => n + g.length, 0) === xs.length,
        `${xs.length} extrusiones, grupos ${grupos.map(g => g.length)}`,
    );
    revisar('copias: el resumen del paso 4 dice "3 piezas"', /3 piezas/.test(await pagina.textContent('#resumen')));
    await pagina.goBack();
    await pagina.goBack();
}

/** Sin aviso "No entran todas" y con "Siguiente" habilitado. */
async function entranTodas({ page: pagina, visible }) {
    return !(await visible('#avisoEntran')) && (await pagina.isEnabled('#siguiente'));
}

/** Con 3 copias de 200 mm no entran: aviso visible y "Siguiente" deshabilitado; al restablecer, vuelve todo. */
async function probarCopiasNoEntran(ctx) {
    const { page: pagina, ok: revisar, visible } = ctx;
    await pagina.fill('#escala', '1000');
    await pagina.locator('#escala').blur();
    revisar(
        'copias que no entran: aviso "No entran todas en la cama" y "Siguiente" deshabilitado',
        (await visible('#avisoEntran')) &&
            /^No entran todas en la cama: achicá, rotá, bajá las copias o quitá piezas\.$/.test(
                await pagina.textContent('#avisoEntran'),
            ) &&
            (await pagina.isDisabled('#siguiente')),
        await pagina.textContent('#avisoEntran'),
    );
    await pagina.tap('#restablecerModelo');
    revisar('copias que entran de nuevo: sin aviso y "Siguiente" habilitado', await entranTodas(ctx));
    revisar('copias: restablecer no toca las copias (siguen 3)', (await numCopias(pagina)) === '3');
}

/** Suma copias hasta el tope de `maxCopias()`: el "+" se deshabilita con un texto que explica por qué. */
async function probarTopeCopias({ page: pagina, ok: revisar }) {
    const gb = await pagina.evaluate(() => navigator.deviceMemory);
    const max = gb && gb <= 2 ? 6 : gb && gb <= 4 ? 12 : gb && gb >= 8 ? 24 : 16;
    for (let i = 0; i < max && (await pagina.isEnabled('#copiasMas')); i++) await pagina.tap('#copiasMas');
    revisar(
        `tope de copias: ${max} (maxCopias), "+" deshabilitado y con la explicación`,
        (await numCopias(pagina)) === String(max) &&
            (await pagina.isDisabled('#copiasMas')) &&
            (await pagina.textContent('#copiasAyuda')) === `Podés poner hasta ${max} copias en total.`,
        await numCopias(pagina),
    );
    revisar(
        'tope de copias: "Agregar pieza" también queda deshabilitado y el foco pasa a "−"',
        (await pagina.isDisabled('#agregarArchivo')) &&
            (await pagina.evaluate(() => document.activeElement?.id)) === 'copiasMenos',
    );
    for (let i = 0; i < max && (await pagina.isEnabled('#copiasMenos')); i++) await pagina.tap('#copiasMenos');
    revisar(
        'bajar a 1 copia: "−" deshabilitado y el visor con 1 copia',
        (await numCopias(pagina)) === '1' && (await copiasEnVisor(pagina)) === 1,
    );
}

/** Una pieza agregada (distinta del cubo) aparece en recientes; después se borra y se deja el cubo. */
async function probarReciente({ page: pagina, ok: revisar, tmp, elegirArchivo }) {
    const extra = path.join(tmp, 'pieza-extra.stl');
    fs.copyFileSync('public/ejemplos/cubo-20mm.stl', extra);
    await pagina.setInputFiles('#archivoPieza', extra);
    await pagina.waitForFunction(() => document.querySelectorAll('#listaPiezas .chip').length === 2);
    await pagina.tap('#otroModelo');
    const hay = () => pagina.$$eval('.reciente b', bs => bs.some(b => b.textContent === 'pieza-extra.stl'));
    await pagina.waitForFunction(() =>
        [...document.querySelectorAll('.reciente b')].some(b => b.textContent === 'pieza-extra.stl'),
    );
    revisar('una pieza agregada aparece en recientes', await hay());
    await pagina.tap('li:has(.reciente:has-text("pieza-extra.stl")) .borrar');
    await pagina.waitForFunction(
        () => ![...document.querySelectorAll('.reciente b')].some(b => b.textContent === 'pieza-extra.stl'),
    );
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
}

/** Con 2 piezas donde sólo una no entra: `data-fuera` nombra exactamente esa copia (la que `acomodar` deja fuera). */
async function probarFueraPorPieza({ page: pagina, ok: revisar }) {
    await pagina.tap('#agregarEjemplo');
    await pagina.waitForFunction(() => document.querySelectorAll('#listaPiezas .chip').length === 2);
    await pagina.fill('#escala', '1000'); // la pieza 2 pasa a 200 mm; la 1 sigue en 20 mm
    await pagina.locator('#escala').blur();
    const ids = await chips(pagina).evaluateAll(b => b.map(x => x.dataset.id));
    const huellas = [
        { x: 20, y: 20 },
        { x: 200, y: 200 },
    ];
    const { fuera } = acomodar(huellas, { x: CAMA, y: CAMA }, SEPARACION_PIEZAS_MM);
    const esperado = fuera.map(k => `${ids[k]}:0`).join();
    const real = await pagina.evaluate(() => document.getElementById('listaPiezas').dataset.fuera);
    revisar(
        'dos piezas, una no entra: data-fuera nombra sólo esa copia',
        fuera.length === 1 && real === esperado,
        `real "${real}", esperado "${esperado}"`,
    );
    await pagina.tap('#restablecerModelo');
    revisar(
        'dos piezas: al achicarla no queda ninguna fuera',
        (await pagina.evaluate(() => document.getElementById('listaPiezas').dataset.fuera)) === '',
    );
    await pagina.tap('#listaPiezas li:nth-child(2) .chip-quitar');
}

/** Paso 2 -> impresora más chica donde ya no entran 2 copias: el paso 2 avisa, Laminar queda deshabilitado,
 *  "Ir al paso 1" vuelve al paso 1 y al volver a la Ender el aviso desaparece y Laminar se habilita. */
async function probarImpresoraChica({ page: pagina, ok: revisar, visible }) {
    await pagina.fill('#escala', '450'); // 90 mm: 2 copias entran en la Ender (220) y no en la Prusa mini (180)
    await pagina.locator('#escala').blur();
    await pagina.tap('#copiasMas');
    revisar('impresora chica: con 2 copias de 90 mm entran en la Ender', await entranTodas({ page: pagina, visible }));
    await pagina.tap('#siguiente');
    revisar(
        'impresora chica: en la Ender el paso 2 no avisa y Laminar está habilitado',
        !(await visible('#avisoEntranPaso2')) && (await pagina.isEnabled('#laminar')),
    );
    await pagina.tap('#cambiarImpresora');
    await pagina.fill('#buscarImpresora', 'prusa mini');
    await pagina.tap('[data-id="kiri-prusa-mini"]');
    revisar(
        'impresora chica: el paso 2 avisa que no entran y Laminar queda deshabilitado',
        (await visible('#avisoEntranPaso2')) &&
            /^Con esta impresora no entran todas las piezas/.test(await pagina.textContent('#textoEntranPaso2')) &&
            (await pagina.getAttribute('#avisoEntranPaso2', 'role')) === 'status' &&
            (await pagina.isDisabled('#laminar')),
        await pagina.textContent('#textoEntranPaso2'),
    );
    await pagina.tap('#irPaso1');
    revisar(
        'impresora chica: "Ir al paso 1" lleva al paso 1 (y "Siguiente" queda deshabilitado)',
        (await visible('#conModelo')) && (await pagina.isDisabled('#siguiente')),
    );
    await volverALaEnder({ page: pagina, ok: revisar, visible });
}

/** Vuelve al paso 2 por el historial, elige la Ender y deja el cubo de 20 mm con 1 copia. */
async function volverALaEnder({ page: pagina, ok: revisar, visible }) {
    await pagina.goForward(); // "Siguiente" no deja pasar: se vuelve al paso 2 por el historial
    await pagina.tap('#cambiarImpresora');
    await pagina.fill('#buscarImpresora', 'v3 se');
    await pagina.tap('[data-id="creality-ender-3-v3-se"]');
    revisar(
        'impresora chica: al volver a la Ender desaparece el aviso y Laminar se habilita',
        !(await visible('#avisoEntranPaso2')) && (await pagina.isEnabled('#laminar')),
    );
    await pagina.goBack();
    await pagina.tap('#restablecerModelo');
    await pagina.tap('#copiasMenos');
    revisar(
        'impresora chica: restaurado un cubo de 20 mm, 1 copia, a 100 %',
        (await pagina.inputValue('#escala')) === '100' && (await numCopias(pagina)) === '1',
    );
}
