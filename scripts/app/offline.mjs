// PWA: instalable y sin conexión.
//
// Flujo: manifest con íconos, service worker controlando la página tras recargar; sin red abre
// la app, carga el cubo de ejemplo y lamina. Al final toca "Laminar otro modelo" (#otro).
//
// El visor 3D también carga sin conexión: su chunk (three.js) sale del caché del service worker (ADR 0006).
//
// Precondición: cualquier paso de la app ya cargada (la última área deja la app en paso 2 o 1).
// Deja: paso 1 sin modelo cargado, de vuelta con conexión.

import { esperarVisor } from '../lib/visor.mjs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarOffline(ctx) {
    const { page: pagina, context: contexto, ok: revisar, visible, esperarResultado } = ctx;
    const manifest = await pagina.evaluate(async () =>
        (await fetch(document.querySelector('link[rel=manifest]').href)).json(),
    );
    revisar('manifest con íconos', manifest.icons.length === 3 && manifest.display === 'standalone');
    await pagina.evaluate(() => navigator.serviceWorker.ready);
    await pagina.reload();
    revisar('service worker controlando la página', await pagina.evaluate(() => !!navigator.serviceWorker.controller));
    await contexto.setOffline(true);
    await pagina.reload();
    revisar('abre sin conexión', await visible('section[data-paso="1"]'));
    await pagina.tap('#ejemplo');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'cubo-20mm.stl');
    // Recargada sin red, la página no tiene el chunk del visor en memoria: lo tiene que traer del caché.
    await esperarVisor(pagina, '#visor');
    revisar('el visor 3D carga sin conexión', (await pagina.getAttribute('#visor', 'data-visor')) === 'listo');
    // Que cargue no prueba que esté precacheado (el fetch del service worker no queda offline): se mira el caché.
    const enCache = await pagina.evaluate(async () => {
        const url = performance.getEntriesByType('resource').find(r => /\/assets\/visor-[^/]*\.js/.test(r.name))?.name;
        return url ? !!(await caches.match(url, { ignoreSearch: true, ignoreVary: true })) : null;
    });
    revisar('el chunk del visor está en el caché del service worker', enCache === true, String(enCache));
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
    revisar('lamina sin conexión', true);
    await contexto.setOffline(false);

    // "Laminar otro modelo" vuelve al paso 1 sin modelo cargado.
    await pagina.tap('#otro');
    revisar(
        '"otro modelo" → paso 1 sin modelo',
        (await visible('section[data-paso="1"]')) && (await visible('#sinModelo')),
    );
}
