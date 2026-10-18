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
}

export function probarLimites(ctx) {
    tope(ctx);
    crecimiento(ctx);
}
