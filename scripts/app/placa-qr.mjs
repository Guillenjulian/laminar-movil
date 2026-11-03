// Placa QR: una lámina con QR (PNG) se convierte en placa de 10 × 15 cm y, al laminar, la vista previa
// pone sola las dos pausas de cambio de filamento (blanco → negro → bordó).
//
// Flujo: desde el paso 1 sin modelo elige la lámina sintética con "Litofanía o placa QR", revisa la hoja
// (link leído y resumen), genera la placa (100 × 150 mm, sin escala ni rotación), lamina, revisa las dos
// pausas en la vista previa y que el G-code descargado las tenga. Después elige tres láminas juntas en la
// cama de 220 × 220: la hoja lista dos, avisa que la tercera queda afuera, y la pieza "placas-2.stl" entra
// y lamina con sus dos pausas. Con el formato "sólo QR" la misma lámina da un cuadrado de 100 × 100 mm con una
// sola pausa. Al final revisa "Hacer una litofanía" desde la hoja.
//
// Precondición: cualquier paso, con o sin modelo. Deja: paso 1 con el cubo de 20 mm cargado.

import fs from 'node:fs';
import path from 'node:path';
import { pngRgba } from '../lib/png.mjs';
import { laminaSintetica, URL_PRUEBA } from '../placa/lamina.mjs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarPlacaQr(ctx) {
    const { page: pagina, ok: revisar, visible, tmp, elegirArchivo, esperarResultado } = ctx;
    const png = path.join(tmp, 'lamina.png');
    fs.writeFileSync(png, pngRgba(laminaSintetica()));
    if (!(await visible('section[data-paso="1"]'))) await pagina.goBack();
    await pagina.waitForSelector('section[data-paso="1"]:not([hidden])');
    if (!(await visible('#sinModelo'))) await pagina.tap('#otroModelo');
    await pagina.setInputFiles('#foto', png);
    await pagina.waitForSelector('#hojaPlaca:not([hidden])', { timeout: 20000 });
    revisar(
        'placa: la lámina con QR abre la hoja de placa con el link leído',
        (await pagina.textContent('#enlacePlaca')) === URL_PRUEBA,
        await pagina.textContent('#enlacePlaca'),
    );
    const resumen = await pagina.textContent('#resumenPlaca');
    revisar(
        'placa: el resumen cuenta 4 renglones, 1 en bordó y el marco',
        /4 renglones.*1 en bordó.*marco/.test(resumen),
        resumen,
    );
    await pagina.tap('#generarPlaca');
    await pagina.waitForFunction(
        () => document.getElementById('nombreModelo').textContent === 'lamina-placa.stl',
        null,
        {
            timeout: 60000,
        },
    );
    const medidas = await pagina.textContent('#medidasModelo').catch(() => '');
    revisar('placa: se carga sin escala ni rotación', !(await visible('#ajustesModelo')), medidas);
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
    await revisarPausas(ctx);
    await revisarVarias(ctx, png);
    await revisarCuadrado(ctx, png);
    await revisarLitofania(ctx, png);
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
}

// La vista previa trae dos pausas (en la primera capa sobre 1,6 y sobre 2,2 mm) y 3 filamentos con los
// colores de la placa; el G-code descargado tiene las dos pausas.
async function revisarPausas({ page: pagina, ok: revisar }) {
    await pagina.waitForSelector('#controlCapas:not([hidden])', { timeout: 60000 });
    const zs = await pagina.$$eval('#listaPausas small', els => els.map(e => e.textContent));
    revisar('placa: la vista previa trae dos pausas solas', zs.length === 2, zs.join(' | '));
    const z = zs.map(t => Number(t.replace(/.*Z ([\d,]+).*/, '$1').replace(',', '.')));
    revisar(
        'placa: pausas apenas arriba de 1,6 y de 2,2 mm',
        z[0] > 1.6 && z[0] <= 1.9 && z[1] > 2.2 && z[1] <= 2.5,
        z.join(', '),
    );
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const gcode = fs.readFileSync(await descarga.path(), 'utf8');
    const veces = gcode.split('; --- PAUSA:').length - 1;
    revisar('placa: el G-code descargado tiene las dos pausas', veces === 2, `(${veces})`);
}

// Escribe la lámina número n (con su propio link) en la carpeta temporal y devuelve la ruta.
function escribirLamina({ tmp }, n) {
    const ruta = path.join(tmp, `lamina-${n}.png`);
    fs.writeFileSync(ruta, pngRgba(laminaSintetica({ url: `${URL_PRUEBA}-${n}` })));
    return ruta;
}

// Tres láminas juntas en una cama de 220 × 220: entran dos, en una sola pieza, y la tercera queda avisada.
async function revisarVarias(ctx, png) {
    const { page: pagina, ok: revisar, visible, esperarResultado } = ctx;
    const otras = [2, 3].map(n => escribirLamina(ctx, n));
    await pagina.goBack();
    await pagina.goBack();
    await pagina.waitForSelector('section[data-paso="1"]:not([hidden])');
    await pagina.tap('#otroModelo');
    await pagina.setInputFiles('#foto', [png, ...otras]);
    await pagina.waitForSelector('#hojaPlaca:not([hidden])', { timeout: 30000 });
    const items = await pagina.$$eval('#listaPlacas li', els => els.map(e => e.textContent));
    revisar(
        'placas: con tres láminas la hoja lista las dos que entran',
        items.length === 2 && items[1].includes(`${URL_PRUEBA}-2`),
        items.join(' | '),
    );
    const aviso = await pagina.textContent('#avisoPlacas');
    revisar(
        'placas: avisa que la tercera queda afuera',
        (await visible('#avisoPlacas')) && aviso.includes('lamina-3.png'),
        aviso,
    );
    await pagina.tap('#generarPlaca');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'placas-2.stl', null, {
        timeout: 60000,
    });
    const datos = await pagina.textContent('#datosModelo');
    revisar(
        'placas: las dos van en una pieza de 203 × 150 mm que entra en la cama',
        datos.startsWith('203,0 × 150,0') && !(await visible('#ajustarCama')),
        datos,
    );
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
    await pagina.waitForSelector('#controlCapas:not([hidden])', { timeout: 60000 });
    const pausas = await pagina.$$eval('#listaPausas small', els => els.length);
    revisar('placas: dos placas juntas con las mismas dos pausas', pausas === 2, `(${pausas})`);
}

// Formato "sólo QR": cuadrado de 100 × 100 mm con una sola pausa (blanco → negro).
async function revisarCuadrado({ page: pagina, ok: revisar, esperarResultado }, png) {
    await pagina.goBack();
    await pagina.goBack();
    await pagina.waitForSelector('section[data-paso="1"]:not([hidden])');
    await pagina.tap('#otroModelo');
    await pagina.setInputFiles('#foto', png);
    await pagina.waitForSelector('#hojaPlaca:not([hidden])', { timeout: 20000 });
    await pagina.check('#hojaPlaca [name=formatoPlaca][value=cuadrado]');
    const resumen = await pagina.textContent('#resumenPlaca');
    revisar(
        'sólo QR: el resumen dice que los renglones van grabados atrás',
        /sólo el QR.*2 renglones grabados atrás.*10 × 10 cm/.test(resumen),
        resumen,
    );
    await pagina.tap('#generarPlaca');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'lamina-qr.stl', null, {
        timeout: 60000,
    });
    const datos = await pagina.textContent('#datosModelo');
    revisar('sólo QR: cuadrado de 100 × 100 × 2,2 mm', datos.startsWith('100,0 × 100,0 × 2,2'), datos);
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
    await pagina.waitForSelector('#controlCapas:not([hidden])', { timeout: 60000 });
    const zs = await pagina.$$eval('#listaPausas small', els => els.map(e => e.textContent));
    const z = zs.map(t => Number(t.replace(/.*Z ([\d,]+).*/, '$1').replace(',', '.')));
    revisar(
        'sólo QR: una sola pausa, apenas arriba de 1,6 mm',
        z.length === 1 && z[0] > 1.6 && z[0] <= 1.9,
        zs.join(' | '),
    );
}

// Desde la hoja de placa se puede mandar la misma imagen a la litofanía.
async function revisarLitofania({ page: pagina, ok: revisar, visible }, png) {
    await pagina.goBack();
    await pagina.goBack();
    await pagina.waitForSelector('section[data-paso="1"]:not([hidden])');
    await pagina.tap('#otroModelo');
    await pagina.setInputFiles('#foto', png);
    await pagina.waitForSelector('#hojaPlaca:not([hidden])', { timeout: 20000 });
    await pagina.tap('#placaComoLitofania');
    await pagina.waitForSelector('#hojaLitofania:not([hidden])');
    revisar('placa: "Hacer una litofanía" abre la hoja de litofanía', await visible('#hojaLitofania'));
    await pagina.tap('#hojaLitofania [data-cerrar]');
    await pagina.waitForSelector('#hojaLitofania', { state: 'hidden' });
}
