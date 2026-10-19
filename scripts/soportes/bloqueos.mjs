// Pruebas de src/motor/bloqueos.js (Node, sin navegador). Las corre scripts/probar-soportes.mjs.

import {
    validarBloqueos,
    seccionBloqueos,
    radioSeccion,
    LADOS_SECCION,
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
// Resta de mentira sólo para la prueba: el círculo cae entero adentro de la sombra, así que restar es agregarlo
// como otro anillo (Kiri resta con even-odd: el sentido de giro no importa). La resta real es POLY.subtract del puente.
const restarAgujero = (sombra, secciones) => [...sombra, ...secciones];
// Área even-odd con anillos anidados: el primero menos los demás, sin depender del sentido de giro.
const areaTotal = polis => Math.abs(area(polis[0])) - polis.slice(1).reduce((t, p) => t + Math.abs(area(p)), 0);

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

function probarVarias(revisar) {
    // z, radio y centro distintos; la tercera no cruza z=4 y no debe correr a las demás.
    const bs = [esfera(1, 0, 0, 4, 6), esfera(2, 30, -10, 8, 7), esfera(3, -20, 5, 40, 5), esfera(4, 12, 12, 1, 5)];
    const secs = seccionBloqueos(bs, 4);
    const cosPi = Math.cos(Math.PI / 16);
    const esperado = [
        { cx: 0, cy: 0, r: 6 },
        { cx: 30, cy: -10, r: Math.sqrt(49 - 16) },
        { cx: 12, cy: 12, r: Math.sqrt(25 - 9) },
    ];
    revisar('2+ esferas: una por cada que cruza z (la lejana no aporta)', secs.length === esperado.length);
    esperado.forEach((e, i) => {
        const c = secs[i];
        const cen = c && { x: c.reduce((t, p) => t + p.x, 0) / c.length, y: c.reduce((t, p) => t + p.y, 0) / c.length };
        const ok =
            c !== undefined &&
            Math.abs(cen.x - e.cx) < 1e-9 &&
            Math.abs(cen.y - e.cy) < 1e-9 &&
            c.every(p => Math.abs(Math.hypot(p.x - e.cx, p.y - e.cy) - e.r / cosPi) < 1e-9);
        revisar(`esfera ${i + 1}: centro (${e.cx}, ${e.cy}) y radio ${e.r.toFixed(3)}`, ok);
    });
}

function probarSeccion(revisar) {
    console.log('\n▶ seccionBloqueos y bloqueaPunto');
    const b = [esfera(1, 10, 20, 5, 8)];
    const cosPi = Math.cos(Math.PI / 16);
    for (const dz of [0, 3, -6]) {
        const c = seccionBloqueos(b, 5 + dz)[0];
        const esperado = Math.sqrt(64 - dz * dz);
        // Circunscripto: vértices a esperado/cos(π/16), puntos medios de los lados justo a `esperado`.
        const vert = c?.every(p => Math.abs(Math.hypot(p.x - 10, p.y - 20) - esperado / cosPi) < 1e-9);
        const med = c?.every((p, i) => {
            const q = c[(i + 1) % c.length];
            return Math.abs(Math.hypot((p.x + q.x) / 2 - 10, (p.y + q.y) / 2 - 20) - esperado) < 1e-9;
        });
        revisar(
            `dz=${dz}: lados tangentes al radio √(r²−dz²)=${esperado.toFixed(3)}`,
            c !== undefined && c.length === 16 && vert && med,
        );
    }
    probarVarias(revisar);
    const e = b[0];
    revisar(
        'radioSeccion: √(R²−dz²), 0 si |dz| ≥ R, y es el radio de seccionBloqueos',
        Math.abs(radioSeccion(e, 8) - Math.sqrt(64 - 9)) < 1e-12 &&
            radioSeccion(e, 13) === 0 &&
            radioSeccion(e, -3) === 0 &&
            seccionBloqueos([e], 8)[0].length === LADOS_SECCION,
    );
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
    const circ = Math.abs(area(seccionBloqueos(una, 5)[0]));
    revisar('cuadrado − círculo en el medio deja el área esperada', Math.abs(resultado - (3600 - circ)) < 1e-6);
    // Circunscripto: la zona nunca es más chica que la esfera; con 16 lados es 16·tan(π/16)/π − 1 ≈ 1,3 % más grande.
    const ideal = Math.PI * 100;
    const exceso = (circ - ideal) / ideal;
    revisar(
        `...la zona no queda más chica que la esfera (exceso ${(exceso * 100).toFixed(2)} %, tope 1,4 %)`,
        exceso >= 0 && exceso < 0.014,
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
