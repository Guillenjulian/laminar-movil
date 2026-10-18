// Soportes tipo árbol (ADR 0004): algoritmo propio y simplificado, puro (sin Kiri, sin DOM).
//
// Troncos verticales con deriva lateral limitada que nacen en puntas chicas bajo los voladizos, esquivan la pieza,
// se funden cuando se tocan y engordan al bajar. Todo es 2D por capa, de arriba hacia abajo; sólo se guarda la capa
// actual (los "nodos" activos). Cada nodo sale como un círculo de 8 lados.
//
//   planificarArbol(capas, opciones) -> Poligono[][]   un array de polígonos de soporte por capa
//
// Invariantes de la salida: ningún par de círculos de una misma capa se pisa (por eso no hace falta unir
// polígonos), ningún centro cae dentro de la pieza, ningún círculo toca un bloqueo ni sale de la cama, y la salida
// tiene un elemento por capa.

import { circulo, distanciaAPoligono, puntoEnPoligono, areaPoligono } from './geometria-2d.js';

/** @typedef {import('./geometria-2d.js').Punto} Punto */
/** @typedef {import('./geometria-2d.js').Poligono} Poligono */

const LADOS = 8;
const FACTOR_VECINO = 6; // un nodo se acerca a otro que esté a menos de FACTOR_VECINO × radio
const CRECIMIENTO = 0.25; // mm de radio que gana un tronco por cada mm que baja
const MAX_REINTENTOS = 3; // veces que se duplica la separación si se pasa de maxNodos
const SALTO_INYECTADA = 3; // una última capa más de tantas alturas por encima de la anterior no es una capa real
const DIRECCIONES = [0, 1, 2, 3, 4, 5, 6, 7].map(k => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

/**
 * @typedef {object} CapaArbol
 * @property {number} z  altura del corte (mm, marco local de la pieza)
 * @property {Poligono[]} voladizos  zonas de la capa que necesitan apoyo
 * @property {Poligono[]} cuerpo  la pieza en esa capa, para esquivarla
 */

/**
 * @typedef {object} OpcionesArbol
 * @property {number} ancho  ancho de línea (mm)
 * @property {number} altoCapa  mm
 * @property {number} angulo  ángulo de voladizo de Kiri (grados): limita la deriva por capa
 * @property {number} [separacion=3]  mm entre puntas
 * @property {number} [radioPunta]  mm; por defecto `1,2 × ancho`
 * @property {number} [radioMax=2.5]  mm
 * @property {number} [maxNodos=150]  tope de nodos activos
 * @property {object[]} [bloqueos=[]]  esferas `{centro:{x,y,z}, radio}` sin soporte
 * @property {{x0:number, y0:number, x1:number, y1:number}} [cama]  si se da, ningún círculo sale de este rectángulo
 *   (extensión opcional del contrato; sin ella no se controla la cama)
 */

// Completa los valores por defecto y calcula la deriva máxima por capa: altoCapa × tan(ángulo), con el ángulo
// acotado para que la tangente no explote.
function normalizar(op) {
    const radioPunta = op.radioPunta ?? 1.2 * op.ancho;
    const angulo = Math.min(Math.max(op.angulo ?? 0, 0), 80);
    return {
        radioPunta,
        radioMax: Math.max(op.radioMax ?? 2.5, radioPunta),
        maxNodos: op.maxNodos ?? 150,
        separacion: op.separacion ?? 3,
        bloqueos: op.bloqueos ?? [],
        cama: op.cama,
        deriva: op.altoCapa * Math.tan((angulo * Math.PI) / 180),
        crece: CRECIMIENTO * op.altoCapa,
    };
}

// ¿El círculo (x, y, r) a la altura z toca la sección de alguna esfera bloqueada? La sección de una esfera de radio
// R a distancia dz de su centro es un círculo de radio √(R² − dz²).
function tocaBloqueo(bloqueos, x, y, z, r) {
    for (const b of bloqueos) {
        const dz = z - b.centro.z;
        if (Math.abs(dz) >= b.radio) continue;
        if (Math.hypot(x - b.centro.x, y - b.centro.y) < Math.sqrt(b.radio * b.radio - dz * dz) + r) return true;
    }
    return false;
}

// Condiciones duras de un círculo: adentro de la cama y fuera de los bloqueos. Devuelve la holgura al cuerpo
// (distancia del centro a la pieza; negativa = adentro, no sirve) o -Infinity si no cumple.
function holgura(ctx, x, y, r) {
    const { op, capa } = ctx;
    const c = op.cama;
    if (c && (x - r < c.x0 || x + r > c.x1 || y - r < c.y0 || y + r > c.y1)) return -Infinity;
    if (tocaBloqueo(op.bloqueos, x, y, capa.z, r)) return -Infinity;
    return distanciaAPoligono({ x, y }, capa.cuerpo);
}

// Prueba los candidatos en orden y se queda con el primero cuyo círculo no toca la pieza (holgura ≥ r); si ninguno
// llega, con el primero cuyo centro al menos queda afuera. Sin candidato válido devuelve null (el tronco termina).
function elegir(ctx, candidatos, r) {
    let aceptable = null;
    for (const [x, y] of candidatos) {
        const h = holgura(ctx, x, y, r);
        if (h >= r) return { x, y };
        if (h >= 0 && !aceptable) aceptable = { x, y };
    }
    return aceptable;
}

// Vecino más cercano a menos de FACTOR_VECINO × radio, o null.
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

// Candidatos de movimiento de un nodo, en orden de preferencia: hacia el vecino, recto, y las 8 direcciones.
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

// Baja todos los nodos una capa: cada uno se mueve como mucho `deriva`, y crece. Los que no tienen dónde
// apoyarse (la pieza o la cama lo cierran) terminan. `ox, oy` guarda de dónde vino, para acotar la fusión.
function bajar(nodos, ctx) {
    const { op } = ctx;
    const bajados = [];
    for (const n of nodos) {
        const r = Math.min(op.radioMax, n.r + op.crece);
        const p = elegir(ctx, candidatos(n, nodos, op.deriva), r);
        if (p) bajados.push({ x: p.x, y: p.y, r, ox: n.x, oy: n.y });
    }
    return bajados;
}

// Fusiona `b` en `a`: posición ponderada por área (r²), radio √(r1² + r2²) con tope. Para que la deriva por capa
// siga acotada, la posición se limita al disco de deriva alrededor de donde estaba el nodo mayor un piso más
// arriba; si el resultado no es válido, el mayor se queda donde está.
function fusionar2(a, b, ctx) {
    const mayor = a.r >= b.r ? a : b;
    const wa = a.r * a.r;
    const wb = b.r * b.r;
    let x = (a.x * wa + b.x * wb) / (wa + wb);
    let y = (a.y * wa + b.y * wb) / (wa + wb);
    const r = Math.min(ctx.op.radioMax, Math.sqrt(wa + wb));
    const d = Math.hypot(x - mayor.ox, y - mayor.oy);
    if (d > ctx.op.deriva) {
        x = mayor.ox + ((x - mayor.ox) * ctx.op.deriva) / d;
        y = mayor.oy + ((y - mayor.oy) * ctx.op.deriva) / d;
    }
    if (holgura(ctx, x, y, r) < 0) ({ x, y } = mayor);
    return { x, y, r, ox: mayor.ox, oy: mayor.oy };
}

// Fusiona pares que se pisan (distancia de centros < r1 + r2) hasta que no quede ninguno. Cada fusión saca un nodo,
// así que termina; O(n²) por pasada con n ≤ maxNodos.
function fusionarTodo(nodos, ctx) {
    let hubo = true;
    while (hubo) {
        hubo = false;
        for (let i = 0; i < nodos.length && !hubo; i++) {
            for (let j = i + 1; j < nodos.length && !hubo; j++) {
                const a = nodos[i];
                const b = nodos[j];
                if (Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r) continue;
                nodos[i] = fusionar2(a, b, ctx);
                nodos.splice(j, 1);
                hubo = true;
            }
        }
    }
}

// ¿El punto está cubierto por un nodo, o la punta nueva se pisaría con uno?
function pisaNodo(nodos, x, y, rp) {
    return nodos.some(n => Math.hypot(n.x - x, n.y - y) < n.r + rp);
}

// Centroide por área del polígono (si el área es 0, el promedio de los vértices).
function centroide(poli) {
    const area = areaPoligono(poli);
    if (area === 0)
        return [poli.reduce((s, p) => s + p.x, 0) / poli.length, poli.reduce((s, p) => s + p.y, 0) / poli.length];
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
        const w = poli[j].x * poli[i].y - poli[i].x * poli[j].y;
        cx += (poli[j].x + poli[i].x) * w;
        cy += (poli[j].y + poli[i].y) * w;
    }
    return [cx / (6 * area), cy / (6 * area)];
}

// Puntos de la grilla de `sep` mm (anclada en múltiplos de `sep`, así no depende del polígono) que caen dentro de
// los voladizos. Si algún polígono quedó sin ningún punto de la grilla, se agrega su centroide (si cae adentro).
function puntosDeSiembra(voladizos, sep) {
    const puntos = [];
    for (const poli of voladizos) {
        const xs = poli.map(p => p.x);
        const ys = poli.map(p => p.y);
        const xMax = Math.max(...xs);
        const yMax = Math.max(...ys);
        let hay = false;
        for (let x = Math.ceil(Math.min(...xs) / sep) * sep; x <= xMax; x += sep) {
            for (let y = Math.ceil(Math.min(...ys) / sep) * sep; y <= yMax; y += sep) {
                if (!puntoEnPoligono({ x, y }, poli) || distanciaAPoligono({ x, y }, voladizos) >= 0) continue;
                puntos.push([x, y]);
                hay = true;
            }
        }
        const c = hay ? null : centroide(poli);
        if (c && distanciaAPoligono({ x: c[0], y: c[1] }, voladizos) < 0) puntos.push(c);
    }
    return puntos;
}

// Siembra puntas nuevas en los voladizos de la capa. Devuelve false si se pasa de `maxNodos` y todavía quedan
// reintentos; en el último intento simplemente deja de sembrar.
function sembrar(nodos, ctx, sep, ultimo) {
    const { op, capa } = ctx;
    for (const [x, y] of puntosDeSiembra(capa.voladizos, sep)) {
        const rp = op.radioPunta;
        if (holgura(ctx, x, y, rp) < 0 || pisaNodo(nodos, x, y, rp)) continue;
        if (nodos.length >= op.maxNodos) {
            if (!ultimo) return false;
            break;
        }
        nodos.push({ x, y, r: rp, ox: x, oy: y });
    }
    return true;
}

// Una pasada completa de arriba hacia abajo con una separación dada. null = se pasó de maxNodos.
function pasada(capas, ultima, op, sep, ultimo) {
    const salida = capas.map(() => []);
    let nodos = [];
    for (let i = ultima; i >= 0; i--) {
        const ctx = { op, capa: capas[i] };
        nodos = bajar(nodos, ctx);
        fusionarTodo(nodos, ctx);
        if (!sembrar(nodos, ctx, sep, ultimo)) return null;
        salida[i] = nodos.map(n => circulo(n, n.r, LADOS));
    }
    return salida;
}

// Kiri le pasa a `arbol` una capa vacía de más arriba de todo cuya `z` es un índice y no mm (hecho del spike T0).
// Se la reconoce por z no finita o por un salto de más de SALTO_INYECTADA alturas respecto de la capa anterior.
function esInyectada(capas, i, altoCapa) {
    const z = capas[i].z;
    if (!Number.isFinite(z)) return true;
    return i > 0 && i === capas.length - 1 && z - capas[i - 1].z > SALTO_INYECTADA * altoCapa;
}

/**
 * Planifica los troncos de un soporte árbol, capa por capa, de arriba hacia abajo. Pura y determinista.
 * Una capa final inyectada (z no es una altura en mm) se ignora y su salida queda vacía.
 * @param {CapaArbol[]} capas  ordenadas de abajo hacia arriba (índice 0 = primera capa)
 * @param {OpcionesArbol} opciones
 * @returns {Poligono[][]}  `salida[i]` = polígonos de soporte de `capas[i]` (vacío si no hay)
 */
export function planificarArbol(capas, opciones) {
    const op = normalizar(opciones);
    let ultima = capas.length - 1;
    while (ultima >= 0 && esInyectada(capas, ultima, opciones.altoCapa)) ultima--;
    for (let intento = 0; intento <= MAX_REINTENTOS; intento++) {
        // Cada reintento duplica la separación: menos puntas, menos nodos.
        const salida = pasada(capas, ultima, op, op.separacion * 2 ** intento, intento === MAX_REINTENTOS);
        if (salida) return salida;
    }
    return capas.map(() => []); // inalcanzable: el último intento nunca devuelve null
}
