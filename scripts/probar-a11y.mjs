// Prueba de accesibilidad con axe-core (ADR 0008, A6): `npm run build && npm run test:a11y`.
// Sirve dist/ con `vite preview`, abre Chromium como Pixel 7 (como test:app), inyecta axe desde
// node_modules y corre las reglas WCAG 2.2 AA en cada etapa, en tema claro y oscuro. Sale con 1 si hay
// CUALQUIER violación que no esté en CONOCIDAS, o si una conocida ya no ocurre ("conocida vencida").
//
// Flujo por tema: paso 1 vacío → hoja de la torre → con el cubo → paso 2 (Personalizar y Avanzado abiertos)
// → hoja de impresoras → hoja "Mi impresora" → laminar → paso 4 con la vista de capas → hoja de red →
// paso 3 (forzado visible, con el error de laminado, porque el cubo lamina demasiado rápido para medirlo).
// Precondición: `npm run build` hecho. Usa CHROMIUM_PATH (o el Chromium de PLAYWRIGHT_BROWSERS_PATH).

import { chromium, devices } from 'playwright-core';
import { preview } from 'vite';
import { buscarChromium } from './lib/chromium.mjs';

const RUTA_AXE = 'node_modules/axe-core/axe.min.js';
const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TEMAS = ['light', 'dark'];

/**
 * Violaciones aceptadas, una por una. Cada una necesita su motivo; si deja de ocurrir, la prueba falla
 * ("conocida vencida") para que la lista se vacíe sola.
 * @type {{ regla: string, selector: string, motivo: string }[]}
 */
const CONOCIDAS = [];

const conocidaUsada = new Set();
let fallas = 0;

/** Pasa axe por la página y devuelve [{ regla, impacto, selector }] (un item por nodo). */
async function violaciones(pagina) {
    return pagina.evaluate(async etiquetas => {
        const res = await globalThis.axe.run(document, { runOnly: etiquetas });
        return res.violations.flatMap(v =>
            v.nodes.map(n => ({ regla: v.id, impacto: v.impact, selector: n.target.join(' ') })),
        );
    }, ETIQUETAS);
}

async function etapa(pagina, tema, nombre) {
    const todas = await violaciones(pagina);
    const reales = [];
    for (const v of todas) {
        const i = CONOCIDAS.findIndex(c => c.regla === v.regla && v.selector.includes(c.selector));
        if (i >= 0) conocidaUsada.add(i);
        else reales.push(v);
    }
    if (reales.length === 0) console.log(`✔ [${tema}] ${nombre}`);
    else {
        fallas += reales.length;
        console.log(`✘ [${tema}] ${nombre}`);
        for (const v of reales) console.log(`    ${v.regla} (${v.impacto}) ${v.selector}`);
    }
}

const visible = (pagina, sel) => pagina.waitForSelector(sel, { state: 'visible' });
const cerrarHoja = async (pagina, sel) => {
    await pagina.evaluate(() => history.back());
    await pagina.waitForSelector(sel, { state: 'hidden' });
};

async function etapasPaso1(pagina, tema) {
    await pagina.waitForSelector('#ejemplo');
    await etapa(pagina, tema, 'paso 1 vacío');

    await pagina.tap('#botonTorre');
    await visible(pagina, '#hojaTorre');
    await etapa(pagina, tema, 'hoja de torre');
    await cerrarHoja(pagina, '#hojaTorre');

    await pagina.tap('#ejemplo');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent !== '', null, {
        timeout: 60000,
    });
    await pagina.waitForSelector('#visor[data-visor="listo"]', { timeout: 30000 }).catch(() => {});
    await etapa(pagina, tema, 'paso 1 con el cubo');
}

async function etapasPaso2(pagina, tema) {
    await pagina.tap('#siguiente');
    await visible(pagina, 'section[data-paso="2"]');
    await pagina.evaluate(() => {
        for (const id of ['personalizar', 'avanzado']) document.getElementById(id).open = true;
    });
    await etapa(pagina, tema, 'paso 2 (Personalizar y Avanzado abiertos)');

    await pagina.tap('#cambiarImpresora');
    await visible(pagina, '#hojaImpresoras');
    await etapa(pagina, tema, 'hoja de impresoras');
    await pagina.tap('#nuevaImpresora');
    await visible(pagina, '#hojaMiImpresora');
    await etapa(pagina, tema, 'hoja "Mi impresora"');
    await cerrarHoja(pagina, '#hojaMiImpresora');
    await cerrarHoja(pagina, '#hojaImpresoras');
}

async function etapasResultado(pagina, tema) {
    await pagina.tap('#laminar');
    await pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 90000 });
    await pagina.waitForSelector('#controlCapas:not([hidden])', { timeout: 30000 });
    await etapa(pagina, tema, 'paso 4 con el resultado y la vista de capas');

    await pagina.tap('#configurarRed');
    await visible(pagina, '#hojaRed');
    await etapa(pagina, tema, 'hoja de red');
    await cerrarHoja(pagina, '#hojaRed');

    // Paso 3 forzado: el cubo lamina en milisegundos; se muestra la pantalla con su error de laminado.
    await pagina.evaluate(() => {
        for (const s of document.querySelectorAll('section.pantalla')) s.hidden = s.dataset.paso !== '3';
        const e = document.getElementById('errorLaminado');
        e.textContent = 'No se pudo laminar el modelo.';
        e.hidden = false;
    });
    await etapa(pagina, tema, 'paso 3 (laminando, forzado visible)');
}

async function recorrer(navegador, base, tema) {
    const contexto = await navegador.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block', colorScheme: tema });
    const pagina = await contexto.newPage();
    pagina.on('pageerror', e => console.log('[error]', e.message));
    try {
        await pagina.emulateMedia({ colorScheme: tema });
        await pagina.goto(base);
        await pagina.addScriptTag({ path: RUTA_AXE });
        await etapasPaso1(pagina, tema);
        await etapasPaso2(pagina, tema);
        await etapasResultado(pagina, tema);
    } finally {
        await contexto.close();
    }
}

async function main() {
    const inicio = Date.now();
    const servidor = await preview({ preview: { port: 4176 } });
    const navegador = await chromium.launch({ executablePath: buscarChromium(), args: ['--use-angle=swiftshader'] });
    try {
        for (const tema of TEMAS) await recorrer(navegador, servidor.resolvedUrls.local[0], tema);
    } finally {
        await navegador.close();
        servidor.httpServer.close();
    }
    CONOCIDAS.forEach((c, i) => {
        if (conocidaUsada.has(i)) return console.log(`• conocida: ${c.regla} ${c.selector}: ${c.motivo}`);
        fallas++;
        console.log(`✘ conocida vencida: ${c.regla} ${c.selector} ya no ocurre; sacala de CONOCIDAS (${c.motivo})`);
    });
    const seg = ((Date.now() - inicio) / 1000).toFixed(0);
    console.log(`\n${fallas ? `✘ ${fallas} problema(s)` : '✔ axe sin violaciones'} (${seg} s)`);
    process.exit(fallas ? 1 : 0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
