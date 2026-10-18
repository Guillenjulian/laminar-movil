// Prepara las piezas para el laminado (ADR 0003, sección 3): lee, transforma, decima y centra cada pieza
// y la replica por copia. No importa Kiri y no toca el DOM: se prueba en Node.
//
//   prepararPiezas  piezas -> widgets (uno por copia, cada uno con su `pos` en la cama)
//   centrar         centra una malla en X/Y y la apoya en Z=0 (TODO T6: el worker usa esta)

import { leerSTL } from './stl.js';
import { decimar } from './decimar.js';
import { aplicar, esIdentidad } from './transformar.js';
import { repartirTriangulos } from './piezas.js';

/** Tolerancia (mm) con la que una copia puede pasarse del borde de la cama. */
export const TOLERANCIA_COPIA_MM = 0.5;

/**
 * Centra la malla en X/Y y la apoya en Z=0 (modifica `v`). Kiri ubica el modelo en el centro de la cama
 * cuando la posición es (0,0,0). TODO T6: el worker usa esta en vez de su copia local.
 * @param {Float32Array} v vértices [x,y,z, ...]
 * @returns {{x:number, y:number, z:number}} medidas de la caja
 */
export function centrar(v) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            if (v[i + k] < min[k]) min[k] = v[i + k];
            if (v[i + k] > max[k]) max[k] = v[i + k];
        }
    }
    const dx = (min[0] + max[0]) / 2;
    const dy = (min[1] + max[1]) / 2;
    const dz = min[2];
    for (let i = 0; i < v.length; i += 3) {
        v[i] -= dx;
        v[i + 1] -= dy;
        v[i + 2] -= dz;
    }
    return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

const mm = n => n.toFixed(1).replace('.', ',');

// Error si una pieza sola no entra en la cama (mismo mensaje y criterio que el worker, sin tolerancia).
function validarSola(t, d) {
    if (t.x > d.bedWidth || t.y > d.bedDepth || t.z > d.maxHeight) {
        throw new Error(
            `El modelo mide ${mm(t.x)} × ${mm(t.y)} × ${mm(t.z)} mm y no entra en la cama ` +
                `(${d.bedWidth} × ${d.bedDepth} × ${d.maxHeight} mm).`,
        );
    }
}

// Error si una copia centrada en `pos` se sale de la cama por más de la tolerancia.
function validarCopia(t, pos, d) {
    const sobraX = Math.abs(pos.x) + t.x / 2 - d.bedWidth / 2;
    const sobraY = Math.abs(pos.y) + t.y / 2 - d.bedDepth / 2;
    if (sobraX > TOLERANCIA_COPIA_MM || sobraY > TOLERANCIA_COPIA_MM) {
        throw new Error('Las piezas no entran en la cama. Probá con menos copias o más chicas.');
    }
}

// Lee y transforma una pieza (antes de decimar y de centrar: así se mide el modelo ya transformado).
function leerPieza(p) {
    const vertices = leerSTL(p.stl);
    if (p.transformacion && !esIdentidad(p.transformacion)) aplicar(p.transformacion, vertices);
    return vertices;
}

// Decima cada pieza una sola vez con su tope repartido. Devuelve las mallas finales y el resumen (o null).
function decimarTodas(mallas, copias, maxTriangulos, alReducir) {
    const topes = repartirTriangulos(
        mallas.map(v => v.length / 9),
        copias,
        maxTriangulos,
    );
    let hubo = false;
    let precisionMm = 0;
    const salida = mallas.map((v, i) => {
        const tope = topes === Infinity ? Infinity : Math.floor(topes[i]);
        const r = decimar(v, tope, val => alReducir?.((i + val) / mallas.length));
        if (!r) return v;
        hubo = true;
        precisionMm = Math.max(precisionMm, r.celda);
        return r.vertices;
    });
    if (!hubo) return { mallas: salida, decimado: null };
    const suma = ms => ms.reduce((s, v, i) => s + (v.length / 9) * copias[i], 0);
    return { mallas: salida, decimado: { original: suma(mallas), final: suma(salida), precisionMm } };
}

// Caja que abarca todas las copias (`cajas[k]` centrada en `centros[k]`); z = la más alta.
function cajaDelConjunto(cajas, centros) {
    const lim = (eje, signo) => Math.max(...cajas.map((c, k) => signo * (centros[k][eje] + (signo * c[eje]) / 2)));
    if (!cajas.length) return { x: 0, y: 0, z: 0 };
    return {
        x: lim('x', 1) + lim('x', -1),
        y: lim('y', 1) + lim('y', -1),
        z: Math.max(...cajas.map(c => c.z)),
    };
}

// Traslada los vértices (plan B del ADR): la copia queda en `pos` y el widget va en 0.
function desplazarVertices(v, pos) {
    for (let i = 0; i < v.length; i += 3) {
        v[i] += pos.x;
        v[i + 1] += pos.y;
    }
}

/**
 * Lee, transforma, decima y centra cada pieza y la replica por copia.
 * Cada pieza se decima una sola vez; cada copia lleva su propio `Float32Array` (`slice`), nunca compartido.
 * @param {{stl:ArrayBuffer, transformacion?:number[], posiciones:{x:number,y:number}[]}[]} piezas
 * @param {object} dispositivo perfil (bedWidth, bedDepth, maxHeight)
 * @param {number} maxTriangulos tope del conjunto, copias incluidas
 * @param {(valor:number)=>void} [alReducir] avance de la decimación (0..1)
 * @param {{desplazar?: boolean}} [opciones] `desplazar: true` traslada los vértices y deja `pos` en 0 (plan B)
 * @returns {{widgets: {vertices:Float32Array, pos:{x:number,y:number,z:number}, tamano:{x:number,y:number,z:number}}[],
 *           triangulos:number, tamano:{x:number,y:number,z:number}, decimado:object|null}}
 *   `tamano`: x e y de la caja que abarca todo (con posiciones), z la altura de la más alta.
 *   `decimado`: `{original, final, precisionMm}` del conjunto (con copias) o `null` si no se decimó nada.
 * @throws {Error} en español si una pieza no entra sola o una copia se sale de la cama
 */
export function prepararPiezas(piezas, dispositivo, maxTriangulos, alReducir, opciones = {}) {
    const copias = piezas.map(p => p.posiciones.length);
    const { mallas, decimado } = decimarTodas(piezas.map(leerPieza), copias, maxTriangulos, alReducir);
    const widgets = [];
    const cajas = [];
    const centros = [];
    mallas.forEach((v, i) => {
        const tamano = centrar(v);
        validarSola(tamano, dispositivo);
        for (const p of piezas[i].posiciones) {
            validarCopia(tamano, p, dispositivo);
            const vertices = v.slice();
            const pos = { x: p.x, y: p.y, z: 0 };
            if (opciones.desplazar) {
                desplazarVertices(vertices, pos);
                pos.x = 0;
                pos.y = 0;
            }
            widgets.push({ vertices, pos, tamano: { ...tamano } });
            cajas.push(tamano);
            centros.push(p);
        }
    });
    const triangulos = widgets.reduce((s, w) => s + w.vertices.length / 9, 0);
    return { widgets, triangulos, tamano: cajaDelConjunto(cajas, centros), decimado };
}
