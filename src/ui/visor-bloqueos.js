// Visor: marcas de las zonas sin soporte (ADR 0004): una esfera translúcida por zona y por copia de la pieza.
// Lo usa visor.js; no toca el DOM al importarse (la escena llega por parámetro).

import * as THREE from 'three';

const COLOR_ZONA = 0xe0a020;
const OPACIDAD_ZONA = 0.3;

/**
 * Crea las marcas de zonas sin soporte sobre la escena.
 * Las esferas comparten una sola geometría de radio 1 y un solo material; el radio de cada zona es la escala de su
 * malla, así que cambiar un radio no recrea nada.
 * @param {object} ctx
 * @param {THREE.Scene} ctx.escena
 * @param {() => void} ctx.redibujar  pide un cuadro nuevo
 * @returns {{
 *   poner: (bloqueos: {id:number, centro:{x:number, y:number, z:number}, radio:number}[],
 *     posiciones: {x:number, y:number}[]) => void,
 *   quitar: () => void,
 * }}
 *   `poner` deja una esfera por (zona, copia): centro de la zona (marco de la pieza) más la posición de la copia.
 *   `quitar` saca todas y libera la geometría y el material.
 */
export function crearMarcasBloqueo(ctx) {
    const est = { ...ctx, grupo: null, geometria: null, material: null, mallas: new Map() };
    return {
        poner(bloqueos, posiciones) {
            ponerMarcas(est, bloqueos || [], posiciones || []);
            est.redibujar();
        },
        quitar() {
            liberar(est);
            est.redibujar();
        },
    };
}

// Reusa las mallas que ya existen (misma zona y misma copia), crea las que faltan y saca las que sobran.
function ponerMarcas(est, bloqueos, posiciones) {
    if (!posiciones.length) posiciones = [{ x: 0, y: 0 }]; // pieza sola, sin copias: está en el origen
    if (!bloqueos.length) return liberar(est);
    if (!est.grupo) armar(est);
    const vigentes = new Set();
    for (const b of bloqueos) {
        posiciones.forEach((pos, k) => {
            const clave = `${b.id}:${k}`;
            vigentes.add(clave);
            const malla = est.mallas.get(clave) ?? nuevaMalla(est, clave);
            malla.position.set(b.centro.x + pos.x, b.centro.y + pos.y, b.centro.z);
            malla.scale.setScalar(b.radio);
        });
    }
    for (const [clave, malla] of est.mallas) {
        if (vigentes.has(clave)) continue;
        est.grupo.remove(malla);
        est.mallas.delete(clave);
    }
}

function armar(est) {
    est.geometria = new THREE.SphereGeometry(1, 24, 16);
    est.material = new THREE.MeshBasicMaterial({
        color: COLOR_ZONA,
        transparent: true,
        opacity: OPACIDAD_ZONA,
        depthWrite: false,
    });
    est.grupo = new THREE.Group();
    est.escena.add(est.grupo);
}

function nuevaMalla(est, clave) {
    const malla = new THREE.Mesh(est.geometria, est.material);
    est.grupo.add(malla);
    est.mallas.set(clave, malla);
    return malla;
}

// Saca el grupo de la escena y libera lo compartido.
function liberar(est) {
    if (!est.grupo) return;
    est.escena.remove(est.grupo);
    est.geometria.dispose();
    est.material.dispose();
    est.grupo = est.geometria = est.material = null;
    est.mallas.clear();
}
