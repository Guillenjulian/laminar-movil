// Paso 2: configuración básica (calidad) y botón "atrás" del celu.
//
// Flujo: "Siguiente" lleva al paso 2, elige calidad Rápido, atrás vuelve al paso 1 y adelante al 2.
//
// Precondición: paso 1 con el cubo cargado.
// Deja: paso 2 visible con calidad Rápido elegida.

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarConfig(ctx) {
    const { page: pagina, ok: revisar, visible, captura } = ctx;
    await pagina.tap('#siguiente');
    revisar('paso 2 visible', await visible('section[data-paso="2"]'));
    await pagina.tap('label.opcion:has(input[value="rapido"])');
    revisar('calidad Rápido elegida', await pagina.isChecked('input[value="rapido"]'));
    await captura('2-configurar');

    // Botón "atrás" del celu vuelve al paso 1 y "adelante" de nuevo al 2.
    await pagina.goBack();
    revisar('atrás → paso 1', await visible('section[data-paso="1"]'));
    await pagina.goForward();
    revisar('adelante → paso 2', await visible('section[data-paso="2"]'));
}
