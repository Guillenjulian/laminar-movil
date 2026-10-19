// Accesibilidad de pasos y hojas (ADR 0008, A2): aria-current, foco al cambiar de paso, hojas modales.
// `accesibilidad.mjs` la re-exporta para que probar-app.mjs siga importando todo desde ahí.

// Dónde está el foco: el id y a qué zona pertenece (dentro de `selector`, el cuerpo o fuera).
const foco = (page, selector) =>
    page.evaluate(
        sel => ({
            id: document.activeElement?.id || '',
            etiqueta: document.activeElement?.tagName,
            dentro: !!document.activeElement?.closest(sel),
        }),
        selector,
    );

const actuales = page => page.$$eval('.pasos li[aria-current]', lis => lis.map(li => li.dataset.paso).join(','));

// 14 pulsaciones hacia adelante y 14 hacia atrás: el foco siempre dentro de la hoja (o en body, fuera del documento).
async function recorrerConTab(page, hoja) {
    const salidas = [];
    for (const tecla of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 14; i++) {
            await page.keyboard.press(tecla);
            const f = await foco(page, hoja);
            if (!f.dentro && f.etiqueta !== 'BODY') salidas.push(`${tecla} ${i + 1}: ${f.etiqueta}#${f.id}`);
        }
    }
    return salidas;
}

// Escape y espera a que la hoja se cierre; si no se cierra devuelve false y la cierra con atrás (para seguir).
async function cerrarConEscape(page, hoja) {
    await page.keyboard.press('Escape');
    const cerro = await page.waitForSelector(hoja, { state: 'hidden', timeout: 2000 }).then(
        () => true,
        () => false,
    );
    if (!cerro) await page.goBack();
    return cerro;
}

async function probarPasoActual({ page, ok }) {
    ok('aria-current="step" sólo en el paso 2', (await actuales(page)) === '2', await actuales(page));
    const texto = await page.textContent('.pasos li[data-paso="2"]');
    ok('el paso dice "Paso 2 de 4" para lectores', texto.replace(/\s+/g, ' ').trim() === 'Paso 2 de 4', texto);
    await page.goBack();
    await page.waitForSelector('section[data-paso="1"]:not([hidden])');
    ok('aria-current pasa al paso 1', (await actuales(page)) === '1', await actuales(page));
    const f1 = await foco(page, 'section[data-paso="1"]');
    ok('al volver al paso 1 el foco está en el paso 1', f1.dentro, `${f1.etiqueta}#${f1.id}`);
    await page.tap('#siguiente');
    await page.waitForSelector('section[data-paso="2"]:not([hidden])');
    ok('aria-current vuelve al paso 2', (await actuales(page)) === '2', await actuales(page));
    const f2 = await foco(page, 'section[data-paso="2"]');
    ok(
        'tras "Siguiente" el foco está en el encabezado del paso 2',
        f2.dentro && f2.etiqueta === 'H2',
        `${f2.etiqueta}#${f2.id}`,
    );
}

async function estadoHoja(page, hoja) {
    return page.evaluate(id => {
        const h = document.getElementById(id);
        const inerte = sel => document.querySelector(sel)?.inert === true;
        return {
            dialogo: h.getAttribute('role') === 'dialog' && h.getAttribute('aria-modal') === 'true',
            nombre: document.getElementById(h.getAttribute('aria-labelledby'))?.tagName === 'H1',
            fondo: inerte('body > header.barra') && inerte('#main') && inerte('footer.acciones'),
            libre: !inerte('body > header.barra') && !inerte('#main') && !inerte('footer.acciones'),
        };
    }, hoja);
}

async function probarHojaImpresoras({ page, ok, visible }) {
    await page.tap('#cambiarImpresora');
    const e = await estadoHoja(page, 'hojaImpresoras');
    ok('la hoja es un diálogo modal con nombre', e.dialogo && e.nombre);
    ok('con la hoja abierta el fondo está inert', e.fondo);
    ok('al abrir la hoja el foco va a la búsqueda', (await foco(page, '#hojaImpresoras')).id === 'buscarImpresora');
    // Sin resultados la hoja sólo tiene tres controles: 14 Tab dan varias vueltas y, sin inert, llegan al fondo.
    await page.fill('#buscarImpresora', 'zzzz');
    const salidas = await recorrerConTab(page, '#hojaImpresoras');
    ok('14 Tab y 14 Shift+Tab no sacan el foco de la hoja', salidas.length === 0, salidas.join('; '));
    await page.fill('#buscarImpresora', ''); // con texto Escape sólo limpia el campo
    await page.focus('#buscarImpresora');
    const cerro = await cerrarConEscape(page, '#hojaImpresoras');
    ok('Escape cierra la hoja y deja el paso 2', cerro && (await visible('section[data-paso="2"]')));
    ok('al cerrar se saca el inert', (await estadoHoja(page, 'hojaImpresoras')).libre);
    ok('el foco vuelve a "Cambiar impresora"', (await foco(page, 'body')).id === 'cambiarImpresora');
}

// Dos Escape en el mismo turno (y uno con auto-repeat) con una hoja abierta: sólo cuenta un history.back().
async function probarEscapeRepetido({ page, ok, visible }) {
    await page.tap('#cambiarImpresora');
    await page.evaluate(() => {
        const tecla = repeat =>
            document.activeElement.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', repeat, bubbles: true }),
            );
        tecla(false);
        tecla(false);
        tecla(true);
    });
    const cerro = await page.waitForSelector('#hojaImpresoras', { state: 'hidden', timeout: 2000 }).then(
        () => true,
        () => false,
    );
    await page.waitForTimeout(300);
    const enApp = page.url().startsWith('http://localhost') && (await visible('section[data-paso="2"]'));
    ok(
        'dos Escape seguidos (y uno repetido) cierran sólo la hoja: sigue el paso 2 en la app',
        cerro && enApp,
        page.url(),
    );
    if (!cerro) await page.goBack();
    // Con texto en la búsqueda Escape lo deja limpiar el campo y no cierra la hoja.
    await page.tap('#cambiarImpresora');
    await page.fill('#buscarImpresora', 'prusa');
    await page.keyboard.press('Escape');
    ok('Escape con texto en la búsqueda no cierra la hoja', await visible('#hojaImpresoras'));
    await page.fill('#buscarImpresora', '');
    await cerrarConEscape(page, '#hojaImpresoras');
}

async function probarHojasApiladas({ page, ok }) {
    await page.tap('#cambiarImpresora');
    await page.tap('#nuevaImpresora');
    await page.waitForSelector('#hojaMiImpresora:not([hidden])');
    const dentro = await foco(page, '#hojaMiImpresora');
    ok('"Mi impresora" desde la hoja de impresoras: foco dentro de la hoja nueva', dentro.dentro, dentro.etiqueta);
    ok('con hojas apiladas el fondo sigue inert', (await estadoHoja(page, 'hojaMiImpresora')).fondo);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#hojaImpresoras:not([hidden])');
    ok(
        'Escape en la de arriba vuelve a la hoja de abajo, al botón que la abrió',
        (await foco(page, 'body')).id === 'nuevaImpresora',
    );
    ok('con la hoja de abajo el fondo sigue inert', (await estadoHoja(page, 'hojaImpresoras')).fondo);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#hojaImpresoras', { state: 'hidden' });
    ok(
        'al cerrar la última el foco vuelve a "Cambiar impresora"',
        (await foco(page, 'body')).id === 'cambiarImpresora',
    );
    ok('y el fondo queda libre', (await estadoHoja(page, 'hojaImpresoras')).libre);
}

/**
 * Paso actual, foco al cambiar de paso y hojas modales (H1, H2, H3; ADR 0008, A.2).
 *
 * Flujo: mira `aria-current` y el texto "Paso N de 4"; vuelve al paso 1 con atrás y avanza con "Siguiente"
 * midiendo `document.activeElement`; abre la hoja de impresoras (diálogo modal, fondo inert, foco en la búsqueda,
 * 14 Tab y 14 Shift+Tab sin salir, Escape cierra y devuelve el foco a #cambiarImpresora) y apila "Mi impresora"
 * (foco dentro, Escape vuelve a la hoja de abajo y luego al botón).
 *
 * Precondición: paso 2 visible.
 * Deja: paso 2 visible, ninguna hoja abierta, `main` sin `inert`.
 *
 * @param {import('../lib/app.mjs').Ctx} ctx
 */
export async function probarAccesibilidadPasos(ctx) {
    await probarPasoActual(ctx);
    await probarHojaImpresoras(ctx);
    await probarEscapeRepetido(ctx);
    await probarHojasApiladas(ctx);
}
