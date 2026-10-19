// Pruebas del lector: detección de capas, pausas y modo espiral.
import { leerPlano, offsetDe } from './ayuda.mjs';

const f32 = (...v) => Array.from(Float32Array.of(...v));

function pausas({ revisar, igual }) {
    console.log('\n▶ pausaCapa');
    const sube = [
        ...['; feature shells', 'G1 Z0.2', 'G1 X10 Y0 E1', 'G1 X10 Y10 E2'],
        ...['G1 Z0.4', 'G1 X0 Y10 F3000', 'G1 X0 Y0 E3', 'G1 X10 Y0 E4'],
    ];
    const a = leerPlano(sube);
    revisar(
        'hay subida de Z tras la última extrusión: apunta a ese G1 Z',
        igual(a.pausas, [offsetDe(sube, 1), offsetDe(sube, 4)]),
        a.pausas.join(','),
    );
    revisar('...y las capas quedan [0, 2, 4]', igual(a.ini, [0, 2, 4]));
    const sinZ = ['; feature shells', 'G1 X10 Y0 E1', 'G1 X10 Y10 E2'];
    revisar('sin subida: apunta a la primera extrusión', igual(leerPlano(sinZ).pausas, [offsetDe(sinZ, 1)]));
}

// Vasija: Z sube en cada tramo y la marca "; capa en espiral" abre la vuelta.
function espiral({ revisar, igual }) {
    console.log('\n▶ modo espiral');
    const M = '; capa en espiral';
    const S = [
        ...['G90', 'M82', 'G1 Z0.2 F600', '; feature shells', M],
        ...['G1 X10 Y0 Z0.20 E1', 'G1 X10 Y10 Z0.25 E2', 'G1 X0 Y10 Z0.30 E3', M],
        ...['G1 X0 Y0 Z0.35 E4', 'G1 X10 Y0 Z0.40 E5', M, 'G1 X10 Y10 Z0.45 E6'],
    ];
    const r = leerPlano(S);
    revisar('3 vueltas marcadas: inicioCapa [0, 3, 5, 6]', igual(r.ini, [0, 3, 5, 6]), r.ini.join(','));
    revisar('zCapa de cada vuelta', igual(r.z, f32(0.2, 0.35, 0.45)), r.z.join(','));
    const esperado = [offsetDe(S, 2), offsetDe(S, 9), offsetDe(S, 12)];
    revisar('pausa de la vuelta del medio: su primera extrusión', igual(r.pausas, esperado), r.pausas.join(','));
    const sinMarca = leerPlano(S.filter(l => l !== M));
    revisar('sin la marca, la Z que sube en cada tramo no abre capas', igual(sinMarca.z, f32(0.2)));
}

function deteccion({ revisar, igual }) {
    console.log('\n▶ detección de capa');
    const viaje = [
        ...['; feature shells', 'G1 Z0.2', 'G1 X10 Y0 E1', 'G1 X10 Y10 E2'],
        ...['G1 Z0.4', 'G1 Z0.6', 'G1 X0 Y10 F3000', 'G1 X0 Y0 E3', 'G1 Z5'],
    ];
    const a = leerPlano(viaje);
    revisar(
        'subir Z sin extruir no abre capa (ni al final)',
        igual(a.z, f32(0.2, 0.6)) && igual(a.ini, [0, 2, 3]),
        a.z.join(','),
    );
    const soloZ = leerPlano(['; feature shells', 'G1 Z0.2', 'G1 X10 Y0 F3000', 'G1 Z0.4']);
    revisar('sin extrusión no hay capas', igual(soloZ.z, []) && igual(soloZ.ini, [0]));
    const con = leerPlano(['; feature shells', 'G1 Z0.2', 'G1 X10 Y0 E1', 'G1 Z0.4', 'G1 X10 Y10 E2']);
    revisar('con extrusión a otra Z, sí abre capa', igual(con.z, f32(0.2, 0.4)) && igual(con.ini, [0, 1, 2]));
    const V = [
        ...['; feature shells', 'G1 Z0.12', 'G1 X10 Y0 E1', 'G1 Z0.4', 'G1 X10 Y10 E2'],
        ...['G1 Z0.52', 'G1 X0 Y10 E3', 'G1 Z0.8', 'G1 X0 Y0 E4'],
    ];
    const v = leerPlano(V);
    revisar('altura variable 0,12 / 0,28: zCapa exacta', igual(v.z, f32(0.12, 0.4, 0.52, 0.8)), v.z.join(','));
    revisar(
        '...y la Z cuantizada de cada tramo',
        igual([v.pos[2], v.pos[8], v.pos[14], v.pos[20]], [30006, 30020, 30026, 30040]),
    );
}

export function probarCapas(ctx) {
    pausas(ctx);
    espiral(ctx);
    deteccion(ctx);
}
