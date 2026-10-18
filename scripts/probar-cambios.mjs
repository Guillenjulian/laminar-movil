// Pruebas de src/perfiles/cambios.js (corren en Node, sin navegador).
//
// Uso: npm run test:cambios

import { validarCambios, cambiosARangos, resumenCambios, avisosPostLaminado } from '../src/perfiles/cambios.js';

let fallas = 0;
let aciertos = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (condicion) aciertos++;
    else fallas++;
}
const J = JSON.stringify;
const errores = (lista, ctx) => validarCambios(lista, ctx).errores.length;
const B = { sliceHeight: 0.2, firstSliceHeight: 0.2, outputFeedrate: 60, outputFinishrate: 45 };
const rangos = (c, base = B) => cambiosARangos(Array.isArray(c) ? c : [c], base);

console.log('\n▶ validarCambios: entradas, orden y solapes');
revisar(
    'no arreglo / vacío -> vacío',
    [null, 'x', []].every(x => J(validarCambios(x)) === J({ cambios: [], errores: [] })),
);
const basura = validarCambios([null, 'a', 7, NaN, [], { desdeMm: 5, tempBoquilla: 210, x: 1 }]);
revisar(
    'descarta basura y claves desconocidas',
    J(basura) === J({ cambios: [{ desdeMm: 5, tempBoquilla: 210 }], errores: [] }),
);
const orden = validarCambios([
    { desdeMm: 20, velocidad: 80 },
    { desdeMm: 5, relleno: 0.1 },
]);
revisar(
    'ordena y corta el que no tiene hastaMm en el siguiente',
    J(orden.cambios.map(c => [c.desdeMm, c.hastaMm])) === '[[5,20],[20,null]]',
);
const solape = validarCambios([
    { desdeMm: 5, hastaMm: 15, relleno: 0.2 },
    { desdeMm: 10, relleno: 0.4 },
]);
revisar('solape explícito: error y se descarta el segundo', solape.errores.length === 1 && solape.cambios.length === 1);
const pegados = [
    { desdeMm: 5, hastaMm: 10, relleno: 0.2 },
    { desdeMm: 10, relleno: 0.4 },
];
revisar('hastaMm == desdeMm del siguiente no es solape', errores(pegados) === 0);
const nueve = Array.from({ length: 9 }, (_, i) => ({ desdeMm: i + 1, tempBoquilla: 200 }));
revisar(
    '9 cambios: error y quedan 8; 8 es válido',
    validarCambios(nueve).cambios.length === 8 && errores(nueve) === 1 && errores(nueve.slice(1)) === 0,
);
const mezcla = validarCambios([
    { desdeMm: 0, relleno: 1 },
    { desdeMm: 3, relleno: 1 },
]);
revisar('uno malo no tira a los buenos', mezcla.cambios.length === 1 && mezcla.errores.length === 1);

console.log('\n▶ validarCambios: errores y bordes (1 = rechaza, 0 = acepta)');
const casos = [
    [{ desdeMm: 0, relleno: 0.2 }, 1, 'desdeMm 0'],
    [{ desdeMm: -1, relleno: 0.2 }, 1, 'desdeMm negativo'],
    [{ desdeMm: 1001, relleno: 0.2 }, 1, 'desdeMm 1001'],
    [{ desdeMm: 1000, relleno: 0.2 }, 0, 'desdeMm 1000'],
    [{ desdeMm: NaN, relleno: 0.2 }, 1, 'desdeMm NaN'],
    [{ desdeMm: '5', relleno: 0.2 }, 1, 'desdeMm texto'],
    [{ desdeMm: 5, hastaMm: 5, relleno: 0.2 }, 1, 'hastaMm == desdeMm'],
    [{ desdeMm: 5, hastaMm: 3, relleno: 0.2 }, 1, 'hastaMm < desdeMm'],
    [{ desdeMm: 5, hastaMm: 5.1, relleno: 0.2 }, 0, 'hastaMm apenas mayor'],
    [{ desdeMm: 5 }, 1, 'sin propiedades'],
    [{ desdeMm: 5, hastaMm: 8 }, 1, 'sólo hastaMm'],
    [{ desdeMm: 5, relleno: Infinity }, 1, 'relleno Infinity'],
    [{ desdeMm: 5, patron: '' }, 1, 'patrón vacío'],
    [{ desdeMm: 5, patron: 'xx' }, 0, 'patrón sin contexto no se revisa'],
];
for (const [c, esperado, nombre] of casos) revisar(nombre, errores([c]) === esperado);
const limites = {
    relleno: [0, 1],
    tempBoquilla: [150, 300],
    velocidad: [50, 150],
    ventilador: [0, 100],
    retraccion: [0, 10],
};
for (const [k, [min, max]] of Object.entries(limites)) {
    const e = v => errores([{ desdeMm: 5, [k]: v }]);
    revisar(`${k}: ${min} y ${max} válidos`, e(min) + e(max) === 0);
    revisar(`${k}: fuera de rango`, e(min - max / 100) + e(max * 1.01) === 2);
}
const ctx = { patrones: ['gyroid'] };
revisar(
    'patrón conocido / desconocido',
    errores([{ desdeMm: 5, patron: 'gyroid' }], ctx) + errores([{ desdeMm: 5, patron: 'xx' }], ctx) === 1,
);

console.log('\n▶ cambiosARangos: mapeo mm -> capa [h, h0, desde, lo, hasta, hi]');
const tabla = [
    [0.2, 0.2, 10, 50, 12, 59],
    [0.2, 0.2, 10.05, 51, 12.05, 60],
    [0.2, 0.2, 0.1, 1, 1, 4],
    [0.2, 0.3, 10, 50, 12, 59],
    [0.2, 0.3, 0.1, 1, 0.5, 1],
    [0.12, 0.24, 10, 83, 12, 98],
    [0.12, 0.24, 1, 8, 2, 15],
];
for (const [h, h0, x, lo, y, hi] of tabla) {
    const [r] = rangos({ desdeMm: x, hastaMm: y, tempBoquilla: 200 }, { sliceHeight: h, firstSliceHeight: h0 });
    revisar(
        `h=${h} h0=${h0}: ${x}..${y} mm -> capas ${lo}..${hi}`,
        r?.lo === lo && r.hi === hi,
        r ? `(${r.lo}..${r.hi})` : '',
    );
}
// Casos que dependen de la tolerancia EPS (división casi exacta en punto flotante)
const eps = [
    [0.2, 0.2, { desdeMm: 0.8 }, 'lo', 4],
    [0.2, 0.2, { desdeMm: 1.4 }, 'lo', 7],
    [0.2, 0.2, { desdeMm: 2.0 }, 'lo', 10],
    [0.2, 0.2, { desdeMm: 0.2, hastaMm: 0.6 }, 'hi', 2],
    [0.2, 0.2, { desdeMm: 0.2, hastaMm: 1.0 }, 'hi', 4],
    [0.2, 0.2, { desdeMm: 0.2, hastaMm: 4.8 }, 'hi', 23],
    [0.12, 0.24, { desdeMm: 0.6 }, 'lo', 4],
    [0.12, 0.24, { desdeMm: 0.3, hastaMm: 4.8 }, 'hi', 38],
];
for (const [h, h0, c, k, esperado] of eps) {
    const [r] = rangos({ ...c, tempBoquilla: 200 }, { sliceHeight: h, firstSliceHeight: h0 });
    revisar(`EPS: h=${h} h0=${h0} ${J(c)} -> ${k} ${esperado}`, r?.[k] === esperado, r ? `(${r[k]})` : '');
}
const t = { tempBoquilla: 200 };
revisar('desde en el piso de una capa no se corre', rangos({ desdeMm: 0.6, ...t })[0].lo === 3);
revisar(
    'desde <= primera capa -> lo 1 (nunca 0)',
    rangos({ desdeMm: 0.2, ...t })[0].lo === 1 && rangos({ desdeMm: 0.05, ...t })[0].lo === 1,
);
revisar('sin hastaMm -> hi 1e9', rangos({ desdeMm: 10, ...t })[0].hi === 1e9);
const sinBase = { sliceHeight: 0.2, firstSliceHeight: 0.2 };
revisar(
    'sin capas / sin cambios / sin base de velocidad -> []',
    rangos({ desdeMm: 5.05, hastaMm: 5.1, ...t }).length +
        rangos([]).length +
        rangos({ desdeMm: 10, velocidad: 80 }, sinBase).length ===
        0,
);

console.log('\n▶ cambiosARangos: campos de Kiri');
const campos = c => rangos({ desdeMm: 10, ...c })[0].fields;
revisar(
    'velocidad 80 %: feedrate y finishrate',
    J(campos({ velocidad: 80 })) === J({ outputFeedrate: 48, outputFinishrate: 36 }),
);
revisar('velocidad 55 % redondea', campos({ velocidad: 55 }).outputFinishrate === Math.round(45 * 0.55));
revisar(
    'ventilador 0 / 50 / 100 -> 0 / 128 / 255',
    [0, 50, 100].map(v => campos({ ventilador: v }).outputFanSpeed).join() === '0,128,255',
);
const mapa = [
    ['relleno', 0, 'sliceFillSparse'],
    ['patron', 'gyroid', 'sliceFillType'],
    ['tempBoquilla', 215, 'outputTemp'],
    ['retraccion', 1.5, 'outputRetractDist'],
];
for (const [k, v, kiri] of mapa) revisar(`${k} -> ${kiri}`, campos({ [k]: v })[kiri] === v);
const dos = [
    { desdeMm: 5, hastaMm: 10, relleno: 0.1 },
    { desdeMm: 10, relleno: 0.5 },
];
revisar(
    'mantiene el orden de los cambios',
    rangos(dos)
        .map(r => r.lo)
        .join() === '25,50',
);

console.log('\n▶ resumenCambios y avisosPostLaminado');
revisar(
    'resumen básico',
    resumenCambios([{ desdeMm: 10, relleno: 0.1, tempBoquilla: 215 }]) === 'desde 10 mm: relleno 10 %, 215 °C',
);
revisar(
    'resumen con hasta y decimales',
    resumenCambios([{ desdeMm: 6, hastaMm: 12.5, retraccion: 1.5 }]) === 'de 6 a 12,5 mm: retracción 1,5 mm',
);
const varios = [
    { desdeMm: 5, velocidad: 80 },
    { desdeMm: 9, ventilador: 0 },
];
revisar(
    'resumen de varios y vacío',
    resumenCambios(varios) === 'desde 5 mm: velocidad 80 %; desde 9 mm: ventilador 0 %' && resumenCambios([]) === '',
);
const cs = [10, 30, 20].map(d => ({ desdeMm: d, tempBoquilla: 200 }));
revisar('avisa los que quedan por encima (o justo en el alto)', avisosPostLaminado(cs, 20).length === 2);
revisar('sin avisos si todo aplica', avisosPostLaminado(cs, 40).length === 0 && avisosPostLaminado([], 5).length === 0);

console.log('\n▶ revisión: mismo desde, null y avisos con capas');
const igualDesde = validarCambios([
    { desdeMm: 5, relleno: 0.2 },
    { desdeMm: 5, tempBoquilla: 210 },
]);
revisar(
    'mismo desdeMm: error y se descarta el segundo',
    igualDesde.errores.length === 1 && igualDesde.cambios.length === 1,
);
const nulos = validarCambios([
    { desdeMm: 5, hastaMm: null, relleno: null, patron: null, tempBoquilla: 210, velocidad: null },
]);
revisar('null equivale a sin valor', J(nulos) === J({ cambios: [{ desdeMm: 5, tempBoquilla: 210 }], errores: [] }));
revisar('sólo nulls -> "no cambia nada"', errores([{ desdeMm: 5, relleno: null }]) === 1);
const capa = { sliceHeight: 0.2, firstSliceHeight: 0.2 };
const av = (d, alto, c = capa) => avisosPostLaminado([{ desdeMm: d, tempBoquilla: 200 }], alto, c).length;
revisar('con capas: 9.8 aplica (capa 49); 10 avisa (no hay capa 50)', av(9.8, 10) === 0 && av(10, 10) === 1);
revisar('con capas: 9.9 cae entre capas y avisa', av(9.9, 10) === 1);
revisar('con capas: 10.1 en pieza de 10 avisa', av(10.1, 10) === 1);
revisar(
    'altura no numérica o cambios inválidos -> []',
    [NaN, undefined, '10', null].every(a => avisosPostLaminado(cs, a).length === 0) &&
        avisosPostLaminado(null, 10).length === 0,
);

console.log('\n▶ rangos contiguos (la capa pertenece al cambio si su piso cae en [desde, hasta))');
const bloques = [0, 10, 20, 30, 40, 50];
const bloquesCambio = bloques
    .slice(1)
    .map((d, i) => ({ desdeMm: bloques[i] || 0.01, hastaMm: d, tempBoquilla: 200 + i }));
for (const [h, h0] of [
    [0.2, 0.2],
    [0.12, 0.2],
    [0.12, 0.24],
    [0.28, 0.28],
    [0.3, 0.3],
]) {
    const rs = rangos(bloquesCambio, { sliceHeight: h, firstSliceHeight: h0 });
    const duenos = new Map();
    rs.forEach((r, i) => {
        for (let c = r.lo; c <= r.hi; c++) duenos.set(c, [...(duenos.get(c) || []), i]);
    });
    const ultima = rs[rs.length - 1].hi;
    const sinCubrir = Array.from({ length: ultima }, (_, i) => i + 1).filter(c => !duenos.has(c));
    const doble = [...duenos.values()].filter(v => v.length > 1).length;
    revisar(
        `h=${h} h0=${h0}: sin huecos ni capas repetidas`,
        rs.length === 5 && !sinCubrir.length && !doble,
        J(sinCubrir),
    );
    const piso = c => h0 + (c - 1) * h;
    const mal = rs
        .slice(1)
        .filter(
            (r, i) =>
                !(Math.abs(piso(r.lo) - bloques[i + 1]) < h) ||
                piso(r.lo) < bloques[i + 1] - 1e-6 ||
                piso(r.lo - 1) >= bloques[i + 1] - 1e-6,
        );
    revisar(`h=${h} h0=${h0}: cada cambio empieza en la capa con piso >= su desde`, mal.length === 0);
}
const justo = rangos([
    { desdeMm: 0.8, hastaMm: 1.4, ...t },
    { desdeMm: 1.4, ...t },
]);
revisar(
    'la capa con piso justo en X va al cambio que empieza en X',
    justo[0].hi + 1 === justo[1].lo && justo[1].lo === 7,
);

console.log(fallas ? `\n✘ ${fallas} FALLAS (${aciertos} OK)` : `\nTODAS LAS PRUEBAS OK (${aciertos})`);
process.exit(fallas ? 1 : 0);
