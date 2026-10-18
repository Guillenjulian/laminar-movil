// Cambios por altura contra el Kiri real (ADR 0002, sección 7, casos 1-9; es el "spike" de la tarea T3).
// Responsabilidad: laminar el cubo de 20 mm con `cambios` y revisar sobre el G-code que cada cambio
// aparece en la capa correcta. La tarea T7 amplía este archivo con los casos 10-11 (torres).
// Lo llama scripts/probar-motor.mjs dentro de su `try`, con su propio `laminar()` y `revisar()`.
// Regla de capas (ADR 0002, sección 3): una capa pertenece a un cambio si su PISO cae en [desde, hasta).
// El piso de la capa i (i >= 1) es la Z de la capa i-1; el offset de la balsa se mide contra la corrida base.

import { insertarPausas } from '../../src/motor/pausas.js';

// El lector de la vista previa es un worker: se carga en Node simulando `self` (igual que probar-motor.mjs).
globalThis.self ??= {};
const { leer: leerRecorridos } = await import('../../src/motor/recorridos.worker.js');

const EPS = 1e-6;
const CUBO = { caso: 'cubo', personal: { adhesion: 'nada' } };

/**
 * Recorre el G-code y lo ordena por capa de Kiri (`;LAYER:n`).
 * @param {string[]} lineas líneas del G-code
 * @returns {{ capas: object[], extrusiones: object[] }} capas con su Z y sus M104/M106/retracciones;
 *   extrusiones con capa, Z, F vigente y feature
 */
export function porCapa(lineas) {
    const capas = [];
    const extrusiones = [];
    let capa = null;
    let z = 0;
    let f = 0;
    let feature = '';
    lineas.forEach((l, i) => {
        const n = l.match(/^;LAYER:(\d+)/);
        if (n) {
            capa = { n: +n[1], ini: i, z: NaN, filamento: 0, m104: [], m106: [], retracciones: [] };
            capas.push(capa);
            return;
        }
        if (!capa) return;
        if (l.startsWith('; feature')) feature = l.slice(10).trim();
        const mz = l.match(/^G[01] .*?Z(-?[\d.]+)/);
        if (mz) {
            z = +mz[1];
            if (Number.isNaN(capa.z)) capa.z = z;
        }
        f = +(l.match(/ F([\d.]+)/)?.[1] ?? f);
        const t = l.match(/^M104 S(\d+)/);
        if (t) capa.m104.push({ i, temp: +t[1] });
        const v = l.match(/^M106 S(\d+)/);
        if (v) capa.m106.push({ i, valor: +v[1] });
        const r = l.match(/^G1 E-([\d.]+).*; e-retract/)?.[1];
        if (r) capa.retracciones.push(+r);
        const e = l.match(/^G1 .*[XY].* E([\d.]+)/);
        if (e) {
            capa.filamento += +e[1];
            extrusiones.push({ i, capa: capa.n, z, f, feature, e: +e[1] });
        }
    });
    return { capas, extrusiones };
}

const filamento = (capas, desde, hasta) =>
    capas.filter(c => c.n >= desde && c.n <= hasta).reduce((s, c) => s + c.filamento, 0);
const lineasM104 = (lineas, temp) => lineas.map((l, i) => (l.startsWith(`M104 S${temp}`) ? i : -1)).filter(i => i >= 0);
// Kiri escribe la fecha en la línea 2: lo único que cambia entre dos corridas iguales.
const sinFecha = g => g.replace(/^; \w{3} \w{3} \d+ \d{4} .*$/m, '');
const redondear = n => Math.round(n * 1000) / 1000;
// STL binario (en base64) de dos pilares de 5 x 5 x 20 mm separados 30 mm: Kiri retrae al viajar de uno al otro.
function dosPilares() {
    const tris = [];
    for (const x0 of [-17.5, 12.5]) {
        const v = i => [x0 + 5 * (i & 1), 5 * ((i >> 1) & 1), 20 * (i >> 2)];
        // 12 triángulos de un cubo: cada tres dígitos son los vértices (bit 0 = x, bit 1 = y, bit 2 = z)
        for (const t of '021 123 456 576 014 154 263 367 042 246 135 375'.split(' ')) tris.push([...t].map(n => v(+n)));
    }
    const b = Buffer.alloc(84 + tris.length * 50);
    b.writeUInt32LE(tris.length, 80);
    tris.forEach((t, i) => t.flat().forEach((n, j) => b.writeFloatLE(n, 84 + i * 50 + 12 + j * 4)));
    return b.toString('base64');
}

// F más alto por feature en una capa (mm/min).
function fPorFeature(extrusiones, capa) {
    const m = {};
    for (const x of extrusiones.filter(x => x.capa === capa)) m[x.feature] = Math.max(m[x.feature] || 0, x.f);
    return m;
}

/**
 * Casos 1-9 de la sección 7 del ADR 0002 más tres extras (retracción, cambios contiguos, alturas de capa).
 * @param {{ laminar: Function, revisar: Function }} ctx `laminar(opciones)` devuelve `{ gcode, g, info, avisos }`;
 *   `revisar(nombre, condicion, detalle)` registra el resultado
 * @returns {Promise<void>}
 */
export async function probarCambios({ laminar, revisar }) {
    console.log('\n▶ Cambios por altura contra Kiri (ADR 0002, casos 1-9)');
    const base = await laminar({ ...CUBO });
    const con = (cambios, extra = {}) => laminar({ ...CUBO, ...extra, cambios });
    const c = { laminar, revisar, con, base, B: porCapa(base.g.lineas) };
    const t = await probarTemperatura(c); // casos 1 y 2
    for (const caso of [probarRelleno, probarVelocidad, probarVentilador, probarRetraccion, probarRango]) await caso(c);
    await probarBalsa(c);
    await probarJarron(c);
    probarPausa({ revisar, ...t });
    await probarAlturas(c);
}

// Caso 1: regresión (sin cambios el G-code es idéntico). Caso 2: temperatura, un solo M104 S215 entre la última
// extrusión a Z <= 10 y la primera a Z > 10. Devuelve el G-code del caso 2 para el caso 9.
async function probarTemperatura({ con, revisar, base }) {
    const vacio = await con([]);
    revisar(
        'caso 1 regresión: cambios [] da el mismo G-code que sin cambios',
        sinFecha(vacio.gcode) === sinFecha(base.gcode),
    );
    revisar('caso 1 regresión: no hay M104 de más', base.g.lineas.filter(l => l.startsWith('M104')).length === 3);
    const t = await con([{ desdeMm: 10, tempBoquilla: 215 }]);
    const T = porCapa(t.g.lineas);
    const iT = lineasM104(t.g.lineas, 215);
    const antes = T.extrusiones.filter(x => x.i < iT[0]).at(-1);
    const despues = T.extrusiones.find(x => x.i > iT[0]);
    revisar('caso 2 temperatura: M104 S215 aparece una sola vez', iT.length === 1, `(${iT.length})`);
    revisar(
        'caso 2 temperatura: después de la última extrusión a Z <= 10 y antes de la primera a Z > 10',
        antes?.z <= 10 + EPS && despues?.z > 10,
        `Z antes ${antes?.z}, Z después ${despues?.z}, capa ${despues?.capa}`,
    );
    revisar(
        'caso 2 temperatura: el M104 S200 inicial se mantiene y no hay otro M104 antes',
        t.g.lineas.filter(l => l.startsWith('M104 S200')).length === 1 &&
            T.capas.filter(c => c.n < 50).every(c => !c.m104.length),
    );
    return { t, T };
}

// Caso 3: relleno. Debajo de 10 mm igual que la base; encima menos con 0 % y más con 60 %.
async function probarRelleno({ con, revisar, B }) {
    const sin = porCapa((await con([{ desdeMm: 10, relleno: 0 }])).g.lineas).capas;
    const mas = porCapa((await con([{ desdeMm: 10, relleno: 0.6 }])).g.lineas).capas;
    const abajo = redondear(filamento(B.capas, 0, 49));
    const sobra = n => redondear(filamento(n, 50, 999) - filamento(B.capas, 50, 999));
    revisar(
        'caso 3 relleno: por debajo de 10 mm el filamento es igual',
        redondear(filamento(sin, 0, 49)) === abajo && redondear(filamento(mas, 0, 49)) === abajo,
    );
    revisar('caso 3 relleno: 0 % por encima de 10 mm usa menos', sobra(sin) < -1, `(${sobra(sin)} mm de filamento)`);
    revisar('caso 3 relleno: 60 % por encima de 10 mm usa más', sobra(mas) > 1, `(+${sobra(mas)} mm de filamento)`);
}

// Caso 4: velocidad 50 %. En Detalle (70/40 mm/s, por debajo del tope de caudal) los F de encima de 10 mm son
// exactamente la mitad, por feature, y debajo no cambian. En Normal el tope de caudal (15 mm³/s) recorta la
// velocidad base, así que el 50 % se nota menos (74 %): se documenta (ver el reporte de T3).
async function probarVelocidad({ laminar, con, revisar, B }) {
    const v = porCapa((await con([{ desdeMm: 10, velocidad: 50 }])).g.lineas);
    const DB = porCapa((await laminar({ ...CUBO, calidad: 'detalle' })).g.lineas);
    const DV = porCapa((await con([{ desdeMm: 10, velocidad: 50 }], { calidad: 'detalle' })).g.lineas);
    const arriba = DB.capas.find(c => c.n >= 1 && DB.capas[c.n - 1].z >= 10 - EPS).n + 10;
    const razon = (V, BB, n) =>
        Object.entries(fPorFeature(BB.extrusiones, n)).map(([k, f]) => [k, fPorFeature(V.extrusiones, n)[k] / f]);
    const texto = r => r.map(([k, x]) => `${k} ${x.toFixed(2)}`).join(', ');
    const r4 = razon(DV, DB, arriba);
    revisar(
        'caso 4 velocidad: F por encima de 10 mm = 50 % por feature (Detalle)',
        r4.length >= 2 && r4.every(([, x]) => Math.abs(x - 0.5) < 0.01),
        `capa ${arriba}: ${texto(r4)}`,
    );
    revisar(
        'caso 4 velocidad: la capa 10 (debajo de 10 mm) no cambia',
        JSON.stringify(fPorFeature(DV.extrusiones, 10)) === JSON.stringify(fPorFeature(DB.extrusiones, 10)),
    );
    const r4n = razon(v, B, 60);
    revisar(
        'caso 4 velocidad (Normal): el tope de caudal recorta la base, el 50 % queda entre 50 y 100 %',
        r4n.every(([, x]) => x > 0.5 && x < 1),
        `capa 60: ${texto(r4n)}`,
    );
}

// Caso 5: ventilador 50 % (S128) desde 10 mm: el M106 está al empezar la capa 50 y no antes.
async function probarVentilador({ con, revisar }) {
    const fan = porCapa((await con([{ desdeMm: 10, ventilador: 50 }])).g.lineas);
    const iFan = fan.capas.find(c => c.m106.some(m => m.valor === 128));
    revisar(
        'caso 5 ventilador: M106 S128 en la capa 50 y no antes',
        iFan?.n === 50 && fan.capas.filter(c => c.n < 50).every(c => !c.m106.some(m => m.valor === 128)),
        `capa ${iFan?.n}`,
    );
}

// Extra a: retracción 3 mm desde 10 mm en dos pilares (hay un viaje con retracción en cada capa).
async function probarRetraccion({ laminar, revisar }) {
    const pilares = { stlBase64: dosPilares(), personal: { adhesion: 'nada' } };
    const ret = porCapa((await laminar({ ...pilares, cambios: [{ desdeMm: 10, retraccion: 3 }] })).g.lineas).capas;
    const dist = (capas, d, h) => [...new Set(capas.filter(c => c.n >= d && c.n <= h).flatMap(c => c.retracciones))];
    revisar(
        'extra a retracción: 0,8 mm debajo de 10 mm y 3 mm encima (dos pilares)',
        JSON.stringify(dist(ret, 1, 49)) === '[0.8]' && JSON.stringify(dist(ret, 50, 999)) === '[3]',
        `${dist(ret, 1, 49)} / ${dist(ret, 50, 999)}`,
    );
}

// Caso 6: rango acotado. M104 S215 al entrar (capa 30) y M104 S200 al salir (capa 60).
async function probarRango({ con, revisar }) {
    const r6 = porCapa((await con([{ desdeMm: 6, hastaMm: 12, tempBoquilla: 215 }])).g.lineas).capas;
    const ent = r6.filter(c => c.m104.some(m => m.temp === 215)).map(c => c.n);
    const sal = r6.filter(c => c.n > 1 && c.m104.some(m => m.temp === 200)).map(c => c.n);
    revisar(
        'caso 6 rango: M104 S215 en la capa 30 y M104 S200 en la 60',
        ent + '' === '30' && sal + '' === '60',
        `${ent} / ${sal}`,
    );
}

// Caso 7: con balsa Kiri numera sus capas de la balsa en el G-code, pero `slice.index` no las cuenta: el cambio
// cae a 10 mm sobre la pieza (Z = 10 + offset de la balsa) y NO a Z = 10.
async function probarBalsa({ con: laminar, revisar, B }) {
    const sinBalsa = await laminar([], { personal: { adhesion: 'balsa' } });
    const SB = porCapa(sinBalsa.g.lineas);
    const offset = redondear(SB.capas.at(-1).z - B.capas.at(-1).z);
    const r = await laminar([{ desdeMm: 10, tempBoquilla: 215 }], { personal: { adhesion: 'balsa' } });
    const R = porCapa(r.g.lineas);
    const capa = R.capas.find(c => c.m104.some(m => m.temp === 215));
    const raft = SB.capas.length - B.capas.length;
    const piso = capa && R.capas[capa.n - 1].z - offset;
    revisar(
        'caso 7 balsa: el cambio cae a 10 mm sobre la pieza (Z = 10 + balsa), no a Z = 10',
        capa && Math.abs(piso - 10) < 0.01 && capa.n === 50 + raft && offset > 0.5,
        `capa ${capa?.n} (la balsa suma ${raft} capas), Z ${capa?.z}, piso ${piso} sobre la pieza, offset ${offset} mm; sin balsa sería la capa 50`,
    );
}

// Caso 8: jarrón. El M104 sale una sola vez, cerca de 10 mm, y el G-code sigue siendo espiral.
async function probarJarron({ laminar, revisar }) {
    const r = await laminar({
        caso: 'cubo',
        personal: { adhesion: 'nada', avanzado: { jarron: true } },
        cambios: [{ desdeMm: 10, tempBoquilla: 215 }],
    });
    const J = porCapa(r.g.lineas);
    const iT = lineasM104(r.g.lineas, 215);
    const sig = J.extrusiones.find(x => x.i > iT[0]);
    const capaT = J.capas.find(c => c.m104.some(m => m.temp === 215));
    revisar(
        'caso 8 jarrón: M104 S215 una vez, a ~10 mm',
        iT.length === 1 && sig && sig.z >= 10 && sig.z <= 10.4,
        `capa ${capaT?.n}, Z siguiente ${sig?.z}`,
    );
    const zs = J.extrusiones.filter(x => x.capa === 50).map(x => x.z);
    revisar(
        'caso 8 jarrón: sigue siendo espiral (Z sube dentro de la capa)',
        zs.at(-1) > zs[0],
        `Z ${zs[0]} → ${zs.at(-1)}`,
    );
}

// Caso 9: pausa en la misma capa que un cambio: el M104 queda antes y sólo suma el comentario y el M600.
function probarPausa({ revisar, t, T }) {
    const rec = leerRecorridos(t.gcode, Infinity);
    const capa = T.capas.find(c => c.m104.some(m => m.temp === 215)).n;
    const con = insertarPausas(t.gcode, [{ capa, offset: rec.pausaCapa[capa], z: rec.zCapa[capa] }], ['M600']);
    const l = con.split('\n');
    const iM = l.indexOf('M600');
    const iT = lineasM104(l, 215);
    revisar(
        'caso 9 pausa + cambio: el M104 queda antes del M600 y no se duplica ninguna línea',
        iM > 0 && iT.length === 1 && iT[0] < iM && [...l.slice(0, iM - 1), ...l.slice(iM + 1)].join('\n') === t.gcode,
        `capa ${capa}: M104 en la línea ${iT[0]}, M600 en la ${iM}`,
    );
}

// Extra c: alturas de capa que no dividen el borde (0,12 y 0,28) y cambios contiguos (sin capa con el valor base).
async function probarAlturas({ con: laminar, revisar }) {
    for (const [calidad, h] of [
        ['detalle', 0.12],
        ['rapido', 0.28],
    ]) {
        const r = await laminar([{ desdeMm: 10, tempBoquilla: 215 }], { calidad });
        const R = porCapa(r.g.lineas);
        const capa = R.capas.find(c => c.m104.some(m => m.temp === 215));
        const previa = R.capas[capa?.n - 1];
        revisar(
            `extra c capas de ${h} mm: el cambio empieza en la primera capa con piso >= 10 mm`,
            capa && previa.z >= 10 - EPS && R.capas[capa.n - 2].z < 10 - EPS,
            `capa ${capa?.n}, piso ${previa?.z}`,
        );
        const c = await laminar(
            [
                { desdeMm: 6, hastaMm: 10, tempBoquilla: 215 },
                { desdeMm: 10, tempBoquilla: 225 },
            ],
            { calidad },
        );
        const C = porCapa(c.g.lineas).capas;
        const temps = C.flatMap(x => (x.n > 1 ? x.m104.map(m => m.temp) : []));
        revisar(
            `extra b contiguos con capas de ${h} mm: 215 y luego 225, sin volver a la temperatura base`,
            temps.slice(0, 3).join() === '215,225,0',
            temps.join(','),
        );
    }
}
