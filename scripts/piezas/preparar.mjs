// Pruebas de src/motor/preparar-piezas.js (ADR 0003, T4). Las llama scripts/probar-piezas.mjs.

import { prepararPiezas, centrar } from '../../src/motor/preparar-piezas.js';
import { leerSTL } from '../../src/motor/stl.js';
import { decimar } from '../../src/motor/decimar.js';
import { repartirTriangulos } from '../../src/motor/piezas.js';

const CARAS = [
    [0, 2, 1],
    [1, 2, 3],
    [4, 5, 6],
    [5, 7, 6],
    [0, 1, 4],
    [1, 5, 4],
    [2, 6, 3],
    [3, 6, 7],
    [0, 4, 2],
    [2, 4, 6],
    [1, 3, 5],
    [3, 7, 5],
];

// STL binario de un prisma de medidas (w, d, h) con la esquina mínima en (x0, y0, z0).
function stlPrisma(w, d, h, x0 = 0, y0 = 0, z0 = 0) {
    const c = [0, 1, 2, 3, 4, 5, 6, 7].map(i => [x0 + (i & 1 ? w : 0), y0 + (i & 2 ? d : 0), z0 + (i & 4 ? h : 0)]);
    return stlDeTriangulos(CARAS.map(f => f.flatMap(i => c[i])));
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

// Caja de una malla: { min: [x,y,z], max: [x,y,z] }.
function cajaDe(v) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i++) {
        min[i % 3] = Math.min(min[i % 3], v[i]);
        max[i % 3] = Math.max(max[i % 3], v[i]);
    }
    return { min, max };
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
    const cubo = stlPrisma(20, 20, 20, 5, 7, 3); // esquina en (5,7,3)
    const r = prepararPiezas([pieza(cubo, [O])], cama, Infinity);
    const v = r.widgets[0].vertices;
    revisar('caja literal: x/y -10..10, z 0..20', igual(cajaDe(v), { min: [-10, -10, 0], max: [10, 10, 20] }));
    const esperado = leerSTL(cubo);
    centrar(esperado);
    revisar('mismos vértices que leer -> centrar', igual(v, esperado));
    revisar('pos {0,0,0}, tamano 20×20×20', igual(r.widgets[0].pos, { x: 0, y: 0, z: 0 }));
    revisar('tamano del conjunto 20×20×20', igual(r.tamano, { x: 20, y: 20, z: 20 }));
    revisar('12 triángulos, sin decimar', r.triangulos === 12 && r.decimado === null && r.widgets.length === 1);
    const escala2 = [2, 0, 0, 0, 2, 0, 0, 0, 2];
    const rt = prepararPiezas([pieza(cubo, [O], escala2)], cama, Infinity);
    revisar(
        'escala 2: caja literal x/y -20..20, z 0..40',
        igual(cajaDe(rt.widgets[0].vertices), { min: [-20, -20, 0], max: [20, 20, 40] }) && rt.tamano.z === 40,
    );
}

const pa = [
    { x: -50, y: 0 },
    { x: 50, y: 10 },
];
const pb = [
    { x: 0, y: -30 },
    { x: 0, y: 30 },
    { x: 10, y: 60 },
];

function probarVarias({ revisar, igual }) {
    console.log('\n▶ prepararPiezas: varias piezas y copias');
    const a = stlPrisma(20, 20, 20, 5, 7, 3);
    const b = stlPrisma(40, 10, 5, -9, 2, 8);
    const m = prepararPiezas([pieza(a, pa), pieza(b, pb)], cama, Infinity);
    const w = m.widgets;
    revisar('5 widgets (2 + 3)', w.length === 5);
    revisar(
        'pos exactos, z = 0',
        igual(
            w.map(x => x.pos),
            [...pa, ...pb].map(p => ({ x: p.x, y: p.y, z: 0 })),
        ),
    );
    const cajaA = { min: [-10, -10, 0], max: [10, 10, 20] };
    const cajaB = { min: [-20, -5, 0], max: [20, 5, 5] };
    revisar(
        'caja literal de cada widget (piezas A y B)',
        [0, 1].every(k => igual(cajaDe(w[k].vertices), cajaA)) &&
            [2, 3, 4].every(k => igual(cajaDe(w[k].vertices), cajaB)),
    );
    revisar(
        'tamano de cada widget',
        igual(w[1].tamano, { x: 20, y: 20, z: 20 }) && igual(w[3].tamano, { x: 40, y: 10, z: 5 }),
    );
    probarCopias({ revisar, igual }, m);
    revisar('triángulos totales = 5 × 12', m.triangulos === 60);
    revisar('caja del conjunto (x -60..60, y -35..65, z más alta)', igual(m.tamano, { x: 120, y: 100, z: 20 }));
    revisar(
        'las posiciones del pedido no se tocan',
        igual(pa, [
            { x: -50, y: 0 },
            { x: 50, y: 10 },
        ]),
    );
}

// Las copias de una pieza no comparten el array ni el buffer, pero tienen los mismos valores.
function probarCopias({ revisar, igual }, { widgets: w }) {
    const distintas = (p, q) => p.vertices !== q.vertices && p.vertices.buffer !== q.vertices.buffer;
    revisar(
        'copias de A: otro array y otro buffer, mismos valores',
        distintas(w[0], w[1]) && igual(w[0].vertices, w[1].vertices),
    );
    revisar(
        'copias de B: todas distintas, mismos valores',
        distintas(w[2], w[3]) && distintas(w[3], w[4]) && distintas(w[2], w[4]) && igual(w[2].vertices, w[4].vertices),
    );
    revisar('A y B no comparten vértices', !igual(w[0].vertices, w[2].vertices));
}

// Tope por pieza como lo calcula prepararPiezas: repartirTriangulos + floor.
function topesDe(triangulos, copias, max) {
    const t = repartirTriangulos(triangulos, copias, max);
    return t === Infinity ? triangulos.map(() => Infinity) : t.map(Math.floor);
}

// Copias de `n` posiciones válidas (en fila, separadas 40 mm).
const fila = n => Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * 40, y: 0 }));

function probarTopes({ revisar, igual }) {
    console.log('\n▶ prepararPiezas: decimación con tope repartido');
    const grande = stlPlano(100, 100); // 20000 triángulos
    const chica = stlPlano(30, 50); // 1800 triángulos
    const casos = [
        ['2 copias de la grande + 1 de la chica, tope 10000', [grande, chica], [2, 1], 10000],
        ['3 copias con tope fraccionario (1078,67)', [grande, chica], [3, 1], 10000],
    ];
    for (const [nombre, stls, copias, max] of casos) {
        const topes = topesDe([20000, 1800], copias, max);
        const r = prepararPiezas(
            stls.map((s, i) => pieza(s, fila(copias[i]))),
            cama,
            max,
        );
        let k = 0;
        const dentro = copias.every((c, i) =>
            Array.from({ length: c }, () => r.widgets[k++].vertices.length / 9 <= topes[i]).every(Boolean),
        );
        revisar(`${nombre}: cada widget <= su tope ${JSON.stringify(topes)}`, dentro);
        revisar(`${nombre}: total <= ${max}`, r.triangulos <= max, `(${r.triangulos})`);
        revisar(
            `${nombre}: decimado coherente`,
            r.decimado.final === r.triangulos && r.decimado.original > r.triangulos,
        );
    }
    const fraccionario = repartirTriangulos([20000, 1800], [3, 1], 10000);
    revisar('el tope del caso de 3 copias no es entero', !Number.isInteger(fraccionario[0]));
    probarTopeSolo({ revisar, igual }, grande);
}

function probarTopeSolo({ revisar, igual }, grande) {
    const sola = prepararPiezas([pieza(grande, [O])], cama, 7777.5);
    const ref = decimar(leerSTL(grande), Math.floor(7777.5));
    centrar(ref.vertices);
    revisar(
        'una pieza sola: igual a decimar(leerSTL, floor(max)) -> centrar',
        igual(sola.widgets[0].vertices, ref.vertices),
    );
    revisar('una pieza sola: decimado.final == triangulos', sola.decimado.final === sola.triangulos);
    const piso = prepararPiezas([pieza(grande, [O])], cama, 100);
    revisar(
        'piso de 500 triángulos por pieza',
        piso.triangulos >= 400 && piso.triangulos <= 500,
        `(${piso.triangulos})`,
    );
    const justo = prepararPiezas([pieza(grande, [O])], cama, 20000);
    revisar('total == máximo: no decima', justo.decimado === null && justo.triangulos === 20000);
}

function probarAvance({ revisar }) {
    console.log('\n▶ prepararPiezas: alReducir');
    const grande = stlPlano(100, 100);
    const cubo = stlPrisma(10, 10, 10);
    const sube = a => a.every((v, i) => !i || v >= a[i - 1]);
    for (const [nombre, piezas] of [
        ['la que decima va primero', [pieza(grande, [O]), pieza(cubo, [O])]],
        ['la que decima va última', [pieza(cubo, [O]), pieza(grande, [O])]],
    ]) {
        const avances = [];
        prepararPiezas(piezas, cama, 5000, v => avances.push(v));
        revisar(`${nombre}: crece y termina en 1`, avances.length > 0 && sube(avances) && avances.at(-1) === 1);
    }
    const nada = [];
    prepararPiezas([pieza(cubo, [O])], cama, 5000, v => nada.push(v));
    revisar('sin decimar no avisa', nada.length === 0);
}

function probarCama({ revisar }) {
    console.log('\n▶ prepararPiezas: no entra en la cama');
    const sola =
        (w, pos = O, h = 10) =>
        () =>
            prepararPiezas([pieza(stlPrisma(w, 10, h), [pos])], cama, Infinity);
    revisar('huella 220 entra', intenta(sola(220)) === '');
    const msg = intenta(sola(220.6));
    revisar(
        'huella 220,6 no entra, mensaje de hoy',
        msg === 'El modelo mide 220,6 × 10,0 × 10,0 mm y no entra en la cama (220 × 220 × 250 mm).',
        msg,
    );
    revisar(
        'altura 250 entra, 251 no',
        intenta(sola(10, O, 250)) === '' && /no entra en la cama/.test(intenta(sola(10, O, 251))),
    );
    revisar('copia que sobra 0,5 mm entra', intenta(sola(100, { x: 60.5, y: 0 })) === '');
    const tol = intenta(sola(100, { x: 60.6, y: 0 }));
    revisar('copia que sobra 0,6 mm no entra', noEntran.test(tol), tol);
    revisar('X negativa: -60,5 entra', intenta(sola(100, { x: -60.5, y: 0 })) === '');
    revisar('X negativa: -60,6 no entra', noEntran.test(intenta(sola(100, { x: -60.6, y: 0 }))));
    revisar('en Y también (105,6 + 5 > 110,5)', noEntran.test(intenta(sola(100, { x: 0, y: 105.6 }))));
    const dos = () => prepararPiezas([pieza(stlPrisma(100, 10, 10), [O, { x: 60.6, y: 0 }])], cama, Infinity);
    revisar('con dos copias falla la que se sale', noEntran.test(intenta(dos)));
}

function probarInvalidas({ revisar }) {
    console.log('\n▶ prepararPiezas: posiciones inválidas');
    const con = pos => () => prepararPiezas([pieza(stlPrisma(10, 10, 10), [pos])], cama, Infinity);
    revisar('x NaN da error', noEntran.test(intenta(con({ x: NaN, y: 0 }))));
    revisar('y NaN da error', noEntran.test(intenta(con({ x: 0, y: NaN }))));
    revisar('x undefined da error', noEntran.test(intenta(con({ y: 0 }))));
    revisar('y undefined da error', noEntran.test(intenta(con({ x: 0 }))));
    revisar('Infinity da error', noEntran.test(intenta(con({ x: Infinity, y: 0 }))));
}

export function probarPreparar(ctx) {
    probarUna(ctx);
    probarVarias(ctx);
    probarTopes(ctx);
    probarAvance(ctx);
    probarCama(ctx);
    probarInvalidas(ctx);
}
