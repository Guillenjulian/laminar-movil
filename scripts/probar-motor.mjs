// Pruebas automáticas del motor: levanta la app, abre Chromium sin ventana,
// lamina mallas de prueba con el perfil real de la impresora y revisa que el
// G-code tenga sentido.
//
// Uso: npm run build && npm run test:motor
//      npm run test:motor -- --dev   (contra el servidor de desarrollo)
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

// Datos útiles de un G-code para comparar.
function analizar(gcode) {
    const lineas = gcode.split('\n');
    // Sólo la pieza: desde la primera capa (así no cuenta la línea de purga del start G-code).
    const pieza = lineas.slice(lineas.findIndex(l => l.startsWith(';LAYER:')));
    const extrusiones = pieza.filter(l => /^G1 .*E\d/.test(l));
    const valores = eje => extrusiones.map(l => l.match(new RegExp(eje + '(-?[\\d.]+)'))).filter(Boolean).map(m => +m[1]);
    const zs = lineas.map(l => l.match(/^G[01] .*Z([\d.]+)/)).filter(Boolean).map(m => +m[1]);
    const xs = valores('X'), ys = valores('Y');
    const min = v => v.reduce((a, b) => Math.min(a, b), Infinity);
    const max = v => v.reduce((a, b) => Math.max(a, b), -Infinity);
    return {
        lineas,
        extrusiones: extrusiones.length,
        capas: lineas.filter(l => l.startsWith(';LAYER:')).length,
        x: [min(xs), max(xs)],
        y: [min(ys), max(ys)],
        zMax: max(zs),
        tiene: prefijo => lineas.some(l => l.startsWith(prefijo)),
    };
}

const modoDev = process.argv.includes('--dev');
const servidor = modoDev
    ? await (await createServer({ server: { port: 5199 } })).listen()
    : await preview({ preview: { port: 4173 } });
const url = servidor.resolvedUrls.local[0];
const navegador = await chromium.launch({ executablePath: buscarChromium() });
const pagina = await navegador.newPage();
pagina.on('console', m => m.type() === 'error' && console.log('[consola]', m.text().slice(0, 300)));
pagina.on('pageerror', e => console.log('[error]', e.message));
await pagina.goto(url + 'prueba-motor.html');
await pagina.waitForFunction(() => window.probar);

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (!condicion) fallas++;
}

async function laminar(opciones) {
    const r = await pagina.evaluate(o => window.probar(o), opciones);
    console.log(`\n▶ ${JSON.stringify(opciones)} — ${r.ms} ms, ${r.info.capas} capas, ` +
        `${Math.round(r.info.tiempo / 60)} min, ${(r.info.filamento / 1000).toFixed(2)} m`);
    if (process.env.GUARDAR_GCODE) {
        const nombre = [opciones.caso, opciones.calidad || 'normal', opciones.soportes && 'soportes'].filter(Boolean).join('-');
        fs.writeFileSync(`${process.env.GUARDAR_GCODE}/${nombre}.gcode`, r.gcode);
    }
    return { ...r, g: analizar(r.gcode) };
}

try {
    // 1. Cubo con calidad Normal: perfil completo de la Ender 3 V3 SE.
    const normal = await laminar({ caso: 'cubo', calidad: 'normal' });
    revisar('start G-code con temperaturas PLA', ['M140 S60', 'M190 S60', 'M104 S200', 'M109 S200', 'G28'].every(normal.g.tiene));
    revisar('ventilador de capa', normal.g.tiene('M106 S255'));
    revisar('retracción de 0,8 mm', normal.g.tiene('G1 E-0.8'));
    revisar('cubo centrado en la cama', normal.g.x[0] > 95 && normal.g.x[1] < 125 && normal.g.y[0] > 95 && normal.g.y[1] < 125,
        `X ${normal.g.x} Y ${normal.g.y}`);
    revisar('altura ~20 mm', normal.g.zMax >= 19.8 && normal.g.zMax <= 21, `Z máx ${normal.g.zMax}`);
    revisar('capas de 0,2 mm', Math.abs(normal.g.capas - 100) <= 1, `(${normal.g.capas} capas)`);
    revisar('end G-code', normal.g.tiene('M84 X Y E') && normal.g.tiene('G1 X0 Y220'));
    revisar('sin macros sin reemplazar', !normal.gcode.includes('{'));

    // 2. Las otras calidades cambian la altura de capa.
    const rapido = await laminar({ caso: 'cubo', calidad: 'rapido' });
    revisar('Rápido: capas de 0,28 mm', Math.abs(rapido.g.capas - 20 / 0.28) <= 2, `(${rapido.g.capas} capas)`);
    const detalle = await laminar({ caso: 'cubo', calidad: 'detalle' });
    revisar('Detalle: capas de 0,12 mm', Math.abs(detalle.g.capas - (1 + 19.8 / 0.12)) <= 2, `(${detalle.g.capas} capas)`);

    // 3. Soportes automáticos (con los minions locales).
    const sinSop = await laminar({ caso: 'te' });
    const conSop = await laminar({ caso: 'te', soportes: true });
    revisar('soportes agregan material', conSop.info.filamento > sinSop.info.filamento * 1.1,
        `(${(sinSop.info.filamento / 1000).toFixed(2)} m → ${(conSop.info.filamento / 1000).toFixed(2)} m)`);

    // 4. Malla pesada: tiene que decimarse por debajo del límite y laminar igual.
    const pesada = await laminar({ caso: 'esfera', limite: 250000 });
    const d = pesada.info.decimado;
    revisar('esfera decimada', d && d.original > 1e6 && d.final <= 250000,
        d ? `(${d.original} → ${d.final} triángulos, celda ${d.precisionMm.toFixed(3)} mm)` : '');
    revisar('esfera de 80 mm de alto', pesada.g.zMax >= 79 && pesada.g.zMax <= 81, `Z máx ${pesada.g.zMax}`);
} finally {
    await navegador.close();
    await (modoDev ? servidor.close() : servidor.httpServer.close());
}
console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallas ? 1 : 0);
