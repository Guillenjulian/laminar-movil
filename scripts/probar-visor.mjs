// Pruebas de las marcas de zonas sin soporte y del punto tocado (ADR 0004, T3): src/ui/visor-bloqueos.js y
// `alTocarPunto` de src/ui/visor-cara.js. Corren en Node, sin navegador (three no necesita WebGL para Object3D).
//
// Uso: node scripts/probar-visor.mjs

import * as THREE from 'three';
import { crearMarcasBloqueo } from '../src/ui/visor-bloqueos.js';
import { crearSelectorCara } from '../src/ui/visor-cara.js';
import { armarPieza, POSICIONES } from './visor/arnes.mjs';

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${condicion ? '' : detalle}`);
    if (!condicion) fallas++;
}
const casi = (a, b) => Math.abs(a - b) < 1e-6;

// alTocarPunto: un toque simulado sobre cada copia (cámara cenital) devuelve el mismo punto en el marco de la pieza,
// sin importar dónde está la copia en la cama. `dom` es un EventTarget con medidas, sin navegador.
const LADO = 300;
const { copias, local, enGeometria } = armarPieza();
const camara = new THREE.PerspectiveCamera(40, 1, 1, 1000);
camara.position.set(0, 0, 220);
camara.updateMatrixWorld(true);
const dom = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: LADO, height: LADO }),
});
const toques = [];
const ids = [];
const selector = crearSelectorCara({ escena: new THREE.Scene(), camara, dom, redibujar() {}, mallas: () => copias });
selector.alTocarPunto(t => toques.push(t));
selector.alTocarPieza(id => ids.push(id));
function tocar(x, y) {
    const datos = { pointerId: 1, clientX: x, clientY: y, pointerType: 'touch', button: 0 };
    for (const tipo of ['pointerdown', 'pointerup']) dom.dispatchEvent(Object.assign(new Event(tipo), datos));
}
const arriba = enGeometria.clone().setZ(20); // un punto de la tapa, para que el rayo cenital lo encuentre
const esperado = local.clone().setZ(20);
copias.forEach((copia, k) => {
    const mundo = arriba.clone().applyMatrix4(copia.matrixWorld);
    const pantalla = mundo.clone().project(camara);
    tocar(((pantalla.x + 1) / 2) * LADO, ((1 - pantalla.y) / 2) * LADO);
    const p = toques.at(-1)?.punto ?? {};
    revisar(
        `punto tocado en la copia ${k + 1} vuelve al marco de la pieza`,
        casi(p.x, esperado.x) && casi(p.y, esperado.y) && casi(p.z, esperado.z),
        `dio (${p.x}, ${p.y}, ${p.z}), esperaba (${esperado.x}, ${esperado.y}, ${esperado.z})`,
    );
    revisar(`la copia ${k + 1} está corrida de verdad`, casi(mundo.x - esperado.x, POSICIONES[k].x));
    revisar(`copia ${k + 1}: avisa el id y alTocarPieza también`, toques.at(-1)?.id === 0 && ids.at(-1) === 0);
});
tocar(LADO - 2, LADO - 2); // el fondo: no hay pieza
revisar('un toque fuera de la pieza no avisa', toques.length === 2 && ids.length === 2);
selector.alTocarPunto(null);
tocar(...[0, 1].map(() => LADO / 2));
revisar('alTocarPunto(null) deja de avisar', toques.length === 2);

// crearMarcasBloqueo: esferas por copia, reuso y liberación.
const escena = new THREE.Scene();
let dibujos = 0;
const marcas = crearMarcasBloqueo({ escena, redibujar: () => dibujos++ });
const zonas = [
    { id: 1, forma: 'esfera', centro: { x: 4, y: -2, z: 12 }, radio: 8 },
    { id: 2, forma: 'esfera', centro: { x: -1, y: 3, z: 5 }, radio: 3 },
];
marcas.poner(zonas, POSICIONES);
const esferas = () => escena.children.flatMap(g => g.children);
const radioDe = m => m.scale.x * m.geometry.parameters.radius;
revisar('una esfera por zona y por copia (2 × 2)', esferas().length === 4, `hay ${esferas().length}`);
revisar('pidió redibujar', dibujos === 1);
const hallar = (z, k) =>
    esferas().find(
        m =>
            casi(m.position.x, z.centro.x + POSICIONES[k].x) &&
            casi(m.position.y, z.centro.y + POSICIONES[k].y) &&
            casi(m.position.z, z.centro.z),
    );
revisar(
    'posición = centro local + posición de la copia',
    zonas.every(z => POSICIONES.every((_, k) => hallar(z, k))),
);
revisar(
    'radio = el del bloqueo',
    zonas.every(z => POSICIONES.every((_, k) => casi(radioDe(hallar(z, k)), z.radio))),
);

const antes = esferas();
const geo = antes[0].geometry;
const mat = antes[0].material;
marcas.poner([{ ...zonas[0], radio: 12 }, zonas[1]], POSICIONES);
const despues = esferas();
revisar('cambiar un radio no recrea mallas', despues.length === 4 && despues.every(m => antes.includes(m)));
revisar('ni la geometría ni el material', despues[0].geometry === geo && despues[0].material === mat);
revisar('el radio nuevo se aplica', casi(radioDe(hallar(zonas[0], 0)), 12));

marcas.poner([zonas[1]], [POSICIONES[0]]);
revisar('menos zonas y copias saca las que sobran', esferas().length === 1, `hay ${esferas().length}`);

let liberados = 0;
geo.dispose = () => liberados++;
mat.dispose = () => liberados++;
marcas.quitar();
revisar('quitar saca todo de la escena', escena.children.length === 0);
revisar('quitar libera geometría y material (dispose)', liberados === 2, `dispose llamado ${liberados} veces`);
marcas.poner([], POSICIONES);
revisar('poner sin zonas no deja nada', escena.children.length === 0);
marcas.poner(zonas, POSICIONES);
revisar('se puede volver a poner después de quitar', esferas().length === 4);

console.log(fallas ? `\n✘ ${fallas} FALLAS` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallas ? 1 : 0);
