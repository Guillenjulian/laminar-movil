// Busca el ejecutable de Chromium para Playwright (compartido por las pruebas que abren un navegador).
// Orden: variable CHROMIUM_PATH, y si no el Chromium más nuevo de PLAYWRIGHT_BROWSERS_PATH (o /opt/pw-browsers).

import fs from 'node:fs';

/**
 * @returns {string | undefined} ruta del ejecutable, o undefined para que Playwright use el suyo.
 */
export function buscarChromium() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    if (!fs.existsSync(base)) return undefined;
    for (const dir of fs
        .readdirSync(base)
        .filter(d => d.startsWith('chromium'))
        .sort()
        .reverse()) {
        for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
            const p = `${base}/${dir}/${sub}`;
            if (fs.existsSync(p)) return p;
        }
    }
}
