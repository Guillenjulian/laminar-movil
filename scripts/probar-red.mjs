// Pruebas del cliente de red local (ADR 0007, src/red/). Corren en Node, sin navegador ni impresora.
// Recorre scripts/red/*.mjs; cada archivo exporta por defecto `async function ({ revisar, igual, cargar })`.
// `cargar('direccion')` importa src/red/direccion.js; si no existe informa "✘ falta src/red/direccion.js" y da null,
// así que un módulo que falta no rompe las pruebas de los demás.
//
// Uso: npm run test:red

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

let fallas = 0;
let aciertos = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${condicion ? '' : detalle}`);
    if (condicion) aciertos++;
    else fallas++;
}
// Comparación estricta (distingue -0 de 0 y no esconde NaN).
function igual(real, esperado) {
    try {
        assert.deepStrictEqual(real, esperado);
        return true;
    } catch {
        return false;
    }
}

const carpetaRed = fileURLToPath(new URL('../src/red/', import.meta.url));
async function cargar(nombre) {
    const ruta = `${carpetaRed}${nombre}.js`;
    if (!existsSync(ruta)) {
        revisar(`falta src/red/${nombre}.js`, false);
        return null;
    }
    try {
        return await import(pathToFileURL(ruta).href);
    } catch (e) {
        // Si el que falta es un módulo del que éste depende, se dice cuál es.
        const falta = /src\/red\/([\w-]+)\.js/.exec(String(e?.message ?? ''));
        const dependencia = e?.code === 'ERR_MODULE_NOT_FOUND' && falta && falta[1] !== nombre;
        revisar(dependencia ? `falta src/red/${falta[1]}.js` : `src/red/${nombre}.js no carga`, false, e?.message);
        return null;
    }
}

const carpeta = fileURLToPath(new URL('./red/', import.meta.url));
const archivos = readdirSync(carpeta)
    .filter(f => f.endsWith('.mjs'))
    .sort();
for (const archivo of archivos) {
    const modulo = await import(pathToFileURL(carpeta + archivo).href);
    // Los helpers compartidos (sin export default) no son pruebas: se saltean.
    if (typeof modulo.default !== 'function') continue;
    console.log(`\n== ${archivo}`);
    try {
        await modulo.default({ revisar, igual, cargar });
    } catch (e) {
        revisar(`${archivo} terminó con una excepción`, false, e?.stack ?? String(e));
    }
}

console.log(fallas ? `\n✘ ${fallas} FALLAS (${aciertos} OK)` : `\nTODAS LAS PRUEBAS OK (${aciertos})`);
process.exit(fallas ? 1 : 0);
