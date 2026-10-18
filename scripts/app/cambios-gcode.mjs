// Cambios por altura en el G-code descargado (ADR 0002, T9).
//
// Flujo: con el cubo de 20 mm, agrega un cambio "desde 10 mm, temperatura 215" (sin tocar el relleno),
// lamina, descarga y revisa que el G-code tenga M104 S215 una sola vez y después de ;LAYER:49. Vuelve al
// paso 2 y quita el cambio.
//
// Precondición: paso 2 con el cubo de 20 mm cargado, sin cambios por altura (tras descarga.mjs).
// Deja: paso 2, sin cambios por altura (el resultado de la corrida con el cambio ya no está en pantalla).

import fs from 'node:fs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarCambiosGcode(ctx) {
    const { page: pagina, ok: revisar, esperarResultado } = ctx;
    if (await pagina.evaluate(() => !document.getElementById('cambiosAltura').open)) {
        await pagina.tap('#cambiosAltura summary');
    }
    await pagina.tap('#cambAgregar');
    await pagina.fill('[data-k="desdeMm"]', '10');
    await pagina.locator('[data-k="desdeMm"]').blur();
    await pagina.tap('[data-on="relleno"]');
    await pagina.tap('[data-on="tempBoquilla"]');
    await pagina.fill('[data-k="tempBoquilla"]', '215');
    await pagina.locator('[data-k="tempBoquilla"]').blur();
    revisar(
        'cambios G-code: un cambio desde 10 mm a 215 °C',
        (await pagina.textContent('#cambiosAltura summary')).endsWith('1 cambio') &&
            !(await pagina.isVisible('#cambErrores')),
        await pagina.textContent('#cambDetalle'),
    );
    await pagina.tap('#laminar');
    await esperarResultado();
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    revisarM104(ctx, fs.readFileSync(await descarga.path(), 'utf8'));
    await pagina.goBack();
    await pagina.tap('[data-quitar="0"]');
    revisar(
        'cambios G-code: quitado el cambio queda sin cambios',
        (await pagina.textContent('#cambiosAltura summary')) === 'Cambios por altura',
    );
}

// M104 S215 una sola vez, después de ;LAYER:49 (la capa de Z = 10 mm del cubo).
function revisarM104({ ok: revisar }, gcode) {
    const lineas = gcode.split('\n');
    const donde = lineas.flatMap((l, i) => (l.startsWith('M104 S215') ? [i] : []));
    const capa49 = lineas.indexOf(';LAYER:49');
    revisar('cambios G-code: M104 S215 una sola vez', donde.length === 1, `${donde.length} veces`);
    revisar(
        'cambios G-code: el M104 S215 va después de ;LAYER:49',
        capa49 >= 0 && donde.length === 1 && donde[0] > capa49,
        `M104 en la línea ${donde[0]}, ;LAYER:49 en la ${capa49}`,
    );
}
