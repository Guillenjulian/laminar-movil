// Descarga del G-code y botón "atrás" desde el resultado.
//
// Flujo: descarga el G-code del cubo (nombre, temperaturas, la pausa M600 entre Z 2,80 y Z 3,08)
// y revisa que "atrás" vuelva a la configuración y no a la barra de progreso.
//
// Precondición: paso 4 con una pausa en la capa 10 (pausas.mjs).
// Deja: paso 2 visible.

import fs from 'node:fs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarDescarga(ctx) {
    const { page: pagina, ok: revisar, visible } = ctx;
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const gcode = fs.readFileSync(await descarga.path(), 'utf8');
    revisar(
        'descarga del G-code',
        descarga.suggestedFilename() === 'cubo-20mm_rapido.gcode',
        descarga.suggestedFilename(),
    );
    revisar('G-code con temperaturas', gcode.includes('M104 S200') && gcode.includes('M140 S60'));
    revisarPausa(ctx, gcode);

    // "Atrás" desde el resultado vuelve a la configuración (no a la barra de progreso).
    await pagina.goBack();
    revisar('atrás desde el resultado → paso 2', await visible('section[data-paso="2"]'));
}

// una sola pausa, entre la capa de Z 2,80 y la de Z 3,08
function revisarPausa({ ok: revisar }, gcode) {
    const l = gcode.split('\n'),
        i = l.indexOf('M600');
    const zs = (a, b) =>
        l
            .slice(a, b)
            .map(x => x.match(/^G1 Z([\d.]+)/))
            .filter(Boolean)
            .map(m => +m[1]);
    const antes = zs(0, i).at(-1),
        despues = zs(i, l.length)[0];
    revisar(
        'el G-code descargado trae la pausa',
        gcode.split('\nM600\n').length === 2 && antes === 2.8 && despues === 3.08,
        `Z ${antes} → M600 → Z ${despues}`,
    );
}
