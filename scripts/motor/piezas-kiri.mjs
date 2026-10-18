// Varios widgets con `track.pos` distintos contra el Kiri real (ADR 0003, tarea T0; riesgo R1).
// Responsabilidad: laminar dos copias de una pieza en pos (-40,0) y (+40,0) con el mismo flujo que el worker (página de
// pruebas: `window.probarPiezas`) y revisar sobre el G-code que cada pieza y sus extras (falda, borde, balsa, soportes)
// caen en su posición. Si algo falla con `track.pos`, el plan B del ADR es desplazar los vértices en `prepararPiezas`.
// Lo llama scripts/probar-motor.mjs dentro de su `try`.

const POS = [-40, 40]; // X de cada copia, relativa al centro de la cama
const LADO = 20; // cubo de 20 mm
const TOL = 0.5; // la pared sale a media línea (0,2 mm) hacia adentro; 0,5 mm de holgura

// Extrusiones del G-code: tramos con su capa, feature y puntas. (Kiri a veces escribe sólo X o sólo Y.)
function extrusiones(gcode) {
    const lineas = gcode.split('\n');
    const out = [];
    let x = 0,
        y = 0,
        capa = -1,
        feature = '';
    lineas.forEach((l, i) => {
        const c = l.match(/^;LAYER:(\d+)/);
        if (c) capa = +c[1];
        if (l.startsWith('; feature')) feature = l.slice(10).trim();
        if (!/^G[01] /.test(l)) return;
        const v = letra => {
            const m = l.match(new RegExp(` ${letra}(-?[\\d.]+)`));
            return m ? +m[1] : NaN;
        };
        const nx = Number.isNaN(v('X')) ? x : v('X');
        const ny = Number.isNaN(v('Y')) ? y : v('Y');
        if (capa >= 0 && v('E') > 0 && (nx !== x || ny !== y))
            out.push({ i, capa, feature, x0: x, y0: y, x1: nx, y1: ny });
        x = nx;
        y = ny;
    });
    return { lineas, ext: out };
}

const puntos = ext =>
    ext.flatMap(e => [
        [e.x1, e.y1],
        [e.x0, e.y0],
    ]);
const rango = pts => {
    const xs = pts.map(p => p[0]),
        ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const f = n => (Math.round(n * 100) / 100).toString();
const bb = r => `X ${f(r.x0)}..${f(r.x1)} Y ${f(r.y0)}..${f(r.y1)}`;
// Copia a la que pertenece un punto: la de centro más cercano en X.
const copiaDe = (px, cxs) => (Math.abs(px - cxs[0]) <= Math.abs(px - cxs[1]) ? 0 : 1);

const lamina = (pagina, o) => pagina.evaluate(x => window.probarPiezas(x), o);
const dosCubos = (pagina, adhesion) =>
    lamina(pagina, { piezas: POS.map(x => ({ caso: 'cubo', pos: { x, y: 0 } })), personal: { adhesion } });
const contiene = (r, c) => r && r.x0 <= c.x0 && r.x1 >= c.x1 && r.y0 <= c.y0 && r.y1 >= c.y1;
const bbs = r => (r ? bb(r) : 'vacía');
// bbox de los puntos de cada copia (null si una copia no tiene).
const porCopia = (pts, cxs) =>
    cxs.map((_, k) => {
        const p = pts.filter(q => copiaDe(q[0], cxs) === k);
        return p.length ? rango(p) : null;
    });

// Geometría común: centro de cama del perfil (Kiri cuenta desde la esquina salvo `originCenter`/cama redonda).
function geometria(d) {
    const centro = d.originCenter || d.bedRound;
    const cx0 = centro ? 0 : d.bedWidth / 2;
    const cy0 = centro ? 0 : d.bedDepth / 2;
    const cxs = POS.map(x => x + cx0);
    const caja = cx => ({ x0: cx - LADO / 2, x1: cx + LADO / 2, y0: cy0 - LADO / 2, y1: cy0 + LADO / 2 });
    return { cx0, cy0, cxs, caja };
}

// 1. Sin extras: la capa 2 (;LAYER:1) son dos cuadrados exactos y nada entre ellos.
function sinExtras({ revisar }, A, { cy0, cxs }) {
    const m = LADO / 2;
    const grupos = cxs.map(() => []);
    A.ext.filter(e => e.capa === 1).forEach(e => grupos[copiaDe(e.x1, cxs)].push(e));
    const rg = grupos.map(g => (g.length ? rango(puntos(g)) : null));
    const dentro = rg.every(
        (r, k) =>
            r && r.x0 >= cxs[k] - m - TOL && r.x1 <= cxs[k] + m + TOL && r.y0 >= cy0 - m - TOL && r.y1 <= cy0 + m + TOL,
    );
    const det = rg.map((r, k) => `copia ${k + 1} (cx ${cxs[k]}): ${bbs(r)} ${grupos[k].length} extrusiones`);
    revisar(
        '1. sin extras: la capa 2 son dos grupos en [cx-10,5; cx+10,5] y nada entre ellos',
        dentro && grupos.every(g => g.length > 20),
        det.join(' | '),
    );
}

// 2. Falda: rodea a cada cubo (sus extrusiones de la capa 1 contienen ambos cubos).
async function falda({ revisar, pagina }, { cy0, cxs, caja }) {
    const m = LADO / 2;
    const ext = extrusiones((await dosCubos(pagina, 'falda')).gcode).ext;
    const pts = puntos(ext.filter(e => e.capa === 0 && e.feature === 'brim'));
    const rf = pts.length ? rango(pts) : null;
    const vueltas = porCopia(pts, cxs);
    const todo = { x0: cxs[0] - m, x1: cxs[1] + m, y0: cy0 - m, y1: cy0 + m };
    const rodea = vueltas.every((r, k) => contiene(r, caja(cxs[k])) && cxs[k] - m - r.x0 < 8 && r.x1 - cxs[k] - m < 8);
    revisar(
        '2. falda: bbox de la falda (capa 1) contiene los dos cubos, con vueltas a cada lado de cada uno (3 a 8 mm)',
        contiene(rf, todo) && rodea,
        `falda ${bbs(rf)}; por copia: ${vueltas.map(bbs).join(' | ')}`,
    );
}

// 3. Borde (brim): un anillo de < 6 mm alrededor de cada cubo y nada en el centro.
async function borde({ revisar, pagina }, { cy0, cxs }) {
    const ext = extrusiones((await dosCubos(pagina, 'borde')).gcode).ext;
    const pb = puntos(ext.filter(e => e.capa === 0 && e.feature === 'brim'));
    // Distancia (Chebyshev) de un punto al borde de su cubo; > 0 = afuera.
    const afuera = (p, k) => Math.max(Math.abs(p[0] - cxs[k]), Math.abs(p[1] - cy0)) - LADO / 2;
    const dist = cxs.map((_, k) => pb.filter(p => copiaDe(p[0], cxs) === k).map(p => afuera(p, k)));
    const maxDist = dist.map(a => (a.length ? Math.max(...a) : NaN));
    revisar(
        '3. borde: hay brim alrededor de cada cubo (0 < distancia al borde < 6 mm) y ninguno suelto en el centro',
        dist.every((a, k) => a.length > 20 && a.every(v => v > -TOL && v < 6) && maxDist[k] > 3),
        `puntos ${dist.map(a => a.length)}, distancia máxima al borde ${maxDist.map(f)} mm`,
    );
}

// 4. Balsa: las capas de balsa (las que suma respecto de la corrida sin balsa) cubren las dos posiciones.
async function balsa({ revisar, pagina }, A, { cxs, caja }) {
    const R = extrusiones((await dosCubos(pagina, 'balsa')).gcode);
    const capasR = new Set(R.ext.map(e => e.capa)).size;
    const capasN = new Set(A.ext.map(e => e.capa)).size;
    const nBalsa = capasR - capasN;
    const malas = [];
    for (let n = 0; n < nBalsa; n++) {
        const pts = puntos(R.ext.filter(e => e.capa === n));
        const rr = porCopia(pts, cxs);
        const centro = pts.some(p => p[0] > cxs[0] + LADO / 2 + 8 && p[0] < cxs[1] - LADO / 2 - 8);
        if (!rr.every((r, k) => contiene(r, caja(cxs[k]))) || centro)
            malas.push(`capa ${n + 1}: ${rr.map(bbs).join(' | ')}${centro ? ' (hay algo en el centro)' : ''}`);
    }
    const r0 = rango(puntos(R.ext.filter(e => e.capa === 0)));
    revisar(
        '4. balsa: cada capa de balsa cubre la huella de los dos cubos (y no el hueco entre ellos)',
        nBalsa >= 2 && malas.length === 0,
        `${nBalsa} capas de balsa (${capasR} totales, ${capasN} sin balsa); capa 1: ${bb(r0)}${malas.length ? '; falla: ' + malas[0] : ''}`,
    );
}

// 5. Soportes: una "T" por copia; los de cada una caen bajo ella (su huella ±5 mm), nada entre las dos.
async function soportes({ revisar, pagina }, { cy0, cxs }) {
    const S = await lamina(pagina, {
        piezas: POS.map(x => ({ caso: 'te', pos: { x, y: 0 } })),
        soportes: true,
        personal: { adhesion: 'nada' },
    });
    const BARRA = 25; // la barra de la T mide 50 × 10 mm (src/prueba/mallas.js)
    const rs = porCopia(puntos(extrusiones(S.gcode).ext.filter(e => e.feature === 'support')), cxs);
    const bajo = rs.every(
        (r, k) => r && r.x0 >= cxs[k] - BARRA - 5 && r.x1 <= cxs[k] + BARRA + 5 && r.y0 >= cy0 - 10 && r.y1 <= cy0 + 10,
    );
    const det = rs.map(
        (r, k) => `copia ${k + 1} (huella X ${cxs[k] - BARRA}..${cxs[k] + BARRA}): ${r ? bb(r) : 'sin soportes'}`,
    );
    revisar('5. soportes: los de cada copia caen bajo su pieza (huella ±5 mm)', bajo, det.join(' | '));
}

// 6. Retracción entre piezas: cada vez que una capa pasa de un cubo al otro hay retracción en el medio.
function retraccion({ revisar }, A, { cxs }) {
    const E = A.ext;
    const capasN = new Set(E.map(e => e.capa)).size;
    const saltos = [];
    for (let j = 1; j < E.length; j++) {
        if (E[j - 1].capa === E[j].capa && copiaDe(E[j - 1].x1, cxs) !== copiaDe(E[j].x0, cxs))
            saltos.push([E[j - 1], E[j]]);
    }
    const sin = saltos.filter(
        ([a, b]) => !A.lineas.slice(a.i + 1, b.i).some(l => /^G1 E-[\d.]+/.test(l) || l.startsWith('G10')),
    );
    const capasConSalto = new Set(saltos.map(([a]) => a.capa)).size;
    revisar(
        '6. retracción entre piezas: cada salto de un cubo al otro en una misma capa retrae',
        saltos.length > 0 && sin.length === 0 && capasConSalto >= capasN - 1,
        `${saltos.length} saltos en ${capasConSalto} de ${capasN} capas, ${sin.length} sin retracción${sin.length ? ` (capa ${sin[0][0].capa + 1})` : ''}`,
    );
}

/**
 * Pruebas de la tarea T0 del ADR 0003: criterios 1 a 6.
 * @param {{ revisar: Function, pagina: object }} ctx `pagina` es la de Playwright con `window.probarPiezas`
 * @returns {Promise<void>}
 */
export async function probarPiezasKiri(ctx) {
    console.log('\n▶ Varias piezas con track.pos contra Kiri (ADR 0003, T0)');
    const nada = await dosCubos(ctx.pagina, 'nada');
    const A = extrusiones(nada.gcode);
    const g = geometria(nada.dispositivo);
    console.log(`  centro de cama (${g.cx0}, ${g.cy0}); copias en X ${g.cxs}`);
    sinExtras(ctx, A, g);
    await falda(ctx, g);
    await borde(ctx, g);
    await balsa(ctx, A, g);
    await soportes(ctx, g);
    retraccion(ctx, A, g);
}
