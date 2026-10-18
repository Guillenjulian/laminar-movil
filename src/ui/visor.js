// Visor 3D de las piezas sobre la cama, con gestos táctiles:
//   1 dedo: girar · 2 dedos: zoom y mover · doble toque: volver a la vista inicial.
// Usamos Z hacia arriba, igual que la impresora. Una malla por pieza (por `id`, el 0 si no se dice);
// elegir cara y recorridos del G-code viven en visor-cara.js y visor-recorridos.js (ADR 0003, sección 4).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { crearSelectorCara } from './visor-cara.js';
import { crearRecorridos } from './visor-recorridos.js';
import { crearMarcasBloqueo } from './visor-bloqueos.js';
import { reemplazarCama } from './visor-cama.js';

const COLOR_PIEZA = 0xf08a24;
const COLOR_FUERA = 0xd03030; // copias que se pasan de la cama
const TINTE_ACTIVA = 0x1a3050; // brillo suave de la pieza activa (sólo si hay más de una)
const IDENTIDAD = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Crea el visor dentro de `contenedor`. Las piezas van por `id` (0 si no se dice: la única de hoy). API:
 * ponerCama, ponerModelo(vertices, id?), ponerTransformacion(m, id?), ponerCopias(id, posiciones, fuera?),
 * tamanoModelo(id?), quitarModelo(id?; sin id, todas), resaltarPieza(id|null), elegirCara(activo, alElegir(normal, id)),
 * alTocarPieza(fn|null), alTocarPunto(fn|null; ADR 0004), marcasBloqueo ({poner, quitar}: zonas sin soporte), ponerRecorridos, mostrarCapa, pintarRecorridos, atenuarAbajo, quitarRecorridos,
 * vistaInicial, pausar(p).
 * @param {HTMLElement} contenedor
 * @returns {Record<string, Function>} el visor
 */
export function crearVisor(contenedor) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); // más de 2x no se nota y gasta batería
    contenedor.appendChild(renderer.domElement);
    const camara = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camara.up.set(0, 0, 1);
    const controles = new OrbitControls(camara, renderer.domElement);
    controles.enableDamping = true;
    controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    const v = { renderer, camara, controles, escena: crearEscena(), cama: null, piezas: new Map() };
    Object.assign(v, { tamanoCama: { x: 220, y: 220, z: 250 }, activa: null, activo: true, sucio: true });
    v.redibujar = () => {
        v.sucio = true;
    };
    v.vistaInicial = () => vistaInicial(v);
    const { escena, redibujar } = v;
    const dom = renderer.domElement;
    v.cara = crearSelectorCara({ escena, camara, dom, redibujar, mallas: () => mallas(v) });
    v.marcas = crearMarcasBloqueo({ escena, redibujar });
    v.rec = crearRecorridos({ escena, redibujar, tamanoCama: () => v.tamanoCama, vistaInicial: () => vistaInicial(v) });
    dom.addEventListener('dblclick', v.vistaInicial); // doble toque (o doble clic): vista inicial
    new ResizeObserver(() => ajustar(v, contenedor)).observe(contenedor);
    renderer.setAnimationLoop(() => dibujar(v));
    ponerCama(v, v.tamanoCama);
    ajustar(v, contenedor);
    return armarApi(v);
}

// La API pública: lo de las piezas va por id (0 si falta); elegir cara y recorridos se delegan.
function armarApi(v) {
    const { cara, rec } = v;
    return {
        ponerCama: medidas => ponerCama(v, medidas),
        ponerModelo: (vertices, id = 0) => ponerModelo(v, vertices, id),
        ponerTransformacion: (m, id = 0) => ponerTransformacion(v, m, id),
        ponerCopias: (id, posiciones, fuera = []) => ponerCopias(v, id, posiciones, fuera),
        tamanoModelo: (id = 0) => (v.piezas.has(id) ? { ...v.piezas.get(id).tamano } : null),
        quitarModelo: id => quitarModelo(v, id),
        resaltarPieza: id => {
            v.activa = id;
            aplicarTinte(v);
        },
        elegirCara: cara.elegirCara,
        alTocarPieza: cara.alTocarPieza,
        alTocarPunto: cara.alTocarPunto,
        marcasBloqueo: v.marcas,
        ...Object.fromEntries(Object.entries(rec).filter(([nombre]) => nombre !== 'esfera')),
        vistaInicial: v.vistaInicial,
        pausar(p) {
            v.activo = !p;
            v.redibujar();
        },
    };
}

function crearEscena() {
    const escena = new THREE.Scene();
    escena.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
    const sol = new THREE.DirectionalLight(0xffffff, 1.5);
    sol.position.set(-1, -2, 3);
    escena.add(sol);
    return escena;
}

// Sólo dibujamos cuando algo cambia (gesto, capa, tamaño) y mientras el visor
// está a la vista: con millones de líneas, redibujar cada cuadro gasta mucha batería.
function dibujar(v) {
    if (!v.activo) return;
    const seMovio = v.controles.update(); // true mientras dura el gesto (y su inercia)
    if (seMovio || v.sucio) {
        v.renderer.render(v.escena, v.camara);
        v.sucio = false;
    }
}

// Ajustar al tamaño del contenedor.
function ajustar(v, contenedor) {
    const { width, height } = contenedor.getBoundingClientRect();
    if (!width || !height) return;
    v.renderer.setSize(width, height, false);
    v.camara.aspect = width / height;
    v.camara.updateProjectionMatrix();
    v.redibujar();
}

function ponerCama(v, medidas) {
    v.tamanoCama = { x: medidas.x, y: medidas.y, z: medidas.z };
    v.cama = reemplazarCama(v.escena, v.cama, medidas);
    v.redibujar();
}

function materialPieza(color) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true });
}

// Las mallas tocables: las copias de cada pieza si las hay, si no la malla sola.
function mallas(v) {
    return [...v.piezas.values()].flatMap(p => (p.copias.length ? p.copias : [p.malla]));
}

// Pieza: se centra en la cama y se apoya en Z=0, igual que al laminar.
function ponerModelo(v, vertices, id) {
    quitarPieza(v, id);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeBoundingBox();
    const c = geo.boundingBox;
    geo.translate(-(c.min.x + c.max.x) / 2, -(c.min.y + c.max.y) / 2, -c.min.z);
    geo.computeVertexNormals();
    const malla = new THREE.Mesh(geo, materialPieza(COLOR_PIEZA));
    malla.matrixAutoUpdate = false; // la posición la manejamos a mano con la matriz
    malla.userData.idPieza = id;
    v.escena.add(malla);
    v.piezas.set(id, { malla, copias: [], tamano: null, posiciones: [], rojo: null });
    aplicarTinte(v);
    contarPiezas(v);
    ponerTransformacion(v, null, id); // arranca sin girar ni escalar (y reencuadra)
}

// Gira/escala la pieza `id`. `m` es una matriz 3×3 en un Array de 9 números, fila por fila, que lleva
// del modelo original a la impresora (Z arriba); null es la identidad. No tocamos los vértices: va
// todo en la matriz del objeto (así three.js corrige las normales para la luz). Después, igual que al
// laminar, lo recentramos en X/Y y lo apoyamos en Z=0. Con una sola pieza reencuadra la cámara.
function ponerTransformacion(v, m, id) {
    const p = v.piezas.get(id);
    if (!p) return;
    v.cara.quitarResaltado();
    const r = m || IDENTIDAD;
    const matriz = new THREE.Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
    const caja = cajaTransformada(p.malla.geometry.attributes.position.array, r);
    // Centrado en X/Y y apoyado en la cama.
    matriz.setPosition(-(caja.min.x + caja.max.x) / 2, -(caja.min.y + caja.max.y) / 2, -caja.min.z);
    p.malla.matrix.copy(matriz);
    const { x, y, z } = caja.getSize(new THREE.Vector3());
    p.tamano = { x, y, z };
    actualizarCopias(p);
    p.malla.matrixWorldNeedsUpdate = true;
    p.malla.updateMatrixWorld(true);
    if (v.piezas.size <= 1) vistaInicial(v);
    else v.redibujar();
}

// Caja de los vértices ya transformados. Transformar la caja original no alcanza: al girar,
// sus esquinas quedan afuera del modelo y la caja sale más grande.
function cajaTransformada(pos, r) {
    const m3 = new THREE.Matrix3().set(...r);
    const caja = new THREE.Box3();
    const punto = new THREE.Vector3();
    for (let k = 0; k < pos.length; k += 3) caja.expandByPoint(punto.fromArray(pos, k).applyMatrix3(m3));
    return caja;
}

// Una instancia por posición (centro en mm, relativo al centro de la cama); las de `fuera` (índices)
// van en rojo. Comparten la geometría de la pieza (no se duplican buffers). Sin posiciones, vuelve la malla sola.
function ponerCopias(v, id, posiciones, fuera) {
    const p = v.piezas.get(id);
    if (!p) return;
    v.cara.quitarResaltado();
    quitarCopias(v, p);
    p.posiciones = posiciones || [];
    p.malla.visible = !p.posiciones.length;
    // El rojo gana: las copias de `fuera` no se tiñen aunque sean de la pieza activa.
    if (fuera.length) p.rojo = materialPieza(COLOR_FUERA);
    p.copias = p.posiciones.map((_, k) => {
        const copia = new THREE.Mesh(p.malla.geometry, fuera.includes(k) ? p.rojo : p.malla.material);
        copia.matrixAutoUpdate = false;
        copia.userData.idPieza = id;
        v.escena.add(copia);
        return copia;
    });
    actualizarCopias(p);
    v.redibujar();
}

// Pone la matriz de cada copia: la de la pieza más el corrimiento de su posición.
function actualizarCopias(p) {
    p.copias.forEach((copia, k) => {
        copia.matrix.copy(p.malla.matrix);
        copia.matrix.elements[12] += p.posiciones[k].x;
        copia.matrix.elements[13] += p.posiciones[k].y;
        copia.updateMatrixWorld(true);
    });
}

// Saca las copias de la escena. La geometría y el material son de la pieza (no se liberan acá); el rojo sí.
function quitarCopias(v, p) {
    p.copias.forEach(copia => v.escena.remove(copia));
    p.copias = [];
    p.rojo?.dispose();
    p.rojo = null;
}

// Con id quita esa pieza; sin id, todas.
function quitarModelo(v, id) {
    for (const k of id === undefined ? [...v.piezas.keys()] : [id]) quitarPieza(v, k);
    aplicarTinte(v);
}

// Libera la pieza: sus copias dejan de existir con ella, así que recién ahí se libera la geometría compartida.
function quitarPieza(v, id) {
    const p = v.piezas.get(id);
    if (!p) return;
    v.cara.quitarResaltado();
    quitarCopias(v, p);
    v.escena.remove(p.malla);
    p.malla.geometry.dispose();
    p.malla.material.dispose();
    v.piezas.delete(id);
    if (id === v.activa) v.activa = null;
    contarPiezas(v);
}

// Deja la cantidad de piezas en el canvas (data-piezas): lo leen las pruebas.
function contarPiezas(v) {
    v.renderer.domElement.dataset.piezas = String(v.piezas.size);
}

// Tinte suave a la activa; con una sola pieza (o ninguna activa) no tiñe.
function aplicarTinte(v) {
    for (const [id, p] of v.piezas) {
        p.malla.material.emissive.setHex(v.piezas.size > 1 && id === v.activa ? TINTE_ACTIVA : 0);
    }
    v.redibujar();
}

// Encuadra lo que haya (recorridos, piezas o la cama) desde adelante y arriba.
function vistaInicial(v) {
    const esfera = v.rec.esfera();
    let centro, radio;
    let margen = 1.8; // un poco más lejos de lo justo, para ver la cama alrededor
    if (esfera) {
        margen = 1.2; // en la vista previa interesa la pieza, de cerca
        centro = esfera.centro.clone();
        radio = Math.max(esfera.radio, 15);
    } else if (v.piezas.size) {
        const s = esferaPiezas(v); // ya girada y apoyada
        centro = s.center;
        radio = Math.max(s.radius, 15);
    } else {
        centro = new THREE.Vector3(0, 0, 0);
        radio = Math.max(v.tamanoCama.x, v.tamanoCama.y) / 2;
    }
    const dist = (radio / Math.sin((v.camara.fov * Math.PI) / 360)) * margen;
    v.camara.position.copy(centro).add(new THREE.Vector3(0, -dist * 0.6, dist * 0.8));
    v.controles.target.copy(centro);
    v.controles.update();
    v.redibujar();
}

// Esfera que abarca las piezas mostradas (con una sola, su esfera propia).
function esferaPiezas(v) {
    return mallas(v)
        .map(m => {
            if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); // las copias comparten geometría
            return m.geometry.boundingSphere.clone().applyMatrix4(m.matrix);
        })
        .reduce((total, esfera) => total.union(esfera));
}
