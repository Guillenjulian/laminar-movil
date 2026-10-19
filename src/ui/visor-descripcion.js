// Texto que describe lo que se ve en el visor del paso 1 (ADR 0008, A4). Puro: sin DOM ni `estado`.

import { milimetros } from './formato.js';

/**
 * @typedef {object} DatosVisor
 * @property {{ nombre: string, tamano: {x:number, y:number, z:number}|null, copias: number }[]} piezas
 * @property {boolean} entra  false si alguna copia no entra en la cama
 */

/** Una pieza: nombre y, entre paréntesis, la medida (o que falta) y las copias si hay más de una. */
function textoPieza({ nombre, tamano, copias }) {
    const detalles = [tamano ? milimetros(tamano) : 'todavía sin medida'];
    if (copias > 1) detalles.push(`${copias} copias`);
    return `${nombre} (${detalles.join(', ')})`;
}

/**
 * Texto que describe lo que se ve en el visor: cada pieza con su medida y copias, y si entran. Sin piezas dice que
 * la cama está vacía (el nodo de descripción nunca queda sin texto).
 * @param {DatosVisor} datos
 * @returns {string}
 */
export function textoDescripcionVisor(datos) {
    const { piezas, entra } = datos;
    if (!piezas.length) return 'La cama está vacía.';
    const lista = piezas.map(textoPieza).join('; ');
    const cuantas = piezas.length === 1 ? '1 pieza' : `${piezas.length} piezas`;
    const sola = piezas.length === 1 && piezas[0].copias === 1; // una sola cosa en la cama: singular
    const noEntra = sola ? ' No entra en la cama.' : ' No entran todas en la cama.';
    return `Vista 3D de la cama con ${cuantas}: ${lista}.${entra ? '' : noEntra}`;
}
