// Acomodo de las piezas en la cama (ADR 0003, secciones 2 y 6): huella de cada copia -> posiciones.
//
// Responsabilidad: calcular la huella (x, y) de cada pieza ya transformada, repetirla `copias` veces, pedirle
// el acomodo a `motor/piezas.acomodar` con la cama de la impresora elegida y guardar el resultado en
// `p.posiciones` y `estado.entra`. Sin DOM: lo llaman el paso 3 (antes de laminar) y, más adelante, la UI del visor.

import { SEPARACION_PIEZAS_MM } from '../config.js';
import { acomodar } from '../motor/piezas.js';
import { medir } from '../motor/transformar.js';
import { buscarImpresora } from '../perfiles/perfiles.js';
import { estado, matrizPieza } from './estado.js';

/**
 * Tamaño (x, y, z) de la caja de la pieza ya transformada, a partir de las 8 esquinas de `vista.tamano`.
 * Con giros de 90° es exacto; con otros ángulos es la caja que abarca a la pieza (conservadora).
 * Es la medida conservadora que usa `acomodarPiezas` cuando no le pasan `medir`.
 * @param {import('./estado.js').Pieza} p
 * @returns {{x:number, y:number, z:number}}
 */
function tamanoTransformado(p) {
    const { x, y, z } = p.vista.tamano;
    const esquinas = [];
    for (const i of [-x / 2, x / 2]) {
        for (const j of [-y / 2, y / 2]) {
            for (const k of [-z / 2, z / 2]) esquinas.push(i, j, k);
        }
    }
    return medir(matrizPieza(p), esquinas);
}

/**
 * Acomoda todas las copias de todas las piezas en la cama de la impresora elegida. Escribe `p.posiciones`
 * (una por copia, centro en mm relativo al centro de la cama) y `estado.entra`. Una copia más alta que la
 * impresora cuenta como `fuera`. Sin piezas: `entra` es true y `fuera` está vacío.
 * @param {(p: import('./estado.js').Pieza) => ({x:number, y:number, z:number}|null|undefined)} [medir] tamaño
 *   real de la pieza ya transformada (ej. `p => visor.tamanoModelo(p.id)`). Si no viene, o devuelve algo falso,
 *   se usa `p.tamano` (la medida real que guardan el ajuste y "agregar pieza" desde el visor) y, si tampoco
 *   está, la caja de las 8 esquinas de `vista.tamano` (conservadora: con giros que no son de 90° puede ser
 *   más grande que la malla real).
 * @returns {{entra: boolean, fuera: number[]}} `fuera`: índices de copia global (piezas en orden, copias seguidas)
 */
export function acomodarPiezas(medir) {
    const d = buscarImpresora(estado.impresoraId).dispositivo;
    const huellas = [];
    const altas = [];
    for (const p of estado.piezas) {
        const t = medir?.(p) || p.tamano || tamanoTransformado(p);
        for (let c = 0; c < p.copias; c++) {
            altas.push(t.z > d.maxHeight);
            huellas.push({ x: t.x, y: t.y });
        }
    }
    const r = huellas.length
        ? acomodar(huellas, { x: d.bedWidth, y: d.bedDepth }, SEPARACION_PIEZAS_MM)
        : { posiciones: [], fuera: [] };
    let i = 0;
    for (const p of estado.piezas) {
        p.posiciones = r.posiciones.slice(i, i + p.copias);
        i += p.copias;
    }
    const fuera = [...new Set([...r.fuera, ...altas.flatMap((a, k) => (a ? [k] : []))])].sort((a, b) => a - b);
    estado.entra = fuera.length === 0;
    return { entra: estado.entra, fuera };
}
