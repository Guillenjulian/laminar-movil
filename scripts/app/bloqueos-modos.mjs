// Modos del panel de zonas (ADR 0004, T6): "Apoyar cara" y "Marcar zona sin soporte" son excluyentes (prender uno apaga
// el otro, con aria-pressed coherente en los dos) y tocar una pieza que NO es la activa sólo la activa, sin agregar zona.
//
// Precondición: paso 1 con el cubo de ejemplo cargado (una sola pieza), escala 100 %, sin zonas, fuera de los dos modos.
// Deja: lo mismo (el cubo recargado, una sola pieza, escala 100 %, sin zonas, sin modos).

import { esperarVisor, tocarLienzo } from '../lib/visor.mjs';

const presionado = (pagina, sel) => pagina.getAttribute(sel, 'aria-pressed');

/** Marcar y después Apoyar cara: el toque apoya la cara y NO agrega zona. Apoyar cara y después Marcar: agrega zona. */
async function probarExclusion({ page: pagina, ok: revisar }) {
    const chips = pagina.locator('#bloqueoLista .chip');
    await pagina.tap('#bloqueoMarcar');
    await pagina.tap('#apoyarCara');
    revisar(
        'modos: "Apoyar cara" apaga "Marcar" (aria-pressed coherente)',
        (await presionado(pagina, '#bloqueoMarcar')) === 'false' &&
            (await presionado(pagina, '#apoyarCara')) === 'true',
    );
    await tocarLienzo(pagina);
    await pagina.waitForFunction(() => document.getElementById('ayudaCara').hidden);
    revisar('modos: con Marcar y luego Apoyar cara, el toque no agrega zona', (await chips.count()) === 0);
    if (await pagina.isVisible('#restablecerModelo')) await pagina.tap('#restablecerModelo');

    await pagina.tap('#apoyarCara');
    await pagina.tap('#bloqueoMarcar');
    revisar(
        'modos: "Marcar" apaga "Apoyar cara" (aria-pressed coherente, sin la ayuda)',
        (await presionado(pagina, '#bloqueoMarcar')) === 'true' &&
            (await presionado(pagina, '#apoyarCara')) === 'false' &&
            (await pagina.isHidden('#ayudaCara')),
    );
    await tocarLienzo(pagina);
    revisar('modos: con Apoyar cara y luego Marcar, el toque agrega la zona', (await chips.count()) === 1);
    revisar('modos: la zona no se vació (la pieza no giró)', (await pagina.getByText('Se quitaron').count()) === 0);
    await pagina.tap('#bloqueoLista .chip-quitar');
    await pagina.tap('#bloqueoMarcar'); // fuera del modo
}

/** Dos piezas: con Marcar encendido, el primer toque sobre la que no es activa sólo la activa; el segundo sí marca. */
async function probarPiezaNoActiva({ page: pagina, ok: revisar }) {
    const chips = pagina.locator('#bloqueoLista .chip');
    await pagina.tap('#agregarEjemplo'); // la 2.ª queda activa, a la derecha y al frente (0,62 / 0,62 del lienzo)
    await pagina.waitForFunction(() => document.getElementById('listaPiezas').dataset.copias === '2');
    await pagina.tap('#bloqueoMarcar');
    await tocarLienzo(pagina, 0.38, 0.5); // la 1.ª, a la izquierda (simétrica)
    const activa = await pagina.locator('#listaPiezas .chip[aria-pressed="true"]').allTextContents();
    revisar('modos: el toque sobre la pieza no activa la vuelve activa', activa[0]?.startsWith('1.'), activa.join());
    revisar('modos: ...y en ese toque no se agrega zona', (await chips.count()) === 0);
    await tocarLienzo(pagina, 0.38, 0.5);
    revisar('modos: el siguiente toque, ya sobre la activa, sí agrega la zona', (await chips.count()) === 1);
    await pagina.tap('#bloqueoLista .chip-quitar');
    await pagina.tap('#bloqueoMarcar'); // fuera del modo
}

const AVISO = 'Se quitaron las zonas sin soporte porque cambió la pieza';
const chip = n => `#listaPiezas li:nth-child(${n}) .chip`;

/** Marca una zona con un toque en (fx, fy) del lienzo y sale del modo; devuelve su id (data-zona de la chip). */
async function marcarUna(pagina, fx, fy) {
    await pagina.tap('#bloqueoMarcar');
    await tocarLienzo(pagina, fx, fy);
    await pagina.tap('#bloqueoMarcar');
    return Number(await pagina.locator('#bloqueoLista .chip').first().getAttribute('data-zona'));
}

/**
 * Con 2 piezas (la 1.ª activa): la lista de zonas es la de la pieza activa (cambiar de pieza redibuja), el aviso de
 * "se quitaron las zonas" se va al cambiar de pieza activa y los ids de zona nunca se repiten ni retroceden, aunque
 * se quiten y agreguen piezas.
 */
async function probarPiezasYAviso({ page: pagina, ok: revisar }) {
    const chips = pagina.locator('#bloqueoLista .chip');
    const ids = [];
    await pagina.tap(chip(1));
    ids.push(await marcarUna(pagina, 0.38, 0.5));
    await pagina.tap(chip(2));
    revisar('piezas: la pieza 2 activa no muestra las zonas de la 1', (await chips.count()) === 0);
    await pagina.tap(chip(1));
    revisar('piezas: volver a la pieza 1 muestra su zona', (await chips.count()) === 1);
    await pagina.tap('#escalaMas'); // cambia la pieza: las zonas se vacían con aviso
    revisar('piezas: el aviso de zonas vaciadas se ve', (await pagina.getByText(AVISO).count()) > 0);
    await pagina.tap('#escalaMenos');
    await pagina.tap(chip(2));
    revisar('piezas: el aviso se va al cambiar de pieza activa', (await pagina.getByText(AVISO).count()) === 0);
    await pagina.tap(chip(1));
    ids.push(await marcarUna(pagina, 0.38, 0.5));
    await pagina.tap('#bloqueoLista .chip-quitar');
    await pagina.tap('#listaPiezas li:nth-child(2) .chip-quitar'); // quita la pieza 2 y vuelve a agregar otra
    await pagina.tap('#agregarEjemplo');
    await pagina.waitForFunction(() => document.getElementById('listaPiezas').dataset.copias === '2');
    await pagina.tap(chip(1));
    ids.push(await marcarUna(pagina, 0.38, 0.5));
    await pagina.tap('#bloqueoLista .chip-quitar');
    return ids;
}

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarBloqueosModos(ctx) {
    await probarExclusion(ctx);
    await probarPiezaNoActiva(ctx);
    const ids = await probarPiezasYAviso(ctx);
    const { page: pagina, ok: revisar } = ctx;
    await pagina.tap('#otroModelo');
    await pagina.tap('#ejemplo'); // un cubo nuevo: vuelve el encuadre de una sola pieza
    await pagina.waitForFunction(
        () => !document.getElementById('conModelo').hidden && document.getElementById('listaPiezas').hidden,
    );
    await esperarVisor(pagina, '#visor');
    ids.push(await marcarUna(pagina, 0.5, 0.5)); // tras cargar otro modelo
    await pagina.tap('#bloqueoLista .chip-quitar');
    revisar(
        'ultimoIdBloqueo: los ids de zona crecen siempre',
        ids.every((id, i) => i === 0 || id > ids[i - 1]),
        ids.join(),
    );
    revisar(
        'modos: queda una sola pieza',
        (await pagina.locator('#listaPiezas .chip').count()) === 0 && (await pagina.inputValue('#escala')) === '100',
    );
}
