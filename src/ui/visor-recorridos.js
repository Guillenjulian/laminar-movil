// Visor: recorridos del G-code (vista previa capa por capa). Las capas de abajo se dibujan
// atenuadas y la actual con todo su color; las dos comparten los mismos datos y sólo cambia
// qué tramo se dibuja (por eso el deslizador es instantáneo). Lo usa visor.js.

import * as THREE from 'three';
import { CUANTIZADO } from '../motor/tipos-linea.js';

/**
 * Crea el manejador de recorridos del G-code.
 * @param {object} ctx
 * @param {THREE.Scene} ctx.escena
 * @param {() => void} ctx.redibujar  pide un cuadro nuevo
 * @param {() => {x:number, y:number}} ctx.tamanoCama  medidas actuales de la cama (mm)
 * @param {() => void} ctx.vistaInicial  reencuadra la cámara (se llama al poner recorridos)
 * @returns {{
 *   ponerRecorridos: (datos: object, opciones: {origenCentro: boolean}) => void,
 *   mostrarCapa: (n: number, sola?: boolean) => void,
 *   pintarRecorridos: (rellenar: (colores: Float32Array|Uint8Array) => void) => void,
 *   atenuarAbajo: (fuerte: boolean) => void,
 *   quitarRecorridos: () => void,
 *   esfera: () => {centro: THREE.Vector3, radio: number} | null,
 * }}  `esfera()` da la esfera que abarca los recorridos (null si no hay), para encuadrar la cámara.
 */
export function crearRecorridos(ctx) {
    const est = { ...ctx, recorridos: null }; // recorridos: { grupo, abajo, actual, inicioCapa, col, esfera }
    return {
        ponerRecorridos: (datos, opciones) => ponerRecorridos(est, datos, opciones),
        mostrarCapa: (n, sola = false) => mostrarCapa(est, n, sola),
        pintarRecorridos: rellenar => pintarRecorridos(est, rellenar),
        atenuarAbajo: fuerte => atenuarAbajo(est, fuerte),
        quitarRecorridos: () => quitarRecorridos(est),
        esfera: () => est.recorridos?.esfera ?? null,
    };
}

// Datos: { posiciones, colores, inicioCapa, caja }; `origenCentro` si la impresora tiene el origen en el centro.
function ponerRecorridos(est, { posiciones, colores, inicioCapa, caja }, { origenCentro }) {
    quitarRecorridos(est);
    const pos = new THREE.BufferAttribute(posiciones, 3);
    const col = new THREE.BufferAttribute(colores, 3, true);
    const { abajo, actual } = crearLineas(pos, col);
    const grupo = new THREE.Group();
    grupo.add(abajo, actual);
    // De enteros a mm, y del origen de la impresora al centro de la cama del visor.
    const cama = est.tamanoCama();
    const dx = origenCentro ? 0 : cama.x / 2,
        dy = origenCentro ? 0 : cama.y / 2;
    const { ESCALA, DESPLAZAMIENTO } = CUANTIZADO;
    grupo.scale.setScalar(1 / ESCALA);
    grupo.position.set(-DESPLAZAMIENTO - dx, -DESPLAZAMIENTO - dy, -DESPLAZAMIENTO);
    est.escena.add(grupo);
    est.recorridos = { grupo, abajo, actual, inicioCapa, col, esfera: esferaDe(caja, dx, dy) };
    est.vistaInicial();
}

// Muestra hasta la capa n (o sólo esa capa).
function mostrarCapa(est, n, sola) {
    if (!est.recorridos) return;
    const { abajo, actual, inicioCapa } = est.recorridos;
    const desde = inicioCapa[n],
        hasta = inicioCapa[n + 1];
    actual.geometry.setDrawRange(desde * 2, (hasta - desde) * 2);
    abajo.geometry.setDrawRange(0, desde * 2);
    abajo.visible = !sola;
    est.redibujar();
}

// Cambia los colores de los recorridos: `rellenar(array)` escribe RGB por vértice.
function pintarRecorridos(est, rellenar) {
    if (!est.recorridos) return;
    rellenar(est.recorridos.col.array);
    est.recorridos.col.needsUpdate = true;
    est.redibujar();
}

// Cuánto se atenúan las capas de abajo: fuerte por tipo de línea (para que resalte la
// capa actual) y suave por filamento (para que se vean bien los colores).
function atenuarAbajo(est, fuerte) {
    if (!est.recorridos) return;
    est.recorridos.abajo.material.color.set(fuerte ? 0x9a9a9a : 0xe6e6e6);
    est.recorridos.abajo.material.opacity = fuerte ? 0.55 : 0.9;
    est.redibujar();
}

function quitarRecorridos(est) {
    const r = est.recorridos;
    if (!r) return;
    est.escena.remove(r.grupo);
    r.abajo.geometry.dispose();
    r.actual.geometry.dispose();
    r.abajo.material.dispose();
    r.actual.material.dispose();
    est.recorridos = null;
    est.redibujar();
}

// Dos juegos de líneas con los mismos datos: las capas de abajo (atenuadas) y la actual.
function crearLineas(pos, col) {
    const geometria = () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', pos);
        g.setAttribute('color', col);
        return g;
    };
    const abajo = new THREE.LineSegments(
        geometria(),
        new THREE.LineBasicMaterial({ vertexColors: true, color: 0x9a9a9a, transparent: true, opacity: 0.55 }),
    );
    const actual = new THREE.LineSegments(geometria(), new THREE.LineBasicMaterial({ vertexColors: true }));
    // Sin "frustum culling": three.js tendría que recorrer millones de puntos para
    // calcular la caja, y la pieza siempre está a la vista.
    abajo.frustumCulled = actual.frustumCulled = false;
    return { abajo, actual };
}

// Esfera que abarca la caja de los recorridos, en las coordenadas del visor.
function esferaDe(caja, dx, dy) {
    const centro = new THREE.Vector3(
        (caja.min[0] + caja.max[0]) / 2 - dx,
        (caja.min[1] + caja.max[1]) / 2 - dy,
        (caja.min[2] + caja.max[2]) / 2,
    );
    const radio = Math.hypot(caja.max[0] - caja.min[0], caja.max[1] - caja.min[1], caja.max[2] - caja.min[2]) / 2;
    return { centro, radio };
}
