// Paso 3: laminando. Cancelar a mitad de camino y laminar el cubo hasta el paso 4.
//
// probarCancelar — precondición: paso 2 visible. Atrás, carga la esfera pesada, lamina hasta
//   el 10 % y cancela. Deja: paso 2 con la esfera cargada.
// probarPersonalizar — precondición: paso 2 (tras cancelar). Atrás, vuelve al cubo y personaliza
//   (giroide, 40 %, 3 paredes, borde). Deja: paso 2 con el cubo y lo personalizado, sin laminar.
// probarLaminarCubo — precondición: paso 2 con lo personalizado. Lamina. Deja: paso 4 (resultado).

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarCancelar(ctx) {
    const { page: pagina, ok: revisar, visible, captura, elegirArchivo, stlPesado } = ctx;
    // Cancelar a mitad de camino (con la esfera pesada, que tarda).
    await pagina.goBack();
    await elegirArchivo(stlPesado);
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await pagina.waitForFunction(() => parseInt(document.getElementById('porcentaje').textContent) >= 10, null, {
        timeout: 60000,
    });
    await captura('3-laminando');
    await pagina.tap('#cancelar');
    revisar('cancelar → paso 2', await visible('section[data-paso="2"]'));
}

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarPersonalizar(ctx) {
    const { page: pagina, ok: revisar, captura, elegirArchivo } = ctx;
    await pagina.goBack();
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    await pagina.tap('#siguiente');

    // Personalizar: giroide, "Fuerte" (40 %), una pared más (Rápido trae 2) y borde.
    await pagina.tap('#personalizar summary');
    await pagina.tap('.patron:has(input[value="gyroid"])');
    await pagina.tap('.atajo[data-densidad="0.4"]');
    await pagina.tap('.contador[data-clave="paredes"] button[data-delta="1"]');
    await pagina.tap('label.opcion:has(input[value="borde"])');
    revisar(
        'personalizar: valores elegidos',
        (await pagina.isChecked('input[value="gyroid"]')) &&
            (await pagina.textContent('#densidadValor')) === '40 %' &&
            (await pagina.textContent('.contador[data-clave="paredes"] output')) === '3',
    );
    const resumenPers = await pagina.textContent('#personalizar summary');
    revisar(
        'resumen de lo personalizado',
        resumenPers === 'Personalizado: Giroide 40 % · 3 paredes · Borde',
        resumenPers,
    );
    await pagina.evaluate(() => document.getElementById('personalizar').scrollIntoView());
    await captura('2-relleno');
    await pagina.locator('#adhesiones').scrollIntoViewIfNeeded();
    await captura('2-personalizar');
    revisar(
        'la página no se corre (acciones abajo de todo)',
        await pagina.evaluate(
            () => Math.abs(document.querySelector('.acciones').getBoundingClientRect().bottom - innerHeight) < 2,
        ),
    );
}

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarLaminarCubo(ctx) {
    const { page: pagina, ok: revisar, esperarResultado } = ctx;
    await pagina.tap('#laminar');
    await esperarResultado();
    revisar('paso 4 visible', true);
    revisar(
        'el resultado usa lo personalizado',
        (await pagina.textContent('#resumen')).includes('Giroide 40 % · 3 paredes · Borde'),
    );
}
