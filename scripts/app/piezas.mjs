// BORRADOR hasta T11 (no está enganchado en probar-app.mjs): varias piezas en el paso 1 (ADR 0003, T8).
//
// Flujo: con el cubo cargado, "Agregar cubo de ejemplo" suma una segunda pieza (2 chips numeradas, la nueva
// activa y con el foco); su escala se ve en #datosModelo (que sale del visor) y en una captura del visor;
// tocar la chip 1 la vuelve activa y la escala muestra la suya; quitar la 2 vuelve a una pieza sin chips
// (el visor ya no la dibuja y el foco va a "Agregar pieza"). Después: quitar la activa cuando es la primera,
// el tope de MAX_PIEZAS (8) y que con una torre no se vea "Agregar pieza".
//
// Precondición: paso 1 con el cubo de ejemplo cargado (una sola pieza, sin chips), escala 100 %.
// Deja: paso 1 con el cubo de ejemplo cargado (una sola pieza, sin chips), escala 100 %.

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarPiezas(ctx) {
    await probarAgregarYElegir(ctx);
    await probarQuitar(ctx);
    await probarTope(ctx);
    await probarTorre(ctx);
}

const chips = pagina => pagina.locator('#listaPiezas .chip');
const pulsadas = pagina => chips(pagina).evaluateAll(b => b.map(x => x.getAttribute('aria-pressed')).join());
const medidas = pagina => pagina.textContent('#datosModelo').then(t => t.split(' · ')[0]);

/** Suma el cubo de ejemplo como pieza nueva y espera a que haya `n` chips. */
async function agregarCubo(pagina, n) {
    await pagina.tap('#agregarEjemplo');
    await pagina.waitForFunction(k => document.querySelectorAll('#listaPiezas .chip').length === k, n);
}

async function probarAgregarYElegir(ctx) {
    const { page: pagina, ok: revisar, visible } = ctx;
    revisar(
        'una pieza: sin chips y con "Agregar pieza"',
        !(await visible('#listaPiezas')) && (await visible('#agregarPieza')),
    );
    revisar('una pieza: ni siquiera hay chips en el DOM', (await chips(pagina).count()) === 0);
    await agregarCubo(pagina, 2);
    revisar('2 chips, la nueva es la activa', (await pulsadas(pagina)) === 'false,true', await pulsadas(pagina));
    revisar(
        'foco en la chip nueva',
        await pagina.evaluate(() => document.activeElement === document.querySelectorAll('#listaPiezas .chip')[1]),
    );
    revisar(
        'chips numeradas y botón de quitar con aria-label',
        (await chips(pagina).nth(1).textContent()) === '2. cubo-20mm.stl' &&
            (await pagina.getAttribute('#listaPiezas li:nth-child(2) .chip-quitar', 'aria-label')) ===
                'Quitar pieza 2, cubo-20mm.stl',
    );
    revisar('aria-live anuncia "Pieza agregada"', /Pieza agregada/.test(await pagina.textContent('#avisoPiezas')));

    await probarEscalaPieza2(ctx);
}

/** Escala de la pieza 2 (activa) y su efecto en el visor; luego alterna la activa con las chips. */
async function probarEscalaPieza2({ page: pagina, ok: revisar }) {
    await pagina.waitForTimeout(300);
    const antes = await pagina.locator('#visor').screenshot();
    await pagina.fill('#escala', '150');
    await pagina.locator('#escala').blur();
    revisar(
        'escala de la pieza 2 en el visor (150 %)',
        (await medidas(pagina)) === '30,0 × 30,0 × 30,0 mm',
        await medidas(pagina),
    );
    await pagina.waitForTimeout(300);
    revisar(
        'el visor dibuja distinto con la pieza 2 agrandada',
        !antes.equals(await pagina.locator('#visor').screenshot()),
    );

    await pagina.tap('#listaPiezas li:nth-child(1) .chip');
    revisar('tocar la chip 1: pasa a activa', (await pulsadas(pagina)) === 'true,false', await pulsadas(pagina));
    revisar(
        'la escala muestra la de la pieza 1 (100 %, 20 mm)',
        (await pagina.inputValue('#escala')) === '100' && (await medidas(pagina)) === '20,0 × 20,0 × 20,0 mm',
    );
    await pagina.tap('#listaPiezas li:nth-child(2) .chip');
    revisar(
        'la pieza 2 conserva su escala (150 %, 30 mm)',
        (await pagina.inputValue('#escala')) === '150' && (await medidas(pagina)) === '30,0 × 30,0 × 30,0 mm',
    );
}

async function probarQuitar({ page: pagina, ok: revisar, visible }) {
    await pagina.waitForTimeout(300);
    const con2 = await pagina.locator('#visor').screenshot();
    await pagina.tap('#listaPiezas li:nth-child(2) .chip-quitar');
    revisar(
        'quitar la 2: una sola pieza y sin chips',
        !(await visible('#listaPiezas')) && (await chips(pagina).count()) === 0,
    );
    revisar(
        'foco en "Agregar pieza" al quedar sin chips',
        await pagina.evaluate(() => document.activeElement?.id === 'agregarArchivo'),
    );
    revisar('aria-live anuncia "Pieza quitada"', /Pieza quitada/.test(await pagina.textContent('#avisoPiezas')));
    revisar(
        'queda la primera, a 100 % y 20 mm',
        (await pagina.inputValue('#escala')) === '100' && (await medidas(pagina)) === '20,0 × 20,0 × 20,0 mm',
    );
    await pagina.waitForTimeout(300);
    revisar('el visor ya no dibuja la pieza 2', !con2.equals(await pagina.locator('#visor').screenshot()));

    // Quitar la activa cuando es la primera: la 2 pasa a ser la única, con su escala.
    await agregarCubo(pagina, 2);
    await pagina.fill('#escala', '150');
    await pagina.locator('#escala').blur();
    await pagina.tap('#listaPiezas li:nth-child(1) .chip');
    await pagina.tap('#listaPiezas li:nth-child(1) .chip-quitar');
    revisar('quitar la primera (activa): queda la otra sin chips', !(await visible('#listaPiezas')));
    revisar(
        'la que queda es la pieza 2: 150 % y 30 mm en el visor',
        (await pagina.inputValue('#escala')) === '150' && (await medidas(pagina)) === '30,0 × 30,0 × 30,0 mm',
        await medidas(pagina),
    );
    await pagina.tap('#restablecerModelo');
}

async function probarTope({ page: pagina, ok: revisar }) {
    for (let n = 2; n <= 8; n++) await agregarCubo(pagina, n);
    const deshabilitados = await pagina.evaluate(
        () => document.getElementById('agregarArchivo').disabled && document.getElementById('agregarEjemplo').disabled,
    );
    revisar(
        'tope de 8 piezas: botones deshabilitados con texto que lo explica',
        deshabilitados &&
            /Máximo 8/.test(await pagina.textContent('#agregarArchivo')) &&
            /Máximo 8/.test(await pagina.textContent('#agregarEjemplo')),
    );
    for (let n = 7; n >= 1; n--) await pagina.tap('#listaPiezas li:nth-child(1) .chip-quitar');
    revisar(
        'al quitar, vuelve "Agregar pieza" habilitado',
        (await pagina.isEnabled('#agregarArchivo')) &&
            (await pagina.textContent('#agregarArchivo')) === 'Agregar pieza',
    );
}

async function probarTorre({ page: pagina, ok: revisar, visible, elegirArchivo }) {
    await pagina.tap('#otroModelo');
    await pagina.tap('#botonTorre');
    await pagina.tap('#formTorre button[type="submit"]');
    await pagina.waitForFunction(
        () => document.getElementById('nombreModelo').textContent === 'Torre de temperatura',
        null,
        {
            timeout: 60000,
        },
    );
    revisar('con una torre no se ve "Agregar pieza"', !(await visible('#agregarPieza')));
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    revisar('de vuelta al cubo: vuelve "Agregar pieza"', await visible('#agregarPieza'));
}
