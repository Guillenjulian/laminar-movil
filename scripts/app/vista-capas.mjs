// Vista previa capa por capa (paso 4).
//
// Flujo: espera el control de capas, revisa que arranque en la última capa con tantas capas como
// Kiri, prueba el botón −, el deslizador, "solo esta capa", reproducir y que el canvas tenga
// recorridos dibujados.
//
// Precondición: paso 4 visible con el cubo de 20 mm en PLA/Rápido (72 capas).
// Deja: paso 4, vista en la capa penúltima (la que fuerza el dibujo), sin pausas.

import { esperarVisor } from '../lib/visor.mjs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarVistaCapas(ctx) {
    const { page: pagina, ok: revisar, captura } = ctx;
    await pagina.waitForSelector('#controlCapas:not([hidden])', { timeout: 30000 });
    const textoCapa = () => pagina.textContent('#textoCapa');
    const ultima = await textoCapa();
    const m = ultima.match(/Capa (\d+)\/(\d+) · Z ([\d,]+) mm/);
    revisar(
        'vista previa: arranca en la última capa',
        m && m[1] === m[2] && Math.abs(parseFloat(m[3].replace(',', '.')) - 20) < 0.3,
        ultima,
    );
    revisar('vista previa: tantas capas como Kiri', m && Math.abs(Number(m[2]) - 72) <= 1, `${m?.[2]} capas`);
    revisar(
        'vista previa: un cubo no muestra aviso (texto vacío)',
        (await pagina.textContent('#avisoVista')) === '',
        await pagina.textContent('#avisoVista'),
    );
    await pagina.tap('#capaMenos');
    revisar('botón − baja una capa', (await textoCapa()).startsWith(`Capa ${Number(m[2]) - 1}/`));
    await pagina.locator('#capa').fill('0');
    revisar('deslizador a la primera capa', /^Capa 1\/\d+ · Z 0,28 mm/.test(await textoCapa()), await textoCapa());
    await pagina.locator('#capa').fill(String(Math.round(Number(m[2]) / 2)));
    await pagina.waitForTimeout(400);
    await captura('4-vista-capas');
    await pagina.tap('#soloCapa');
    await pagina.waitForTimeout(300);
    await captura('4-vista-capa-sola');
    await pagina.tap('#soloCapa');
    await reproducir(ctx, ultima);
    const pixeles = await pixelesConColor(pagina);
    revisar('se dibujan los recorridos', pixeles > 50, `${pixeles} píxeles con color en el centro`);
}

async function reproducir({ page: pagina, ok: revisar }, ultima) {
    await pagina.tap('#reproducir');
    await pagina.waitForTimeout(600);
    const durante = await pagina.textContent('#textoCapa');
    await pagina.waitForFunction(() => document.getElementById('reproducir').textContent === '▶', null, {
        timeout: 15000,
    });
    revisar(
        'reproducir recorre las capas hasta el final',
        durante !== ultima && (await pagina.textContent('#textoCapa')) === ultima,
        durante,
    );
}

async function pixelesConColor(pagina) {
    await esperarVisor(pagina, '#visorCapas');
    return pagina.evaluate(
        () =>
            new Promise(listo => {
                // El visor sólo dibuja cuando algo cambia: movemos la capa para forzar un dibujo.
                const capa = document.getElementById('capa');
                capa.value = Number(capa.max) - 1;
                capa.dispatchEvent(new Event('input'));
                requestAnimationFrame(() => {
                    // ¿El canvas tiene algo dibujado? Miramos el centro en una copia 2D, dentro del mismo
                    // cuadro en que dibuja three.js (después WebGL descarta la imagen).
                    const c = document.querySelector('#visorCapas canvas');
                    const t = document.createElement('canvas');
                    t.width = 64;
                    t.height = 64;
                    const ctx = t.getContext('2d');
                    ctx.drawImage(c, c.width / 2 - 32, c.height / 2 - 32, 64, 64, 0, 0, 64, 64);
                    const d = ctx.getImageData(0, 0, 64, 64).data;
                    let pintados = 0;
                    for (let i = 0; i < d.length; i += 4)
                        if (d[i + 3] > 0 && (d[i] > 150 || d[i + 2] > 150)) pintados++;
                    listo(pintados);
                });
            }),
    );
}
