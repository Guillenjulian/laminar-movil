// Pruebas automáticas del motor: levanta la app, abre Chromium sin ventana,
// lamina mallas de prueba con el perfil real de la impresora y revisa que el
// G-code tenga sentido. Cada tema vive en scripts/motor/ (`probarX(ctx)`).
//
// Uso: npm run build && npm run test:motor
//      npm run test:motor -- --dev   (contra el servidor de desarrollo)
// Requiere Chromium (variable CHROMIUM_PATH o el de Playwright).

import { chromium } from 'playwright-core';
import { preview, createServer } from 'vite';
import fs from 'node:fs';
import { buscarChromium } from './lib/chromium.mjs';
import { analizar } from './motor/ayudas.mjs';
import { probarCubo } from './motor/cubo.mjs';
import { probarMateriales } from './motor/materiales.mjs';
import { probarTransformaciones } from './motor/transformaciones.mjs';
import { probarPersonalizar } from './motor/personalizar.mjs';
import { probarImpresoras } from './motor/impresoras.mjs';
import { probarAvanzado } from './motor/avanzado.mjs';
import { probarMallaPesada } from './motor/malla-pesada.mjs';
import { probarCambios } from './motor/cambios.mjs';
import { probarTorres } from './motor/torres.mjs';
import { probarPiezasKiri } from './motor/piezas-kiri.mjs';
import { probarPerfilesRevisados } from './motor/perfiles-revisados.mjs';
import { probarBambuPerfiles } from './motor/bambu-perfiles.mjs';
import { probarPiezas } from './motor/piezas.mjs';
import { probarPiezasExtra } from './motor/piezas-extra.mjs';
import { probarSoportesGanchos } from './motor/soportes-ganchos.mjs';

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
    console.log(
        `\n▶ ${JSON.stringify(opciones, (_k, v) => (typeof v === 'string' && v.length > 80 ? `<${v.length} caracteres>` : v))} — ${r.ms} ms, ${r.info.capas} capas, ` +
            `${Math.round(r.info.tiempo / 60)} min, ${(r.info.filamento / 1000).toFixed(2)} m`,
    );
    if (process.env.GUARDAR_GCODE) {
        const nombre = [opciones.caso, opciones.calidad || 'normal', opciones.soportes && 'soportes']
            .filter(Boolean)
            .join('-');
        fs.writeFileSync(`${process.env.GUARDAR_GCODE}/${nombre}.gcode`, r.gcode);
    }
    return { ...r, g: analizar(r.gcode) };
}

try {
    const ctx = { laminar, revisar, pagina };
    const rapido = await probarCubo(ctx); // perfil, pausas y calidades
    await probarMateriales({ ...ctx, rapido }); // materiales y recorte de temperatura
    await probarTransformaciones(ctx); // escala, rotación, apoyar cara
    const { base, nada } = await probarPersonalizar(ctx); // soportes, relleno, paredes, adhesión
    await probarImpresoras(ctx); // todas las impresoras importadas
    await probarAvanzado({ ...ctx, base, nada }); // jarrón, altura variable, costura, compensación
    await probarMallaPesada(ctx); // decimado
    await probarCambios(ctx); // cambios por altura (ADR 0002)
    await probarTorres(ctx); // torres de calibración (ADR 0002)
    await probarPiezasKiri(ctx); // varias piezas con track.pos (ADR 0003, T0)
    await probarPerfilesRevisados(ctx); // 8 impresoras populares revisadas
    await probarBambuPerfiles(ctx); // 4 perfiles Bambu Lab y salidaDe (ADR 0005)
    await probarPiezas(ctx); // varias piezas con track.pos (ADR 0003)
    await probarPiezasExtra(ctx); // cama centrada, progreso y cancelación con 3 copias
    await probarSoportesGanchos(ctx); // ganchos de soportes con puente de mentira (ADR 0004, T0)
} finally {
    await navegador.close();
    await (modoDev ? servidor.close() : servidor.httpServer.close());
}
console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallas ? 1 : 0);
