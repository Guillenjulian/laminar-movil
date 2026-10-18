// Pruebas de src/motor/piezas.js (corren en Node, sin navegador).
//
// Uso: npm run test:piezas

import { acomodar, repartirTriangulos, validarCantidad } from '../src/motor/piezas.js';

let fallas = 0;
let aciertos = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (condicion) aciertos++;
    else fallas++;
}
const J = JSON.stringify;
const cama = { x: 220, y: 220 };
const cubo = { x: 20, y: 20 };
const h = (x, y) => ({ x, y });
const P = (x, y) => ({ x, y });

console.log('\n▶ acomodar: una sola huella');
revisar(
    'en el borde exacto entra, centrada',
    J(acomodar([h(220, 220)], cama, 10)) === J({ posiciones: [P(0, 0)], entra: true, fuera: [] }),
);
revisar(
    '0,5 mm más ancha no entra',
    J(acomodar([h(220.5, 10)], cama, 10)) === J({ posiciones: [P(0, 0)], entra: false, fuera: [0] }),
);
revisar('1 mm más profunda no entra', acomodar([h(10, 221)], cama, 10).entra === false);
revisar('la separación no cuenta con una sola huella', acomodar([h(220, 100)], cama, 50).entra === true);

console.log('\n▶ acomodar: posiciones exactas');
revisar(
    '4 cubos de 20 en cama 220, sep 10: una fila centrada',
    J(acomodar([cubo, cubo, cubo, cubo], cama, 10)) ===
        J({ posiciones: [P(-45, 0), P(-15, 0), P(15, 0), P(45, 0)], entra: true, fuera: [] }),
);
revisar(
    'bloque == cama - separacion entra (la más ancha primero)',
    J(acomodar([h(90, 20), h(100, 20)], { x: 210, y: 100 }, 10)) ===
        J({ posiciones: [P(55, 0), P(-50, 0)], entra: true, fuera: [] }),
);
revisar(
    '1 mm menos de cama: abre un segundo estante',
    J(acomodar([h(90, 20), h(100, 20)], { x: 209, y: 100 }, 10)) ===
        J({ posiciones: [P(-5, 15), P(0, -15)], entra: true, fuera: [] }),
);
const tres = [h(10, 20), h(10, 20), h(10, 30)];
revisar(
    'ejes intercambiados ganan cuando los normales dejan una afuera',
    J(acomodar(tres, { x: 50, y: 60 }, 10)) ===
        J({ posiciones: [P(10, -15), P(10, 15), P(-10, -10)], entra: true, fuera: [] }),
);
revisar(
    'si los normales alcanzan, gana la variante normal (menor fondo)',
    J(acomodar(tres, { x: 60, y: 50 }, 10)) ===
        J({ posiciones: [P(0, -5), P(20, -5), P(-20, 0)], entra: true, fuera: [] }),
);

console.log('\n▶ acomodar: lo que no entra');
const ancha = acomodar([cubo, h(300, 10), cubo], cama, 10);
revisar('huella más ancha que la cama -> en fuera, con índice de entrada', J(ancha.fuera) === '[1]' && !ancha.entra);
revisar('devuelve una posición por huella', ancha.posiciones.length === 3);
const muchas = acomodar(Array(5).fill(h(100, 100)), cama, 10);
revisar('5 de 100x100 en 220: una queda afuera', muchas.fuera.length === 1 && !muchas.entra);
revisar(
    'entra es lo contrario de tener fuera',
    [ancha, muchas].every(r => r.entra === (r.fuera.length === 0)),
);
revisar('sin huellas: vacío y entra', J(acomodar([], cama, 10)) === J({ posiciones: [], entra: true, fuera: [] }));

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
    if (J(r) !== J(acomodar(hs, c, sep))) nodeterministas++;
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
    J(acomodar([h(30, 30), h(30, 30)], cama, 10).posiciones) === J([P(-20, 0), P(20, 0)]),
);
revisar(
    'mismo fondo: primero la más ancha; la salida respeta el orden de entrada',
    J(acomodar([h(20, 20), h(20, 40), h(30, 40)], cama, 10).posiciones) === J([P(35, -10), P(5, 0), P(-30, 0)]),
);
const entrada = [h(10, 50), h(60, 10), h(40, 30)];
const ida = acomodar(entrada, cama, 10);
const vuelta = acomodar([...entrada].reverse(), cama, 10);
revisar(
    'mismas medidas en otro orden: cada una conserva su lugar',
    J([...vuelta.posiciones].reverse()) === J(ida.posiciones),
);

console.log('\n▶ repartirTriangulos');
revisar('si el total entra -> Infinity (incluso justo)', repartirTriangulos([1000, 3000], [1, 1], 4000) === Infinity);
revisar('proporcional', J(repartirTriangulos([1000, 3000], [1, 1], 2000)) === '[500,1500]');
revisar('piso de 500 por pieza', J(repartirTriangulos([100000, 600], [1, 1], 1000)) === '[994,500]');
revisar('con copias: el tope es por copia', J(repartirTriangulos([4000], [2], 4000)) === '[1000]');
revisar('con copias: nunca menos de 500', J(repartirTriangulos([4000], [4], 1000)) === '[500]');
revisar(
    'las copias cuentan en el total',
    repartirTriangulos([1000], [4], 3999) !== Infinity && repartirTriangulos([1000], [4], 4000) === Infinity,
);
revisar('una pieza chica no sube por el piso', repartirTriangulos([100, 9000], [1, 1], 5000)[0] === 100);

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

console.log(fallas ? `\n✘ ${fallas} FALLAS (${aciertos} OK)` : `\nTODAS LAS PRUEBAS OK (${aciertos})`);
process.exit(fallas ? 1 : 0);
