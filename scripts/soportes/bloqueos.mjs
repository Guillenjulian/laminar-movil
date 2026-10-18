// Pruebas de src/motor/bloqueos.js (Node, sin navegador). Las corre scripts/probar-soportes.mjs.

import {
    validarBloqueos,
    seccionBloqueos,
    bloqueaPunto,
    sinBloqueos,
    MAX_BLOQUEOS,
    RADIO_MAX_MM,
    RADIO_MIN_MM,
} from '../../src/motor/bloqueos.js';

const esfera = (id, x, y, z, radio) => ({ id, forma: 'esfera', centro: { x, y, z }, radio });
const area = p => {
    let s = 0;
    p.forEach((a, i) => {
        const c = p[(i + 1) % p.length];
        s += a.x * c.y - c.x * a.y;
    });
    return s / 2;
};
const cuadrado = l => [
    { x: -l, y: -l },
    { x: l, y: -l },
    { x: l, y: l },
    { x: -l, y: l },
];
// Resta de mentira sólo para la prueba: el círculo cae entero adentro de la sombra, así que restar es agregar un
// agujero (anillo invertido) y el área con signo queda cuadrado − círculo. La resta real es POLY.subtract del puente.
const restarAgujero = (sombra, secciones) => [...sombra, ...secciones.map(s => [...s].reverse())];
const areaTotal = polis => polis.reduce((s, p) => s + area(p), 0);

function probarValidar(revisar) {
    console.log('\n▶ validarBloqueos');
    const malos = [
        null,
        5,
        esfera(1, 0, 0, 0, -3),
        esfera(2, NaN, 0, 0, 5),
        { ...esfera(3, 0, 0, 0, 5), forma: 'caja' },
    ];
    revisar(
        'descarta basura, NaN, caja y radio negativo',
        validarBloqueos([...malos, esfera(9, 1, 2, 3, 6)]).length === 1,
    );
    revisar('no arreglo -> []', validarBloqueos(undefined).length === 0 && validarBloqueos('x').length === 0);
    const acot = validarBloqueos([esfera(1, 0, 0, 0, 0.5), esfera(2, 0, 0, 0, 999)]);
    revisar('acota radios', acot[0].radio === RADIO_MIN_MM && acot[1].radio === RADIO_MAX_MM);
    const muchos = Array.from({ length: MAX_BLOQUEOS + 5 }, (_, i) => esfera(i, 0, 0, 0, 5));
    revisar('corta en MAX_BLOQUEOS', validarBloqueos(muchos).length === MAX_BLOQUEOS);
}

function probarSeccion(revisar) {
    console.log('\n▶ seccionBloqueos y bloqueaPunto');
    const b = [esfera(1, 10, 20, 5, 8)];
    for (const dz of [0, 3, -6]) {
        const [c] = seccionBloqueos(b, 5 + dz);
        const esperado = Math.sqrt(64 - dz * dz);
        const ok = c.every(p => Math.abs(Math.hypot(p.x - 10, p.y - 20) - esperado) < 1e-9);
        revisar(`dz=${dz}: todos los puntos a radio √(r²−dz²)=${esperado.toFixed(3)}`, ok && c.length === 16);
    }
    revisar('vacía si |dz| >= r', seccionBloqueos(b, 13).length === 0 && seccionBloqueos(b, -3).length === 0);
    revisar('sin bloqueos -> []', seccionBloqueos([], 5).length === 0 && seccionBloqueos(undefined, 5).length === 0);
    const dentro = bloqueaPunto(b, { x: 10, y: 20, z: 5 });
    const fuera = !bloqueaPunto(b, { x: 19, y: 20, z: 5 });
    revisar('bloqueaPunto: dentro, fuera y margen', dentro && fuera && bloqueaPunto(b, { x: 19, y: 20, z: 5 }, 1.5));
}

function probarResta(revisar) {
    console.log('\n▶ sinBloqueos (resta de la sombra)');
    const sombra = [cuadrado(30)];
    const una = [esfera(1, 0, 0, 5, 10)];
    const resultado = areaTotal(sinBloqueos(sombra, 5, una, restarAgujero));
    const circ = area(seccionBloqueos(una, 5)[0]);
    revisar('cuadrado − círculo en el medio deja el área esperada', Math.abs(resultado - (3600 - circ)) < 1e-6);
    // Discretización: 16 lados inscriptos dan 97,45 % del círculo ideal, o sea 2,6 % de error contra π·r².
    const errRel = Math.abs(resultado - (3600 - Math.PI * 100)) / (Math.PI * 100);
    revisar(
        `...y contra el círculo ideal, dentro de la discretización (2,6 %): ${(errRel * 100).toFixed(2)} %`,
        errRel < 0.026,
    );
    const dos = sinBloqueos(sombra, 5, [esfera(1, -15, 0, 5, 5), esfera(2, 15, 0, 5, 5)], restarAgujero);
    revisar('varias esferas se restan todas', dos.length === 3);
    const ident =
        sinBloqueos(sombra, 5, [], restarAgujero) === sombra &&
        sinBloqueos(sombra, 5, undefined, restarAgujero) === sombra;
    revisar('con [] devuelve el MISMO shadow (identidad, misma referencia)', ident);
    revisar(
        'capa con z índice (115) que no cruza zonas: no rompe y es identidad',
        sinBloqueos(sombra, 115, una, restarAgujero) === sombra,
    );
}

export default async function ({ revisar }) {
    probarValidar(revisar);
    probarSeccion(revisar);
    probarResta(revisar);
}
