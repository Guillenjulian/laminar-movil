// Torres de calibración (ADR 0002, T9): hoja del paso 1, paso 2 y G-code descargado.
//
// Flujo: desde el paso 1 sin modelo abre la hoja "Torre de calibración", crea una torre de temperatura
// (valores sugeridos, 3 bloques de 6 mm para que lamine rápido), revisa que se oculten escala y rotación,
// que el paso 2 muestre la línea de la torre y oculte "Cambios por altura", lamina, descarga y revisa que
// el G-code tenga un M104 por bloque con su temperatura, en orden. Después revisa que la torre no entre
// en recientes y que cargar otro modelo vuelva a mostrar escala, rotación y los cambios por altura.
//
// Precondición: un modelo cargado, en el paso 2 (tras transformar.mjs) o en el paso 1.
// Deja: paso 1 con el cubo de 20 mm cargado (sin torre), escala 100 %.

import fs from 'node:fs';

const BLOQUES = 3;
const ALTO_MM = 6;

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarTorres(ctx) {
    const { page: pagina, ok: revisar, visible, elegirArchivo, esperarResultado } = ctx;
    // Llegar al paso 1 sin modelo: el botón de la torre está en la pantalla "sin modelo".
    if (!(await visible('section[data-paso="1"]'))) await pagina.goBack();
    await pagina.waitForSelector('section[data-paso="1"]:not([hidden])');
    if (!(await visible('#sinModelo'))) await pagina.tap('#otroModelo');
    await pagina.waitForSelector('#botonTorre', { state: 'visible' });
    await pagina.tap('#botonTorre');
    revisar('torre: se abre la hoja desde el paso 1', await visible('#hojaTorre'));
    await probarEscapeTorre(ctx);
    const valores = await crearTorre(ctx);
    revisar(
        'torre: se carga y oculta escala y rotación',
        (await pagina.textContent('#nombreModelo')) === 'Torre de temperatura' &&
            !(await visible('#ajustesModelo')) &&
            !(await visible('#escala')),
    );
    await pagina.tap('#siguiente');
    revisar(
        'torre: el paso 2 muestra su línea y oculta los cambios por altura',
        (await visible('#lineaTorre')) &&
            (await pagina.textContent('#lineaTorre')).includes(`${valores.join(', ')} °C`) &&
            !(await visible('#cambiosAltura')),
        await pagina.textContent('#lineaTorre'),
    );
    await pagina.tap('#laminar');
    await esperarResultado();
    revisarGcode(ctx, await descargar(pagina), valores);
    await revisarRecientes(ctx);
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    revisar(
        'torre: otro modelo vuelve a mostrar escala y rotación',
        (await visible('#ajustesModelo')) && (await visible('#escala')) && (await visible('[data-rotar="x"]')),
    );
    await pagina.tap('#siguiente');
    revisar(
        'torre: otro modelo en el paso 2, sin línea de torre y con cambios por altura',
        !(await visible('#lineaTorre')) && (await visible('#cambiosAltura')),
    );
    await pagina.goBack();
}

// Crea la torre de temperatura con los valores sugeridos (3 bloques de 6 mm) y devuelve esos valores.
/** Fija 3 bloques de 6 mm, crea la torre y devuelve los valores de la hoja releídos tras fijarlos.
 *  @param {import('../lib/app.mjs').Ctx} ctx @returns {Promise<number[]>} */
async function crearTorre({ page: pagina, ok: revisar }) {
    const leer = () => pagina.$$eval('#valoresTorre input', cs => cs.map(c => Number(c.value)));
    const sugeridos = await leer();
    revisar('torre: trae valores sugeridos', sugeridos.length >= BLOQUES && sugeridos.every(Number.isFinite));
    await pagina.fill('#formTorre input[name="bloques"]', String(BLOQUES));
    await pagina.locator('#formTorre input[name="bloques"]').blur();
    await pagina.fill('#formTorre input[name="alto"]', String(ALTO_MM));
    const valores = await leer();
    revisar(
        'torre: 3 bloques con sus valores',
        valores.length === BLOQUES && valores.every(Number.isFinite),
        `${valores}`,
    );
    await pagina.tap('#formTorre button[type="submit"]');
    await pagina.waitForFunction(
        () => document.getElementById('nombreModelo').textContent === 'Torre de temperatura',
        null,
        { timeout: 60000 },
    );
    return valores;
}

/** Toca Descargar y devuelve el G-code. @param {import('playwright-core').Page} pagina @returns {Promise<string>} */
async function descargar(pagina) {
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    return fs.readFileSync(await descarga.path(), 'utf8');
}

/** El bloque 1 va en el arranque: su M104 es el último antes del primer ;LAYER:. Después del primer ;LAYER:
 *  tienen que estar exactamente los de los bloques 2..N, en orden (un M104 de más o de menos falla).
 *  @param {import('../lib/app.mjs').Ctx} ctx @param {string} gcode @param {number[]} valores @returns {void} */
function revisarGcode({ ok: revisar }, gcode, valores) {
    const corte = gcode.indexOf(';LAYER:');
    const temps = texto => [...texto.matchAll(/^M104 S(\d+)/gm)].map(m => Number(m[1])).filter(t => t > 0);
    const antes = corte < 0 ? [] : temps(gcode.slice(0, corte));
    const despues = corte < 0 ? [] : temps(gcode.slice(corte));
    revisar(
        'torre: el G-code descargado tiene exactamente un M104 por bloque, en orden',
        corte >= 0 && antes.at(-1) === valores[0] && despues.join() === valores.slice(1).join(),
        `arranque ${antes.at(-1)}, después de ;LAYER: ${despues.join(' → ')} (esperado ${valores.join(' → ')})`,
    );
}

/** La torre no entra en recientes: espera a que la lista tenga el cubo (se guardó) y que no haya torre.
 *  @param {import('../lib/app.mjs').Ctx} ctx @returns {Promise<void>} */
async function revisarRecientes({ page: pagina, ok: revisar, visible }) {
    await pagina.goBack(); // resultado -> paso 2
    await pagina.goBack(); // paso 2 -> paso 1
    await pagina.tap('#otroModelo');
    await pagina.waitForSelector('.reciente b');
    const nombres = await pagina.$$eval('.reciente b', bs => bs.map(b => b.textContent));
    revisar(
        'torre: no aparece en recientes',
        (await visible('#sinModelo')) && nombres.length > 0 && !nombres.some(n => /torre/i.test(n)),
        JSON.stringify(nombres),
    );
}

// Escape cierra la hoja sin crear nada y el foco vuelve a #botonTorre; después la deja abierta otra vez.
async function probarEscapeTorre({ page: pagina, ok: revisar }) {
    await pagina.keyboard.press('Escape');
    await pagina.waitForSelector('#hojaTorre', { state: 'hidden' });
    revisar(
        'torre: Escape cierra la hoja y el foco vuelve a #botonTorre',
        (await pagina.evaluate(() => document.activeElement?.id)) === 'botonTorre',
    );
    await pagina.tap('#botonTorre');
    await pagina.waitForSelector('#hojaTorre:not([hidden])');
}
