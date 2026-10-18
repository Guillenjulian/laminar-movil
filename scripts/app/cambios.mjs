// Cambios por altura (paso 2, ADR 0002): agregar, quitar y deshabilitar con altura variable.
// El M104 en el G-code lo revisa scripts/app/cambios-gcode.mjs.
//
// Flujo: vuelve al paso 2, agrega 2 cambios, quita 1, prende Altura variable (la sección queda
// deshabilitada), la apaga, quita el cambio que queda, lamina el cubo con uno desde 100 mm (el paso 4
// avisa), carga una torre de temperatura y lamina (no avisa: los cambios de la torre caen dentro de la
// pieza), vuelve al cubo y lamina otra vez.
//
// Precondición: paso 4 (tras probarAvanzado), sin cambios por altura.
// Deja: paso 4 visible con el resultado del cubo sin aviso, sin cambios por altura y con Altura variable apagada.

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarCambios(ctx) {
    const { page: pagina, ok: revisar, visible, captura } = ctx;
    await pagina.goBack();
    const resumen = () => pagina.textContent('#cambiosAltura summary');
    await pagina.tap('#cambiosAltura summary');
    await pagina.tap('#cambAgregar');
    await pagina.tap('#cambAgregar');
    revisar('cambios: dos cambios en el resumen', (await resumen()).endsWith('2 cambios'), await resumen());
    await pagina.tap('[data-quitar="0"]');
    revisar(
        'cambios: quitar deja uno',
        (await resumen()).endsWith('1 cambio') && (await pagina.locator('.cambio').count()) === 1,
        await resumen(),
    );
    await captura('2-cambios');
    await probarVacios(ctx);
    await pagina.tap('label.interruptor:has(#avAlturaVariable)');
    revisar(
        'cambios: altura variable deshabilita la sección',
        (await visible('#cambAlturaVariable')) &&
            (await pagina.isDisabled('#cambAgregar')) &&
            (await pagina.isDisabled('[data-quitar="0"]')),
    );
    await pagina.tap('label.interruptor:has(#avAlturaVariable)');
    revisar('cambios: sin altura variable se habilita', !(await pagina.isDisabled('#cambAgregar')));
    await pagina.tap('[data-quitar="0"]');
    revisar('cambios: sin cambios', (await resumen()) === 'Cambios por altura', await resumen());
    await probarAviso(ctx);
    await probarTorre(ctx);
    revisar('cambios: de vuelta en el resultado del cubo', await visible('section[data-paso="4"]'));
}

/** Un cambio "desde 100 mm" en el cubo de 20 mm: tras laminar, el paso 4 avisa que no se aplicó.
 *  @param {import('../lib/app.mjs').Ctx} ctx */
async function probarAviso({ page: pagina, ok: revisar, visible, esperarResultado }) {
    await pagina.tap('#cambAgregar');
    await pagina.locator('[data-k="desdeMm"]').fill('100');
    await pagina.locator('[data-k="desdeMm"]').blur();
    await pagina.tap('#laminar');
    await esperarResultado();
    const aviso = await pagina.textContent('#avisoResultado');
    revisar(
        'cambios: aviso si el cambio queda por encima de la pieza',
        (await visible('#avisoResultado')) && aviso.includes('desde 100 mm') && aviso.includes('no se aplicó'),
        aviso,
    );
}

/** Con una torre, el paso 4 avisa sólo de los cambios efectivos (los de la torre, que caen dentro de la pieza),
 *  no de los del usuario (cargar la torre los vacía). Después vuelve al cubo y lamina de nuevo.
 *  @param {import('../lib/app.mjs').Ctx} ctx */
async function probarTorre({ page: pagina, ok: revisar, visible, esperarResultado, elegirArchivo }) {
    await pagina.goBack(); // paso 2
    await pagina.goBack(); // paso 1
    await pagina.tap('#otroModelo');
    await pagina.tap('#botonTorre');
    await pagina.tap('#formTorre button[type="submit"]');
    await pagina.waitForFunction(() => /torre/i.test(document.getElementById('nombreModelo').textContent), null, {
        timeout: 60000,
    });
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
    const aviso = await pagina.textContent('#avisoResultado');
    revisar(
        'cambios: la torre no avisa de cambios ocultos',
        !(await visible('#avisoResultado')) || !aviso.includes('no se aplicó'),
        aviso,
    );
    await pagina.goBack(); // paso 2
    await pagina.goBack(); // paso 1
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
}

/** Campos vacíos: no se guardan como 0 sino como "sin valor" (error), y "Quitar" lo refleja.
 *  @param {import('../lib/app.mjs').Ctx} ctx */
async function probarVacios({ page: pagina, ok: revisar, visible }) {
    await pagina.locator('[data-k="relleno"]').fill('');
    await pagina.locator('[data-k="relleno"]').blur();
    revisar(
        'cambios: relleno vacío da error, no 0',
        (await visible('#cambErrores')) && (await pagina.locator('[data-k="relleno"]').inputValue()) === '',
        await pagina.textContent('#cambErrores'),
    );
    await pagina.locator('[data-k="desdeMm"]').fill('');
    await pagina.locator('[data-k="desdeMm"]').blur();
    revisar(
        'cambios: "Quitar" sin altura',
        (await pagina.getAttribute('[data-quitar="0"]', 'aria-label')) === 'Quitar este cambio',
    );
    await pagina.locator('[data-k="desdeMm"]').fill('10');
    await pagina.locator('[data-k="relleno"]').fill('20');
    await pagina.locator('[data-k="relleno"]').blur();
}
