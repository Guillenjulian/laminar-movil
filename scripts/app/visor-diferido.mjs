// Visor diferido (ADR 0006): lo que se hace mientras three.js todavía no llegó, y lo que pasa cuando llega.
//
// Flujo: en un contexto aparte sin service worker (para poder demorar el chunk del visor con `page.route`),
// carga la T, la gira 90° en X y suma una copia ANTES de que llegue el chunk. Mientras tanto el visor está en
// `data-visor="cargando"`, sin canvas, y el paso 1 sigue andando con la medida de la caja (la T sin girar). Al soltar
// el chunk, `alListo` (ajuste.aplicar + piezas.reacomodar) tiene que dejar la medida real de la T girada.
//
// Precondición: cualquiera (usa su propia página y no toca la del recorrido).
// Deja: nada cambia en la app del recorrido; cierra su contexto.

import { devices } from 'playwright-core';
import { esperarVisor } from '../lib/visor.mjs';

const medidas = pagina => pagina.textContent('#datosModelo').then(t => t.split(' · ')[0]);

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarVisorDiferido({ browser, base, ok: revisar, stlTe }) {
    const contexto = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
    const pagina = await contexto.newPage();
    let soltar;
    const puerta = new Promise(r => (soltar = r));
    await pagina.route('**/assets/visor-*.js', async ruta => {
        await puerta;
        await ruta.continue();
    });
    try {
        await pagina.goto(base);
        await pagina.setInputFiles('#archivo', stlTe);
        await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'te.stl');
        await pagina.tap('[data-rotar="x"]');
        await pagina.tap('#copiasMas');
        revisar(
            'visor diferido: cargando, sin canvas, y el paso 1 sigue andando',
            (await pagina.getAttribute('#visor', 'data-visor')) === 'cargando' &&
                (await pagina.locator('#visor canvas').count()) === 0 &&
                (await pagina.isEnabled('#siguiente')) &&
                (await pagina.textContent('#copiasNum')).trim() === '2',
        );
        revisar(
            'visor diferido: mientras tanto la medida es la de la caja (sin girar)',
            (await medidas(pagina)) === '50,0 × 10,0 × 23,0 mm',
        );
        soltar();
        await revisarAlLlegar(pagina, revisar);
    } finally {
        soltar();
        await contexto.close();
    }
}

// Con el chunk ya en la página: la medida real y la cola reproducida.
async function revisarAlLlegar(pagina, revisar) {
    await esperarVisor(pagina, '#visor');
    const real = await pagina
        .waitForFunction(
            () => document.getElementById('datosModelo').textContent.startsWith('50,0 × 23,0 × 10,0 mm'),
            null,
            { timeout: 10000 },
        )
        .then(
            () => true,
            () => false,
        );
    revisar('visor diferido: al llegar, alListo deja la medida real de la T girada', real, await medidas(pagina));
    revisar(
        'visor diferido: la cola se reprodujo (una pieza en el visor, 2 copias)',
        (await pagina.evaluate(() => document.querySelector('#visor canvas').dataset.piezas)) === '1' &&
            (await pagina.evaluate(() => document.getElementById('listaPiezas').dataset.copias)) === '2',
    );
}
