// Cambios por altura en el G-code descargado (ADR 0002, T9).
//
// Flujo: con el cubo de 20 mm, agrega un cambio "desde 10 mm, temperatura 215" (sin tocar el relleno),
// lamina, descarga y revisa que el G-code tenga M104 S215 una sola vez y en la capa de 10 mm. Vuelve al
// paso 2 y quita el cambio.
//
// Precondición: paso 2 con el cubo de 20 mm cargado, sin cambios por altura (tras descarga.mjs).
// Deja: paso 2, sin cambios por altura (el resultado de la corrida con el cambio ya no está en pantalla).

import fs from 'node:fs';
import { porCapa } from '../motor/gcode-capas.mjs';

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

/** Capa (`;LAYER:n`) cuyo piso es >= 10 mm: la primera después de una capa con Z >= 10 (la calidad cambia el número).
 *  @param {object[]} capas capas de `porCapa` @returns {number|undefined} n de la capa */
const capaDe10mm = capas => capas.find((c, i) => i > 0 && capas[i - 1].z >= 10 - 1e-6)?.n;

/** M104 S215 una sola vez y dentro de la capa que empieza a 10 mm, no en la anterior.
 *  @param {import('../lib/app.mjs').Ctx} ctx @param {string} gcode @returns {void} */
function revisarM104({ ok: revisar }, gcode) {
    const { capas } = porCapa(gcode.split('\n'));
    const n = capaDe10mm(capas);
    const con215 = capas.filter(c => c.m104.some(m => m.temp === 215)).map(c => c.n);
    const total = capas.reduce((t, c) => t + c.m104.filter(m => m.temp === 215).length, 0);
    revisar('cambios G-code: M104 S215 una sola vez', total === 1, `${total} veces`);
    revisar(
        'cambios G-code: el M104 S215 está en la capa de 10 mm y no en la anterior',
        n !== undefined && con215.join() === String(n),
        `capa de 10 mm = ;LAYER:${n}, M104 S215 en ;LAYER:${con215.join(', ')}`,
    );
}
