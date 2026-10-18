// Pausas para cambiar filamento (paso 4, vista de capas).
//
// Flujo: no se puede pausar en la primera capa; pausa en las capas 10 y 30 (tres filamentos),
// colores por filamento, marcas sobre el deslizador, el filamento 2 en verde puro, y quita
// la pausa de la capa 30 (queda una sola: la de la capa 10).
//
// Precondición: paso 4 con la vista de capas lista (vista-capas.mjs), sin pausas.
// Deja: paso 4 con UNA pausa (entre Z 2,80 y Z 3,08) y el resumen visible.

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarPausas(ctx) {
    const { page: pagina, ok: revisar, captura } = ctx;
    await pagina.locator('#capa').fill('0');
    revisar('no se puede pausar en la primera capa', await pagina.isDisabled('#pausarCapa'));
    await pagina.locator('#capa').fill('10');
    await pagina.tap('#pausarCapa');
    await pagina.locator('#capa').fill('30');
    await pagina.tap('#pausarCapa');
    await revisarLista(ctx);
    await pagina.locator('#listaPausas').scrollIntoViewIfNeeded();
    await captura('4-pausas');
    await revisarColorFilamento(ctx);

    await pagina.tap('#listaPausas .quitar[data-capa="30"]');
    revisar('quitar una pausa', (await pagina.locator('#listaPausas .ir').count()) === 2);
    const resumen = await pagina.textContent('#resumen');
    revisar('resumen con tiempo y filamento', /Tiempo estimado/.test(resumen) && /Filamento.*m \(≈/.test(resumen));
    await captura('4-listo');
}

async function revisarLista({ page: pagina, ok: revisar }) {
    const filas = await pagina.$$eval('#listaPausas .ir', bs => bs.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
    revisar(
        'tres filamentos en la lista',
        filas.length === 3 &&
            filas[0] === 'Filamento 1 · capas 1–10' &&
            filas[1] === 'Filamento 2 · capas 11–30 ⏸ pausa en Z 3,08 mm' &&
            filas[2].startsWith('Filamento 3 · capas 31–71'),
        filas.join(' | '),
    );
    revisar(
        'con pausas pasa a colores por filamento',
        (await pagina.isVisible('#modoColor')) &&
            /activo/.test(await pagina.getAttribute('#modoColor [data-modo="filamento"]', 'class')),
    );
    revisar('la capa muestra la pausa', (await pagina.textContent('#textoCapa')).endsWith('⏸'));
    revisar('marcas sobre el deslizador', (await pagina.locator('#marcasPausa i').count()) === 2);
    revisar('el botón ahora quita la pausa', /Quitar/.test(await pagina.textContent('#pausarCapa')));
}

// Cuenta píxeles verdes en el centro del visor. Fuerza un dibujo y lee el canvas en ese mismo
// cuadro: si el visor ya dibujó en un cuadro anterior, WebGL descartó la imagen.
const verdes = pagina =>
    pagina.evaluate(
        () =>
            new Promise(listo => {
                document.getElementById('capa').dispatchEvent(new Event('input'));
                requestAnimationFrame(() => {
                    const c = document.querySelector('#visorCapas canvas');
                    const t = document.createElement('canvas');
                    t.width = 96;
                    t.height = 96;
                    const ctx = t.getContext('2d');
                    ctx.drawImage(c, c.width / 2 - 48, c.height / 2 - 48, 96, 96, 0, 0, 96, 96);
                    const d = ctx.getImageData(0, 0, 96, 96).data;
                    let n = 0;
                    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i] < 90 && d[i + 2] < 90) n++;
                    listo(n);
                });
            }),
    );

// Filamento 2 en verde puro: en la capa 20 tiene que verse verde; por tipo de línea, no.
async function revisarColorFilamento({ page: pagina, ok: revisar, captura }) {
    await pagina.locator('#listaPausas input[data-filamento="1"]').fill('#00ff00');
    await pagina.locator('#capa').fill('19');
    const conVerde = await verdes(pagina);
    await pagina.tap('#modoColor [data-modo="tipo"]');
    const sinVerde = await verdes(pagina);
    revisar(
        'el filamento 2 se pinta del color elegido',
        conVerde > 50 && sinVerde < conVerde / 10,
        `${conVerde} → ${sinVerde} píxeles verdes`,
    );
    await pagina.tap('#modoColor [data-modo="filamento"]');
    await pagina.locator('#capa').fill('70');
    await pagina.evaluate(() => document.getElementById('visorCapas').scrollIntoView());
    await pagina.waitForTimeout(300);
    await captura('4-filamentos');
}
