// Pruebas de los textos (ADR 0008, I2): el núcleo `t` y los diccionarios es/en. Corren en Node, sin navegador.
// Recorre scripts/textos/*.mjs; cada archivo exporta por defecto `async function ({ revisar, igual })`.
// Los archivos sin export default (detectores, autopruebas) son ayudas compartidas y se saltean.
// Si todavía no existe src/textos/, cada chequeo informa "✘ falta src/textos/…" sin romper el orquestador.
//
// Uso: npm run test:textos

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
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

const carpeta = fileURLToPath(new URL('./textos/', import.meta.url));
const archivos = readdirSync(carpeta)
    .filter(f => f.endsWith('.mjs'))
    .sort();
for (const archivo of archivos) {
    const modulo = await import(pathToFileURL(carpeta + archivo).href);
    // Los helpers compartidos (sin export default) no son pruebas: se saltean.
    if (typeof modulo.default !== 'function') continue;
    console.log(`\n== ${archivo}`);
    await modulo.default({ revisar, igual });
}

console.log(fallas ? `\n✘ ${fallas} FALLAS (${aciertos} OK)` : `\nTODAS LAS PRUEBAS OK (${aciertos})`);
process.exit(fallas ? 1 : 0);
