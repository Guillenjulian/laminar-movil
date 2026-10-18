// PWA: instalable y sin conexión.
//
// Flujo: manifest con íconos, service worker controlando la página tras recargar; sin red abre
// la app, carga el cubo de ejemplo y lamina. Al final toca "Laminar otro modelo" (#otro).
//
// Precondición: cualquier paso de la app ya cargada (la última área deja la app en paso 2 o 1).
// Deja: paso 1 sin modelo cargado, de vuelta con conexión.

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
