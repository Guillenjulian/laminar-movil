// Pruebas de src/motor/piezas.js (corren en Node, sin navegador).
//
// Uso: npm run test:piezas

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acomodar, repartirTriangulos, validarCantidad } from '../src/motor/piezas.js';
import { probarPreparar } from './piezas/preparar.mjs';

let fallas = 0;
let aciertos = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (condicion) aciertos++;
    else fallas++;
}
// Comparación estricta (distingue -0 de 0 y no esconde NaN, a diferencia de JSON.stringify).
function igual(real, esperado) {
    try {
        assert.deepStrictEqual(real, esperado);
        return true;
    } catch {
        return false;
    }
}
const cama = { x: 220, y: 220 };
const cubo = { x: 20, y: 20 };
const h = (x, y) => ({ x, y });
const P = (x, y) => ({ x, y });

console.log('\n▶ acomodar: una sola huella');
revisar(
    'en el borde exacto entra, centrada',
    igual(acomodar([h(220, 220)], cama, 10), { posiciones: [P(0, 0)], entra: true, fuera: [] }),
);
revisar(
    '0,5 mm más ancha no entra',
    igual(acomodar([h(220.5, 10)], cama, 10), { posiciones: [P(0, 0)], entra: false, fuera: [0] }),
);
revisar('1 mm más profunda no entra', acomodar([h(10, 221)], cama, 10).entra === false);
revisar('la separación no cuenta con una sola huella', acomodar([h(220, 100)], cama, 50).entra === true);

console.log('\n▶ acomodar: posiciones exactas');
revisar(
    '4 cubos de 20 en cama 220, sep 10: una fila centrada',
    igual(acomodar([cubo, cubo, cubo, cubo], cama, 10), {
        posiciones: [P(-45, 0), P(-15, 0), P(15, 0), P(45, 0)],
        entra: true,
        fuera: [],
    }),
);
revisar(
    'bloque == cama - separacion entra (la más ancha primero)',
    igual(acomodar([h(90, 20), h(100, 20)], { x: 210, y: 100 }, 10), {
        posiciones: [P(55, 0), P(-50, 0)],
        entra: true,
        fuera: [],
    }),
);
revisar(
    '1 mm menos de cama: abre un segundo estante',
    igual(acomodar([h(90, 20), h(100, 20)], { x: 209, y: 100 }, 10), {
        posiciones: [P(-5, 15), P(0, -15)],
        entra: true,
        fuera: [],
    }),
);
const tres = [h(10, 20), h(10, 20), h(10, 30)];
revisar(
    'ejes intercambiados ganan cuando los normales dejan una afuera',
    igual(acomodar(tres, { x: 50, y: 60 }, 10), {
        posiciones: [P(10, -15), P(10, 15), P(-10, -10)],
        entra: true,
        fuera: [],
    }),
);
revisar(
    'si los normales alcanzan, gana la variante normal (menor fondo)',
    igual(acomodar(tres, { x: 60, y: 50 }, 10), {
        posiciones: [P(0, -5), P(20, -5), P(-20, 0)],
        entra: true,
        fuera: [],
    }),
);

console.log('\n▶ acomodar: separación contra el borde en el eje del fondo');
const dos50 = [h(20, 50), h(20, 50)];
revisar(
    'fondo del bloque == cama.y - sep entra (variante normal)',
    igual(acomodar(dos50, { x: 210, y: 60 }, 10), { posiciones: [P(-15, 0), P(15, 0)], entra: true, fuera: [] }),
);
revisar(
    'cama.y - sep + 1 no entra: fuera exacto',
    igual(acomodar(dos50, { x: 210, y: 59 }, 10), { posiciones: [P(-15, 0), P(15, 0)], entra: false, fuera: [0, 1] }),
);
const cuatro = [h(10, 40), h(10, 20), h(10, 10), h(20, 20)];
revisar(
    'ancho del bloque == cama.x - sep entra (variante girada)',
    igual(acomodar(tres, { x: 40, y: 60 }, 10), {
        posiciones: [P(10, -15), P(10, 15), P(-10, -10)],
        entra: true,
        fuera: [],
    }),
);
revisar(
    'cama.x - sep + 1 no entra (variante girada): fuera exacto',
    igual(acomodar(tres, { x: 39, y: 60 }, 10).fuera, [0, 1]) && !acomodar(tres, { x: 39, y: 60 }, 10).entra,
);
revisar('bloque girado de 70 en cama 70: entra justo', acomodar(cuatro, { x: 70, y: 70 }, 10).entra);

console.log('\n▶ acomodar: criterio de menor fondo entre variantes (igual cantidad afuera)');
revisar(
    'gana la normal por menor fondo (2 de 50x10)',
    igual(acomodar([h(50, 10), h(50, 10)], { x: 200, y: 200 }, 10), {
        posiciones: [P(-30, 0), P(30, 0)],
        entra: true,
        fuera: [],
    }),
);
revisar(
    'gana la girada por menor fondo (60 contra 40)',
    igual(acomodar(cuatro, { x: 70, y: 70 }, 10), {
        posiciones: [P(5, 0), P(25, -10), P(25, 15), P(-20, -10)],
        entra: true,
        fuera: [],
    }),
);
revisar(
    'empate puro (igual cantidad afuera e igual fondo): va a X',
    igual(acomodar([h(10, 10), h(10, 10), h(10, 10)], { x: 50, y: 50 }, 10).posiciones, [
        P(-10, -10),
        P(10, -10),
        P(-10, 10),
    ]),
);

console.log('\n▶ acomodar: lo que no entra');
const ancha = acomodar([cubo, h(300, 10), cubo], cama, 10);
revisar('huella más ancha que la cama -> en fuera, con índice de entrada', igual(ancha.fuera, [1]) && !ancha.entra);
revisar('devuelve una posición por huella', ancha.posiciones.length === 3);
const muchas = acomodar(Array(5).fill(h(100, 100)), cama, 10);
revisar('5 de 100x100 en 220: una queda afuera', muchas.fuera.length === 1 && !muchas.entra);
revisar(
    'entra es lo contrario de tener fuera',
    [ancha, muchas].every(r => r.entra === (r.fuera.length === 0)),
);
revisar('sin huellas: vacío y entra', igual(acomodar([], cama, 10), { posiciones: [], entra: true, fuera: [] }));

console.log('\n▶ acomodar: índices de fuera exactos y medidas no finitas');
revisar('5 de 100x100 en 220: fuera [4]', igual(acomodar(Array(5).fill(h(100, 100)), cama, 10).fuera, [4]));
revisar('6 de 100x100 en 220: fuera [4, 5]', igual(acomodar(Array(6).fill(h(100, 100)), cama, 10).fuera, [4, 5]));
const sinNada = { posiciones: [P(0, 0), P(0, 0)], entra: false };
revisar(
    'NaN en una huella (2 huellas): esa va a fuera',
    igual(acomodar([h(NaN, 20), cubo], cama, 10), { posiciones: [P(15, -10), P(-5, 0)], entra: false, fuera: [0] }),
);
revisar(
    'Infinity en el fondo de una huella: va a fuera',
    igual(acomodar([cubo, cubo, h(20, Infinity)], cama, 10).fuera, [2]),
);
revisar(
    'NaN en una huella sola: fuera [0]',
    igual(acomodar([h(10, NaN)], cama, 10), { posiciones: [P(0, 0)], entra: false, fuera: [0] }),
);
revisar(
    'cama con NaN: todas a fuera',
    igual(acomodar([cubo, cubo], { x: NaN, y: 220 }, 10), { ...sinNada, fuera: [0, 1] }),
);
revisar(
    'cama Infinity: todas a fuera',
    igual(acomodar([cubo, cubo, cubo], { x: Infinity, y: 220 }, 10).fuera, [0, 1, 2]),
);
revisar('separación NaN: todas a fuera', igual(acomodar([cubo, cubo], cama, NaN).fuera, [0, 1]));
revisar(
    'las posiciones nunca son NaN',
    [acomodar([h(NaN, 5), cubo], cama, 10), acomodar([cubo, cubo], { x: NaN, y: 1 }, 10)].every(r =>
        r.posiciones.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ),
);

console.log('\n▶ acomodar: propiedades (300 casos pseudoaleatorios, semilla fija)');
let semilla = 12345;
const azar = (a, b) => {
    semilla = (semilla * 1103515245 + 12345) % 2147483648;
    return a + (semilla % (b - a + 1));
};
let conEntra = 0;
let solapes = 0;
let afuera = 0;
let largo = 0;
let nodeterministas = 0;
for (let t = 0; t < 300; t++) {
    const hs = Array.from({ length: azar(2, 8) }, () => h(azar(5, 90), azar(5, 90)));
    const c = { x: azar(100, 250), y: azar(100, 250) };
    const sep = azar(2, 12);
    const r = acomodar(hs, c, sep);
    if (!igual(r, acomodar(hs, c, sep))) nodeterministas++;
    if (r.posiciones.length !== hs.length) largo++;
    if (r.entra) conEntra++;
    for (let i = 0; i < hs.length; i++) {
        const p = r.posiciones[i];
        if (r.entra && (Math.abs(p.x) + hs[i].x / 2 > c.x / 2 || Math.abs(p.y) + hs[i].y / 2 > c.y / 2)) afuera++;
        for (let j = i + 1; j < hs.length; j++) {
            if (!r.entra && (r.fuera.includes(i) || r.fuera.includes(j))) continue;
            const q = r.posiciones[j];
            const sepX = Math.abs(p.x - q.x) - (hs[i].x + hs[j].x) / 2;
            const sepY = Math.abs(p.y - q.y) - (hs[i].y + hs[j].y) / 2;
            if (Math.max(sepX, sepY) < sep - 1e-9) solapes++;
        }
    }
}
revisar(
    `${conEntra} casos con entra: ninguna pareja a menos de la separación`,
    conEntra > 20 && solapes === 0,
    `(${solapes} fallas)`,
);
revisar('con entra, todas dentro de la cama', afuera === 0, `(${afuera} fallas)`);
revisar('una posición por huella (orden de entrada)', largo === 0);
revisar('determinista: dos llamadas iguales dan lo mismo', nodeterministas === 0);

console.log('\n▶ acomodar: empates y orden');
revisar(
    'huellas idénticas: la primera va a la izquierda',
    igual(acomodar([h(30, 30), h(30, 30)], cama, 10).posiciones, [P(-20, 0), P(20, 0)]),
);
revisar(
    'mismo fondo: primero la más ancha; la salida respeta el orden de entrada',
    igual(acomodar([h(20, 20), h(20, 40), h(30, 40)], cama, 10).posiciones, [P(35, -10), P(5, 0), P(-30, 0)]),
);
const entrada = [h(10, 50), h(60, 10), h(40, 30)];
const ida = acomodar(entrada, cama, 10);
const vuelta = acomodar([...entrada].reverse(), cama, 10);
revisar(
    'mismas medidas en otro orden: cada una conserva su lugar',
    igual([...vuelta.posiciones].reverse(), ida.posiciones),
);

console.log('\n▶ repartirTriangulos');
revisar('si el total entra -> Infinity (incluso justo)', repartirTriangulos([1000, 3000], [1, 1], 4000) === Infinity);
revisar('proporcional', igual(repartirTriangulos([1000, 3000], [1, 1], 2000), [500, 1500]));
revisar('piso de 500 por pieza', igual(repartirTriangulos([100000, 600], [1, 1], 1000), [994, 500]));
revisar('con copias: el tope es por copia', igual(repartirTriangulos([4000], [2], 4000), [1000]));
revisar('con copias: nunca menos de 500', igual(repartirTriangulos([4000], [4], 1000), [500]));
revisar(
    'las copias cuentan en el total',
    repartirTriangulos([1000], [4], 3999) !== Infinity && repartirTriangulos([1000], [4], 4000) === Infinity,
);
revisar('una pieza chica no sube por el piso', repartirTriangulos([100, 9000], [1, 1], 5000)[0] === 100);
revisar(
    'el tope puede no ser entero (quien lo usa aplica floor)',
    igual(repartirTriangulos([1001], [2], 1000), [500]) &&
        !Number.isInteger(repartirTriangulos([3001, 1000], [2, 1], 6000)[0]),
);

console.log('\n▶ piezas.js no tiene imports');
const fuente = readFileSync(new URL('../src/motor/piezas.js', import.meta.url), 'utf8');
revisar('ni import estático, ni import(), ni require', !/^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(fuente));

console.log('\n▶ validarCantidad');
revisar('maxPiezas y maxCopias exactos -> null', validarCantidad(8, 24, 8, 24) === null);
revisar(
    'maxPiezas + 1 -> error en español',
    /8 piezas/.test(validarCantidad(9, 9, 8, 24) ?? ''),
    validarCantidad(9, 9, 8, 24),
);
revisar(
    'maxCopias + 1 -> error en español',
    /24 copias/.test(validarCantidad(1, 25, 8, 24) ?? ''),
    validarCantidad(1, 25, 8, 24),
);
revisar('las dos pasadas: avisa primero las piezas', /piezas/.test(validarCantidad(9, 25, 8, 24) ?? ''));

probarPreparar({ revisar, igual });

console.log(fallas ? `\n✘ ${fallas} FALLAS (${aciertos} OK)` : `\nTODAS LAS PRUEBAS OK (${aciertos})`);
process.exit(fallas ? 1 : 0);
