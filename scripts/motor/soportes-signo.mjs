// Signo de `pos` en la cama local del widget (ADR 0004, T6). Cada widget recibe la cama como rectángulo en SU marco
// (`camaLocal` del worker: x0 = −bedWidth/2 − pos.x), y el soporte árbol no sale de él. Con el signo de `pos` invertido
// el límite del lado tapado se abre y el soporte se pasa de la cama. Lo llama scripts/probar-motor.mjs.

import { esSoporte, extrusionesDe, f, stlDeCajas } from './soportes-kiri.mjs';

const CAMA = 220; // Ender 3 V3 SE
const TAPA_Z = 20;

// Blinda el SIGNO de `pos` en la cama local de cada widget (`camaLocal` del worker: x0 = −bedWidth/2 − pos.x). Tapa de
// 148 mm con la copia a ±35,8 mm: sus bordes quedan a 0,2 mm del de la cama (0,2 a 148,2 y 71,8 a 219,8). Con el
// signo correcto el soporte árbol queda dentro de 0..220; con el signo invertido el límite del lado tapado se abre y
// el soporte se pasa (medido por el revisor: izquierda X −0,30, arriba Y 220,30, abajo Y −0,10).
const TAPA_148 = stlDeCajas([
    [-5, -5, 0, 5, 5, TAPA_Z],
    [-74, -74, TAPA_Z, 74, 74, TAPA_Z + 3],
]);
/**
 * @param {{ laminar: Function, revisar: Function }} ctx
 * @returns {Promise<void>}
 */
export async function probarSignoDePos({ laminar, revisar }) {
    console.log('\n▶ tapa de 148 mm a ±35,8 mm: el signo de `pos` en la cama local');
    for (const [dx, dy] of [
        [-35.8, -35.8],
        [35.8, 35.8],
        [-35.8, 35.8],
        [35.8, -35.8],
    ]) {
        const r = await laminar({
            piezas: [{ stlBase64: TAPA_148, posiciones: [{ x: dx, y: dy }] }],
            soportes: true,
            personal: { adhesion: 'nada' },
            extras: { sliceSupportTree: true },
        });
        const sop = extrusionesDe(r.gcode).filter(esSoporte);
        const xs = sop.flatMap(e => [e.x0, e.x]);
        const ys = sop.flatMap(e => [e.y0, e.y]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        console.log(`  · copia en (${dx}, ${dy}): soporte X ${f(x0, 2)} a ${f(x1, 2)}, Y ${f(y0, 2)} a ${f(y1, 2)}`);
        revisar(
            `copia en (${dx}, ${dy}): hay soporte árbol y todo cae dentro de la cama (0..220 en X e Y)`,
            sop.length > 0 && x0 >= 0 && x1 <= CAMA && y0 >= 0 && y1 <= CAMA,
        );
    }
}
