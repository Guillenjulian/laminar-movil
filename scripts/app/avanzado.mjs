// Ajustes avanzados (jarrón, costura, velocidad, ventilador).
//
// Flujo: vuelve un momento al paso 2 (el resultado queda), prueba el modo jarrón, lo apaga,
// elige costura al azar, velocidad 80 % y ventilador 50 %, y avanza al resultado. Se eligen
// opciones que no cambian lo que revisan las áreas siguientes (temperaturas, retracción); se
// restablecen en "recientes", después de recargar.
//
// Precondición: paso 4 con el cubo laminado en PLA.
// Deja: paso 4 visible, con el avanzado cambiado (costura al azar · velocidad 80 % · ventilador 50 %).

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarAvanzado(ctx) {
    const { page: pagina, ok: revisar, visible, captura } = ctx;
    await pagina.goBack();
    const resumenAv = () => pagina.textContent('#avanzado summary');
    revisar(
        'avanzado: sin cambios, resumen genérico',
        (await resumenAv()).startsWith('Avanzado: jarrón, costura'),
        await resumenAv(),
    );
    await probarJarron(ctx, resumenAv);
    await pagina.tap('label.opcion:has(input[name="costura"][value="azar"])');
    await pagina.locator('#avVelocidad').fill('80');
    await pagina.locator('#avVentilador').fill('50');
    revisar(
        'avanzado: resumen con lo cambiado',
        (await resumenAv()) === 'Avanzado: costura al azar · velocidad 80 % · ventilador 50 %',
        await resumenAv(),
    );
    await pagina.locator('#avRestablecer').scrollIntoViewIfNeeded();
    await captura('2-avanzado');
    await pagina.goForward();
    revisar('avanzado: adelante vuelve al resultado', await visible('section[data-paso="4"]'));
}

async function probarJarron({ page: pagina, ok: revisar, visible, captura }, resumenAv) {
    await pagina.tap('#avanzado summary');
    await pagina.tap('label.interruptor:has(#avJarron)');
    revisar(
        'avanzado: jarrón avisa y deshabilita el relleno',
        (await visible('#avisoJarron')) &&
            (await pagina.evaluate(() => document.getElementById('personalizar').classList.contains('sin-relleno'))) &&
            (await pagina.isDisabled('#avAlturaVariable')) &&
            (await resumenAv()) === 'Avanzado: jarrón',
        await resumenAv(),
    );
    await captura('2-avanzado-jarron');
    await pagina.tap('label.interruptor:has(#avJarron)');
    revisar(
        'avanzado: apagar el jarrón vuelve a lo de fábrica',
        !(await visible('#avisoJarron')) && (await resumenAv()).startsWith('Avanzado: jarrón, costura'),
    );
}
