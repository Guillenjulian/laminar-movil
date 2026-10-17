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
pagina.on('console', m => m.type() === 'error' && console.log('[consola]', m.text().slice(0, 200)));
pagina.on('dialog', d => { console.log('[alerta]', d.message()); d.dismiss(); });

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (!condicion) fallas++;
}
const visible = sel => pagina.isVisible(sel);
const captura = async nombre => pagina.screenshot({ path: path.join(CAPTURAS, nombre + '.png') });

try {
    await pagina.goto(url);
    await captura('1-inicio');
    revisar('paso 1 visible', await visible('section[data-paso="1"]'));
    revisar('"Siguiente" deshabilitado sin modelo', await pagina.isDisabled('#siguiente'));

    // Modelo pesado: tiene que avisar que se va a simplificar.
    await pagina.setInputFiles('#archivo', stlPesado);
    await pagina.waitForSelector('#conModelo:not([hidden])', { timeout: 60000 });
    const aviso = await pagina.textContent('#avisoModelo');
    revisar('aviso de modelo pesado', /Modelo pesado/.test(aviso), `"${aviso.slice(0, 60)}…"`);
    await pagina.waitForTimeout(800);
    await captura('1-modelo-pesado');

    // Cubo de ejemplo
    await pagina.click('#ejemplo').catch(() => {}); // está oculto si ya hay modelo
    await pagina.setInputFiles('#archivo2', 'public/ejemplos/cubo-20mm.stl');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'cubo-20mm.stl');
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
    await pagina.setInputFiles('#archivo2', stlPesado);
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'esfera-pesada.stl', null, { timeout: 60000 });
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await pagina.waitForFunction(() => parseInt(document.getElementById('porcentaje').textContent) >= 10, null, { timeout: 60000 });
    await captura('3-laminando');
    await pagina.tap('#cancelar');
    revisar('cancelar → paso 2', await visible('section[data-paso="2"]'));

    // Laminar el cubo hasta el final.
    await pagina.goBack();
    await pagina.setInputFiles('#archivo2', 'public/ejemplos/cubo-20mm.stl');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'cubo-20mm.stl');
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 60000 });
    revisar('paso 4 visible', true);
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
} finally {
    await navegador.close();
    servidor.httpServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallas ? 1 : 0);
