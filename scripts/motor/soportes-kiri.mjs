// Soportes árbol y zonas sin soporte contra el Kiri real (ADR 0004, T4). Lamina una "T" (pilar de 10×10×20 y tapa de
// 20×20×3 arriba: voladizo de 5 mm por lado a 20 mm de altura) con el puente real de src/motor/soportes-kiri.js y revisa
// sobre el G-code, por coordenadas absolutas (= centro de la cama + posición de la copia + coordenada local):
//   1. 'normal' vs 'arbol': hay soporte bajo la tapa, con 'arbol' mucho menos material, nunca dentro de la pieza ni
//      fuera de la cama, ni por encima de la tapa;
//   2. zona sin soporte con 'normal' (una y dos copias) y con 'arbol': ninguna extrusión de soporte dentro de la
//      sección de la esfera y, con 'arbol', nada flotando;
//   3. sin zonas y sin árbol el G-code es idéntico al del Kiri sin puente (T0.c) y en producción no se registra nada.
// Lo llama scripts/probar-motor.mjs dentro de su `try` (se registra en T6).

import { sinFecha } from './gcode-capas.mjs';

const CENTRO = 110; // Ender 3 V3 SE (la de la página de pruebas): cama de 220 × 220 con el origen en la esquina
const CAMA = 220;
const TAPA_Z = 20; // altura de la cara de abajo de la tapa
const POS_DOS = [
    { x: -40, y: 0 },
    { x: 40, y: 30 },
];
const ARBOL = { sliceSupportTree: true };
const SOPORTES = { soportes: true, personal: { adhesion: 'nada' }, diagnostico: true };
// MUTAR=c (sólo para la mutación del marco): la prueba "olvida" sumar la posición de la copia.
const SIN_POS = process.env.MUTAR === 'c';

const esfera = (id, x, y, z, radio) => ({ id, forma: 'esfera', centro: { x, y, z }, radio });
const ZONA = esfera(1, -7, 0, 15, 5); // sobre el voladizo izquierdo (x de -10 a -5), capas de 10 a 20 mm
const ZONA_ARBOL = esfera(2, -7, 0, 10, 5);

// STL binario (base64) de una unión de cajas [x0, y0, z0, x1, y1, z1].
export function stlDeCajas(cajas) {
    const tris = [];
    for (const [x0, y0, z0, x1, y1, z1] of cajas) {
        // vértice i: bit 0 = x, bit 1 = y, bit 2 = z (cada tres dígitos son los vértices de un triángulo)
        const q = i => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
        for (const t of '021 123 456 576 014 154 263 367 042 246 135 375'.split(' ')) tris.push([...t].map(n => q(+n)));
    }
    const b = Buffer.alloc(84 + tris.length * 50);
    b.writeUInt32LE(tris.length, 80);
    tris.forEach((t, i) => t.flat().forEach((n, j) => b.writeFloatLE(n, 84 + i * 50 + 12 + j * 4)));
    return b.toString('base64');
}

export const TE = stlDeCajas([
    [-5, -5, 0, 5, 5, TAPA_Z],
    [-10, -10, TAPA_Z, 10, 10, TAPA_Z + 3],
]);

// No reusa `porCapa` de gcode-capas.mjs porque necesita el tipo ("; feature") y los dos extremos de cada
// extrusión para muestrear segmentos; unificar los dos lectores queda como deuda (MAPA §6).
/**
 * Extrusiones del G-code con su tipo ("; feature ...") y sus coordenadas absolutas de cama.
 * @param {string} gcode
 * @returns {{x0:number, y0:number, x:number, y:number, z:number, e:number, tipo:string, largo:number}[]}
 */
export function extrusionesDe(gcode) {
    const salida = [];
    let [x, y, z, tipo] = [0, 0, 0, ''];
    for (const l of gcode.split('\n')) {
        if (l.startsWith('; feature')) tipo = l.slice(10).trim();
        if (!/^G[01] /.test(l)) continue;
        const nx = +(l.match(/ X(-?[\d.]+)/)?.[1] ?? x);
        const ny = +(l.match(/ Y(-?[\d.]+)/)?.[1] ?? y);
        z = +(l.match(/ Z(-?[\d.]+)/)?.[1] ?? z);
        const e = +(l.match(/ E(-?[\d.]+)/)?.[1] ?? 0);
        if (l.startsWith('G1') && e > 0 && / [XY]/.test(l)) {
            salida.push({ x0: x, y0: y, x: nx, y: ny, z, e, tipo, largo: Math.hypot(nx - x, ny - y) });
        }
        x = nx;
        y = ny;
    }
    return salida;
}

const esSoporte = e => e.tipo.includes('support');
const suma = (lista, f) => lista.reduce((s, e) => s + f(e), 0);

// Puntos de una extrusión cada 0,5 mm (de inicio a fin), en el marco local de la copia que está en `pos`.
function muestras(e, pos) {
    const n = Math.max(1, Math.ceil(e.largo / 0.5));
    const dx = SIN_POS ? 0 : pos.x;
    const dy = SIN_POS ? 0 : pos.y;
    return Array.from({ length: n + 1 }, (_, k) => ({
        x: e.x0 + ((e.x - e.x0) * k) / n - CENTRO - dx,
        y: e.y0 + ((e.y - e.y0) * k) / n - CENTRO - dy,
        z: e.z,
    }));
}

// De cada extrusión, la copia a la que pertenece (la de centro más cercano).
const copiaDe = (e, posiciones) =>
    posiciones.reduce((m, p) => {
        const d = q => Math.hypot(e.x - CENTRO - q.x, e.y - CENTRO - q.y);
        return d(p) < d(m) ? p : m;
    }, posiciones[0]);

// Cuántas muestras de soporte caen dentro de la sección de alguna esfera. La sección se toma con su radio mínimo
// dentro del alto de la capa (la capa de Kiri se corta en algún z entre `z - alto` y `z`) y menos 0,05 mm; las
// secciones de menos de 1 mm de radio no cuentan (el cierre del contorno de Kiri las tapa: el polo de la esfera).
function dentroDeZonas(extr, zonas, posiciones, alto) {
    let n = 0;
    for (const e of extr.filter(esSoporte)) {
        const pos = copiaDe(e, posiciones);
        for (const m of muestras(e, pos)) {
            for (const b of zonas) {
                const r2 = z => b.radio ** 2 - (z - b.centro.z) ** 2;
                const r = Math.sqrt(Math.max(0, Math.min(r2(m.z), r2(m.z - alto))));
                if (r >= 1 && Math.hypot(m.x - b.centro.x, m.y - b.centro.y) < r - 0.05) n++;
            }
        }
    }
    return n;
}

const distSegmento = (p, e) => {
    const [dx, dy] = [e.x - e.x0, e.y - e.y0];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - e.x0) * dx + (p.y - e.y0) * dy) / l2)) : 0;
    return Math.hypot(e.x0 + t * dx - p.x, e.y0 + t * dy - p.y);
};

// Soporte "en el aire": una extrusión de soporte a z > primera capa sin otro soporte a menos de `radio` mm en la capa de
// abajo (z - alto). Ahí abajo no hay nada que lo sostenga (en la T no hay otra cosa que la cama, el pilar y el soporte).
// El radio por defecto (5,05 mm = 2 × radioMax del árbol + margen) es el alcance máximo legítimo: cuando dos troncos
// se funden el radio del fusionado queda acotado y el círculo del más liviano puede quedar a hasta 2 × radioMax de lo
// que hay debajo (hallazgo de T4 sobre T1: ese tronco absorbido pierde apoyo directo en esa capa). Un tronco colgado
// de verdad (sin camino por una zona) queda sin NADA debajo, mucho más lejos.
function flotantes(extr, alto, radio = 5.05) {
    const sop = extr.filter(esSoporte);
    const porZ = new Map();
    for (const e of sop) porZ.set(e.z.toFixed(3), [...(porZ.get(e.z.toFixed(3)) ?? []), e]);
    let n = 0;
    for (const e of sop) {
        if (e.z < 2 * alto + 0.01) continue;
        const abajo = porZ.get((e.z - alto).toFixed(3)) ?? [];
        const medio = { x: (e.x0 + e.x) / 2, y: (e.y0 + e.y) / 2 };
        if (!abajo.some(a => distSegmento(medio, a) < radio)) n++;
    }
    return n;
}

// Alto de capa: la diferencia entre capas que más se repite (hay alguna extrusión suelta a otra altura en la primera).
const altoDe = extr => {
    const zs = [...new Set(extr.map(e => +e.z.toFixed(3)))].sort((a, b) => a - b);
    const difs = zs.slice(1).map((z, i) => +(z - zs[i]).toFixed(3));
    return difs.sort((a, b) => difs.filter(d => d === b).length - difs.filter(d => d === a).length)[0];
};
const f = (n, d = 1) => n.toFixed(d).replace('.', ',');

// Geometría del soporte árbol de la T sola: bajo la tapa, fuera de la pieza, dentro de la cama y sin nada en el aire.
function revisarArbol({ revisar }, ea) {
    const sa = ea.filter(esSoporte);
    const alto = altoDe(ea);
    revisar('árbol: hay soporte', sa.length > 0, `${sa.length} extrusiones`);
    const enHuella = sa.filter(e => Math.abs(e.x - CENTRO) < 11.5 && Math.abs(e.y - CENTRO) < 11.5);
    revisar('árbol: todo el soporte está dentro de la huella de la tapa (±1,5 mm)', enHuella.length === sa.length);
    const zMax = Math.max(...sa.map(e => e.z));
    revisar(
        'árbol: ningún soporte por encima de la cara de abajo de la tapa',
        zMax <= TAPA_Z + 0.01,
        `z máx ${f(zMax, 2)}`,
    );
    const zMin = Math.min(...sa.map(e => e.z));
    revisar('árbol: el soporte llega hasta la cama', zMin < 0.5, `z mín ${f(zMin, 2)}`);
    const enPieza = sa
        .flatMap(e => muestras(e, { x: 0, y: 0 }))
        .filter(m => Math.abs(m.x) < 4.95 && Math.abs(m.y) < 4.95 && m.z < TAPA_Z);
    revisar('árbol: ninguna extrusión de soporte dentro del pilar', enPieza.length === 0, `${enPieza.length} muestras`);
    const fuera = ea.filter(e => [e.x, e.y, e.x0, e.y0].some(v => v < 0 || v > CAMA));
    revisar('árbol: todo el G-code dentro de la cama', fuera.length === 0, `${fuera.length} fuera`);
    const aire = flotantes(ea, alto);
    revisar('árbol: nada flotando (cada capa de soporte tiene soporte debajo)', aire === 0, `${aire} flotantes`);
}

// La T sola en el centro: 'normal' contra 'arbol'.
async function compararTipos(ctx) {
    console.log('\n▶ T con tapa de 20×20: soportes normales contra árbol');
    const normal = await ctx.laminar({ stlBase64: TE, ...SOPORTES });
    const arbol = await ctx.laminar({ stlBase64: TE, ...SOPORTES, extras: ARBOL });
    const [sn, sa] = [normal, arbol].map(r => extrusionesDe(r.gcode).filter(esSoporte));
    ctx.revisar('normal: hay soporte', sn.length > 0, `${sn.length} extrusiones`);
    revisarArbol(ctx, extrusionesDe(arbol.gcode));
    const [longN, longA, eN, eA] = [
        suma(sn, e => e.largo),
        suma(sa, e => e.largo),
        suma(sn, e => e.e),
        suma(sa, e => e.e),
    ];
    console.log(`  · soporte normal: ${sn.length} extrusiones, ${f(longN)} mm, E ${f(eN)} mm`);
    console.log(`  · soporte árbol:  ${sa.length} extrusiones, ${f(longA)} mm, E ${f(eA)} mm`);
    console.log(
        `  · árbol / normal: longitud ${f((100 * longA) / longN)} %, filamento ${f((100 * eA) / eN)} % (meta ≤ 70 %)`,
    );
    const pct = `${f((100 * longA) / longN)} % y ${f((100 * eA) / eN)} %`;
    ctx.revisar(
        'árbol usa ≤ 70 % del soporte de normal (longitud y filamento)',
        longA <= 0.7 * longN && eA <= 0.7 * eN,
        pct,
    );
    console.log(`  · tiempo de laminado: normal ${normal.ms} ms, árbol ${arbol.ms} ms`);
    ctx.revisar(
        'árbol no tarda más del doble que normal',
        arbol.ms <= 2 * normal.ms,
        `${arbol.ms} contra ${normal.ms} ms`,
    );
}

// Zona con 'normal': una copia y dos (cada una respeta la zona en SU posición).
async function zonaNormal({ laminar, revisar }) {
    console.log('\n▶ zona sin soporte con soportes normales (una y dos copias)');
    const sinZona = await laminar({ piezas: [{ stlBase64: TE, posiciones: POS_DOS }], ...SOPORTES });
    const conZona = await laminar({ piezas: [{ stlBase64: TE, posiciones: POS_DOS, bloqueos: [ZONA] }], ...SOPORTES });
    const [es, ec] = [sinZona, conZona].map(r => extrusionesDe(r.gcode));
    const alto = altoDe(es);
    const control = dentroDeZonas(es, [ZONA], POS_DOS, alto);
    revisar(
        'control: sin la zona sí hay soporte dentro de la esfera de cada copia',
        control > 20,
        `${control} muestras`,
    );
    for (const pos of POS_DOS) {
        const propias = ec.filter(e => copiaDe(e, POS_DOS) === pos);
        const antes = dentroDeZonas(
            es.filter(e => copiaDe(e, POS_DOS) === pos),
            [ZONA],
            [pos],
            alto,
        );
        revisar(
            `copia en (${pos.x}, ${pos.y}): con la zona nada de soporte dentro de la esfera`,
            dentroDeZonas(propias, [ZONA], [pos], alto) === 0,
            `quedan ${dentroDeZonas(propias, [ZONA], [pos], alto)} (sin zona ${antes})`,
        );
    }
    const [sn, sc] = [es, ec].map(x => suma(x.filter(esSoporte), e => e.largo));
    revisar('la zona saca soporte, no lo agrega', sc < sn && sc > 0.5 * sn, `${f(sc)} contra ${f(sn)} mm`);
}

// Zona con 'arbol': ninguna extrusión en la sección y nada en el aire.
async function zonaArbol({ laminar, revisar }) {
    console.log('\n▶ zona sin soporte con soportes árbol');
    const op = { piezas: [{ stlBase64: TE, posiciones: POS_DOS, bloqueos: [ZONA_ARBOL] }], ...SOPORTES, extras: ARBOL };
    const r = await laminar(op);
    const libre = await laminar({ ...op, piezas: [{ stlBase64: TE, posiciones: POS_DOS }] });
    const [ec, el] = [r, libre].map(x => extrusionesDe(x.gcode));
    const alto = altoDe(el);
    const antes = dentroDeZonas(el, [ZONA_ARBOL], POS_DOS, alto);
    revisar('control: sin la zona el árbol sí pasa por la esfera', antes > 0, `${antes} muestras`);
    for (const pos of POS_DOS) {
        const propias = ec.filter(e => copiaDe(e, POS_DOS) === pos);
        const adentro = dentroDeZonas(propias, [ZONA_ARBOL], [pos], alto);
        revisar(
            `copia en (${pos.x}, ${pos.y}): ningún soporte dentro de la esfera`,
            adentro === 0,
            `${adentro} muestras`,
        );
        revisar(
            `copia en (${pos.x}, ${pos.y}): nada flotando`,
            flotantes(propias, alto) === 0,
            `${flotantes(propias, alto)} flotantes`,
        );
    }
    revisar('el árbol sigue habiendo (la zona no lo anula)', suma(ec.filter(esSoporte), e => e.largo) > 0);
}

// Sin zonas ni árbol el puente no cambia nada, y en producción (sin `diagnostico`) no registra ni devuelve nada.
async function sinCambios({ laminar, revisar, pagina }) {
    console.log('\n▶ sin zonas y sin árbol: igual que el Kiri sin puente; sin diagnóstico no se registra');
    const pos = POS_DOS.slice(0, 1);
    const r = await laminar({ piezas: [{ stlBase64: TE, posiciones: pos, bloqueos: [] }], soportes: true });
    const ref = await pagina.evaluate(o => window.probarPiezas(o), {
        piezas: [{ stlBase64: TE, pos: pos[0] }],
        soportes: true,
    });
    revisar(
        'G-code idéntico al del Kiri sin puente (salvo la fecha)',
        sinFecha(r.gcode) === sinFecha(ref.gcode),
        `${r.gcode.length} caracteres`,
    );
    revisar('sin `diagnostico` info.ganchos no viaja', r.info.ganchos === undefined);
}

// Cama: pieza de 220 mm de ancho (la tapa ocupa toda la cama); el soporte árbol no puede salir de [0, 220].
const ANCHA = stlDeCajas([
    [-5, -5, 0, 5, 5, TAPA_Z],
    [-110, -20, TAPA_Z, 110, 20, TAPA_Z + 3],
]);
async function conCama({ laminar, revisar }) {
    console.log('\n▶ pieza de 220 mm de ancho: el árbol no sale de la cama');
    const normal = extrusionesDe((await laminar({ stlBase64: ANCHA, ...SOPORTES })).gcode);
    const arbol = extrusionesDe((await laminar({ stlBase64: ANCHA, ...SOPORTES, extras: ARBOL })).gcode);
    const rango = x => {
        const xs = x.filter(esSoporte).flatMap(e => [e.x0, e.x]);
        return [Math.min(...xs), Math.max(...xs)];
    };
    const [[nMin, nMax], [aMin, aMax]] = [rango(normal), rango(arbol)];
    console.log(`  · X del soporte: normal ${f(nMin, 2)} a ${f(nMax, 2)}, árbol ${f(aMin, 2)} a ${f(aMax, 2)}`);
    revisar('árbol: hay soporte', arbol.some(esSoporte));
    revisar('árbol: todo el soporte dentro de X 0..220 (y también Y)', aMin >= 0 && aMax <= CAMA, `${aMin} a ${aMax}`);
    const fuera = arbol.filter(e => [e.x, e.y, e.x0, e.y0].some(v => v < 0 || v > CAMA));
    revisar('árbol: todo el G-code dentro de la cama', fuera.length === 0, `${fuera.length} fuera`);
}

// Agujero: placa de 70×70 con un agujero de 24×24 sobre 4 patas. La sombra tiene un agujero (`.inner` de Kiri): si el
// puente no lo convierte, el árbol siembra soporte adentro.
const PLACA = stlDeCajas([
    ...[-30, 30].flatMap(x => [-30, 30].map(y => [x - 3, y - 3, 0, x + 3, y + 3, TAPA_Z])),
    [-35, -35, TAPA_Z, -12, 35, TAPA_Z + 3],
    [12, -35, TAPA_Z, 35, 35, TAPA_Z + 3],
    [-12, -35, TAPA_Z, 12, -12, TAPA_Z + 3],
    [-12, 12, TAPA_Z, 12, 35, TAPA_Z + 3],
]);
// Lo mismo con una copia corrida: tapa de 220 mm de ancho en x = +0 y otra de 100 mm pegada al borde derecho
// (centro en +60: llega justo a 220), para comprobar que la cama local se corre con la posición de la copia.
async function conCamaCorrida({ laminar, revisar }) {
    const tapa = stlDeCajas([
        [-5, -5, 0, 5, 5, TAPA_Z],
        [-50, -20, TAPA_Z, 50, 20, TAPA_Z + 3],
    ]);
    const r = await laminar({
        piezas: [{ stlBase64: tapa, posiciones: [{ x: 60, y: 0 }] }],
        ...SOPORTES,
        extras: ARBOL,
    });
    const xs = extrusionesDe(r.gcode)
        .filter(esSoporte)
        .flatMap(e => [e.x0, e.x]);
    console.log(`  · copia en x = +60: X del soporte árbol ${f(Math.min(...xs), 2)} a ${f(Math.max(...xs), 2)}`);
    revisar(
        'árbol: copia pegada al borde derecho, todo el soporte en X <= 220',
        xs.length > 0 && Math.max(...xs) <= CAMA,
    );
}

async function conAgujero({ laminar, revisar }) {
    console.log('\n▶ placa con agujero de 24×24 sobre 4 patas: el árbol no entra al agujero');
    const sa = extrusionesDe((await laminar({ stlBase64: PLACA, ...SOPORTES, extras: ARBOL })).gcode).filter(esSoporte);
    const adentro = sa
        .flatMap(e => muestras(e, { x: 0, y: 0 }))
        .filter(m => Math.abs(m.x) < 11.5 && Math.abs(m.y) < 11.5 && m.z < TAPA_Z);
    revisar('árbol: hay soporte', sa.length > 0, `${sa.length} extrusiones`);
    revisar(
        'árbol: ninguna extrusión de soporte dentro del agujero',
        adentro.length === 0,
        `${adentro.length} muestras`,
    );
}

/**
 * Pruebas de la tarea T4 del ADR 0004 (puente real con Kiri).
 * @param {{ laminar: Function, revisar: Function, pagina: object }} ctx
 * @returns {Promise<void>}
 */
export async function probarSoportesKiri(ctx) {
    await compararTipos(ctx);
    await zonaNormal(ctx);
    await zonaArbol(ctx);
    await conCama(ctx);
    await conCamaCorrida(ctx);
    await conAgujero(ctx);
    await sinCambios(ctx);
}
