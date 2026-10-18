// Vista previa liviana (ADR 0006, T6): con poca memoria el lector une tramos y la app avisa que está simplificada.
//
// Flujo: en un contexto aparte (no ensucia el recorrido) fuerza `navigator.deviceMemory = 1` con `addInitScript`
// (tope de 1.000.000 de tramos, sin ganchos de prueba en producción), lamina una esfera grande hasta el paso 4 y
// revisa que aparezca el aviso de "simplificada", que la vista tenga TODAS las capas del G-code (resumen, texto
// y G-code descargado) y que el deslizador llegue a la última.
//
// Precondición: cualquiera (usa su propia página y no toca la del recorrido).
// Deja: nada cambia en la app del recorrido; cierra su contexto.

import fs from 'node:fs';
import path from 'node:path';
import { devices } from 'playwright-core';
import { esfera } from '../../src/prueba/mallas.js';
import { esperarVisor } from '../lib/visor.mjs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarVistaLiviana({ browser, base, ok: revisar, tmp }) {
    const contexto = await browser.newContext({
        ...devices['Pixel 7'],
        acceptDownloads: true,
        serviceWorkers: 'block',
    });
    const pagina = await contexto.newPage();
    pagina.on('pageerror', e => console.log('[error liviana]', e.message));
    await pagina.addInitScript(() =>
        Object.defineProperty(navigator, 'deviceMemory', { value: 1, configurable: true }),
    );
    try {
        // Esfera de 110 mm con relleno giroide: unos 1,3 M de tramos en el nivel 0 (el tope con 1 GB es 1 M)
        // y poco más de 0,3 M en el 3, así que la vista entra simplificada y no cortada.
        const stl = path.join(tmp, 'esfera-liviana.stl');
        fs.writeFileSync(stl, Buffer.from(esfera(55, 550)));
        await pagina.goto(base);
        revisar(
            'vista liviana: el equipo simulado tiene 1 GB',
            (await pagina.evaluate(() => navigator.deviceMemory)) === 1,
        );
        await pagina.setInputFiles('#archivo', stl);
        await pagina.waitForFunction(
            () => document.getElementById('nombreModelo').textContent === 'esfera-liviana.stl',
            null,
            {
                timeout: 60000,
            },
        );
        await pagina.tap('#siguiente');
        // Relleno giroide al 40 %: sus curvas son lo que el lector puede unir (el relleno recto no se une).
        await pagina.tap('#personalizar summary');
        await pagina.tap('.patron:has(input[value="gyroid"])');
        await pagina.tap('.atajo[data-densidad="0.4"]');
        await pagina.tap('#laminar');
        await pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 240000 });
        await pagina.waitForSelector('#controlCapas:not([hidden])', { timeout: 120000 });
        await revisarVista(pagina, revisar);
    } finally {
        await contexto.close();
    }
}

async function revisarVista(pagina, revisar) {
    const aviso = (await pagina.textContent('#avisoVista')).trim();
    revisar(
        'vista liviana: aparece el aviso de vista simplificada',
        (await pagina.isVisible('#avisoVista')) && /simplificada/.test(aviso) && /G-code[^.]*no cambia/.test(aviso),
        aviso,
    );
    revisar('vista liviana: no es el aviso de vista cortada', !/hasta la capa/.test(aviso), aviso);

    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const gcode = fs.readFileSync(await descarga.path(), 'utf8');
    const delGcode = gcode.split('\n').filter(l => l.startsWith(';LAYER:')).length;
    const delTexto = Number((await pagina.textContent('#textoCapa')).match(/Capa (\d+)\/(\d+)/)?.[2]);
    const resumen = await pagina.evaluate(
        () =>
            [...document.querySelectorAll('#resumen dt')].find(d => d.textContent.trim() === 'Capas')
                ?.nextElementSibling?.textContent,
    );
    revisar('vista liviana: el G-code tiene muchas capas', delGcode > 100, `${delGcode} capas`);
    revisar(
        'vista liviana: la vista muestra todas las capas del G-code',
        delTexto === delGcode,
        `${delTexto} de ${delGcode}`,
    );
    revisar(
        'vista liviana: el resumen dice las mismas capas',
        Math.abs(Number(resumen?.replace(/\D/g, '')) - delGcode) <= 1,
        resumen,
    );
    await esperarVisor(pagina, '#visorCapas');
    revisar(
        'vista liviana: el deslizador llega a la última capa',
        Number(await pagina.inputValue('#capa')) === delGcode - 1,
    );
    await pagina.locator('#capa').fill(String(delGcode - 1));
    revisar(
        'vista liviana: la última capa se puede ver',
        (await pagina.textContent('#textoCapa')).startsWith(`Capa ${delGcode}/${delGcode}`),
    );
}
