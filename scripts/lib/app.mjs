// Arranque común de `npm run test:app`: sirve dist/ con `vite preview`, abre Chromium emulando un
// Pixel 7 (táctil) y arma el contexto `ctx` que reciben todas las áreas de scripts/app/.

import { chromium, devices } from 'playwright-core';
import { preview } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { esfera, te } from '../../src/prueba/mallas.js';
import { buscarChromium } from './chromium.mjs';
import { crearContador } from './contador.mjs';

/**
 * Contexto que recibe cada `probarX(ctx)` de scripts/app/.
 * @typedef {object} Ctx
 * @property {import('playwright-core').Page} page página única del recorrido (la app, en un Pixel 7)
 * @property {import('playwright-core').Browser} browser
 * @property {import('playwright-core').BrowserContext} context para `setOffline` y similares
 * @property {string} base URL donde se sirve dist/
 * @property {import('./contador.mjs').Ok} ok registra una prueba (✔/✘)
 * @property {string} tmp carpeta temporal con los archivos de prueba (se borra al cerrar)
 * @property {string} stlPesado esfera de más de 1 M de triángulos (ruta)
 * @property {string} stlTe T de 10×10×20 con tapa de 50×10×3 (ruta)
 * @property {(sel: string) => Promise<boolean>} visible ¿el selector está visible?
 * @property {(ruta: string) => Promise<void>} elegirArchivo carga un modelo (toca "Elegir otro" si ya hay uno)
 * @property {(nombre: string) => Promise<unknown>} captura guarda capturas/<nombre>.png
 * @property {() => Promise<void>} esperarResultado espera el paso 4 (hasta 60 s)
 * @property {() => Promise<void>} cerrar cierra navegador y servidor y borra la carpeta temporal
 * @property {() => number} terminar imprime el resumen y devuelve el código de salida
 */

function crearArchivos() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laminar-'));
    const stlPesado = path.join(tmp, 'esfera-pesada.stl');
    fs.writeFileSync(stlPesado, Buffer.from(esfera()));
    const stlTe = path.join(tmp, 'te.stl'); // columna de 10×10×20 con una tapa de 50×10×3 arriba
    fs.writeFileSync(stlTe, Buffer.from(te()));
    return { tmp, stlPesado, stlTe };
}

async function abrirPagina(navegador) {
    const contexto = await navegador.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
    const pagina = await contexto.newPage();
    pagina.on('pageerror', e => console.log('[error]', e.message));
    pagina.on('requestfailed', r => console.log('[falló]', r.url(), r.failure()?.errorText));
    pagina.on('console', m => m.type() === 'error' && console.log('[consola]', m.text().slice(0, 200)));
    pagina.on('dialog', d => {
        console.log('[alerta]', d.message());
        d.type() === 'confirm' ? d.accept() : d.dismiss();
    });
    return { contexto, pagina };
}

function crearAyudas(pagina) {
    const capturas = process.env.CAPTURAS || 'capturas';
    fs.mkdirSync(capturas, { recursive: true });
    const visible = sel => pagina.isVisible(sel);
    // Carga un STL; si ya hay un modelo, primero toca "Elegir otro modelo".
    async function elegirArchivo(ruta) {
        if (await visible('#otroModelo')) await pagina.tap('#otroModelo');
        await pagina.setInputFiles('#archivo', ruta);
        const nombre = path.basename(ruta);
        await pagina.waitForFunction(n => document.getElementById('nombreModelo').textContent === n, nombre, {
            timeout: 60000,
        });
    }
    const captura = async nombre => pagina.screenshot({ path: path.join(capturas, nombre + '.png') });
    const esperarResultado = () => pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 60000 });
    return { visible, elegirArchivo, captura, esperarResultado };
}

/** @returns {Promise<Ctx>} */
export async function iniciarApp() {
    const archivos = crearArchivos();
    const servidor = await preview({ preview: { port: 4174 } });
    const base = servidor.resolvedUrls.local[0];
    const browser = await chromium.launch({ executablePath: buscarChromium(), args: ['--use-angle=swiftshader'] });
    const { contexto, pagina } = await abrirPagina(browser);
    const { ok, terminar } = crearContador();
    async function cerrar() {
        await browser.close();
        servidor.httpServer.close();
        fs.rmSync(archivos.tmp, { recursive: true, force: true });
    }
    return {
        page: pagina,
        browser,
        context: contexto,
        base,
        ok,
        ...archivos,
        ...crearAyudas(pagina),
        cerrar,
        terminar,
    };
}
