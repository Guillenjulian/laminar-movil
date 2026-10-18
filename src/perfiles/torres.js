// Configuración de las torres de calibración (temperatura y retracción): qué valor lleva cada bloque
// y cómo se traduce a Avanzado (bloque 0) + cambios por altura (bloques 1..N-1). Puro, sin DOM.
//
// Flujo: valoresSugeridos(tipo, impresora, material) -> el usuario ajusta -> armarTorre({ tipo, valores })
// -> configuracionDeTorre(torre) -> { avanzado, personal, soportes, cambios } para armarConfiguracion.
// El bloque 0 va por Avanzado para no tocar la capa 0; el resto son `cambios` (ver cambios.js).
// Ver ADR 0002, sección 6.

import { bloquesDeTorre } from '../motor/torres.js';
import { LIMITES } from './cambios.js';
import { buscarImpresora, esBowden, materiales, valoresDeAvanzado } from './perfiles.js';

/** @typedef {import('./cambios.js').Cambio} Cambio */
/** @typedef {{ tipo: 'temperatura'|'retraccion', altoBloqueMm: number,
 *              bloques: { desdeMm: number, hastaMm: number, valor: number }[] }} Torre */

const CAMPO = { temperatura: 'tempBoquilla', retraccion: 'retraccion' };
const BLOQUES_SUGERIDOS = 5;
const ALTO_SUGERIDO_MM = 10;
const TEMPERATURA_MINIMA = LIMITES.tempBoquilla[0];
const UNIDAD = { tempBoquilla: '°C', retraccion: 'mm' };
const PASO_RETRACCION_MM = 0.5;
const PASO_TEMPERATURA = 5;

function campoDe(tipo) {
    const campo = CAMPO[tipo];
    if (!campo) throw new Error('El tipo de torre tiene que ser "temperatura" o "retraccion".');
    return campo;
}

/** Escalera de temperaturas de arriba hacia abajo (la más caliente va en el bloque 0): nunca pasa de
 *  hotendMax; si `base + 10` lo supera baja toda la escalera (no se repiten valores).
 *  @param {number} base temperatura del material, en °C
 *  @param {number} hotendMax tope de la impresora, en °C (Infinity si no lo define)
 *  @returns {number[]} BLOQUES_SUGERIDOS temperaturas en °C, de a 5 °C
 *  @throws {Error} si hotendMax no alcanza para la escalera con el piso de 150 °C */
function escaleraDeTemperatura(base, hotendMax) {
    const piso = TEMPERATURA_MINIMA + (BLOQUES_SUGERIDOS - 1) * PASO_TEMPERATURA;
    if (hotendMax < piso) throw new Error('La impresora no llega a la temperatura mínima de la torre.');
    const arriba = Math.max(Math.min(base + 2 * PASO_TEMPERATURA, hotendMax), piso);
    return Array.from({ length: BLOQUES_SUGERIDOS }, (_, i) => arriba - i * PASO_TEMPERATURA);
}

// Retracción en mm: la del material si la define (TPU: 0,5..2,5 de a 0,5); si no, 0,5..4,5 (directa)
// o 2..6 (Bowden).
function escaleraDeRetraccion(propia, bowden) {
    const n = BLOQUES_SUGERIDOS;
    if (propia !== undefined) return Array.from({ length: n }, (_, i) => propia + i * PASO_RETRACCION_MM);
    return Array.from({ length: n }, (_, i) => (bowden ? 2 + i : 0.5 + i));
}

/** Valores de partida según material e impresora. Temperatura: [t+10, t+5, t, t-5, t-10] °C (el más
 *  caliente abajo; ver escaleraDeTemperatura). Retracción en mm: la del material si la define (TPU:
 *  0,5..2,5 de a 0,5; en Bowden, la misma escalera con un `aviso`); si no, 0,5..4,5 de a 1 (directa) o
 *  2..6 (Bowden: retracción base > 2 mm).
 *  @param {'temperatura'|'retraccion'} tipo
 *  @param {{ impresoraId: string, material: string }} contexto
 *  @returns {{ bloques: number, altoBloqueMm: number, valores: number[], aviso?: string }}
 *  @throws {Error} si el tipo es desconocido o la impresora no llega a la temperatura mínima */
export function valoresSugeridos(tipo, { impresoraId, material }) {
    campoDe(tipo);
    const av = valoresDeAvanzado(impresoraId, 'normal', material);
    const { hotendMax = Infinity } = buscarImpresora(impresoraId).limites || {};
    const bowden = esBowden(av.retraccion);
    const mat = materiales[material] || materiales.pla;
    const base = { bloques: BLOQUES_SUGERIDOS, altoBloqueMm: ALTO_SUGERIDO_MM };
    if (tipo === 'temperatura') return { ...base, valores: escaleraDeTemperatura(av.tempBoquilla, hotendMax) };
    const propia = mat.proceso.outputRetractDist;
    const aviso = propia !== undefined && bowden ? mat.avisoBowden : undefined;
    return { ...base, valores: escaleraDeRetraccion(propia, bowden), ...(aviso && { aviso }) };
}

// Un valor por bloque, dentro de los límites de los cambios por altura (y de hotendMax en temperatura).
function revisarValores(campo, valores, hotendMax) {
    const [min, max, nombre] = LIMITES[campo];
    const u = UNIDAD[campo];
    valores.forEach((v, i) => {
        const n = `Bloque ${i + 1}: `;
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${n}el valor de ${nombre} no es un número.`);
        if (v < min || v > max) throw new Error(`${n}la ${nombre} tiene que estar entre ${min} y ${max} ${u}.`);
        if (campo === 'tempBoquilla' && v > hotendMax) {
            throw new Error(`${n}${v} ${u} es más de lo que aguanta la impresora (${hotendMax} ${u}).`);
        }
    });
}

/** Arma y valida la torre. Lanza Error (castellano, "Bloque N: …") si hay menos de 3 o más de 8 valores,
 *  el alto del bloque no es válido o algún valor está fuera de rango (los límites de los cambios por
 *  altura) o por encima de `hotendMax` (opcional, °C; sólo cuenta en la torre de temperatura).
 *  @param {{ tipo: string, valores: number[], altoBloqueMm?: number, hotendMax?: number }} op
 *  @returns {Torre} */
export function armarTorre({ tipo, valores, altoBloqueMm = ALTO_SUGERIDO_MM, hotendMax = Infinity }) {
    const campo = campoDe(tipo);
    if (!Array.isArray(valores)) throw new Error('Faltan los valores de la torre.');
    const bloques = bloquesDeTorre({ bloques: valores.length, altoBloqueMm });
    revisarValores(campo, valores, hotendMax);
    return { tipo, altoBloqueMm, bloques: bloques.map((b, i) => ({ ...b, valor: valores[i] })) };
}

/** Lo que la torre le impone a la configuración. El bloque 0 va por la vía normal (Avanzado) para no
 *  tocar la capa 0; los bloques 1..N-1 son `cambios` (sección 4 del ADR).
 *  @param {Torre} torre
 *  @returns {{ avanzado: object, personal: object, soportes: false, cambios: Cambio[] }} */
export function configuracionDeTorre(torre) {
    const campo = campoDe(torre.tipo);
    const [primero, ...resto] = torre.bloques;
    return {
        avanzado: { [campo]: primero.valor, alturaVariable: false, jarron: false, costura: 'ultima' },
        // patron fijo: uno elegido por el usuario (p. ej. jarrón) podría dejar la torre sin relleno
        personal: { paredes: 2, densidad: 0.1, patron: 'linear' },
        soportes: false,
        cambios: resto.map(b => ({ desdeMm: b.desdeMm, hastaMm: b.hastaMm, [campo]: b.valor })),
    };
}
