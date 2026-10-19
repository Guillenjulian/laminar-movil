// Envío por red local de punta a punta, con OctoPrint y Moonraker simulados por page.route (ADR 0007, T8).
//
// Flujo: sin config sólo se ve "Enviar por red…"; la hoja valida la dirección, prueba la conexión (conectó,
// clave mala, sin llegada) y sólo reutiliza la clave guardada si la dirección y el tipo no cambiaron; guarda; envía
// el MISMO G-code que baja Descargar (con las pausas) sin print/select, pide confirm con imprimir, cancela a mitad,
// muestra 409 y error de red; manda a Moonraker con root=gcodes; con una Bambu no ofrece nada; al quitar la config
// desaparece "Enviar a la impresora". La clave centinela no puede aparecer en el DOM, en la consola ni en los storages.
// La página se sirve desde http://localhost: no se ejercita el contenido mixto ni el permiso de red local (T10).
// Este archivo tiene la hoja y la clave; el envío está en red-envio.mjs y Moonraker/Bambu/quitar en red-impresoras.mjs.
//
// Precondición: paso 2 con el cubo de 20 mm cargado y la Ender 3 V3 SE elegida, sin resultado en pantalla y sin
//   config de red (tras descarga-bambu.mjs). Lamina de nuevo para tener el paso 4.
// Deja: paso 2 con lo mismo (Ender 3 V3 SE, cubo, calidad Rápido, material PLA, soportes 'no'), sin config de red,
//   sin rutas simuladas y con el manejo de diálogos de siempre (los confirm se aceptan).

import { IP, IP_B, CLAVE, CLAVE_B, simular } from '../lib/red-simulada.mjs';
import {
    guia,
    campo,
    atributo,
    enfocado,
    asegurarPausa,
    abrirHoja,
    cerrarHoja,
    llenar,
    guardar,
    probar,
    descargar,
    revisarSecreto,
} from '../lib/red-pagina.mjs';
import { casosEnvio, casosErrores, casoOtroModelo } from './red-envio.mjs';
import { casosMoonraker, casosBambu, casoQuitar, limpiarConfig, casosVuelta2 } from './red-impresoras.mjs';

const ERROR_CLAVE = 'Cambió la dirección o el tipo: escribí la clave de nuevo.';

// Junta consola y errores de página y toma el control de los diálogos (el común acepta solo). Devuelve cómo soltarlos.
function escuchar(pagina, salida) {
    const alConsola = m => salida.consola.push(m.text());
    const alError = e => salida.consola.push(e.message);
    const alDialogo = d => {
        salida.dialogos.push({ tipo: d.type(), mensaje: d.message() });
        (salida.responder === 'dismiss' ? d.dismiss() : d.accept()).catch(() => {});
    };
    const originales = pagina.listeners('dialog');
    pagina.removeAllListeners('dialog');
    pagina.on('dialog', alDialogo);
    pagina.on('console', alConsola);
    pagina.on('pageerror', alError);
    return () => {
        pagina.off('console', alConsola);
        pagina.off('pageerror', alError);
        pagina.off('dialog', alDialogo);
        for (const f of originales) pagina.on('dialog', f);
    };
}

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarRed(ctx) {
    const { page: pagina } = ctx;
    const salida = { consola: [], dialogos: [], responder: 'accept' };
    const soltar = escuchar(pagina, salida);
    const rutas = [];
    try {
        await pagina.tap('#laminar');
        await ctx.esperarResultado();
        await asegurarPausa(ctx);
        await casosOctoPrint(ctx, rutas, salida);
        await casosMoonraker(ctx, rutas);
        await casosVuelta2(ctx, salida);
        await casosBambu(ctx);
        await casoQuitar(ctx);
        await revisarSecreto(ctx, salida, 'al final');
    } finally {
        for (const [patron, manejador] of rutas) await pagina.unroute(patron, manejador).catch(() => {});
        soltar();
        await limpiarConfig(ctx);
    }
    if (await ctx.visible('section[data-paso="4"]')) await pagina.goBack(); // deja el paso 2
}

async function casosOctoPrint(ctx, rutas, salida) {
    const { page: pagina, ok: revisar, visible } = ctx;
    const a = simular(pagina, rutas, IP, 'octoprint');
    const b = simular(pagina, rutas, IP_B, 'octoprint');
    await Promise.all([a.listo, b.listo]);
    revisar('red sin config: #configurarRed visible', await visible('#configurarRed'));
    revisar('red sin config: #enviarRed oculto', !(await visible('#enviarRed')));
    revisar('red sin config: Descargar visible', await visible('#descargar'));
    guia.compartirVisible = await visible('#compartir');
    const bajado = await descargar(ctx);
    revisar('red: el G-code de referencia trae la pausa (M600)', bajado.texto.includes('\nM600\n'));
    await abrirHoja(ctx);
    await pagina.keyboard.press('Escape');
    await pagina.waitForSelector('#hojaRed', { state: 'hidden' });
    revisar(
        'hoja: Escape cierra y el foco vuelve a #configurarRed (el que la abrió)',
        (await enfocado(pagina)) === 'configurarRed',
    );
    await casosHoja(ctx, a, b);
    await guardar(ctx);
    revisar('guardar → aparece #enviarRed', await visible('#enviarRed'));
    revisar('guardar → #configurarRed sigue visible', await visible('#configurarRed'));
    await revisarSecreto(ctx, salida, 'tras guardar');
    await casosClave(ctx, salida, a, b);
    await casosEnvio(ctx, salida, a, bajado);
    await casosErrores(ctx, a);
    await casoOtroModelo(ctx, a);
}

// La hoja: dirección inválida, Probar conectó / clave mala / sin llegada. Deja la hoja abierta con la config buena.
async function casosHoja(ctx, a, b) {
    const { page: pagina, ok: revisar, visible } = ctx;
    await abrirHoja(ctx);
    await llenar(ctx, { direccion: 'ftp://x' });
    await pagina.tap('#probarRed');
    revisar(
        'hoja: dirección inválida → aria-invalid, foco y mensaje',
        (await atributo(pagina, campo('direccion'), 'aria-invalid')) === 'true' &&
            (await enfocado(pagina)) === 'direccion' &&
            (await pagina.textContent('#estadoRed')) ===
                'La dirección no es válida. Probá con algo como http://192.168.1.50',
    );
    revisar('hoja: dirección inválida → ningún pedido', a.registro.length === 0 && b.registro.length === 0);
    await llenar(ctx, { direccion: '192.168.1.50', clave: CLAVE });
    revisar(
        'hoja: al corregir se limpia aria-invalid',
        (await atributo(pagina, campo('direccion'), 'aria-invalid')) === null,
    );
    const conecto = await probar(ctx);
    revisar('hoja: Probar con OctoPrint falso → "Conectó…"', conecto === 'Conectó con OctoPrint 1.10.0.', conecto);
    revisar(
        'hoja: Probar pide /api/version y /api/job con X-Api-Key',
        a.pedidos('GET', '/api/version').length === 1 &&
            a.pedidos('GET', '/api/job').length === 1 &&
            a.registro.filter(r => r.url !== IP + '/').every(r => r.clave === CLAVE),
    );
    revisar('hoja: con respuesta buena no se ofrece el plan B', !(await visible('#ayudaRed')));
    await casosHojaFallas(ctx, a);
}

async function casosHojaFallas(ctx, a) {
    const { ok: revisar, visible } = ctx;
    a.modo.version = 403;
    const mala = await probar(ctx);
    revisar('hoja: Probar con 403 → mensaje de clave', mala.startsWith('La API key no sirve.'), mala);
    a.modo.version = 200;
    a.modo.todo = 'abortar';
    const sin = await probar(ctx);
    revisar(
        'hoja: fetch abortado → "No se pudo llegar" y plan B visible (#ayudaRed)',
        sin.startsWith('No se pudo llegar a la impresora.') && (await visible('#ayudaRed')),
        sin,
    );
    a.modo.todo = null;
}

// La clave guardada (dirección A, OctoPrint) sólo se reutiliza con la misma dirección y el mismo tipo.
async function casosClave(ctx, salida, a, b) {
    const { page: pagina, ok: revisar } = ctx;
    await abrirHoja(ctx);
    revisar(
        'clave: al reabrir el campo queda vacío y dice "guardada"',
        (await pagina.inputValue(campo('claveApi'))) === '' &&
            (await atributo(pagina, campo('claveApi'), 'placeholder')) === 'guardada',
    );
    await revisarSecreto(ctx, salida, 'con la hoja reabierta');
    a.vaciar();
    const igual = await probar(ctx);
    revisar(
        'clave: misma dirección y tipo con campo vacío → reutiliza la guardada',
        igual.startsWith('Conectó') && a.pedidos('GET', '/api/version')[0]?.clave === CLAVE,
        igual,
    );
    await claveMostrar(ctx);
    await claveOtraDireccion(ctx, b);
    await claveOtroTipo(ctx, a);
    await claveTipeada(ctx, salida, b);
}

// Con "Mostrar" activado, cerrar la hoja deja el campo vacío y al reabrir vuelve oculta.
async function claveMostrar(ctx) {
    const { page: pagina, ok: revisar } = ctx;
    await pagina.tap('#verClaveRed');
    await llenar(ctx, { clave: CLAVE_B });
    revisar(
        'clave: "Mostrar" muestra el campo como texto',
        (await atributo(pagina, campo('claveApi'), 'type')) === 'text',
    );
    await cerrarHoja(ctx);
    const tras = await pagina.evaluate(() => document.querySelector('#formRed [name=claveApi]').value);
    revisar('clave: con "Mostrar" activado, cerrar la hoja deja el campo vacío', tras === '', tras);
    await abrirHoja(ctx);
    revisar(
        'clave: al reabrir vuelve oculta (password) y vacía',
        (await atributo(pagina, campo('claveApi'), 'type')) === 'password' &&
            (await pagina.inputValue(campo('claveApi'))) === '',
    );
}

async function claveOtraDireccion(ctx, b) {
    const { page: pagina, ok: revisar } = ctx;
    await llenar(ctx, { direccion: IP_B });
    b.vaciar();
    await pagina.tap('#probarRed');
    revisar(
        'clave: otra dirección con campo vacío → error, aria-invalid y foco en la clave',
        (await pagina.textContent('#estadoRed')) === ERROR_CLAVE &&
            (await atributo(pagina, campo('claveApi'), 'aria-invalid')) === 'true' &&
            (await enfocado(pagina)) === 'claveApi',
    );
    await pagina.waitForTimeout(300);
    revisar(
        'clave: otra dirección con campo vacío → NINGÚN pedido a B',
        b.registro.length === 0,
        `${b.registro.length}`,
    );
    await pagina.tap('#formRed [type=submit]');
    revisar(
        'clave: guardar con otra dirección y campo vacío tampoco pasa',
        (await pagina.isVisible('#hojaRed')) && (await atributo(pagina, campo('claveApi'), 'aria-invalid')) === 'true',
    );
}

async function claveOtroTipo(ctx, a) {
    const { page: pagina, ok: revisar } = ctx;
    await llenar(ctx, { direccion: IP, tipo: 'moonraker' });
    a.vaciar();
    await pagina.tap('#probarRed');
    revisar(
        'clave: otro tipo con campo vacío → error y aria-invalid',
        (await pagina.textContent('#estadoRed')) === ERROR_CLAVE &&
            (await atributo(pagina, campo('claveApi'), 'aria-invalid')) === 'true',
    );
    await pagina.waitForTimeout(300);
    revisar('clave: otro tipo con campo vacío → ningún pedido', a.registro.length === 0, `${a.registro.length}`);
}

async function claveTipeada(ctx, salida, b) {
    const { page: pagina, ok: revisar } = ctx;
    await llenar(ctx, { direccion: IP_B, tipo: 'octoprint', clave: CLAVE_B });
    const tipeada = await probar(ctx);
    revisar(
        'clave: la clave tipeada se usa siempre (a B, y no la guardada)',
        tipeada.startsWith('Conectó') &&
            b.registro.length >= 2 &&
            b.registro.filter(r => r.url !== IP_B + '/').every(r => r.clave === CLAVE_B),
        tipeada,
    );
    await cerrarHoja(ctx);
    await revisarSecreto(ctx, salida, 'tras probar con otra clave');
    await abrirHoja(ctx);
    revisar(
        'clave: cerrar sin guardar no cambia la dirección guardada',
        (await pagina.inputValue(campo('direccion'))) === IP,
    );
    await cerrarHoja(ctx);
}
