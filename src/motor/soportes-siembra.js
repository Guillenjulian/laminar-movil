// Siembra de puntas de los soportes árbol (ADR 0004, T1): dónde nacen los troncos nuevos bajo los voladizos de una
// capa. Puro. Importa sólo `geometria-2d` y `soportes-paso` (para `holgura`); no importa a `soportes-arbol.js`.

import { distanciaAPoligono, puntoEnPoligono, areaPoligono } from './geometria-2d.js';
import { holgura } from './soportes-paso.js';

/** ¿El punto está cubierto por un nodo, o la punta nueva se pisaría con uno? */
function pisaNodo(nodos, x, y, rp) {
    return nodos.some(n => Math.hypot(n.x - x, n.y - y) < n.r + rp);
}

/** Centroide por área del polígono (si el área es 0, el promedio de los vértices). */
function centroide(poli) {
    const area = areaPoligono(poli);
    if (area === 0) {
        return [poli.reduce((s, p) => s + p.x, 0) / poli.length, poli.reduce((s, p) => s + p.y, 0) / poli.length];
    }
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
        const w = poli[j].x * poli[i].y - poli[i].x * poli[j].y;
        cx += (poli[j].x + poli[i].x) * w;
        cy += (poli[j].y + poli[i].y) * w;
    }
    return [cx / (6 * area), cy / (6 * area)];
}

/**
 * Puntos de la grilla de `sep` mm (anclada en múltiplos de `sep`, así no depende del polígono) que caen dentro de
 * los voladizos. Si algún polígono quedó sin ningún punto de la grilla, se agrega su centroide (si cae adentro).
 */
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

/**
 * Siembra puntas nuevas en los voladizos de la capa. Devuelve false si se pasa de `maxNodos` y todavía quedan
 * reintentos; en el último intento simplemente deja de sembrar.
 */
export function sembrar(nodos, ctx, sep, ultimo) {
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
