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
import { esfera, te } from '../src/prueba/mallas.js';

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
const stlTe = path.join(tmp, 'te.stl'); // columna de 10×10×20 con una tapa de 50×10×3 arriba
fs.writeFileSync(stlTe, Buffer.from(te()));

const servidor = await preview({ preview: { port: 4174 } });
const url = servidor.resolvedUrls.local[0];
const navegador = await chromium.launch({ executablePath: buscarChromium(), args: ['--use-angle=swiftshader'] });
const contexto = await navegador.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
const pagina = await contexto.newPage();
pagina.on('pageerror', e => console.log('[error]', e.message));
pagina.on('requestfailed', r => console.log('[falló]', r.url(), r.failure()?.errorText));
pagina.on('console', m => m.type() === 'error' && console.log('[consola]', m.text().slice(0, 200)));
pagina.on('dialog', d => { console.log('[alerta]', d.message()); d.type() === 'confirm' ? d.accept() : d.dismiss(); });

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

    // --- Vista previa capa por capa ---
    await pagina.waitForSelector('#controlCapas:not([hidden])', { timeout: 30000 });
    const textoCapa = () => pagina.textContent('#textoCapa');
    const ultima = await textoCapa();
    const m = ultima.match(/Capa (\d+)\/(\d+) · Z ([\d,]+) mm/);
    revisar('vista previa: arranca en la última capa', m && m[1] === m[2] && Math.abs(parseFloat(m[3].replace(',', '.')) - 20) < 0.3, ultima);
    revisar('vista previa: tantas capas como Kiri', m && Math.abs(Number(m[2]) - 72) <= 1, `${m?.[2]} capas`);
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
    await pagina.tap('#reproducir');
    await pagina.waitForTimeout(600);
    const durante = await textoCapa();
    await pagina.waitForFunction(() => document.getElementById('reproducir').textContent === '▶', null, { timeout: 15000 });
    revisar('reproducir recorre las capas hasta el final', durante !== ultima && (await textoCapa()) === ultima, durante);
    const pixeles = await pagina.evaluate(() => new Promise(listo => {
        // El visor sólo dibuja cuando algo cambia: movemos la capa para forzar un dibujo.
        const capa = document.getElementById('capa');
        capa.value = Number(capa.max) - 1;
        capa.dispatchEvent(new Event('input'));
        requestAnimationFrame(() => {
        // ¿El canvas tiene algo dibujado? Miramos el centro en una copia 2D, dentro del mismo
        // cuadro en que dibuja three.js (después WebGL descarta la imagen).
        const c = document.querySelector('#visorCapas canvas');
        const t = document.createElement('canvas'); t.width = 64; t.height = 64;
        const ctx = t.getContext('2d');
        ctx.drawImage(c, c.width / 2 - 32, c.height / 2 - 32, 64, 64, 0, 0, 64, 64);
        const d = ctx.getImageData(0, 0, 64, 64).data;
        let pintados = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && (d[i] > 150 || d[i + 2] > 150)) pintados++;
        listo(pintados);
    });
    }));
    revisar('se dibujan los recorridos', pixeles > 50, `${pixeles} píxeles con color en el centro`);

    // --- Pausa para cambiar filamento ---
    await pagina.locator('#capa').fill('0');
    revisar('no se puede pausar en la primera capa', await pagina.isDisabled('#pausarCapa'));
    await pagina.locator('#capa').fill('10');
    await pagina.tap('#pausarCapa');
    await pagina.locator('#capa').fill('30');
    await pagina.tap('#pausarCapa');
    const filas = await pagina.$$eval('#listaPausas .ir', bs => bs.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
    revisar('tres filamentos en la lista', filas.length === 3 && filas[0] === 'Filamento 1 · capas 1–10' &&
        filas[1] === 'Filamento 2 · capas 11–30 ⏸ pausa en Z 3,08 mm' && filas[2].startsWith('Filamento 3 · capas 31–71'), filas.join(' | '));
    revisar('con pausas pasa a colores por filamento',
        await pagina.isVisible('#modoColor') && /activo/.test(await pagina.getAttribute('#modoColor [data-modo="filamento"]', 'class')));
    revisar('la capa muestra la pausa', (await pagina.textContent('#textoCapa')).endsWith('⏸'));
    revisar('marcas sobre el deslizador', (await pagina.locator('#marcasPausa i').count()) === 2);
    revisar('el botón ahora quita la pausa', /Quitar/.test(await pagina.textContent('#pausarCapa')));
    await pagina.locator('#listaPausas').scrollIntoViewIfNeeded();
    await captura('4-pausas');

    // Filamento 2 en verde puro: en la capa 20 tiene que verse verde; por tipo de línea, no.
    const verdes = () => pagina.evaluate(() => new Promise(listo => requestAnimationFrame(() => {
        const c = document.querySelector('#visorCapas canvas');
        const t = document.createElement('canvas'); t.width = 96; t.height = 96;
        const ctx = t.getContext('2d');
        ctx.drawImage(c, c.width / 2 - 48, c.height / 2 - 48, 96, 96, 0, 0, 96, 96);
        const d = ctx.getImageData(0, 0, 96, 96).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i] < 90 && d[i + 2] < 90) n++;
        listo(n);
    })));
    await pagina.locator('#listaPausas input[data-filamento="1"]').fill('#00ff00');
    await pagina.locator('#capa').fill('19');
    const conVerde = await verdes();
    await pagina.tap('#modoColor [data-modo="tipo"]');
    const sinVerde = await verdes();
    revisar('el filamento 2 se pinta del color elegido', conVerde > 50 && sinVerde < conVerde / 10, `${conVerde} → ${sinVerde} píxeles verdes`);
    await pagina.tap('#modoColor [data-modo="filamento"]');
    await pagina.locator('#capa').fill('70');
    await pagina.evaluate(() => document.getElementById('visorCapas').scrollIntoView());
    await pagina.waitForTimeout(300);
    await captura('4-filamentos');

    await pagina.tap('#listaPausas .quitar[data-capa="30"]');
    revisar('quitar una pausa', (await pagina.locator('#listaPausas .ir').count()) === 2);
    const resumen = await pagina.textContent('#resumen');
    revisar('resumen con tiempo y filamento', /Tiempo estimado/.test(resumen) && /Filamento.*m \(≈/.test(resumen));
    await captura('4-listo');

    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const gcode = fs.readFileSync(await descarga.path(), 'utf8');
    revisar('descarga del G-code', descarga.suggestedFilename() === 'cubo-20mm_rapido.gcode', descarga.suggestedFilename());
    revisar('G-code con temperaturas', gcode.includes('M104 S200') && gcode.includes('M140 S60'));
    {
        // una sola pausa, entre la capa de Z 2,80 y la de Z 3,08
        const l = gcode.split('\n'), i = l.indexOf('M600');
        const zs = (a, b) => l.slice(a, b).map(x => x.match(/^G1 Z([\d.]+)/)).filter(Boolean).map(m => +m[1]);
        const antes = zs(0, i).at(-1), despues = zs(i, l.length)[0];
        revisar('el G-code descargado trae la pausa', gcode.split('\nM600\n').length === 2 && antes === 2.8 && despues === 3.08,
            `Z ${antes} → M600 → Z ${despues}`);
    }

    // "Atrás" desde el resultado vuelve a la configuración (no a la barra de progreso).
    await pagina.goBack();
    revisar('atrás desde el resultado → paso 2', await visible('section[data-paso="2"]'));

    // --- Impresoras: buscar, elegir, "Mi impresora" ---
    await pagina.tap('#cambiarImpresora');
    revisar('hoja de impresoras abierta', await visible('#hojaImpresoras'));
    const total = await pagina.locator('#listaImpresoras [data-id]').count();
    await pagina.fill('#buscarImpresora', 'prusa');
    const prusas = await pagina.$$eval('#listaImpresoras [data-id] b', bs => bs.map(b => b.textContent));
    revisar('buscar filtra la lista', total > 40 && prusas.length === 3 && prusas.every(n => /Prusa/.test(n)), `${total} → ${prusas.join(', ')}`);
    await captura('2-impresoras');
    await pagina.tap('[data-id="kiri-prusa-i3-mk3s"]');
    revisar('elegir cierra la hoja', !(await visible('#hojaImpresoras')) && await visible('section[data-paso="2"]'));
    const tarjeta = await pagina.textContent('#impresoraElegida');
    revisar('tarjeta de importada', /Prusa i3 MK3S\+/.test(tarjeta) && /sin revisar/.test(tarjeta));

    // Atrás del celu cierra la hoja sin salir del paso 2.
    await pagina.tap('#cambiarImpresora');
    await pagina.goBack();
    revisar('atrás cierra la hoja', !(await visible('#hojaImpresoras')) && await visible('section[data-paso="2"]'));

    // Crear una propia con Klipper y extrusor Bowden.
    await pagina.tap('#cambiarImpresora');
    await pagina.tap('#nuevaImpresora');
    await pagina.fill('[name=nombre]', 'Mi Ender 3 Pro');
    await pagina.fill('[name=ancho]', '235');
    await pagina.fill('[name=profundidad]', '235');
    await pagina.selectOption('[name=extrusor]', 'bowden');
    await pagina.selectOption('[name=firmware]', 'klipper');
    revisar('bowden propone 5 mm de retracción', (await pagina.inputValue('[name=retraccion]')) === '5');
    revisar('Klipper cambia la plantilla de inicio', (await pagina.inputValue('[name=inicio]')).startsWith('PRINT_START'));
    await captura('2-mi-impresora');
    await pagina.fill('[name=ancho]', '20');
    await pagina.tap('#formImpresora [type=submit]');
    revisar('valida los datos', await visible('#errorImpresora') && /Ancho/.test(await pagina.textContent('#errorImpresora')));
    await pagina.fill('[name=ancho]', '235');
    await pagina.tap('#formImpresora [type=submit]');
    await pagina.waitForSelector('#hojaMiImpresora', { state: 'hidden' });
    revisar('guardar cierra las dos hojas', !(await visible('#hojaImpresoras')) && await visible('section[data-paso="2"]'));
    revisar('queda elegida la propia', /Mi Ender 3 Pro.*Tuya.*235 × 235 × 250/s.test(await pagina.textContent('#impresoraElegida')));
    await pagina.tap('#laminar');
    await pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 60000 });
    const [desc2] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const gcodePropio = fs.readFileSync(await desc2.path(), 'utf8');
    revisar('G-code con la impresora propia', gcodePropio.includes('PRINT_START BED_TEMP=60 EXTRUDER_TEMP=200') &&
        gcodePropio.includes('G1 E-5'));
    await pagina.goBack();

    // "Copiar como mía" a partir del perfil armado a mano.
    await pagina.tap('#cambiarImpresora');
    await pagina.fill('#buscarImpresora', 'v3 se');
    await pagina.tap('[data-id="creality-ender-3-v3-se"]');
    await pagina.tap('#copiarImpresora');
    revisar('copiar trae los datos', (await pagina.inputValue('[name=nombre]')) === 'Creality Ender 3 V3 SE (mía)' &&
        (await pagina.inputValue('[name=retraccion]')) === '0.8' && (await pagina.inputValue('[name=inicio]')).includes('G28'));
    await pagina.goBack();

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
    await pagina.tap('#cambiarImpresora');
    revisar('la impresora propia sigue guardada', (await pagina.textContent('#listaImpresoras')).includes('Mi Ender 3 Pro'));
    await pagina.tap('[data-id^="propia-"]');
    await pagina.tap('#editarImpresora');
    await pagina.tap('#borrarImpresora');
    await pagina.waitForSelector('#hojaMiImpresora', { state: 'hidden' });
    revisar('borrar la propia vuelve a la inicial', /Ender 3 V3 SE/.test(await pagina.textContent('#impresoraElegida')));
    revisar('se recuerda lo personalizado', (await pagina.textContent('#personalizar summary')).startsWith('Personalizado: Giroide'));
    await pagina.tap('#personalizar summary');
    await pagina.tap('#restablecer');
    revisar('volver a los valores de la calidad', (await pagina.textContent('#personalizar summary')).startsWith('Personalizar'));
    await pagina.goBack();
    await pagina.tap('#otroModelo');
    await pagina.tap('[data-borrar]:near(.reciente:has-text("esfera-pesada.stl"))');
    await pagina.waitForFunction(() => ![...document.querySelectorAll('.reciente b')].some(b => b.textContent === 'esfera-pesada.stl'));
    revisar('borrar un reciente', true);

    // --- Modelo en la cama: escala, rotar, apoyar cara ---
    await pagina.goBack();
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    const medidas = () => pagina.textContent('#datosModelo').then(t => t.split(' · ')[0]);
    await pagina.tap('#escalaMas');
    revisar('escala +10 %', (await medidas()) === '22,0 × 22,0 × 22,0 mm' && (await pagina.inputValue('#escala')) === '110', await medidas());
    await pagina.fill('#escala', '200');
    await pagina.press('#escala', 'Enter');
    await pagina.locator('#escala').blur();
    revisar('escala escrita a mano (200 %)', (await medidas()) === '40,0 × 40,0 × 40,0 mm', await medidas());
    await pagina.tap('#restablecerModelo');
    revisar('restablecer', (await medidas()) === '20,0 × 20,0 × 20,0 mm' && await pagina.isHidden('#restablecerModelo'));

    await pagina.fill('#escala', '2000');
    await pagina.locator('#escala').blur();
    revisar('modelo que no entra: aviso y botón', /No entra/.test(await pagina.textContent('#avisoModelo')) && await pagina.isVisible('#ajustarCama'));
    await pagina.tap('#ajustarCama');
    const ajustada = parseFloat((await medidas()).replace(',', '.'));
    revisar('"Achicar para que entre" lo ajusta', ajustada <= 220 && ajustada > 200 && await pagina.isHidden('#avisoModelo'), await medidas());
    await pagina.tap('#restablecerModelo');

    await elegirArchivo(stlTe);
    revisar('la T original', (await medidas()) === '50,0 × 10,0 × 23,0 mm', await medidas());
    await pagina.tap('[data-rotar="x"]');
    revisar('rotar 90° en X', (await medidas()) === '50,0 × 23,0 × 10,0 mm', await medidas());
    await pagina.tap('[data-rotar="x"]');
    await pagina.tap('[data-rotar="x"]');
    await pagina.tap('[data-rotar="x"]');
    revisar('4 rotaciones vuelven al original', (await medidas()) === '50,0 × 10,0 × 23,0 mm', await medidas());

    // Apoyar cara: tocando el centro del visor el rayo pega en el frente de la columna.
    await pagina.tap('#apoyarCara');
    revisar('modo apoyar cara', await pagina.isVisible('#ayudaCara') && (await pagina.textContent('#apoyarCara')) === 'Cancelar');
    const lienzo = await pagina.locator('#visor canvas').boundingBox();
    await pagina.touchscreen.tap(lienzo.x + lienzo.width / 2, lienzo.y + lienzo.height / 2);
    await pagina.waitForFunction(() => document.getElementById('ayudaCara').hidden, null, { timeout: 5000 });
    revisar('apoyar la cara del frente acuesta la T', (await medidas()) === '50,0 × 23,0 × 10,0 mm', await medidas());
    await captura('1-apoyar-cara');

    // Laminar la T acostada y a mitad de tamaño: el G-code tiene que respetarlo.
    await pagina.fill('#escala', '50');
    await pagina.locator('#escala').blur();
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 60000 });
    revisar('el resumen usa el tamaño transformado', (await pagina.textContent('#resumen')).includes('25,0 × 11,5 × 5,0 mm'));
    const [desc3] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const gT = fs.readFileSync(await desc3.path(), 'utf8').split('\n');
    const fin = gT.findIndex(l => l.startsWith('; --- Fin'));   // el G-code de fin sube Z en relativo
    const zT = gT.slice(0, fin).map(l => l.match(/^G1 Z([\d.]+)/)).filter(Boolean).map(m => +m[1]);
    const zPieza = Math.max(...zT);
    revisar('G-code de la T acostada al 50 %: 5 mm de alto', Math.abs(zPieza - 5) < 0.3, `Z máx ${zPieza}`);
    await pagina.goBack();
    await pagina.goBack();

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
