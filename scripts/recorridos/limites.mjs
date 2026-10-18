// Pruebas del lector: tope de tramos (`incompleta`) y crecimiento de los arrays.
import { leerPlano } from './ayuda.mjs';

function tope({ revisar, igual }) {
    console.log('\n▶ tope e incompleta');
    const L = [
        ...['; feature shells', 'G1 Z0.2', 'G1 X10 Y0 E1', 'G1 X10 Y10 E2'],
        ...['G1 Z0.4', 'G1 X0 Y10 E3', 'G1 X0 Y0 E4', 'G1 Z0.6', 'G1 X10 Y0 F3000'],
    ];
    const justo = leerPlano(L, 4);
    revisar('tope igual a los 4 tramos: completa', justo.incompleta === false && justo.tip.length === 4);
    revisar('...y sin tope también', leerPlano(L).incompleta === false);
    const corto = leerPlano(L, 3);
    revisar('tope de 3: incompleta', corto.incompleta === true && corto.tip.length === 3 && corto.pos.length === 18);
    revisar(
        '...con inicioCapa cerrado [0, 2, 3] y 2 zCapa',
        igual(corto.ini, [0, 2, 3]) && corto.z.length === 2,
        corto.ini.join(','),
    );
}

// Cuadrado de 10 mm repetido: cada tramo gira 90°, así que ninguno se une con el anterior.
function zigzag(n) {
    const puntos = [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
    ];
    const L = ['; feature shells', 'G1 Z0.2', 'G1 X10 Y10 F3000'];
    for (let k = 1; k <= n; k++) L.push(`G1 X${puntos[k % 4][0]} Y${puntos[k % 4][1]} E${k}`);
    return L;
}

function crecimiento({ revisar, igual }) {
    console.log('\n▶ crecimiento de los arrays (más de 65536 tramos)');
    const n = 70000;
    const r = leerPlano(zigzag(n));
    revisar(
        'cantidad exacta de tramos',
        r.tip.length === n && r.pos.length === 6 * n && r.col.length === 6 * n,
        `${r.tip.length}`,
    );
    revisar('sin tope: completa y una sola capa', r.incompleta === false && igual(r.ini, [0, n]));
    const ultimo = r.pos.slice(6 * (n - 1));
    revisar(
        'último tramo: (10;20) -> (10;10)',
        igual(ultimo, [30500, 31000, 30010, 30500, 30500, 30010]),
        ultimo.join(','),
    );
    const pasado = r.pos.slice(6 * 65536, 6 * 65537);
    revisar(
        'el tramo 65537 (ya en el array crecido): (10;10) -> (20;10)',
        igual(pasado, [30500, 30500, 30010, 31000, 30500, 30010]),
    );
    const malos = tramosMalos(r.pos, n);
    revisar('los 70000 tramos (lo copiado al crecer incluido) son los del cuadrado', malos === 0, `${malos} distintos`);
    revisar('colores: todo naranja (perímetro) en los 420000 valores', todosNaranja(r.col));
}

// Esquinas del cuadrado ya cuantizadas, escritas a mano: (10;10) (20;10) (20;20) (10;20).
const ESQUINAS = [
    [30500, 30500],
    [31000, 30500],
    [31000, 31000],
    [30500, 31000],
];

// Cuántos tramos no son el i-ésimo lado del cuadrado (de la esquina i%4 a la siguiente, Z 0,2 -> 30010).
function tramosMalos(pos, n) {
    let malos = 0;
    for (let i = 0; i < n; i++) {
        const [x0, y0] = ESQUINAS[i % 4];
        const [x1, y1] = ESQUINAS[(i + 1) % 4];
        const esperado = [x0, y0, 30010, x1, y1, 30010];
        for (let k = 0; k < 6; k++) if (pos[6 * i + k] !== esperado[k]) malos++;
    }
    return malos;
}

function todosNaranja(col) {
    const naranja = [240, 138, 36];
    for (let i = 0; i < col.length; i++) if (col[i] !== naranja[i % 3]) return false;
    return col.length === 420000;
}

// Extrusión relativa (M83), G92 E0 y retracciones: sólo se dibuja lo que extruye.
function extrusion({ revisar, igual }) {
    console.log('\n▶ extrusión relativa, G92 y retracciones');
    const L = [
        ...['; feature shells', 'M83', 'G92 E0', 'G1 X10 Y0 E1', 'G1 E-2', 'G1 X20 Y10 E-0.5', 'G1 E2'],
        ...['G1 X20 Y20 E1', 'M82', 'G92 E0', 'G1 X30 Y20 E0.5', 'G92 E0', 'G1 X30 Y30 E0.5'],
    ];
    const r = leerPlano(L);
    revisar('relativo: retracción y desplazamiento con E negativo no se dibujan (4 tramos)', r.tip.length === 4);
    revisar(
        '...ni la recarga (E2 sin mover); los tramos son los esperados',
        igual(r.pos, [
            ...[30000, 30000, 30000, 30500, 30000, 30000],
            ...[31000, 30500, 30000, 31000, 31000, 30000],
            ...[31000, 31000, 30000, 31500, 31000, 30000],
            ...[31500, 31000, 30000, 31500, 31500, 30000],
        ]),
        r.pos.join(','),
    );
}

// Cuadrado: tope 2 con 2 tramos por capa. Al cortar justo al abrir la 2.ª capa no debe quedar una capa vacía.
function capaVacia({ revisar, igual }) {
    console.log('\n▶ tope justo al abrir una capa');
    const L = [
        ...['; feature shells', 'G1 Z0.2', 'G1 X10 Y0 E1', 'G1 X10 Y10 E2'],
        ...['G1 Z0.4', 'G1 X0 Y10 E3', 'G1 X0 Y0 E4'],
    ];
    const r = leerPlano(L, 2);
    revisar(
        'tope 2: inicioCapa [0, 2] y 1 sola zCapa (reproduce bug de capa vacía: se arregla en recorridos-lector)',
        r.incompleta === true && igual(r.ini, [0, 2]) && r.z.length === 1,
        `inicioCapa=${r.ini.join(',')} zCapa=${r.z.length}`,
    );
}

export function probarLimites(ctx) {
    tope(ctx);
    capaVacia(ctx);
    crecimiento(ctx);
    extrusion(ctx);
}
