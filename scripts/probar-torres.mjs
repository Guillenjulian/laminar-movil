// Pruebas de las mallas de las torres de calibración (corren en Node, sin navegador).
//
// Uso: npm run test:torres

import { bloquesDeTorre, generarTorreTemperatura, generarTorreRetraccion } from '../src/motor/torres.js';

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (!condicion) fallas++;
}
const casi = (a, b, tol = 1e-3) => Math.abs(a - b) < tol;

// Mínimo y máximo de cada eje (0 = X, 1 = Y, 2 = Z).
const rango = (v, k) => {
    const ejes = Array.from({ length: v.length / 3 }, (_, i) => v[i * 3 + k]);
    return [Math.min(...ejes), Math.max(...ejes)];
};

// Volumen con signo: positivo si las normales miran hacia afuera.
function volumen(v) {
    let s = 0;
    for (let i = 0; i < v.length; i += 9) {
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = v.subarray(i, i + 9);
        s += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return s / 6;
}

// Cada arista dirigida A->B aparece una vez y su opuesta B->A otra vez (malla cerrada y orientada).
function cerrada(v) {
    const p = i => `${v[i].toFixed(4)},${v[i + 1].toFixed(4)},${v[i + 2].toFixed(4)}`;
    const aristas = new Set();
    for (let i = 0; i < v.length; i += 9) {
        for (const [a, b] of [
            [0, 3],
            [3, 6],
            [6, 0],
        ]) {
            const clave = `${p(i + a)}|${p(i + b)}`;
            if (aristas.has(clave)) return false; // repetida con el mismo sentido
            aristas.add(clave);
        }
    }
    return [...aristas].every(k => aristas.has(k.split('|').reverse().join('|')));
}

function revisarMalla(nombre, torre, e) {
    const { vertices: v, alturaMm, bloques } = torre;
    const [[x0, x1], [y0, y1], [z0, z1]] = [0, 1, 2].map(k => rango(v, k));
    revisar(
        `${nombre}: ${v.length / 9} triángulos (${e.tris}), sin NaN`,
        v.length / 9 === e.tris && v.every(Number.isFinite),
    );
    revisar(`${nombre}: malla cerrada (aristas pareadas y opuestas)`, cerrada(v));
    revisar(`${nombre}: volumen positivo ${volumen(v).toFixed(2)}`, casi(volumen(v), e.volumen, 0.05));
    revisar(`${nombre}: z mínimo 0, máximo ${e.alto}`, casi(z0, 0) && casi(z1, e.alto));
    revisar(`${nombre}: X/Y ${x1 - x0} × ${y1 - y0}`, casi(x1 - x0, e.x) && casi(y1 - y0, e.y));
    revisar(`${nombre}: alturaMm y bloques`, casi(alturaMm, e.alto) && bloques.length === e.n);
}

// Temperatura: n bloques de alto h, ancho a, profundidad p y voladizo vo (volumen = p·n·(a·h + vo²/2)).
for (const [n, h, a, p, vo] of [
    [5, 10, 20, 15, 5],
    [3, 6, 12, 8, 2],
]) {
    const torre = generarTorreTemperatura({
        bloques: n,
        altoBloqueMm: h,
        anchoMm: a,
        profundidadMm: p,
        voladizoMm: vo,
    });
    revisarMalla(`temperatura ${n}×${h}`, torre, {
        n,
        alto: n * h,
        x: a + vo,
        y: p,
        tris: 20 * n + 4,
        volumen: p * n * (a * h + (vo * vo) / 2),
    });
}
// Retracción: dos columnas de lado l separadas s.
for (const [n, h, l, s] of [
    [5, 10, 10, 35],
    [8, 15, 12, 40],
]) {
    const torre = generarTorreRetraccion({ bloques: n, altoBloqueMm: h, ladoMm: l, separacionMm: s });
    revisarMalla(`retracción ${n}×${h}`, torre, {
        n,
        alto: n * h,
        x: 2 * l + s,
        y: l,
        tris: 24,
        volumen: 2 * l * l * n * h,
    });
}

for (const op of [{}, { bloques: 3, altoBloqueMm: 6 }, { bloques: 8, altoBloqueMm: 12.5 }]) {
    const b = JSON.stringify(bloquesDeTorre(op));
    const iguales = [generarTorreTemperatura(op), generarTorreRetraccion(op)].every(
        t => JSON.stringify(t.bloques) === b,
    );
    revisar(`bloquesDeTorre ${JSON.stringify(op)} coincide con lo generado`, iguales);
}

const lanza = f => {
    try {
        f();
    } catch (e) {
        return e instanceof Error && e.message.length > 5;
    }
    return false;
};
const todos = (ops, f) => ops.every(op => lanza(() => f(op)));
const malos = [
    { bloques: 2 },
    { bloques: 9 },
    { bloques: 4.5 },
    { altoBloqueMm: 5 },
    { altoBloqueMm: 16 },
    { bloques: NaN },
];
revisar(
    'las tres funciones lanzan error con bloques/alto fuera de rango',
    [bloquesDeTorre, generarTorreTemperatura, generarTorreRetraccion].every(f => todos(malos, f)),
);
revisar(
    'temperatura: ancho, profundidad y voladizo inválidos',
    todos([{ anchoMm: 0 }, { profundidadMm: -1 }, { voladizoMm: 10 }, { voladizoMm: 0 }], generarTorreTemperatura),
);
revisar(
    'retracción: lado y separación inválidos',
    todos([{ ladoMm: 0 }, { separacionMm: -5 }, { ladoMm: NaN }], generarTorreRetraccion),
);

if (fallas) {
    console.error(`\n${fallas} prueba(s) fallaron.`);
    process.exit(1);
}
console.log('\nTODAS LAS PRUEBAS OK');
