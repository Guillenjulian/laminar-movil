// Cambios por altura (paso 2, ADR 0002): agregar, quitar y deshabilitar con altura variable.
// La prueba que lamina con un cambio y revisa el M104 la hace T9.
//
// Flujo: vuelve al paso 2, agrega 2 cambios, quita 1, prende Altura variable (la sección queda
// deshabilitada), la apaga, quita el cambio que queda, lamina con uno desde 100 mm (aviso), lo quita y avanza.
//
// Precondición: paso 4 (tras probarAvanzado), sin cambios por altura.
// Lamina el cubo con un cambio fuera de la pieza y revisa el aviso del paso 4.
// Deja: paso 4 visible, sin cambios por altura y con Altura variable apagada.

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
    await pagina.goForward();
    revisar('cambios: adelante vuelve al resultado', await visible('section[data-paso="4"]'));
}

/** Un cambio "desde 100 mm" en el cubo de 20 mm: tras laminar, el paso 4 avisa que no se aplicó.
 *  Lamina una vez más (cubo chico) y vuelve al paso 2 a quitar el cambio.
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
    await pagina.goBack();
    await pagina.tap('[data-quitar="0"]');
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
