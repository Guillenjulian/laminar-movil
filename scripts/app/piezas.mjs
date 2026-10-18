// Varias piezas en el paso 1 (ADR 0003, T8): agregar, elegir la activa y quitar.
//
// Flujo: con el cubo de ejemplo cargado, "Agregar cubo de ejemplo" suma una segunda pieza (2 chips, la
// nueva activa y con el foco); tocar la chip 1 la vuelve activa y la escala muestra la suya; se quita
// la 2 (queda una sola pieza, sin chips).
//
// Precondición: paso 1 con un modelo STL cargado (una sola pieza), sin chips.
// Deja: paso 1 con una sola pieza (la primera), escala 100 %, sin chips.

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarPiezas(ctx) {
    const { page: pagina, ok: revisar } = ctx;
    const pulsadas = () =>
        pagina.locator('#listaPiezas .chip').evaluateAll(b => b.map(x => x.getAttribute('aria-pressed')).join());
    revisar(
        'una pieza: sin chips y con "Agregar pieza"',
        !(await ctx.visible('#listaPiezas')) && (await ctx.visible('#agregarPieza')),
    );

    await pagina.tap('#agregarEjemplo');
    await pagina.waitForFunction(() => document.querySelectorAll('#listaPiezas .chip').length === 2);
    revisar('2 chips, la nueva es la activa', (await pulsadas()) === 'false,true', await pulsadas());
    revisar(
        'foco en la chip nueva',
        await pagina.evaluate(() => document.activeElement === document.querySelectorAll('#listaPiezas .chip')[1]),
    );

    await pagina.fill('#escala', '150');
    await pagina.locator('#escala').blur();
    await pagina.tap('#listaPiezas li:nth-child(1) .chip');
    revisar('tocar la chip 1: pasa a activa', (await pulsadas()) === 'true,false', await pulsadas());
    revisar('la escala muestra la de esa pieza (100 %)', (await pagina.inputValue('#escala')) === '100');
    await pagina.tap('#listaPiezas li:nth-child(2) .chip');
    revisar('la chip 2 conserva su escala (150 %)', (await pagina.inputValue('#escala')) === '150');

    const etiqueta = await pagina.getAttribute('#listaPiezas li:nth-child(2) .chip-quitar', 'aria-label');
    revisar('botón de quitar con aria-label', etiqueta === 'Quitar cubo-20mm.stl', etiqueta);
    await pagina.tap('#listaPiezas li:nth-child(2) .chip-quitar');
    revisar('quitar la 2: una sola pieza y sin chips', !(await ctx.visible('#listaPiezas')));
    revisar('queda la primera, a 100 %', (await pagina.inputValue('#escala')) === '100');
    revisar('el modelo sigue cargado', await ctx.visible('#otroModelo'));
}
