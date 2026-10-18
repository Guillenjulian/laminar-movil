// Pruebas de src/motor/preparar-piezas.js (ADR 0003, T4). Las llama scripts/probar-piezas.mjs.

import { prepararPiezas, centrar } from '../../src/motor/preparar-piezas.js';
import { leerSTL } from '../../src/motor/stl.js';
import { aplicar } from '../../src/motor/transformar.js';

// STL binario de un prisma de medidas (w, d, h) con la esquina mínima en (x0, y0, z0).
function stlPrisma(w, d, h, x0 = 0, y0 = 0, z0 = 0) {
    const c = [0, 1, 2, 3, 4, 5, 6, 7].map(i => [x0 + (i & 1 ? w : 0), y0 + (i & 2 ? d : 0), z0 + (i & 4 ? h : 0)]);
    // prettier-ignore
    const caras = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];
    return stlDeTriangulos(caras.map(f => f.flatMap(i => c[i])));
}

function stlDeTriangulos(tris) {
    const b = new ArrayBuffer(84 + tris.length * 50);
    const dv = new DataView(b);
    dv.setUint32(80, tris.length, true);
    tris.forEach((t, n) => t.forEach((v, k) => dv.setFloat32(84 + n * 50 + 12 + k * 4, v, true)));
    return b;
}

// Plano de n × n celdas (2n² triángulos) de lado `lado`, con algo de relieve para que decime.
function stlPlano(n, lado) {
    const p = (i, j) => [(i * lado) / n, (j * lado) / n, ((i + j) % 3) * 0.1];
    const tris = [];
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            tris.push(
                [...p(i, j), ...p(i + 1, j), ...p(i, j + 1)],
                [...p(i + 1, j), ...p(i + 1, j + 1), ...p(i, j + 1)],
            );
        }
    }
    return stlDeTriangulos(tris);
}

const cama = { bedWidth: 220, bedDepth: 220, maxHeight: 250 };
const O = { x: 0, y: 0 };
const pieza = (stl, posiciones, transformacion) => ({ stl, posiciones, transformacion });
const intenta = f => {
    try {
        f();
        return '';
    } catch (e) {
        return e.message;
    }
};
const noEntran = /^Las piezas no entran en la cama/;

function probarUna({ revisar, igual }) {
    console.log('\n▶ prepararPiezas: una pieza, una copia, en {0,0}');
    const cubo = stlPrisma(20, 20, 20, 5, 7, 3);
    const r = prepararPiezas([pieza(cubo, [O])], cama, Infinity);
    const esperado = leerSTL(cubo);
    centrar(esperado); // el pipeline de hoy: leer -> (transformar) -> centrar
    revisar('mismos vértices que leer -> centrar', igual(r.widgets[0].vertices, esperado));
    revisar('cubo centrado en X/Y y apoyado en Z=0', Math.min(...r.widgets[0].vertices) === -10);
    revisar(
        'pos {0,0,0}, tamano 20×20×20',
        igual(r.widgets[0].pos, { ...O, z: 0 }) && igual(r.tamano, { x: 20, y: 20, z: 20 }),
    );
    revisar('12 triángulos, sin decimar', r.triangulos === 12 && r.decimado === null && r.widgets.length === 1);
    const t = Array.from({ length: 9 }, (_, i) => (i % 4 === 0 ? 2 : 0));
    const rt = prepararPiezas([pieza(cubo, [O], t)], cama, Infinity);
    const ref = leerSTL(cubo);
    aplicar(t, ref);
    centrar(ref);
    revisar(
        'con transformación: igual a transformar -> centrar',
        igual(rt.widgets[0].vertices, ref) && rt.tamano.x === 40,
    );
}

function probarVarias({ revisar, igual }) {
    console.log('\n▶ prepararPiezas: varias piezas y copias');
    const a = stlPrisma(20, 20, 20);
    const b = stlPrisma(40, 10, 5);
    const pa = [{ x: -50, y: 0 }, { x: 50, y: 10 }]; // prettier-ignore
    const pb = [{ x: 0, y: -30 }, { x: 0, y: 30 }, { x: 10, y: 60 }]; // prettier-ignore
    const m = prepararPiezas([pieza(a, pa), pieza(b, pb)], cama, Infinity);
    const w = m.widgets;
    revisar('5 widgets (2 + 3)', w.length === 5);
    revisar('pos exactos, z = 0', igual(w.map(x => x.pos), [...pa, ...pb].map(p => ({ x: p.x, y: p.y, z: 0 })))); // prettier-ignore
    revisar('tamano de cada widget', igual(w[0].tamano, { x: 20, y: 20, z: 20 }) && igual(w[4].tamano, { x: 40, y: 10, z: 5 })); // prettier-ignore
    const distintas = (p, q) => p.vertices !== q.vertices && p.vertices.buffer !== q.vertices.buffer;
    revisar('copias: otro array y otro buffer, mismos valores', distintas(w[0], w[1]) && igual(w[0].vertices, w[1].vertices)); // prettier-ignore
    revisar('copias de la segunda pieza, igual', distintas(w[2], w[3]) && distintas(w[3], w[4]) && igual(w[2].vertices, w[4].vertices)); // prettier-ignore
    revisar('triángulos totales = 5 × 12', m.triangulos === 60);
    revisar('caja del conjunto (x -60..60, y -35..65, z más alta)', igual(m.tamano, { x: 120, y: 100, z: 20 }));
    revisar('las posiciones del pedido no se tocan', igual(pa, [{ x: -50, y: 0 }, { x: 50, y: 10 }])); // prettier-ignore
}

function probarDecimado({ revisar, igual }) {
    console.log('\n▶ prepararPiezas: decimación con tope repartido');
    const grande = stlPlano(100, 100); // 20000 triángulos
    const chica = stlPlano(30, 50); // 1800 triángulos
    const avances = [];
    const d = prepararPiezas(
        [pieza(grande, [{ x: -50, y: 0 }, { x: 50, y: 0 }]), pieza(chica, [O])], // prettier-ignore
        cama,
        10000,
        v => avances.push(v),
    );
    revisar('conjunto <= 10000 triángulos', d.triangulos <= 10000, `(${d.triangulos})`);
    revisar('decimado informa original y final con copias', d.decimado?.original === 41800 && d.decimado.final === d.triangulos); // prettier-ignore
    revisar('las dos copias comparten decimado', igual(d.widgets[0].vertices, d.widgets[1].vertices));
    revisar('alReducir: crece de 0 a 1', avances.length > 0 && avances.at(-1) === 1 && avances.every((v, i) => !i || v >= avances[i - 1])); // prettier-ignore
    const piso = prepararPiezas([pieza(grande, [O])], cama, 100);
    revisar(
        'piso de 500 triángulos por pieza',
        piso.triangulos >= 400 && piso.triangulos <= 500,
        `(${piso.triangulos})`,
    );
    const justo = prepararPiezas([pieza(grande, [O])], cama, 20000);
    revisar('total == máximo: no decima', justo.decimado === null && justo.triangulos === 20000);
}

function probarCama({ revisar }) {
    console.log('\n▶ prepararPiezas: no entra en la cama');
    const sola =
        (w, pos = O, h = 10) =>
        () =>
            prepararPiezas([pieza(stlPrisma(w, 10, h), [pos])], cama, Infinity);
    revisar('huella 220 entra', intenta(sola(220)) === '');
    const msg = intenta(sola(220.6));
    revisar('huella 220,6 no entra, mensaje de hoy', msg === 'El modelo mide 220,6 × 10,0 × 10,0 mm y no entra en la cama (220 × 220 × 250 mm).', msg); // prettier-ignore
    revisar('altura 250 entra, 251 no', intenta(sola(10, O, 250)) === '' && /no entra en la cama/.test(intenta(sola(10, O, 251)))); // prettier-ignore
    revisar('copia que sobra 0,5 mm entra', intenta(sola(100, { x: 60.5, y: 0 })) === '');
    const tol = intenta(sola(100, { x: 60.6, y: 0 }));
    revisar('copia que sobra 0,6 mm no entra', noEntran.test(tol), tol);
    revisar('en Y también (105,6 + 5 > 110,5)', noEntran.test(intenta(sola(100, { x: 0, y: 105.6 }))));
    const dos = () => prepararPiezas([pieza(stlPrisma(100, 10, 10), [O, { x: 60.6, y: 0 }])], cama, Infinity);
    revisar('con dos copias falla la que se sale', noEntran.test(intenta(dos)));
}

function probarDesplazar({ revisar, igual }) {
    console.log('\n▶ prepararPiezas: opción desplazar (plan B)');
    const a = stlPrisma(20, 20, 20);
    const pos = [{ x: -50, y: 20 }, { x: 30, y: -10 }]; // prettier-ignore
    const des = prepararPiezas([pieza(a, pos)], cama, Infinity, undefined, { desplazar: true });
    const base = prepararPiezas([pieza(a, pos)], cama, Infinity).widgets[0].vertices;
    const mover = (dx, dy) => base.map((v, i) => v + [dx, dy, 0][i % 3]);
    revisar('pos en 0 y vértices trasladados', igual(des.widgets[0].pos, { x: 0, y: 0, z: 0 }) && igual(des.widgets[0].vertices, mover(-50, 20))); // prettier-ignore
    revisar('segunda copia en su posición', igual(des.widgets[1].vertices, mover(30, -10)));
    revisar('misma caja del conjunto', igual(des.tamano, { x: 100, y: 50, z: 20 }));
}

export function probarPreparar(ctx) {
    probarUna(ctx);
    probarVarias(ctx);
    probarDecimado(ctx);
    probarCama(ctx);
    probarDesplazar(ctx);
}
