// Configuración de las torres de calibración (temperatura y retracción): qué valor lleva cada bloque
// y cómo se traduce a Avanzado (bloque 0) + cambios por altura (bloques 1..N-1). Puro, sin DOM.
//
// Flujo: valoresSugeridos(tipo, impresora, material) -> el usuario ajusta -> armarTorre({ tipo, valores })
// -> configuracionDeTorre(torre) -> { avanzado, personal, soportes, cambios } para armarConfiguracion.
// El bloque 0 va por Avanzado para no tocar la capa 0; el resto son `cambios` (ver cambios.js).
// Ver ADR 0002, sección 6.

import { bloquesDeTorre } from '../motor/torres.js';
import { validarCambios } from './cambios.js';
import { buscarImpresora, valoresDeAvanzado } from './perfiles.js';

/** @typedef {{ desdeMm: number, hastaMm?: number, tempBoquilla?: number, retraccion?: number }} Cambio */
/** @typedef {{ tipo: 'temperatura'|'retraccion', altoBloqueMm: number,
 *              bloques: { desdeMm: number, hastaMm: number, valor: number }[] }} Torre */

const CAMPO = { temperatura: 'tempBoquilla', retraccion: 'retraccion' };
const BLOQUES_SUGERIDOS = 5;
const ALTO_SUGERIDO_MM = 10;
const TEMPERATURA_MINIMA = 150;
const PASO_TEMPERATURA = 5;

function campoDe(tipo) {
    const campo = CAMPO[tipo];
    if (!campo) throw new Error('El tipo de torre tiene que ser "temperatura" o "retraccion".');
    return campo;
}

// De arriba hacia abajo: nunca pasa de hotendMax (se baja toda la escalera, no se repiten valores).
function escaleraDeTemperatura(base, hotendMax) {
    const piso = TEMPERATURA_MINIMA + (BLOQUES_SUGERIDOS - 1) * PASO_TEMPERATURA;
    const arriba = Math.max(Math.min(base + 2 * PASO_TEMPERATURA, hotendMax), piso);
    return Array.from({ length: BLOQUES_SUGERIDOS }, (_, i) => arriba - i * PASO_TEMPERATURA);
}

/** Valores de partida según material e impresora. Temperatura: [t+10, t+5, t, t-5, t-10] (el más caliente
 *  abajo; si t+10 pasa de `limites.hotendMax` toda la escalera baja, y nunca baja de 150). Retracción:
 *  0,5..4,5 mm de a 1 (directa) o 2..6 mm (Bowden: retracción base > 2 mm).
 *  @param {'temperatura'|'retraccion'} tipo
 *  @param {{ impresoraId: string, material: string }} contexto
 *  @returns {{ bloques: number, altoBloqueMm: number, valores: number[] }} */
export function valoresSugeridos(tipo, { impresoraId, material }) {
    campoDe(tipo);
    const av = valoresDeAvanzado(impresoraId, 'normal', material);
    const { hotendMax = Infinity } = buscarImpresora(impresoraId).limites || {};
    const bowden = av.retraccion > 2;
    const valores =
        tipo === 'temperatura'
            ? escaleraDeTemperatura(av.tempBoquilla, hotendMax)
            : Array.from({ length: BLOQUES_SUGERIDOS }, (_, i) => (bowden ? 2 + i : 0.5 + i));
    return { bloques: valores.length, altoBloqueMm: ALTO_SUGERIDO_MM, valores };
}

/** Arma y valida la torre. Lanza Error (castellano) si hay menos de 3 o más de 8 valores, el alto del
 *  bloque no es válido o algún valor está fuera de rango (los mismos límites que los cambios por altura).
 *  @param {{ tipo: string, valores: number[], altoBloqueMm?: number }} op
 *  @returns {Torre} */
export function armarTorre({ tipo, valores, altoBloqueMm = ALTO_SUGERIDO_MM }) {
    const campo = campoDe(tipo);
    if (!Array.isArray(valores)) throw new Error('Faltan los valores de la torre.');
    const bloques = bloquesDeTorre({ bloques: valores.length, altoBloqueMm });
    const { errores } = validarCambios(valores.map((v, i) => ({ desdeMm: i + 1, [campo]: v })));
    if (errores.length) throw new Error(errores.join(' '));
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
        personal: { paredes: 2, densidad: 0.1 },
        soportes: false,
        cambios: resto.map(b => ({ desdeMm: b.desdeMm, hastaMm: b.hastaMm, [campo]: b.valor })),
    };
}
