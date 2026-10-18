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

/**
 * Pruebas de la tarea T0 del ADR 0003: criterios 1 a 6.
 * @param {{ revisar: Function, pagina: object }} ctx `pagina` es la de Playwright con `window.probarPiezas`
 * @returns {Promise<void>}
 */
export async function probarPiezasKiri({ revisar, pagina }) {
    console.log('\n▶ Varias piezas con track.pos contra Kiri (ADR 0003, T0)');
    const dosCubos = adhesion =>
        pagina.evaluate(o => window.probarPiezas(o), {
            piezas: POS.map(x => ({ caso: 'cubo', pos: { x, y: 0 } })),
            personal: { adhesion },
        });
    const nada = await dosCubos('nada');
    // Centro de la cama del perfil: con origen en la esquina Kiri cuenta desde ahí; con origen en el centro, desde 0.
    const d = nada.dispositivo;
    const cx0 = d.originCenter || d.bedRound ? 0 : d.bedWidth / 2;
    const cy0 = d.originCenter || d.bedRound ? 0 : d.bedDepth / 2;
    const cxs = POS.map(x => x + cx0);
    const mitad = LADO / 2;
    const caja = cx => ({ x0: cx - mitad, x1: cx + mitad, y0: cy0 - mitad, y1: cy0 + mitad });
    console.log(`  centro de cama (${cx0}, ${cy0}); copias en X ${cxs}`);

    // 1. Sin extras: la capa 2 (;LAYER:1) son dos cuadrados exactos y nada entre ellos.
    const A = extrusiones(nada.gcode);
    const capa2 = A.ext.filter(e => e.capa === 1);
    const grupos = cxs.map(() => []);
    capa2.forEach(e => grupos[copiaDe(e.x1, cxs)].push(e));
    const rg = grupos.map(g => (g.length ? rango(puntos(g)) : null));
    const dentro = rg.every(
        (r, k) =>
            r &&
            r.x0 >= cxs[k] - mitad - TOL &&
            r.x1 <= cxs[k] + mitad + TOL &&
            r.y0 >= cy0 - mitad - TOL &&
            r.y1 <= cy0 + mitad + TOL,
    );
    revisar(
        '1. sin extras: la capa 2 son dos grupos en [cx-10,5; cx+10,5] y nada entre ellos',
        dentro && grupos.every(g => g.length > 20),
        rg
            .map((r, k) => `copia ${k + 1} (cx ${cxs[k]}): ${r ? bb(r) : 'vacía'} ${grupos[k].length} extrusiones`)
            .join(' | '),
    );

    // 2. Falda: rodea a cada cubo (sus extrusiones de la capa 1 contienen ambos cubos).
    const F = extrusiones((await dosCubos('falda')).gcode);
    const falda = F.ext.filter(e => e.capa === 0 && e.feature === 'brim');
    const rf = falda.length ? rango(puntos(falda)) : null;
    const contiene = (r, c) => r && r.x0 <= c.x0 && r.x1 >= c.x1 && r.y0 <= c.y0 && r.y1 >= c.y1;
    const porCopia = cxs.map((_, k) => falda.filter(e => copiaDe(e.x1, cxs) === k));
    const vueltas = porCopia.map(g => (g.length ? rango(puntos(g)) : null));
    revisar(
        '2. falda: bbox de la falda (capa 1) contiene los dos cubos, con vueltas a cada lado de cada uno (3 a 8 mm)',
        contiene(rf, { x0: cxs[0] - mitad, x1: cxs[1] + mitad, y0: cy0 - mitad, y1: cy0 + mitad }) &&
            vueltas.every(
                (r, k) => contiene(r, caja(cxs[k])) && cxs[k] - mitad - r.x0 < 8 && r.x1 - cxs[k] - mitad < 8,
            ),
        `falda ${rf ? bb(rf) : 'no hay'}; por copia: ${vueltas.map(r => (r ? bb(r) : 'vacía')).join(' | ')}`,
    );

    // 3. Borde (brim): un anillo de < 6 mm alrededor de cada cubo y nada en el centro.
    const B = extrusiones((await dosCubos('borde')).gcode);
    const borde = B.ext.filter(e => e.capa === 0 && e.feature === 'brim');
    // Distancia (Chebyshev) de un punto al borde de su cubo; > 0 = afuera.
    const afuera = (p, k) => Math.max(Math.abs(p[0] - cxs[k]), Math.abs(p[1] - cy0)) - mitad;
    const pb = puntos(borde);
    const dist = cxs.map((_, k) => pb.filter(p => copiaDe(p[0], cxs) === k).map(p => afuera(p, k)));
    const maxDist = dist.map(a => (a.length ? Math.max(...a) : NaN));
    revisar(
        '3. borde: hay brim alrededor de cada cubo (0 < distancia al borde < 6 mm) y ninguno suelto en el centro',
        dist.every((a, k) => a.length > 20 && a.every(v => v > -TOL && v < 6) && maxDist[k] > 3),
        `puntos ${dist.map(a => a.length)}, distancia máxima al borde ${maxDist.map(f)} mm`,
    );

    // 4. Balsa: las capas de balsa (las que suma respecto de la corrida sin balsa) cubren las dos posiciones.
    const R = extrusiones((await dosCubos('balsa')).gcode);
    const capasR = new Set(R.ext.map(e => e.capa)).size;
    const capasN = new Set(A.ext.map(e => e.capa)).size;
    const nBalsa = capasR - capasN;
    const malas = [];
    for (let n = 0; n < nBalsa; n++) {
        const ptsCapa = puntos(R.ext.filter(e => e.capa === n));
        const rr = cxs.map((_, k) => {
            const p = ptsCapa.filter(q => copiaDe(q[0], cxs) === k);
            return p.length ? rango(p) : null;
        });
        const cubre = rr.every((r, k) => contiene(r, caja(cxs[k])));
        const centro = ptsCapa.some(p => p[0] > cxs[0] + mitad + 8 && p[0] < cxs[1] - mitad - 8);
        if (!cubre || centro)
            malas.push(
                `capa ${n + 1}: ${rr.map(r => (r ? bb(r) : 'vacía')).join(' | ')}${centro ? ' (hay algo en el centro)' : ''}`,
            );
    }
    const r0 = rango(puntos(R.ext.filter(e => e.capa === 0)));
    revisar(
        '4. balsa: cada capa de balsa cubre la huella de los dos cubos (y no el hueco entre ellos)',
        nBalsa >= 2 && malas.length === 0,
        `${nBalsa} capas de balsa (${capasR} totales, ${capasN} sin balsa); capa 1: ${bb(r0)}${malas.length ? '; falla: ' + malas[0] : ''}`,
    );

    // 5. Soportes: una "T" por copia; los soportes de cada una caen bajo ella (su huella ±5 mm), nada entre las dos.
    const S = await pagina.evaluate(o => window.probarPiezas(o), {
        piezas: POS.map(x => ({ caso: 'te', pos: { x, y: 0 } })),
        soportes: true,
        personal: { adhesion: 'nada' },
    });
    const sop = extrusiones(S.gcode).ext.filter(e => e.feature === 'support');
    const ps = puntos(sop);
    const BARRA = 25; // la barra de la T mide 50 × 10 mm (src/prueba/mallas.js)
    const rs = cxs.map((_, k) => {
        const p = ps.filter(q => copiaDe(q[0], cxs) === k);
        return p.length ? rango(p) : null;
    });
    const bajo = rs.every(
        (r, k) =>
            r && r.x0 >= cxs[k] - BARRA - 5 && r.x1 <= cxs[k] + BARRA + 5 && r.y0 >= cy0 - 5 - 5 && r.y1 <= cy0 + 5 + 5,
    );
    revisar(
        '5. soportes: los de cada copia caen bajo su pieza (huella ±5 mm)',
        bajo && rs.every(Boolean),
        rs
            .map(
                (r, k) =>
                    `copia ${k + 1} (huella X ${cxs[k] - BARRA}..${cxs[k] + BARRA}): ${r ? bb(r) : 'sin soportes'}`,
            )
            .join(' | '),
    );

    // 6. Retracción entre piezas: cada vez que una capa pasa de un cubo al otro hay retracción en el medio.
    let saltos = 0,
        sinRetraer = 0,
        primeraMala = '';
    const E = A.ext;
    for (let j = 1; j < E.length; j++) {
        const a = E[j - 1],
            b = E[j];
        if (a.capa !== b.capa || copiaDe(a.x1, cxs) === copiaDe(b.x0, cxs)) continue;
        saltos++;
        const entre = A.lineas.slice(a.i + 1, b.i);
        if (!entre.some(l => /^G1 E-[\d.]+/.test(l) || l.startsWith('G10'))) {
            sinRetraer++;
            primeraMala ||= `capa ${a.capa + 1}, líneas ${a.i + 1}-${b.i + 1}`;
        }
    }
    const capasConSalto = new Set(
        E.filter((e, j) => j && E[j - 1].capa === e.capa && copiaDe(E[j - 1].x1, cxs) !== copiaDe(e.x0, cxs)).map(
            e => e.capa,
        ),
    ).size;
    revisar(
        '6. retracción entre piezas: cada salto de un cubo al otro en una misma capa retrae',
        saltos > 0 && sinRetraer === 0 && capasConSalto >= capasN - 1,
        `${saltos} saltos en ${capasConSalto} de ${capasN} capas, ${sinRetraer} sin retracción ${primeraMala}`,
    );
}
