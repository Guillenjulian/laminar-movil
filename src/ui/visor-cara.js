// Visor: elegir una cara del modelo con un toque (modo "apoyar cara") y avisar qué pieza y qué punto se tocó.
// Lo usa visor.js; no toca el DOM al importarse (el elemento llega por parámetro).

import * as THREE from 'three';

const MAX_MOVIMIENTO_PX = 8; // más que esto era un arrastre de OrbitControls
const MAX_DURACION_MS = 400; // más que esto era una pulsación larga

/**
 * Crea el selector de caras sobre el elemento del visor.
 * @param {object} ctx
 * @param {THREE.Scene} ctx.escena
 * @param {THREE.Camera} ctx.camara
 * @param {HTMLElement} ctx.dom  elemento que recibe los toques (el canvas del renderer)
 * @param {() => void} ctx.redibujar  pide un cuadro nuevo
 * @param {() => THREE.Mesh[]} ctx.mallas  todas las mallas tocables, copias incluidas; el id de la pieza sale de
 *   `malla.userData.idPieza` (si falta, 0)
 * @returns {{
 *   elegirCara: (activo: boolean, alElegir?: (normal: number[], id: number) => void) => void,
 *   alTocarPieza: (fn: ((id: number) => void) | null) => void,
 *   alTocarPunto: (fn: ((toque: {id: number, punto: {x: number, y: number, z: number}}) => void) | null) => void,
 *   quitarResaltado: () => void,
 *   destruir: () => void,
 * }}
 */
export function crearSelectorCara(ctx) {
    // Estado compartido por las funciones de abajo: dependencias más lo que se va eligiendo.
    const est = {
        ...ctx,
        alElegirCara: null,
        alTocar: null,
        alTocarPunto: null,
        resaltado: null,
        rayo: new THREE.Raycaster(),
    };
    const quitarOyentes = escucharToques(
        est.dom,
        () => !!(est.alElegirCara || est.alTocar || est.alTocarPunto),
        (cx, cy) => tocarModelo(est, cx, cy),
    );
    return {
        // Modo "apoyar cara": con un toque sobre una pieza avisamos su cara (normal ya girada) y su id.
        elegirCara(activo, alElegir) {
            est.alElegirCara = activo ? alElegir : null;
            if (!activo) quitarResaltado(est);
        },
        // Con un toque sobre una pieza (haya o no modo "apoyar cara") avisamos su id.
        alTocarPieza(fn) {
            est.alTocar = fn;
        },
        // Con un toque sobre una pieza avisamos su id y el punto tocado en el marco de la pieza (ver puntoEnMarcoPieza).
        alTocarPunto(fn) {
            est.alTocarPunto = fn;
        },
        quitarResaltado: () => quitarResaltado(est),
        // Saca los oyentes del `dom` y el resaltado.
        destruir() {
            quitarOyentes();
            quitarResaltado(est);
        },
    };
}

function quitarResaltado(est) {
    if (!est.resaltado) return;
    est.escena.remove(est.resaltado);
    est.resaltado.geometry.dispose();
    est.resaltado.material.dispose();
    est.resaltado = null;
    est.redibujar();
}

// Pinta encima de la cara tocada un triángulo semitransparente, apenas despegado
// hacia afuera para que no se mezcle con la cara del modelo.
function resaltar(est, malla, cara, normal) {
    quitarResaltado(est);
    const pos = malla.geometry.attributes.position;
    const despegue = normal.clone().multiplyScalar(0.05);
    const puntos = new Float32Array(9);
    [cara.a, cara.b, cara.c].forEach((v, j) => {
        const p = new THREE.Vector3().fromBufferAttribute(pos, v).applyMatrix4(malla.matrixWorld).add(despegue);
        puntos.set([p.x, p.y, p.z], j * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(puntos, 3));
    est.resaltado = new THREE.Mesh(geo, materialResaltado());
    est.escena.add(est.resaltado);
    est.redibujar();
}

// Busca qué malla (y qué triángulo) está bajo el punto de pantalla; null si ninguna.
function buscarToque(est, cx, cy) {
    const r = est.dom.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const punto = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const mallas = est.mallas();
    if (!mallas.length) return null;
    for (const malla of mallas) malla.updateMatrixWorld(true);
    est.rayo.setFromCamera(punto, est.camara);
    const [toque] = est.rayo.intersectObjects(mallas, false);
    return toque?.face ? { toque, id: toque.object.userData.idPieza ?? 0 } : null;
}

function tocarModelo(est, cx, cy) {
    const hallado = buscarToque(est, cx, cy);
    if (!hallado) return;
    const { toque, id } = hallado;
    // El punto va ANTES que el id: así quien marca zonas ve todavía la pieza activa de antes del toque (ADR 0004).
    est.alTocarPunto?.({ id, punto: puntoEnMarcoPieza(toque.point, toque.object) });
    est.alTocar?.(id);
    if (!est.alElegirCara) return;
    // La normal del triángulo viene en coordenadas del modelo: la llevamos a las
    // de la impresora con la "matriz de normales" (sirve aunque haya escala).
    const normal = toque.face.normal
        .clone()
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(toque.object.matrixWorld))
        .normalize();
    resaltar(est, toque.object, toque.face, normal);
    est.alElegirCara([normal.x, normal.y, normal.z], id);
}

/**
 * Pasa un punto del mundo al marco de la pieza (ya transformada y centrada en X/Y, apoyada en Z=0: el de `centrar()`).
 * La malla tocada es una copia: lo único que la separa de ese marco es su posición en la cama, que es el centro de su
 * caja en X/Y (el marco tiene el centro en el origen y la base en Z=0). Se mide con los vértices, no con la caja
 * original, porque al girar la caja alineada a los ejes sale más grande. Ojo: el motor centra la malla ya decimada
 * (`prepararPiezas`), así que con decimación el centro del motor puede diferir del de acá hasta media celda
 * (menos de 0,2 mm con los topes reales); sin decimar coinciden.
 * @param {THREE.Vector3} punto  en coordenadas del mundo
 * @param {THREE.Object3D} malla  la copia tocada
 * @returns {{x: number, y: number, z: number}}
 */
function puntoEnMarcoPieza(punto, malla) {
    const centro = new THREE.Box3().setFromObject(malla, true).getCenter(new THREE.Vector3());
    return { x: punto.x - centro.x, y: punto.y - centro.y, z: punto.z };
}

function materialResaltado() {
    return new THREE.MeshBasicMaterial({
        color: 0x2a7fff,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
}

// Un "toque" es apoyar y levantar un solo dedo (o el mouse) casi sin moverse y rápido.
// Si se movió, tardó o hubo dos dedos, era un gesto de OrbitControls y no lo tomamos.
// Devuelve una función que saca los oyentes.
function escucharToques(dom, hayOyente, alToque) {
    const toques = new Map(); // pointerId → { x, y, t }
    let gestoMultiple = false;
    const abajo = ev => {
        if (toques.size === 0) gestoMultiple = false;
        toques.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, t: performance.now() });
        if (toques.size > 1) gestoMultiple = true;
    };
    const cancelar = ev => toques.delete(ev.pointerId);
    const arriba = ev => {
        const inicio = toques.get(ev.pointerId);
        toques.delete(ev.pointerId);
        if (!inicio || gestoMultiple || !hayOyente()) return;
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        const movio = Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y);
        if (movio >= MAX_MOVIMIENTO_PX || performance.now() - inicio.t >= MAX_DURACION_MS) return;
        alToque(ev.clientX, ev.clientY);
    };
    dom.addEventListener('pointerdown', abajo);
    dom.addEventListener('pointercancel', cancelar);
    dom.addEventListener('pointerup', arriba);
    return () => {
        dom.removeEventListener('pointerdown', abajo);
        dom.removeEventListener('pointercancel', cancelar);
        dom.removeEventListener('pointerup', arriba);
    };
}
