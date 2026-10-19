// Auditoría de accesibilidad de dist/ (ADR 0008). Uso manual, no está en package.json:
//   npm run build && AXE_PATH=/ruta/a/axe.min.js node scripts/auditar-a11y.mjs [--paso4]
// Sirve dist/ con `vite preview`, abre Chromium como Pixel 7, inyecta axe-core (de AXE_PATH o de
// node_modules/axe-core/axe.min.js, que NO está en package.json: se propone como devDependency en el ADR)
// y recorre: paso 1 vacío, paso 1 con el cubo de ejemplo, paso 2, hoja de impresoras y (con --paso4) el resultado.
// Además hace comprobaciones a mano que axe no cubre: foco al abrir y cerrar hojas, trampa de foco,
// aria-current del paso, tamaño de toque y nombres accesibles del canvas.

import fs from 'node:fs';
import { chromium, devices } from 'playwright-core';
import { preview } from 'vite';
import { buscarChromium } from './lib/chromium.mjs';

const RUTA_AXE = process.env.AXE_PATH || 'node_modules/axe-core/axe.min.js';
const conPaso4 = process.argv.includes('--paso4');

/** Pasa axe por la página y devuelve las violaciones resumidas. */
async function auditar(pagina, etapa) {
    const r = await pagina.evaluate(async () => {
        const res = await globalThis.axe.run(document, {
            runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        });
        return res.violations.map(v => ({
            id: v.id,
            impacto: v.impact,
            ayuda: v.help,
            nodos: v.nodes.map(n => ({
                destino: n.target.join(' '),
                resumen: (n.any[0] || n.all[0] || n.none[0] || {}).message,
                datos: (n.any[0] || {}).data,
            })),
        }));
    });
    console.log(`\n=== axe: ${etapa} (${r.length} reglas violadas)`);
    for (const v of r) {
        console.log(`- [${v.impacto}] ${v.id}: ${v.ayuda} (${v.nodos.length} nodos)`);
        for (const n of v.nodos.slice(0, 6)) console.log(`    ${n.destino} :: ${n.resumen}`);
    }
}

/** Elementos interactivos visibles de menos de 44×44 px (WCAG 2.5.8 pide 24; la guía de la app, 44). */
async function tamanosDeToque(pagina, etapa) {
    const chicos = await pagina.evaluate(() =>
        [...document.querySelectorAll('button, a[href], input, select, summary, textarea, [role=button]')]
            .filter(e => e.offsetParent && e.type !== 'hidden' && !e.closest('[hidden]'))
            .map(e => ({ e, r: e.getBoundingClientRect() }))
            .filter(({ r }) => r.width && (r.width < 44 || r.height < 44))
            .map(
                ({ e, r }) =>
                    `${e.tagName.toLowerCase()}#${e.id || e.className || e.name || '?'} ${Math.round(r.width)}×${Math.round(r.height)}`,
            ),
    );
    console.log(`\n=== toque < 44 px: ${etapa} (${chicos.length})`);
    chicos.slice(0, 12).forEach(c => console.log('    ' + c));
}

/** Comprobaciones a mano de la barra de pasos y del idioma. */
async function pasoActual(pagina, etapa) {
    const d = await pagina.evaluate(() => ({
        lang: document.documentElement.lang,
        actual: [...document.querySelectorAll('.pasos li')].map(
            li => `${li.textContent}:${li.getAttribute('aria-current') || '-'}`,
        ),
        h1: document.querySelectorAll('h1').length,
        landmarks: ['header', 'main', 'footer', 'nav'].map(t => `${t}=${document.querySelectorAll(t).length}`),
        vivas: [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].map(
            e => `${e.id || e.className}:${e.getAttribute('role') || 'aria-live=' + e.getAttribute('aria-live')}`,
        ),
    }));
    console.log(`\n=== pasos/idioma: ${etapa}`, JSON.stringify(d));
}

/** Foco al abrir una hoja, trampa de foco con Tab y foco al cerrar. */
async function focoDeHoja(pagina) {
    await pagina.focus('#cambiarImpresora');
    await pagina.keyboard.press('Enter');
    await pagina.waitForSelector('#hojaImpresoras:not([hidden])');
    const alAbrir = await pagina.evaluate(
        () => document.activeElement.id || document.activeElement.tagName + '.' + document.activeElement.className,
    );
    const fuera = [];
    for (let i = 0; i < 14; i++) {
        await pagina.keyboard.press('Tab');
        const info = await pagina.evaluate(() => {
            const a = document.activeElement;
            return { dentro: !!a.closest('#hojaImpresoras'), id: a.id || a.tagName };
        });
        if (!info.dentro) fuera.push(info.id);
    }
    const inertes = await pagina.evaluate(() => ({
        mainInert: document.getElementById('main').inert,
        footerInert: document.querySelector('footer.acciones').inert,
        modal: document.getElementById('hojaImpresoras').getAttribute('aria-modal'),
        rol: document.getElementById('hojaImpresoras').getAttribute('role'),
    }));
    await pagina.keyboard.press('Escape');
    await pagina.evaluate(() => document.querySelector('#hojaImpresoras [data-cerrar]').click());
    await pagina.waitForSelector('#hojaImpresoras', { state: 'hidden' });
    const alCerrar = await pagina.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    console.log('\n=== foco de hoja');
    console.log(`    al abrir el foco queda en: ${alAbrir}`);
    console.log(`    Tab x14: ${fuera.length} veces el foco salió de la hoja (${[...new Set(fuera)].join(', ')})`);
    console.log(`    fondo inerte/aria-modal/role:`, JSON.stringify(inertes));
    console.log(`    al cerrar el foco queda en: ${alCerrar}`);
    await pagina.keyboard.press('Escape');
}

/** Nombres accesibles del visor, del deslizador de capas, de los steppers y de los chips. */
async function nombresClave(pagina, etapa, selectores) {
    const r = await pagina.evaluate(sels => {
        return sels.map(s => {
            const e = document.querySelector(s);
            if (!e) return `${s}: (no está)`;
            return `${s}: role=${e.getAttribute('role') || '-'} nombre="${e.getAttribute('aria-label') || ''}" aria-valuetext=${e.getAttribute('aria-valuetext') || '-'} desc=${e.getAttribute('aria-describedby') || '-'}`;
        });
    }, selectores);
    console.log(`\n=== nombres: ${etapa}`);
    r.forEach(x => console.log('    ' + x));
}

/** Paso 1 vacío y con el cubo de ejemplo. */
async function etapaPaso1(pagina) {
    await pagina.waitForSelector('#ejemplo');
    await pasoActual(pagina, 'paso 1 vacío');
    await auditar(pagina, 'paso 1 vacío');
    await tamanosDeToque(pagina, 'paso 1 vacío');
    await pagina.tap('#ejemplo');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent !== '', null, {
        timeout: 60000,
    });
    await pagina.waitForSelector('#visor[data-visor="listo"]', { timeout: 30000 }).catch(() => {});
    await auditar(pagina, 'paso 1 con el cubo');
    await tamanosDeToque(pagina, 'paso 1 con el cubo');
    const claves = ['#visor', '#visor canvas', '#escala', '#copiasNum', '#copiasMas', '#listaPiezas'];
    await nombresClave(pagina, 'paso 1', claves);
}

/** Paso 2 y la hoja de impresoras (axe y foco). */
async function etapaPaso2(pagina) {
    await pagina.tap('#siguiente');
    await pagina.waitForSelector('section[data-paso="2"]:not([hidden])');
    await pasoActual(pagina, 'paso 2');
    await auditar(pagina, 'paso 2');
    await tamanosDeToque(pagina, 'paso 2');
    await pagina.tap('#cambiarImpresora');
    await pagina.waitForSelector('#hojaImpresoras:not([hidden])');
    await auditar(pagina, 'hoja de impresoras abierta');
    await pagina.evaluate(() => history.back());
    await pagina.waitForSelector('#hojaImpresoras', { state: 'hidden' });
    await focoDeHoja(pagina);
}

/** Lamina el cubo y audita el resultado con el deslizador de capas. */
async function etapaPaso4(pagina) {
    await pagina.tap('#laminar');
    await pagina.waitForSelector('section[data-paso="4"]:not([hidden])', { timeout: 90000 });
    await pagina.waitForSelector('#controlCapas:not([hidden])', { timeout: 30000 });
    await pasoActual(pagina, 'paso 4');
    await auditar(pagina, 'paso 4 con deslizador de capas');
    await tamanosDeToque(pagina, 'paso 4');
    await nombresClave(pagina, 'paso 4', ['#visorCapas', '#visorCapas canvas', '#capa', '#textoCapa', '#reproducir']);
}

async function main() {
    if (!fs.existsSync(RUTA_AXE)) throw new Error(`No encuentro axe-core en ${RUTA_AXE} (definí AXE_PATH)`);
    const servidor = await preview({ preview: { port: 4175 } });
    const navegador = await chromium.launch({ executablePath: buscarChromium(), args: ['--use-angle=swiftshader'] });
    const contexto = await navegador.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
    const pagina = await contexto.newPage();
    try {
        await pagina.goto(servidor.resolvedUrls.local[0]);
        await pagina.addScriptTag({ path: RUTA_AXE });
        await etapaPaso1(pagina);
        await etapaPaso2(pagina);
        if (conPaso4) await etapaPaso4(pagina);
    } finally {
        await navegador.close();
        servidor.httpServer.close();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
