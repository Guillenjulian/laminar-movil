// Guardado en el celu (IndexedDB): modelos recientes y ajustes que se recuerdan al recargar.
//
// Flujo: recarga la página, revisa los recientes, abre el cubo, comprueba que se recuerdan la
// calidad, la impresora propia, lo personalizado y lo avanzado; borra la impresora propia,
// restablece avanzado y personalizado, y borra la esfera de recientes.
//
// Precondición: paso 2 con la impresora propia guardada, lo personalizado (giroide…) y lo
// avanzado (costura al azar · velocidad 80 % · ventilador 50 %) elegidos.
// Deja: paso 1 (tras el último "atrás"), sin la impresora propia ni la esfera en recientes.

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarRecientes(ctx) {
    await abrirReciente(ctx);
    await recordarAjustes(ctx);
    await restablecerAjustes(ctx);
    const { page: pagina, ok: revisar } = ctx;
    await pagina.goBack();
    await pagina.tap('#otroModelo');
    await pagina.tap('[data-borrar]:near(.reciente:has-text("esfera-pesada.stl"))');
    await pagina.waitForFunction(
        () => ![...document.querySelectorAll('.reciente b')].some(b => b.textContent === 'esfera-pesada.stl'),
    );
    revisar('borrar un reciente', true);
}

async function abrirReciente({ page: pagina, ok: revisar, captura }) {
    await pagina.reload();
    await pagina.waitForSelector('#recientes:not([hidden])');
    const recientes = await pagina.$$eval('.reciente b', bs => bs.map(b => b.textContent));
    revisar(
        'modelos recientes guardados',
        recientes[0] === 'cubo-20mm.stl' && recientes.includes('esfera-pesada.stl'),
        JSON.stringify(recientes),
    );
    await captura('1-recientes');
    await pagina.tap('.reciente:has-text("cubo-20mm.stl")');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'cubo-20mm.stl');
    revisar('abrir un reciente', true);
}

async function recordarAjustes({ page: pagina, ok: revisar }) {
    await pagina.tap('#siguiente');
    revisar('se recuerda la calidad elegida', await pagina.isChecked('input[value="rapido"]'));
    await pagina.tap('#cambiarImpresora');
    revisar(
        'la impresora propia sigue guardada',
        (await pagina.textContent('#listaImpresoras')).includes('Mi Ender 3 Pro'),
    );
    await pagina.tap('[data-id^="propia-"]');
    await pagina.tap('#editarImpresora');
    await pagina.tap('#borrarImpresora');
    await pagina.waitForSelector('#hojaMiImpresora', { state: 'hidden' });
    revisar(
        'borrar la propia vuelve a la inicial',
        /Ender 3 V3 SE/.test(await pagina.textContent('#impresoraElegida')),
    );
    revisar(
        'se recuerda lo personalizado',
        (await pagina.textContent('#personalizar summary')).startsWith('Personalizado: Giroide'),
    );
    revisar(
        'se recuerda lo avanzado',
        (await pagina.textContent('#avanzado summary')) ===
            'Avanzado: costura al azar · velocidad 80 % · ventilador 50 %',
        await pagina.textContent('#avanzado summary'),
    );
}

async function restablecerAjustes({ page: pagina, ok: revisar, visible }) {
    await pagina.tap('#avanzado summary');
    revisar(
        'avanzado: los controles muestran lo guardado',
        (await pagina.isChecked('input[name="costura"][value="azar"]')) &&
            (await pagina.inputValue('#avVelocidad')) === '80' &&
            (await pagina.textContent('#avVentiladorValor')) === '50 %',
    );
    await pagina.tap('#avRestablecer');
    revisar(
        'avanzado: volver a los valores de fábrica',
        (await pagina.textContent('#avanzado summary')).startsWith('Avanzado: jarrón, costura') &&
            (await pagina.isChecked('input[name="costura"][value="ultima"]')) &&
            (await pagina.inputValue('#avVelocidad')) === '100' &&
            !(await visible('#avRestablecer')),
    );
    await pagina.tap('#avanzado summary');
    await pagina.tap('#personalizar summary');
    await pagina.tap('#restablecer');
    revisar(
        'volver a los valores de la calidad',
        (await pagina.textContent('#personalizar summary')).startsWith('Personalizar'),
    );
}
