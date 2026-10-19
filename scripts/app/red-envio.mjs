// Envío por red local, parte 2 de red.mjs (ADR 0007, T8): envío feliz, imprimir con confirm, cancelar, errores y
// "Laminar otro modelo" durante un envío. Contra la impresora simulada A (OctoPrint), con la config ya guardada.
//
// Precondición: paso 4 de la Ender 3 V3 SE con una pausa, config de OctoPrint guardada (dirección A, clave CLAVE,
//   imprimir apagado) y las rutas de `simular` activas (las arma red.mjs).
// Deja: paso 4 con el mismo cubo y la pausa, config con imprimir apagado, sin envío en curso ni mensajes.

import { IP, CLAVE, NOMBRE, partes } from '../lib/red-simulada.mjs';
import {
    atributo,
    asegurarPausa,
    abrirHoja,
    cerrarHoja,
    llenar,
    guardar,
    esperarEnvio,
    entregaIntacta,
    revisarSecreto,
} from '../lib/red-pagina.mjs';

const CONFIRMAR = '¿Empezar a imprimir ahora? Fijate que la cama esté libre.';
const LISTO = 'Listo: subido a la impresora.';

const nombres = p => p.map(x => x.nombre).join(',');
const valorDe = (p, n) => p.find(x => x.nombre === n)?.contenido;

/** Envío feliz sin imprimir, imprimir con confirm y cancelar a mitad. */
export async function casosEnvio(ctx, salida, a, bajado) {
    await envioFeliz(ctx, salida, a, bajado);
    await envioImprimir(ctx, salida, a, bajado);
    await envioCancelar(ctx, salida, a);
}

async function envioFeliz(ctx, salida, a, bajado) {
    const { page: pagina, ok: revisar } = ctx;
    a.vaciar();
    salida.dialogos.length = 0;
    await pagina.tap('#enviarRed');
    const msg = await esperarEnvio(ctx);
    const subida = a.subidas()[0];
    const p = partes(subida);
    const archivo = p.find(x => x.nombre === 'file');
    revisar(
        'envío: un solo POST a la URL exacta de OctoPrint',
        a.subidas().length === 1 && subida.url === `${IP}/api/files/local`,
        a
            .subidas()
            .map(s => s.url)
            .join(' '),
    );
    revisar('envío: lleva X-Api-Key con la clave guardada', subida?.clave === CLAVE);
    revisar('envío: multipart/form-data', /^multipart\/form-data; boundary=/.test(subida?.tipoContenido ?? ''));
    revisar(
        'envío: el archivo se llama como el de Descargar',
        archivo?.archivo === NOMBRE && archivo.archivo === bajado.nombre,
        archivo?.archivo,
    );
    revisar(
        'envío: el contenido es IGUAL al G-code descargado (con la pausa)',
        archivo?.contenido === bajado.texto && archivo.contenido.includes('\nM600\n'),
        `${archivo?.contenido.length} vs ${bajado.texto.length} bytes`,
    );
    revisar('envío: sin imprimir no hay partes print ni select', p.length === 1, nombres(p));
    revisar('envío: sin imprimir no se pide confirm', salida.dialogos.length === 0);
    revisar('envío: resultado en #estadoEntrega', msg === LISTO, msg);
    revisar(
        'envío: termina sin "Enviando…" y con el botón habilitado',
        (await pagina.textContent('#progresoEnvioRed')) === '' &&
            !(await pagina.isDisabled('#enviarRed')) &&
            !(await ctx.visible('#cancelarEnvio')),
    );
    await revisarSecreto(ctx, salida, 'tras enviar');
}

async function envioImprimir(ctx, salida, a, bajado) {
    const { page: pagina, ok: revisar } = ctx;
    await abrirHoja(ctx);
    await llenar(ctx, { imprimir: true });
    await guardar(ctx);
    a.vaciar();
    salida.dialogos.length = 0;
    salida.responder = 'dismiss';
    await pagina.tap('#enviarRed');
    await pagina.waitForFunction(() => !document.getElementById('enviarRed').disabled);
    await pagina.waitForTimeout(300);
    revisar(
        'imprimir: aparece el confirm',
        salida.dialogos.length === 1 &&
            salida.dialogos[0].tipo === 'confirm' &&
            salida.dialogos[0].mensaje === CONFIRMAR,
        JSON.stringify(salida.dialogos),
    );
    revisar('imprimir: si se descarta el confirm no hay POST', a.subidas().length === 0);
    revisar(
        'imprimir: tras descartar el botón queda habilitado y sin mensaje',
        !(await pagina.isDisabled('#enviarRed')) && (await pagina.textContent('#estadoEntrega')) === '',
    );
    salida.responder = 'accept';
    salida.dialogos.length = 0;
    await pagina.tap('#enviarRed');
    const msg = await esperarEnvio(ctx);
    const p = partes(a.subidas()[0]);
    revisar(
        'imprimir: al aceptar hay un POST con print=true y select=true',
        a.subidas().length === 1 && valorDe(p, 'print') === 'true' && valorDe(p, 'select') === 'true',
        nombres(p),
    );
    revisar('imprimir: el archivo del POST sigue siendo el descargado', valorDe(p, 'file') === bajado.texto);
    revisar('imprimir: mensaje "…empezó a imprimir"', msg === 'Listo: subido a la impresora y empezó a imprimir.', msg);
    revisar('imprimir: el confirm se pidió una vez', salida.dialogos.length === 1);
}

async function envioCancelar(ctx, salida, a) {
    const { page: pagina, ok: revisar } = ctx;
    await abrirHoja(ctx);
    await llenar(ctx, { imprimir: false });
    await guardar(ctx);
    a.vaciar();
    a.modo.colgar = true;
    await pagina.evaluate(() => {
        const b = document.getElementById('enviarRed');
        b.click();
        b.click(); // el segundo toque llega con el botón ya deshabilitado
    });
    await pagina.waitForFunction(() => document.getElementById('progresoEnvioRed').textContent === 'Enviando…');
    await pagina.waitForTimeout(500);
    revisar(
        'cancelar: durante el envío se ve "Enviando…" (role=status) y Cancelar',
        (await atributo(pagina, '#progresoEnvioRed', 'role')) === 'status' && (await ctx.visible('#cancelarEnvio')),
    );
    revisar('cancelar: #enviarRed deshabilitado mientras envía', await pagina.isDisabled('#enviarRed'));
    revisar('cancelar: doble toque → un solo POST', a.subidas().length === 1, `${a.subidas().length} POST`);
    await pagina.tap('#cancelarEnvio');
    const cancelado = await esperarEnvio(ctx);
    revisar('cancelar: "Envío cancelado."', cancelado === 'Envío cancelado.', cancelado);
    revisar(
        'cancelar: el botón vuelve a habilitarse, Cancelar se oculta y no hay plan B',
        !(await pagina.isDisabled('#enviarRed')) &&
            !(await ctx.visible('#cancelarEnvio')) &&
            !(await ctx.visible('#ayudaEnvioRed')),
    );
    a.liberar();
    a.modo.colgar = false;
    a.vaciar();
    await pagina.tap('#enviarRed');
    const otra = await esperarEnvio(ctx);
    revisar('cancelar: reintentar funciona (un POST nuevo)', otra === LISTO && a.subidas().length === 1, otra);
}

/** 409, error de red, error con HTML en la respuesta; Descargar/Compartir quedan disponibles en todos. */
export async function casosErrores(ctx, a) {
    const { page: pagina, ok: revisar } = ctx;
    a.vaciar();
    a.modo.subida = 409;
    await pagina.tap('#enviarRed');
    const ocupada = await esperarEnvio(ctx);
    revisar('409 → mensaje de impresora ocupada', ocupada.startsWith('La impresora está imprimiendo ahora.'), ocupada);
    revisar(
        '409: botón habilitado, sin plan B y con Descargar/Compartir',
        !(await pagina.isDisabled('#enviarRed')) &&
            !(await ctx.visible('#ayudaEnvioRed')) &&
            (await entregaIntacta(ctx)),
    );
    a.modo.subida = 201;
    await errorDeRed(ctx, a);
    await errorConHtml(ctx, a);
    a.modo.subida = 201;
    a.modo.cuerpo = null;
    await pagina.tap('#enviarRed');
    const bien = await esperarEnvio(ctx);
    revisar(
        'tras un error, un envío nuevo oculta el plan B',
        bien === LISTO && !(await ctx.visible('#ayudaEnvioRed')),
        bien,
    );
}

async function errorDeRed(ctx, a) {
    const { page: pagina, ok: revisar } = ctx;
    a.modo.todo = 'abortar';
    await pagina.tap('#enviarRed');
    const sin = await esperarEnvio(ctx);
    revisar(
        'error de red → "No se pudo llegar" y #ayudaEnvioRed visible',
        sin.startsWith('No se pudo llegar a la impresora.') && (await ctx.visible('#ayudaEnvioRed')),
        sin,
    );
    revisar('error de red: Descargar/Compartir visibles y habilitados', await entregaIntacta(ctx));
    await pagina.tap('#ayudaEnvioRed');
    await pagina.waitForSelector('#hojaRed:not([hidden])');
    revisar('error de red: #ayudaEnvioRed abre la hoja', await ctx.visible('#hojaRed'));
    await cerrarHoja(ctx);
    a.modo.todo = null;
}

// Una respuesta con HTML no se interpreta: el mensaje es el fijo y no aparecen <b> ni <img> en #estadoEntrega.
async function errorConHtml(ctx, a) {
    const { page: pagina, ok: revisar } = ctx;
    a.modo.subida = 500;
    a.modo.cuerpo = '<b>x</b><img src=x onerror=alert(1)>';
    await pagina.tap('#enviarRed');
    const texto = await esperarEnvio(ctx);
    revisar(
        'error 500 con <b> en la respuesta: mensaje fijo, sin interpretar nada',
        texto.startsWith('La impresora no aceptó el archivo (código 500).') &&
            !texto.includes('<b>') &&
            (await pagina.locator('#estadoEntrega b, #estadoEntrega img').count()) === 0,
        texto,
    );
    revisar('500: Descargar/Compartir visibles y habilitados', await entregaIntacta(ctx));
}

/** "Laminar otro modelo" durante un envío lo aborta y no pinta ningún mensaje; después vuelve al paso 4 como estaba. */
export async function casoOtroModelo(ctx, a) {
    const { page: pagina, ok: revisar, visible } = ctx;
    a.vaciar();
    a.modo.colgar = true;
    await pagina.tap('#enviarRed');
    await pagina.waitForFunction(() => document.getElementById('progresoEnvioRed').textContent === 'Enviando…');
    await pagina.tap('#otro');
    await pagina.waitForSelector('section[data-paso="1"]:not([hidden])');
    await pagina.waitForTimeout(500);
    const mensaje = await pagina.textContent('#estadoEntrega');
    revisar(
        'otro modelo durante el envío: aborta, sin mensaje y sin "Enviando…"',
        mensaje === '' && (await pagina.textContent('#progresoEnvioRed')) === '' && a.subidas().length === 1,
        `"${mensaje}" / ${a.subidas().length} POST`,
    );
    a.liberar();
    a.modo.colgar = false;
    await ctx.elegirArchivo('public/ejemplos/cubo-20mm.stl');
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await ctx.esperarResultado();
    await asegurarPausa(ctx);
    revisar(
        'otro modelo: al volver al paso 4 no quedó mensaje y #enviarRed está habilitado',
        (await pagina.textContent('#estadoEntrega')) === '' &&
            (await visible('#enviarRed')) &&
            !(await pagina.isDisabled('#enviarRed')),
    );
}
