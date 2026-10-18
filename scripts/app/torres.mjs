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
    await pagina.goBack();
    if (await visible('#otroModelo')) await pagina.tap('#otroModelo');
    await pagina.tap('#botonTorre');
    revisar('torre: se abre la hoja desde el paso 1', await visible('#hojaTorre'));
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
        (await visible('#lineaTorre')) && !(await visible('#cambiosAltura')),
        await pagina.textContent('#lineaTorre'),
    );
    await pagina.tap('#laminar');
    await esperarResultado();
    revisarGcode(ctx, await descargar(pagina), valores);
    await revisarRecientes(ctx);
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    revisar('torre: otro modelo vuelve a mostrar escala y rotación', await visible('#ajustesModelo'));
    await pagina.tap('#siguiente');
    revisar(
        'torre: otro modelo en el paso 2, sin línea de torre y con cambios por altura',
        !(await visible('#lineaTorre')) && (await visible('#cambiosAltura')),
    );
    await pagina.goBack();
}

// Crea la torre de temperatura con los valores sugeridos (3 bloques de 6 mm) y devuelve esos valores.
async function crearTorre({ page: pagina, ok: revisar }) {
    const leer = () => pagina.$$eval('#valoresTorre input', cs => cs.map(c => Number(c.value)));
    const sugeridos = await leer();
    revisar('torre: trae valores sugeridos', sugeridos.length >= BLOQUES && sugeridos.every(Number.isFinite));
    await pagina.fill('#formTorre input[name="bloques"]', String(BLOQUES));
    await pagina.locator('#formTorre input[name="bloques"]').blur();
    await pagina.fill('#formTorre input[name="alto"]', String(ALTO_MM));
    const valores = await leer();
    revisar('torre: 3 bloques', valores.length === BLOQUES && valores.join() === sugeridos.slice(0, BLOQUES).join());
    await pagina.tap('#formTorre button[type="submit"]');
    await pagina.waitForFunction(
        () => document.getElementById('nombreModelo').textContent === 'Torre de temperatura',
        null,
        { timeout: 60000 },
    );
    return valores;
}

async function descargar(pagina) {
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    return fs.readFileSync(await descarga.path(), 'utf8');
}

// Un M104 por bloque, con la temperatura de cada bloque y en orden. Se ignoran el precalentado del inicio
// (S150 de la plantilla) y los de apagar (S0): la torre son los últimos M104.
function revisarGcode({ ok: revisar }, gcode, valores) {
    const m104 = [...gcode.matchAll(/^M104 S(\d+)/gm)].map(m => Number(m[1])).filter(t => t > 0);
    const sinRepetir = m104.filter((t, i) => i === 0 || t !== m104[i - 1]);
    revisar(
        'torre: el G-code descargado tiene un M104 por bloque, en orden',
        sinRepetir.slice(-valores.length).join() === valores.join(),
        `M104 ${sinRepetir.join(' → ')} (esperado ${valores.join(' → ')})`,
    );
}

async function revisarRecientes({ page: pagina, ok: revisar, visible }) {
    await pagina.goBack(); // resultado -> paso 2
    await pagina.goBack(); // paso 2 -> paso 1
    await pagina.tap('#otroModelo');
    await pagina.waitForTimeout(800); // el guardado de recientes espera 500 ms
    const nombres = await pagina.$$eval('.reciente b', bs => bs.map(b => b.textContent));
    revisar(
        'torre: no aparece en recientes',
        (await visible('#sinModelo')) && !nombres.some(n => /torre/i.test(n)),
        JSON.stringify(nombres),
    );
}
