// Prueba automática: levanta el build con `vite preview`, abre Chromium sin
// ventana, lamina el cubo de ejemplo y revisa que salga G-code coherente.
//
// Uso: npm run build && npm run test:motor
//      npm run test:motor -- --dev   (prueba contra el servidor de desarrollo)
// Requiere Chromium (variable CHROMIUM_PATH o el de Playwright).

import { chromium } from 'playwright-core';
import { preview, createServer } from 'vite';
import fs from 'node:fs';

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

const modoDev = process.argv.includes('--dev');
const servidor = modoDev
    ? await (await createServer({ server: { port: 5199 } })).listen()
    : await preview({ preview: { port: 4173 } });
const url = servidor.resolvedUrls.local[0];
const navegador = await chromium.launch({ executablePath: buscarChromium() });
let ok = false;
try {
    const pagina = await navegador.newPage();
    pagina.on('console', m => console.log(`[consola ${m.type()}]`, m.text().slice(0, 300)));
    pagina.on('response', r => r.status() >= 400 && console.log('[http]', r.status(), r.url()));
    pagina.on('pageerror', e => console.log('[error]', e.message));
    await pagina.goto(url + 'prueba-motor.html');
    await pagina.click('#probar');
    await pagina.waitForFunction(() => window.resultado, null, { timeout: 120000 })
        .catch(async err => { console.log('estado al cortar:', await pagina.textContent('#estado')); throw err; });
    const r = await pagina.evaluate(() => window.resultado);
    console.log('estado:', await pagina.textContent('#estado'));
    if (r.error) throw new Error(r.error);

    const lineas = r.gcode.split('\n');
    const movs = lineas.filter(l => /^G1 .*E/.test(l)).length;
    const zs = lineas.map(l => l.match(/^G[01] .*Z([\d.]+)/)).filter(Boolean).map(m => +m[1]);
    const rango = eje => {
        const v = lineas.filter(l => /^G1 .*E/.test(l)).map(l => l.match(new RegExp(eje + '(-?[\\d.]+)'))).filter(Boolean).map(m => +m[1]);
        return [Math.min(...v), Math.max(...v)];
    };
    const [xmin, xmax] = rango('X'), [ymin, ymax] = rango('Y');
    console.log('info:', r.info);
    console.log(`extrusión en X ${xmin}..${xmax}, Y ${ymin}..${ymax}`);
    if (process.env.GUARDAR_GCODE) fs.writeFileSync(process.env.GUARDAR_GCODE, r.gcode);
    console.log(`líneas: ${lineas.length}, movimientos con extrusión: ${movs}, Z máx: ${Math.max(...zs)}`);
    const macros = ['M140 S60', 'M104 S200', 'G28', ';LAYER:50'].every(m => lineas.some(l => l.startsWith(m)));
    console.log('macros reemplazadas:', macros);
    ok = macros && movs > 100 && xmin > 95 && xmax < 125 && ymin > 95 && ymax < 125 && Math.max(...zs) >= 19.8 && Math.max(...zs) <= 21;
    console.log(ok ? 'PRUEBA OK' : 'PRUEBA FALLÓ');
} finally {
    await navegador.close();
    await (modoDev ? servidor.close() : servidor.httpServer.close());
}
process.exit(ok ? 0 : 1);
