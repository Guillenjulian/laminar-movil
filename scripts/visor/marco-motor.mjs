// Ata el marco del visor con el del motor (ADR 0004, riesgo R7): una malla asimétrica con una transformación
// compuesta (45° en Z, `rotacionQueApoya` y escala 1,7) y dos copias. Se arma la malla del visor como lo hacen
// `ponerModelo` y `ponerTransformacion` de visor.js, se toca con un rayo cenital el vértice más alto y se exige que
// `alTocarPunto` dé el mismo vértice que `prepararPiezas` (sin decimar) deja en el widget de esa copia.

import * as THREE from 'three';
import { prepararPiezas } from '../../src/motor/preparar-piezas.js';
import { escala, multiplicar, rotacionQueApoya } from '../../src/motor/transformar.js';
import { crearSelectorCara } from '../../src/ui/visor-cara.js';
import { POSICIONES } from './arnes.mjs';

const LADO = 300;
const TOLERANCIA = 1e-4;

// Esfera facetada y deformada a mano: sin simetrías, con un único vértice más alto tras cualquier giro.
function vertices() {
    const g = new THREE.IcosahedronGeometry(15, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)];
        const f = 1 + 0.25 * Math.sin(x * 0.5) * Math.cos(y * 0.3) + 0.15 * (x > 5 ? 1 : 0) * Math.sin(z);
        p.setXYZ(i, x * f * 1.3 + 40, y * f - 7, z * f * 0.8 + 100);
    }
    return new Float32Array(p.array);
}

// STL binario con esos vértices (3 por triángulo).
function aStl(v) {
    const n = v.length / 9;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    dv.setUint32(80, n, true);
    v.forEach((valor, i) => dv.setFloat32(84 + Math.floor(i / 9) * 50 + 12 + (i % 9) * 4, valor, true));
    return buf;
}

// Las copias del visor (visor.js: ponerModelo + ponerTransformacion + ponerCopias), una por posición.
function copiasDelVisor(v, m) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    geo.computeBoundingBox();
    const c = geo.boundingBox;
    geo.translate(-(c.min.x + c.max.x) / 2, -(c.min.y + c.max.y) / 2, -c.min.z);
    const matriz = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    const caja = new THREE.Box3();
    const m3 = new THREE.Matrix3().set(...m);
    const arr = geo.attributes.position.array;
    for (let k = 0; k < arr.length; k += 3) caja.expandByPoint(new THREE.Vector3().fromArray(arr, k).applyMatrix3(m3));
    matriz.setPosition(-(caja.min.x + caja.max.x) / 2, -(caja.min.y + caja.max.y) / 2, -caja.min.z);
    return POSICIONES.map(pos => {
        const copia = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
        copia.matrixAutoUpdate = false;
        copia.matrix.copy(matriz);
        copia.matrix.elements[12] += pos.x;
        copia.matrix.elements[13] += pos.y;
        copia.updateMatrixWorld(true);
        return copia;
    });
}

// El vértice más alto de una lista [x,y,z,...].
function masAlto(a) {
    let mejor = 0;
    for (let i = 3; i < a.length; i += 3) if (a[i + 2] > a[mejor + 2]) mejor = i;
    return new THREE.Vector3().fromArray(a, mejor);
}

// Los vértices de la copia en coordenadas del mundo.
function enMundo(copia) {
    const a = copia.geometry.attributes.position.array;
    const salida = new Float32Array(a.length);
    const t = new THREE.Vector3();
    for (let i = 0; i < a.length; i += 3) t.fromArray(a, i).applyMatrix4(copia.matrixWorld).toArray(salida, i);
    return salida;
}

function tocarEn(dom, camara, mundo) {
    const p = mundo.clone().project(camara);
    const datos = { pointerId: 1, clientX: ((p.x + 1) / 2) * LADO, clientY: ((1 - p.y) / 2) * LADO };
    for (const tipo of ['pointerdown', 'pointerup']) {
        dom.dispatchEvent(Object.assign(new Event(tipo), datos, { pointerType: 'touch', button: 0 }));
    }
}

/** @param {(nombre: string, condicion: boolean, detalle?: string) => void} revisar */
export function probarMarcoMotor(revisar) {
    const v = vertices();
    const c45 = Math.SQRT1_2;
    const giro45 = [c45, -c45, 0, c45, c45, 0, 0, 0, 1];
    const m = multiplicar(escala(1.7), multiplicar(rotacionQueApoya([0.3, 0.5, 0.8]), giro45));
    const dispositivo = { bedWidth: 1000, bedDepth: 1000, maxHeight: 1000 };
    const motor = prepararPiezas([{ stl: aStl(v), transformacion: m, posiciones: POSICIONES }], dispositivo, 1e9);
    revisar('el motor no decimó la malla de prueba', motor.decimado === null);

    const copias = copiasDelVisor(v, m);
    const camara = new THREE.PerspectiveCamera(40, 1, 1, 2000);
    camara.position.set(0, 0, 600);
    camara.updateMatrixWorld(true);
    const dom = Object.assign(new EventTarget(), {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: LADO, height: LADO }),
    });
    const toques = [];
    const selector = crearSelectorCara({
        escena: new THREE.Scene(),
        camara,
        dom,
        redibujar() {},
        mallas: () => copias,
    });
    selector.alTocarPunto(t => toques.push(t));
    copias.forEach((copia, k) => {
        tocarEn(dom, camara, masAlto(enMundo(copia)));
        const punto = toques.at(-1)?.punto;
        const esperado = masAlto(motor.widgets[k].vertices);
        const dif = punto ? Math.hypot(punto.x - esperado.x, punto.y - esperado.y, punto.z - esperado.z) : Infinity;
        revisar(
            `marco visor = marco motor: copia ${k + 1}, vértice más alto`,
            dif < TOLERANCIA,
            `visor ${JSON.stringify(punto)}, motor ${esperado.toArray()}, dif ${dif}`,
        );
    });
}
