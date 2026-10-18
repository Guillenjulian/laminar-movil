// Pruebas del lector de G-code de la vista previa (src/motor/recorridos-lector.js, vía el worker).
// Corren en Node, sin navegador, con G-codes chicos armados a mano y valores esperados escritos a mano.
//
// Uso: npm run test:recorridos

import assert from 'node:assert/strict';
import { probarTramos } from './recorridos/tramos.mjs';
import { probarCapas } from './recorridos/capas.mjs';
import { probarLimites } from './recorridos/limites.mjs';
import { probarNiveles } from './recorridos/niveles.mjs';
import { probarAuto } from './recorridos/auto.mjs';
import { probarAviso } from './recorridos/aviso.mjs';

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

const ctx = { revisar, igual };
probarTramos(ctx);
probarCapas(ctx);
probarLimites(ctx);
probarNiveles(ctx);
probarAuto(ctx);
probarAviso(ctx);

console.log(fallas ? `\n✘ ${fallas} FALLAS (${aciertos} OK)` : `\nTODAS LAS PRUEBAS OK (${aciertos})`);
process.exit(fallas ? 1 : 0);
