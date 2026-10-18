// Cambios por altura (paso 2, ADR 0002): agregar, quitar y deshabilitar con altura variable.
// La prueba que lamina con un cambio y revisa el M104 la hace T9.
//
// Flujo: vuelve al paso 2, agrega 2 cambios, quita 1, prende Altura variable (la sección queda
// deshabilitada), la apaga, quita el cambio que queda y avanza otra vez al resultado.
//
// Precondición: paso 4 (tras probarAvanzado), sin cambios por altura.
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
    await pagina.goForward();
    revisar('cambios: adelante vuelve al resultado', await visible('section[data-paso="4"]'));
}
