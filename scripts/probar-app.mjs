// Prueba de punta a punta de la app, emulando un celu (Pixel 7, pantalla táctil).
// Recorre los 4 pasos, prueba cancelar, el botón "atrás" y la descarga, y
// guarda capturas en capturas/ (o en la carpeta de CAPTURAS).
//
// Uso: npm run build && npm run test:app

import { chromium, devices } from 'playwright-core';
import { preview } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { esfera } from '../src/prueba/mallas.js';

function buscarChromium() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    if (!fs.existsSync(base)) return undefined;
    for (const dir of fs.readdirSync(base).filter(d => d.startsWith('chromium')).sort().reverse()) {
        for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
            const p = `${base}/${dir}/${sub}`;
            if (fs.existsSync(p)) return p;
        }
    }
}

const CAPTURAS = process.env.CAPTURAS || 'capturas';
fs.mkdirSync(CAPTURAS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laminar-'));
const stlPesado = path.join(tmp, 'esfera-pesada.stl');
fs.writeFileSync(stlPesado, Buffer.from(esfera()));

const servidor = await preview({ preview: { port: 4174 } });
const url = servidor.resolvedUrls.local[0];
const navegador = await chromium.launch({ executablePath: buscarChromium(), args: ['--use-angle=swiftshader'] });
const contexto = await navegador.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
const pagina = await contexto.newPage();
pagina.on('pageerror', e => console.log('[error]', e.message));
pagina.on('requestfailed', r => console.log('[falló]', r.url(), r.failure()?.errorText));
pagina.on('console', m => m.type() === 'error' && console.log('[consola]', m.text().slice(0, 200)));
pagina.on('dialog', d => { console.log('[alerta]', d.message()); d.dismiss(); });

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (!condicion) fallas++;
}
const visible = sel => pagina.isVisible(sel);
// Carga un STL; si ya hay un modelo, primero toca "Elegir otro modelo".
async function elegirArchivo(ruta) {
    if (await visible('#otroModelo')) await pagina.tap('#otroModelo');
    await pagina.setInputFiles('#archivo', ruta);
    const nombre = path.basename(ruta);
    await pagina.waitForFunction(n => document.getElementById('nombreModelo').textContent === n, nombre, { timeout: 60000 });
}
const captura = async nombre => pagina.screenshot({ path: path.join(CAPTURAS, nombre + '.png') });

try {
    await pagina.goto(url);
    await captura('1-inicio');
    revisar('paso 1 visible', await visible('section[data-paso="1"]'));
    revisar('"Siguiente" deshabilitado sin modelo', await pagina.isDisabled('#siguiente'));

    // Modelo pesado: tiene que avisar que se va a simplificar.
    await elegirArchivo(stlPesado);
    const aviso = await pagina.textContent('#avisoModelo');
    revisar('aviso de modelo pesado', /Modelo pesado/.test(aviso), `"${aviso.slice(0, 60)}…"`);
    await pagina.waitForTimeout(800);
    await captura('1-modelo-pesado');

    // Cubo de ejemplo
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    revisar('datos del cubo', /20,0 × 20,0 × 20,0 mm/.test(await pagina.textContent('#datosModelo')));
    revisar('sin avisos para el cubo', !(await visible('#avisoModelo')));

    // Gestos: un arrastre con un dedo no tiene que romper nada.
    const caja = await pagina.locator('#visor canvas').boundingBox();
    await pagina.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await pagina.waitForTimeout(500);
    await captura('1-modelo');

    await pagina.tap('#siguiente');
    revisar('paso 2 visible', await visible('section[data-paso="2"]'));
    await pagina.tap('label.opcion:has(input[value="rapido"])');
    revisar('calidad Rápido elegida', await pagina.isChecked('input[value="rapido"]'));
    await captura('2-configurar');

    // Botón "atrás" del celu vuelve al paso 1 y "adelante" de nuevo al 2.
    await pagina.goBack();
    revisar('atrás → paso 1', await visible('section[data-paso="1"]'));
    await pagina.goForward();
    revisar('adelante → paso 2', await visible('section[data-paso="2"]'));

    // Cancelar a mitad de camino (con la esfera pesada, que tarda).
    await pagina.goBack();
    await elegirArchivo(stlPesado);
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await pagina.waitForFunction(() => parseInt(document.getElementById('porcentaje').textContent) >= 10, null, { timeout: 60000 });
    await captura('3-laminando');
    await pagina.tap('#cancelar');
    revisar('cancelar → paso 2', await visible('section[data-paso="2"]'));

    // Laminar el cubo hasta el final.
    await pagina.goBack();
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    await pagina.tap('#siguiente');

    // Personalizar: giroide, "Fuerte" (40 %), una pared más (Rápido trae 2) y borde.
    await pagina.tap('#personalizar summary');
    await pagina.tap('.patron:has(input[value="gyroid"])');
    await pagina.tap('.atajo[data-densidad="0.4"]');
    await pagina.tap('.contador[data-clave="paredes"] button[data-delta="1"]');
    await pagina.tap('label.opcion:has(input[value="borde"])');
    revisar('personalizar: valores elegidos',
        await pagina.isChecked('input[value="gyroid"]') && (await pagina.textContent('#densidadValor')) === '40 %' &&
        (await pagina.textContent('.contador[data-clave="paredes"] output')) === '3');
    const resumenPers = await pagina.textContent('#personalizar summary');
    revisar('resumen de lo personalizado', resumenPers === 'Personalizado: Giroide 40 % · 3 paredes · Borde', resumenPers);
    await pagina.evaluate(() => document.getElementById('personalizar').scrollIntoView());
    await captura('2-relleno');
    await pagina.locator('#adhesiones').scrollIntoViewIfNeeded();
    await captura('2-personalizar');
    revisar('la página no se corre (acciones abajo de todo)', await pagina.evaluate(() =>
        Math.abs(document.querySelector('.acciones').getBoundingClientRect().bottom - innerHeight) < 2));

    await pagina.tap('#laminar');
    await pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 60000 });
    revisar('paso 4 visible', true);
    revisar('el resultado usa lo personalizado', (await pagina.textContent('#resumen')).includes('Giroide 40 % · 3 paredes · Borde'));
    const resumen = await pagina.textContent('#resumen');
    revisar('resumen con tiempo y filamento', /Tiempo estimado/.test(resumen) && /Filamento.*m \(≈/.test(resumen));
    await captura('4-listo');

    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const gcode = fs.readFileSync(await descarga.path(), 'utf8');
    revisar('descarga del G-code', descarga.suggestedFilename() === 'cubo-20mm_rapido.gcode', descarga.suggestedFilename());
    revisar('G-code con temperaturas', gcode.includes('M104 S200') && gcode.includes('M140 S60'));

    // "Atrás" desde el resultado vuelve a la configuración (no a la barra de progreso).
    await pagina.goBack();
    revisar('atrás desde el resultado → paso 2', await visible('section[data-paso="2"]'));

    // --- Guardado en el celu (IndexedDB) ---
    await pagina.reload();
    await pagina.waitForSelector('#recientes:not([hidden])');
    const recientes = await pagina.$$eval('.reciente b', bs => bs.map(b => b.textContent));
    revisar('modelos recientes guardados', recientes[0] === 'cubo-20mm.stl' && recientes.includes('esfera-pesada.stl'),
        JSON.stringify(recientes));
    await captura('1-recientes');
    await pagina.tap('.reciente:has-text("cubo-20mm.stl")');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'cubo-20mm.stl');
    revisar('abrir un reciente', true);
    await pagina.tap('#siguiente');
    revisar('se recuerda la calidad elegida', await pagina.isChecked('input[value="rapido"]'));
    revisar('se recuerda lo personalizado', (await pagina.textContent('#personalizar summary')).startsWith('Personalizado: Giroide'));
    await pagina.tap('#personalizar summary');
    await pagina.tap('#restablecer');
    revisar('volver a los valores de la calidad', (await pagina.textContent('#personalizar summary')).startsWith('Personalizar'));
    await pagina.goBack();
    await pagina.tap('#otroModelo');
    await pagina.tap('[data-borrar]:near(.reciente:has-text("esfera-pesada.stl"))');
    await pagina.waitForFunction(() => ![...document.querySelectorAll('.reciente b')].some(b => b.textContent === 'esfera-pesada.stl'));
    revisar('borrar un reciente', true);

    // --- PWA: instalable y sin conexión ---
    const manifest = await pagina.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    revisar('manifest con íconos', manifest.icons.length === 3 && manifest.display === 'standalone');
    await pagina.evaluate(() => navigator.serviceWorker.ready);
    await pagina.reload();
    revisar('service worker controlando la página', await pagina.evaluate(() => !!navigator.serviceWorker.controller));
    await contexto.setOffline(true);
    await pagina.reload();
    revisar('abre sin conexión', await visible('section[data-paso="1"]'));
    await pagina.tap('#ejemplo');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'cubo-20mm.stl');
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 60000 });
    revisar('lamina sin conexión', true);
    await contexto.setOffline(false);
} finally {
    await navegador.close();
    servidor.httpServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallas ? 1 : 0);
