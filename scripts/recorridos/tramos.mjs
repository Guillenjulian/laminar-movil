// Pruebas del lector: cuantizado, tipos de línea de Kiri y unión de tramos.
import { leerPlano } from './ayuda.mjs';

// cuantizado = round((mm + 600) × 50). Los valores terminan en .5 a propósito: floor daría otro número.
function cuantizado({ revisar, igual }) {
    console.log('\n▶ cuantizado');
    const L = ['; feature shells', 'G1 Z0.2', 'G1 X0.25 Y-10.75 E1', 'G1 X100.25 Y-10.75 E2', 'G1 X100.25 Y200.25 E3'];
    const r = leerPlano(L);
    revisar(
        'X/Y/Z dan los Uint16 exactos (redondeo, no floor)',
        igual(r.pos, [
            ...[30000, 30000, 30010, 30013, 29463, 30010],
            ...[30013, 29463, 30010, 35013, 29463, 30010],
            ...[35013, 29463, 30010, 35013, 40013, 30010],
        ]),
        r.pos.join(','),
    );
    revisar('posiciones es Uint16Array', r.posiciones instanceof Uint16Array);
    revisar('la caja usa mm reales', igual(r.caja, { min: [0, -10.75, 0.2], max: [100.25, 200.25, 0.2] }));
    const c = leerPlano(['; feature shells', 'G1 X-700 Y800 E1']);
    revisar('fuera de rango se recorta a 0 y 65535', igual(c.pos.slice(3, 5), [0, 65535]), c.pos.join(','));
}

const AZUL = [61, 139, 253];
const ROJO = [224, 79, 95];
const NARANJA = [240, 138, 36];
const TURQUESA = [46, 196, 182];
const VIOLETA = [155, 89, 182];
const GRIS = [150, 150, 150];

function tiposKiri({ revisar, igual }) {
    console.log('\n▶ tipos de línea de Kiri');
    const nombres = ['shells', 'support', 'skirt', 'brim', 'solid fill', 'sparse infill', 'wipe tower'];
    const puntos = [
        [10, 0],
        [10, 10],
        [20, 10],
        [20, 20],
        [30, 20],
        [30, 30],
        [40, 30],
    ];
    const L = ['G1 X5 Y0 E0.5 ; purga del inicio, no se dibuja'];
    nombres.forEach((n, i) => L.push(`; feature ${n}`, `G1 X${puntos[i][0]} Y${puntos[i][1]} E${i + 1}`));
    const r = leerPlano(L);
    revisar(
        'tipos: perímetro, soporte, falda, borde, sólido, relleno, desconocido -> otro',
        igual(r.tip, [0, 3, 4, 4, 1, 2, 5]),
        r.tip.join(','),
    );
    const esperado = [NARANJA, TURQUESA, VIOLETA, VIOLETA, ROJO, AZUL, GRIS].flatMap(c => [...c, ...c]);
    revisar('colores RGB de cada tramo (dos puntos por tramo)', igual(r.col, esperado));
    revisar('la purga anterior al primer "; feature" no se dibuja', r.tip.length === 7);
}

function unir({ revisar, igual }) {
    console.log('\n▶ unión de tramos');
    const cuantos = tramos => leerPlano(['; feature shells', ...tramos.map((t, i) => `G1 ${t} E${i + 1}`)]);
    const rec = cuantos(['X0.5 Y0', 'X1 Y0', 'X1.5 Y0', 'X2 Y0']);
    revisar('4 tramos colineales -> 1', rec.tip.length === 1);
    revisar('el tramo unido va de 0 a 2 mm', igual(rec.pos, [30000, 30000, 30000, 30100, 30000, 30000]));
    const d01 = cuantos(['X1 Y0.1', 'X2 Y0']);
    revisar('un desvío de 0,1 mm no se une (2 tramos)', d01.tip.length === 2);
    revisar(
        '...y comparten el punto (1; 0,1)',
        igual(d01.pos, [...[30000, 30000, 30000, 30050, 30005, 30000], ...[30050, 30005, 30000, 30100, 30000, 30000]]),
    );
    revisar('un desvío de 0,01 mm en un tramo corto sí se une', cuantos(['X1 Y0.01', 'X2 Y0']).tip.length === 1);
    revisar(
        'desvío 0,01 mm pero tramo de 4 mm (curva larga) no se une',
        cuantos(['X2 Y0.01', 'X4 Y0']).tip.length === 2,
    );
    revisar('volver sobre el mismo camino no se une', cuantos(['X2 Y0', 'X1 Y0']).tip.length === 2);
    const mixto = leerPlano(['; feature shells', 'G1 X1 Y0 E1', '; feature support', 'G1 X2 Y0 E2']);
    revisar('colineales de distinto tipo no se unen', igual(mixto.tip, [0, 3]));
}

export function probarTramos(ctx) {
    cuantizado(ctx);
    tiposKiri(ctx);
    unir(ctx);
}
