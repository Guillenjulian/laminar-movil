// Envío por red local, parte 3 de red.mjs (ADR 0007, T8): Moonraker, impresora Bambu (sin envío), quitar la config,
// limpieza de seguridad y los casos de la vuelta 2 de T7 (confirm antes del progreso, fallo de carga).
//
// Precondición: paso 4 de la Ender 3 V3 SE con config de OctoPrint guardada (la deja red-envio.mjs).
// Deja: paso 4 de la Ender con el cubo, sin config de red (Moonraker la reemplaza y casoQuitar la borra).

import { devices } from 'playwright-core';
import { IP, MOON, CLAVE, NOMBRE, simular, partes } from '../lib/red-simulada.mjs';
import {
    campo,
    abrirHoja,
    cerrarHoja,
    llenar,
    guardar,
    probar,
    descargar,
    esperarEnvio,
    entregaIntacta,
    laminarCon,
} from '../lib/red-pagina.mjs';

export async function casosMoonraker(ctx, rutas) {
    const { page: pagina, ok: revisar } = ctx;
    const m = simular(pagina, rutas, MOON, 'moonraker');
    await m.listo;
    const bajado = await descargar(ctx);
    await abrirHoja(ctx);
    await llenar(ctx, { tipo: 'moonraker', direccion: MOON, clave: CLAVE, imprimir: false });
    const conecto = await probar(ctx);
    revisar('Moonraker: Probar → "Conectó…"', conecto === 'Conectó con Moonraker v0.9.3.', conecto);
    revisar(
        'Moonraker: Probar pide /server/info y print_stats con X-Api-Key',
        m.pedidos('GET', '/server/info').length === 1 &&
            m.pedidos('GET', '/printer/objects/query?print_stats').length === 1 &&
            m.registro.filter(r => r.url !== MOON + '/').every(r => r.clave === CLAVE),
    );
    await guardar(ctx);
    m.vaciar();
    await pagina.tap('#enviarRed');
    const msg = await esperarEnvio(ctx);
    revisarSubidaMoonraker(ctx, m, bajado, msg);
}

function revisarSubidaMoonraker({ ok: revisar }, m, bajado, msg) {
    const subida = m.subidas()[0];
    const p = partes(subida);
    const archivo = p.find(x => x.nombre === 'file');
    const urls = m.subidas().map(s => s.url);
    revisar(
        'Moonraker: un solo POST a /server/files/upload',
        urls.length === 1 && urls[0] === `${MOON}/server/files/upload`,
        urls.join(' '),
    );
    revisar('Moonraker: lleva X-Api-Key', subida?.clave === CLAVE);
    const nombres = p.map(x => x.nombre).sort();
    revisar(
        'Moonraker: partes file y root=gcodes, sin print',
        nombres.join(',') === 'file,root' && p.find(x => x.nombre === 'root')?.contenido === 'gcodes',
        nombres.join(','),
    );
    revisar(
        'Moonraker: el archivo es el descargado, con su nombre',
        archivo?.archivo === NOMBRE && archivo.contenido === bajado.texto,
    );
    revisar('Moonraker: resultado en #estadoEntrega', msg === 'Listo: subido a la impresora.', msg);
}

/** Con una Bambu no se ofrece nada aunque la Ender tenga config; con la Ender otra vez reaparece. */
export async function casosBambu(ctx) {
    const { ok: revisar, visible } = ctx;
    await laminarCon(ctx, 'bambu-lab-a1');
    await ctx.page.waitForTimeout(300);
    revisar('Bambu: #enviarRed oculto aunque la Ender tenga config', !(await visible('#enviarRed')));
    revisar('Bambu: #configurarRed oculto', !(await visible('#configurarRed')));
    revisar('Bambu: Descargar sigue visible', await visible('#descargar'));
    await laminarCon(ctx, 'creality-ender-3-v3-se');
    revisar('Ender de nuevo: reaparece #enviarRed con la config guardada', await visible('#enviarRed'));
}

export async function casoQuitar(ctx) {
    const { page: pagina, ok: revisar, visible } = ctx;
    await abrirHoja(ctx);
    await pagina.tap('#quitarRed');
    await pagina.waitForSelector('#hojaRed', { state: 'hidden' });
    revisar('quitar la config → desaparece #enviarRed', !(await visible('#enviarRed')));
    revisar('quitar la config → queda #configurarRed', await visible('#configurarRed'));
    await abrirHoja(ctx);
    revisar(
        'quitar: al reabrir la hoja está vacía y sin Quitar',
        (await pagina.inputValue(campo('direccion'))) === '' && !(await visible('#quitarRed')),
    );
    await cerrarHoja(ctx);
}

/** Red de seguridad: si un caso falló a medias, no deja config guardada. */
export async function limpiarConfig(ctx) {
    const { page: pagina, visible } = ctx;
    try {
        if (!(await visible('section[data-paso="4"]'))) return;
        if (await visible('#hojaRed')) await cerrarHoja(ctx);
        if (!(await visible('#enviarRed'))) return;
        await abrirHoja(ctx);
        await pagina.tap('#quitarRed');
        await pagina.waitForSelector('#hojaRed', { state: 'hidden' });
    } catch {
        /* nada que limpiar */
    }
}

// ───────────── Vuelta 2 de T7: confirm antes de "Enviando…" y carga diferida del cliente ─────────────

export async function casosVuelta2(ctx, salida) {
    await confirmCancelado(ctx, salida);
    await falloDeCarga(ctx);
}

// Imprimir con el confirm cancelado: nunca se ve "Enviando…", ni hay POST ni mensaje.
async function confirmCancelado(ctx, salida) {
    const { page: pagina, ok: revisar } = ctx;
    await abrirHoja(ctx);
    await llenar(ctx, { imprimir: true });
    await guardar(ctx);
    const posts = [];
    const alPedido = r => r.method() === 'POST' && r.url().startsWith(IP) && posts.push(r.url());
    await pagina.evaluate(() => {
        window.__viEnviando = false; // ¿alguna vez dijo "Enviando…"?
        new MutationObserver(() => {
            if (document.getElementById('progresoEnvioRed').textContent === 'Enviando…') window.__viEnviando = true;
        }).observe(document.getElementById('progresoEnvioRed'), {
            childList: true,
            characterData: true,
            subtree: true,
        });
    });
    salida.responder = 'dismiss';
    pagina.on('request', alPedido);
    await pagina.tap('#enviarRed');
    await pagina.waitForTimeout(500);
    pagina.off('request', alPedido);
    salida.responder = 'accept';
    revisar(
        'vuelta 2: con el confirm cancelado nunca se vio "Enviando…"',
        !(await pagina.evaluate(() => window.__viEnviando)),
    );
    revisar(
        'vuelta 2: confirm cancelado → sin "Enviando…", sin POST y sin mensaje',
        (await pagina.textContent('#progresoEnvioRed')) === '' &&
            posts.length === 0 &&
            (await pagina.textContent('#estadoEntrega')) === '',
    );
    await abrirHoja(ctx);
    await llenar(ctx, { imprimir: false });
    await guardar(ctx);
}

// El chunk del cliente no carga: error 'carga' y la entrega sigue disponible. Usa un contexto aparte sin service
// worker (con SW el chunk sale de su caché y page.route no lo toca), así que no altera el estado de la página
// principal: su propia config de red vive en el IndexedDB de ese contexto, que se cierra al terminar.
async function falloDeCarga(ctx) {
    const { ok: revisar } = ctx;
    const contexto = await ctx.browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
    try {
        const pagina = await contexto.newPage();
        await pagina.route('**/cliente-*.js', r => r.abort('failed'));
        await pagina.goto(ctx.base);
        await pagina.setInputFiles('#archivo', 'public/ejemplos/cubo-20mm.stl');
        await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent !== '');
        await pagina.tap('#siguiente');
        await pagina.tap('#laminar');
        await pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 60000 });
        const otro = { ...ctx, page: pagina };
        await abrirHoja(otro);
        await llenar(otro, { direccion: IP, clave: CLAVE });
        await guardar(otro);
        await pagina.tap('#enviarRed');
        const msg = await esperarEnvio(otro);
        revisar(
            'vuelta 2: chunk del cliente abortado → "No se pudo cargar el envío."',
            msg.startsWith('No se pudo cargar el envío. Recargá la app y probá de nuevo.'),
            msg,
        );
        revisar('vuelta 2: tras el fallo de carga Descargar/Compartir siguen disponibles', await entregaIntacta(otro));
        revisar(
            'vuelta 2: tras el fallo de carga #enviarRed vuelve a estar habilitado',
            !(await pagina.isDisabled('#enviarRed')),
        );
    } finally {
        await contexto.close();
    }
}
