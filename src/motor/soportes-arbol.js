// Soportes tipo árbol (ADR 0004): algoritmo propio y simplificado, puro (sin Kiri, sin DOM).
//
// Troncos verticales con deriva lateral limitada que nacen en puntas chicas bajo los voladizos, esquivan la pieza,
// se funden cuando se tocan y engordan al bajar. Todo es 2D por capa, de arriba hacia abajo; sólo se guarda la capa
// actual (los "nodos" activos) más un registro liviano para la poda. Cada nodo sale como un círculo de LADOS lados.
// Este módulo orquesta; el paso, la siembra y la poda están en `soportes-paso.js`, `-siembra.js` y `-poda.js`.
//
//   planificarArbol(capas, opciones) -> Poligono[][]   un array de polígonos de soporte por capa
//
// Invariantes de la salida: ningún par de círculos de una misma capa se pisa (por eso no hace falta unir
// polígonos), ningún centro cae dentro de la pieza, ningún círculo toca un bloqueo ni sale de la cama, todo círculo
// tiene debajo la cama, la pieza u otro círculo (la poda saca los troncos colgados) y la salida tiene un elemento
// por capa.

import { circulo } from './geometria-2d.js';
import { LADOS, bajar, fusionarTodo } from './soportes-paso.js';
import { sembrar } from './soportes-siembra.js';
import { marcarViables } from './soportes-poda.js';

/** @typedef {import('./geometria-2d.js').Punto} Punto */
/** @typedef {import('./geometria-2d.js').Poligono} Poligono */

/**
 * Zona sin soporte (ADR 0004, sección Contratos > Tipos): sólo esfera en la v1.
 * @typedef {object} Bloqueo
 * @property {number} id
 * @property {'esfera'} forma
 * @property {{x:number, y:number, z:number}} centro  mm, marco de la pieza
 * @property {number} radio  mm
 */

/** Radio mínimo en anchos de línea: el octágono mide 2·r·cos(π/LADOS) entre lados y tiene que dar ≥ 2 anchos. */
const RADIO_MIN_FACTOR = 1 / Math.cos(Math.PI / LADOS);
const CRECIMIENTO = 0.25; // mm de radio que gana un tronco por cada mm que baja
const MAX_REINTENTOS = 3; // veces que se duplica la separación si se pasa de maxNodos
const SALTO_INYECTADA = 3; // una última capa a más de tantas alturas máximas de la anterior no es una capa real

/**
 * @typedef {object} CapaArbol
 * @property {number} z  altura del corte (mm, marco local de la pieza)
 * @property {Poligono[]} voladizos  zonas de la capa que necesitan apoyo
 * @property {Poligono[]} cuerpo  la pieza en esa capa, para esquivarla
 */

/**
 * @typedef {object} OpcionesArbol
 * @property {number} ancho  ancho de línea (mm)
 * @property {number} altoCapa  mm; sólo respaldo: la deriva sale de las diferencias de `z` entre capas
 * @property {number} angulo  ángulo de voladizo de Kiri (grados): limita la deriva por capa
 * @property {number} [separacion=3]  mm entre puntas
 * @property {number} [radioPunta]  mm; por defecto `1,2 × ancho`; nunca menos de `ancho / cos(π/8)` (≈ 1,08 × ancho)
 * @property {number} [radioMax=2.5]  mm
 * @property {number} [maxNodos=150]  tope de nodos activos
 * @property {Bloqueo[]} [bloqueos=[]]
 * @property {{x0:number, y0:number, x1:number, y1:number}} [cama]  si se da, ningún círculo sale de este rectángulo
 *   (extensión opcional del contrato; sin ella no se controla la cama)
 */

/**
 * Completa los valores por defecto. El radio de la punta se acota por abajo para que el tronco tenga siempre al
 * menos 2 anchos de línea de ancho (si no, el laminador lo descarta por `minArea`).
 * @param {OpcionesArbol} op
 * @returns {object}
 */
function normalizar(op) {
    const radioPunta = Math.max(op.radioPunta ?? 1.2 * op.ancho, RADIO_MIN_FACTOR * op.ancho);
    const angulo = Math.min(Math.max(op.angulo ?? 0, 0), 80); // acotado para que la tangente no explote
    return {
        radioPunta,
        radioMax: Math.max(op.radioMax ?? 2.5, radioPunta),
        maxNodos: op.maxNodos ?? 150,
        separacion: op.separacion ?? 3,
        bloqueos: op.bloqueos ?? [],
        cama: op.cama,
        tanAngulo: Math.tan((angulo * Math.PI) / 180),
        altoCapa: op.altoCapa,
    };
}

/**
 * Contexto de la capa `i`: la deriva y el crecimiento salen de la altura real que se baja (z[i+1] − z[i]), así
 * que valen también con altura de capa variable. Sin capa de arriba (o con una altura absurda) usa `altoCapa`.
 */
function contexto(capas, i, ultima, op) {
    const dz = i < ultima ? capas[i + 1].z - capas[i].z : op.altoCapa;
    const alto = dz > 0 && Number.isFinite(dz) ? dz : op.altoCapa;
    return { op, capa: capas[i], deriva: alto * op.tanAngulo, crece: CRECIMIENTO * alto };
}

/** Una pasada completa de arriba hacia abajo con una separación dada, más la poda. null = se pasó de maxNodos. */
function pasada(capas, ultima, op, sep, ultimo) {
    const registro = capas.map(() => []);
    let nodos = [];
    for (let i = ultima; i >= 0; i--) {
        const ctx = contexto(capas, i, ultima, op);
        nodos = bajar(nodos, ctx);
        fusionarTodo(nodos, ctx);
        if (!sembrar(nodos, ctx, sep, ultimo)) return null;
        registro[i] = nodos;
    }
    marcarViables(registro);
    return registro.map(ns => ns.filter(n => n.viable).map(n => circulo({ x: n.x, y: n.y }, n.r, LADOS)));
}

/**
 * Kiri le pasa a `arbol` una capa vacía de más arriba de todo cuya `z` es un índice y no mm (hecho del spike T0).
 * Se la reconoce por z no finita, por no subir respecto de la capa anterior o por un salto de más de
 * SALTO_INYECTADA veces la mayor altura de capa vista (así una última capa real alta no se descarta).
 */
function esInyectada(capas, i, altoMax) {
    const z = capas[i].z;
    if (!Number.isFinite(z)) return true;
    if (i === 0 || i !== capas.length - 1) return false;
    return z <= capas[i - 1].z || z - capas[i - 1].z > SALTO_INYECTADA * altoMax;
}

/** Mayor diferencia de z entre capas consecutivas (sin contar la última) y, como piso, `altoCapa`. */
function alturaMaxima(capas, altoCapa) {
    let max = altoCapa;
    for (let i = 1; i < capas.length - 1; i++) max = Math.max(max, capas[i].z - capas[i - 1].z);
    return max;
}

/**
 * Planifica los troncos de un soporte árbol, capa por capa, de arriba hacia abajo. Pura y determinista.
 * Una capa final inyectada (z no es una altura en mm) se ignora y su salida queda vacía. Un tronco que no llega a
 * la cama, a la pieza ni a otro tronco que sí llegue (lo frena un bloqueo o el borde de la cama) se poda entero.
 * @param {CapaArbol[]} capas  ordenadas de abajo hacia arriba (índice 0 = primera capa)
 * @param {OpcionesArbol} opciones
 * @returns {Poligono[][]}  `salida[i]` = polígonos de soporte de `capas[i]` (vacío si no hay)
 */
export function planificarArbol(capas, opciones) {
    const op = normalizar(opciones);
    const altoMax = alturaMaxima(capas, op.altoCapa);
    let ultima = capas.length - 1;
    while (ultima >= 0 && esInyectada(capas, ultima, altoMax)) ultima--;
    for (let intento = 0; intento <= MAX_REINTENTOS; intento++) {
        // Cada reintento duplica la separación: menos puntas, menos nodos.
        const salida = pasada(capas, ultima, op, op.separacion * 2 ** intento, intento === MAX_REINTENTOS);
        if (salida) return salida;
    }
    return capas.map(() => []); // inalcanzable: el último intento nunca devuelve null
}
