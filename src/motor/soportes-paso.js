// Un paso de los soportes árbol (ADR 0004, T1): cómo se mueve, se esquiva y se fusiona cada nodo al bajar una capa.
// Funciones puras; las usa `soportes-arbol.js` (que orquesta) y `soportes-siembra.js`. No importa a ninguno de los dos.
//
//   holgura       ¿vale este círculo? (cama, bloqueos, distancia a la pieza)
//   bajar         mueve los nodos una capa hacia abajo
//   fusionarTodo  fusiona los nodos que se pisan
//
// Un nodo es `{x, y, r, ox, oy}` (centro y radio en mm; `ox, oy` es de dónde vino una capa más arriba) más los
// campos de la poda (ver `soportes-poda.js`). El contexto `ctx` es `{op, capa, deriva, crece}`.

import { distanciaAPoligono } from './geometria-2d.js';

/** @typedef {import('./soportes-arbol.js').Bloqueo} Bloqueo */

/** Lados del polígono de cada tronco. Las direcciones de deriva son las mismas que sus vértices. */
export const LADOS = 8;
/** Direcciones (vectores unitarios) que prueba un tronco para esquivar la pieza: una por vértice del octágono. */
const DIRECCIONES = Array.from({ length: LADOS }, (_, k) => [
    Math.cos((2 * Math.PI * k) / LADOS),
    Math.sin((2 * Math.PI * k) / LADOS),
]);
const FACTOR_VECINO = 6; // un nodo se acerca a otro que esté a menos de FACTOR_VECINO × radio

/**
 * ¿El círculo (x, y, r) a la altura z toca la sección de alguna esfera bloqueada? La sección de una esfera de
 * radio R a distancia dz de su centro es un círculo de radio √(R² − dz²).
 * @param {Bloqueo[]} bloqueos
 * @returns {boolean}
 */
function tocaBloqueo(bloqueos, x, y, z, r) {
    for (const b of bloqueos) {
        const dz = z - b.centro.z;
        if (Math.abs(dz) >= b.radio) continue;
        if (Math.hypot(x - b.centro.x, y - b.centro.y) < Math.sqrt(b.radio * b.radio - dz * dz) + r) return true;
    }
    return false;
}

/**
 * Condiciones duras de un círculo: adentro de la cama y fuera de los bloqueos. Devuelve la holgura al cuerpo
 * (distancia del centro a la pieza; negativa = adentro, no sirve) o -Infinity si no cumple.
 * @returns {number}
 */
export function holgura(ctx, x, y, r) {
    const { op, capa } = ctx;
    const c = op.cama;
    if (c && (x - r < c.x0 || x + r > c.x1 || y - r < c.y0 || y + r > c.y1)) return -Infinity;
    if (tocaBloqueo(op.bloqueos, x, y, capa.z, r)) return -Infinity;
    return distanciaAPoligono({ x, y }, capa.cuerpo);
}

/**
 * Prueba los candidatos en orden y se queda con el primero cuyo círculo no toca la pieza (holgura ≥ r); si ninguno
 * llega, con el primero cuyo centro al menos queda afuera. Sin candidato válido devuelve null (el tronco termina).
 * @returns {{x:number, y:number}|null}
 */
function elegir(ctx, candidatos, r) {
    let aceptable = null;
    for (const [x, y] of candidatos) {
        const h = holgura(ctx, x, y, r);
        if (h >= r) return { x, y };
        if (h >= 0 && !aceptable) aceptable = { x, y };
    }
    return aceptable;
}

/** Vecino más cercano a menos de FACTOR_VECINO × radio, o null. */
function vecinoCercano(n, nodos) {
    let mejor = null;
    let mejorD = FACTOR_VECINO * n.r;
    for (const otro of nodos) {
        const d = Math.hypot(otro.x - n.x, otro.y - n.y);
        if (otro !== n && d > 0 && d < mejorD) {
            mejorD = d;
            mejor = otro;
        }
    }
    return mejor && { nodo: mejor, d: mejorD };
}

/** Candidatos de movimiento de un nodo, en orden de preferencia: hacia el vecino, recto y las DIRECCIONES. */
function candidatos(n, nodos, deriva) {
    const lista = [];
    const v = vecinoCercano(n, nodos);
    if (v) {
        const paso = Math.min(deriva, v.d) / v.d;
        lista.push([n.x + (v.nodo.x - n.x) * paso, n.y + (v.nodo.y - n.y) * paso]);
    }
    lista.push([n.x, n.y]);
    for (const [dx, dy] of DIRECCIONES) lista.push([n.x + dx * deriva, n.y + dy * deriva]);
    return lista;
}

/**
 * Baja todos los nodos una capa: cada uno se mueve como mucho `ctx.deriva`, y crece. Los que no tienen dónde ir
 * terminan: 'pieza' si quedan apoyados en la pieza, 'colgado' si los frena un bloqueo o la cama (la poda los saca).
 * `ox, oy` guarda de dónde vino, para acotar la fusión.
 */
export function bajar(nodos, ctx) {
    const { op } = ctx;
    const bajados = [];
    for (const n of nodos) {
        const r = Math.min(op.radioMax, n.r + ctx.crece);
        const p = elegir(ctx, candidatos(n, nodos, ctx.deriva), r);
        if (p) {
            n.hijo = { x: p.x, y: p.y, r, ox: n.x, oy: n.y };
            bajados.push(n.hijo);
        } else {
            n.fin = distanciaAPoligono({ x: n.x, y: n.y }, ctx.capa.cuerpo) < 0 ? 'pieza' : 'colgado';
        }
    }
    return bajados;
}

/**
 * Fusiona dos nodos: posición ponderada por área (r²), radio √(r1² + r2²) con tope. Para que la deriva por capa
 * siga acotada, la posición se limita al disco de deriva alrededor de donde estaba el nodo mayor una capa más
 * arriba; si el resultado no es válido, el mayor se queda donde está.
 */
function fusionar2(a, b, ctx) {
    const mayor = a.r >= b.r ? a : b;
    const wa = a.r * a.r;
    const wb = b.r * b.r;
    let x = (a.x * wa + b.x * wb) / (wa + wb);
    let y = (a.y * wa + b.y * wb) / (wa + wb);
    const r = Math.min(ctx.op.radioMax, Math.sqrt(wa + wb));
    const d = Math.hypot(x - mayor.ox, y - mayor.oy);
    if (d > ctx.deriva) {
        x = mayor.ox + ((x - mayor.ox) * ctx.deriva) / d;
        y = mayor.oy + ((y - mayor.oy) * ctx.deriva) / d;
    }
    if (holgura(ctx, x, y, r) < 0) ({ x, y } = mayor);
    return { x, y, r, ox: mayor.ox, oy: mayor.oy };
}

/**
 * Fusiona pares que se pisan (distancia de centros < r1 + r2) hasta que no quede ninguno. Cada fusión saca un
 * nodo, así que termina; O(n²) por pasada con n ≤ maxNodos. Los dos nodos viejos apuntan al nuevo (`destino`).
 */
export function fusionarTodo(nodos, ctx) {
    let hubo = true;
    while (hubo) {
        hubo = false;
        for (let i = 0; i < nodos.length && !hubo; i++) {
            for (let j = i + 1; j < nodos.length && !hubo; j++) {
                const a = nodos[i];
                const b = nodos[j];
                if (Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r) continue;
                nodos[i] = fusionar2(a, b, ctx);
                a.destino = nodos[i];
                b.destino = nodos[i];
                nodos.splice(j, 1);
                hubo = true;
            }
        }
    }
}
