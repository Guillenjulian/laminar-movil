// Perfiles revisados de impresoras populares contra el Kiri real.
// Responsabilidad: por cada perfil, laminar el cubo de 20 mm con PLA y revisar sobre el G-code que no queden macros
// `{...}` sin reemplazar, que las temperaturas no pasen de `limites`, que X/Y queden dentro de la cama y que la
// retracción sea exactamente la del perfil (y la de las Bowden, mayor que la de las directas).
// Lo llama scripts/probar-motor.mjs dentro de su `try`, con su propio `laminar()` y `revisar()`.

import { porCapa } from './gcode-capas.mjs';

const IDS = [
    'creality-ender-3-v2',
    'creality-ender-3-v3-ke',
    'creality-k1',
    'elegoo-neptune-4',
    'anycubic-kobra-2',
    'anycubic-kobra-3',
    'prusa-mk4',
    'sovol-sv06',
];
const BOWDEN = ['creality-ender-3-v2'];
const EPS = 1e-6;

// Mayor y menor X/Y de los movimientos en coordenadas absolutas (G91 los desactiva hasta el próximo G90).
function extremos(lineas) {
    const r = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] };
    let absoluto = true;
    for (const l of lineas) {
        if (/^G90\b/.test(l)) absoluto = true;
        else if (/^G91\b/.test(l)) absoluto = false;
        if (!absoluto || !/^G[01] /.test(l)) continue;
        for (const eje of ['x', 'y']) {
            const m = l.match(new RegExp(`[ ]${eje.toUpperCase()}(-?[\\d.]+)`));
            if (m) {
                r[eje][0] = Math.min(r[eje][0], +m[1]);
                r[eje][1] = Math.max(r[eje][1], +m[1]);
            }
        }
    }
    return r;
}

const num = (l, re) => +l.match(re)[1];

// Temperaturas del G-code. Klipper con macro (START_PRINT): van como parámetro, no como M109/M190.
function temperaturas(lineas) {
    const pla = lineas.filter(l => /^M109 S/.test(l)).map(l => num(l, /S(\d+)/));
    const viaMacro = lineas.filter(l => /EXTRUDER_TEMP=/.test(l)).map(l => num(l, /EXTRUDER_TEMP=(\d+)/));
    const cama = lineas.filter(l => /^M1[49]0 S/.test(l)).map(l => num(l, /S(\d+)/));
    const camaMacro = lineas.filter(l => /BED_TEMP=/.test(l)).map(l => num(l, /BED_TEMP=(\d+)/));
    const todas = lineas.filter(l => /^M10[49] S/.test(l)).map(l => num(l, /S(\d+)/));
    return { pla: pla.length ? pla : viaMacro, cama: [...cama, ...camaMacro], todas };
}

function revisarTemperaturas(revisar, nombre, lineas, { hotendMax, camaMax }) {
    const t = temperaturas(lineas);
    revisar(
        `${nombre}: temperatura de PLA (${t.pla}) dentro de hotendMax ${hotendMax}`,
        t.pla.length > 0 && t.pla.every(x => x === 200 && x <= hotendMax) && t.todas.every(x => x <= hotendMax),
    );
    revisar(
        `${nombre}: cama (${t.cama}) dentro de camaMax ${camaMax}`,
        t.cama.length > 0 && t.cama.every(x => x <= camaMax),
    );
}

function revisarCama(revisar, nombre, lineas, d) {
    const e = extremos(lineas);
    const dentro = e.x[0] >= -EPS && e.x[1] <= d.bedWidth + EPS && e.y[0] >= -EPS && e.y[1] <= d.bedDepth + EPS;
    revisar(
        `${nombre}: X/Y dentro de la cama ${d.bedWidth}x${d.bedDepth}`,
        dentro && e.x[1] > e.x[0],
        `(X ${e.x}, Y ${e.y})`,
    );
}

function revisarRetraccion(revisar, nombre, lineas, dist) {
    const retracciones = porCapa(lineas).capas.flatMap(c => c.retracciones);
    revisar(
        `${nombre}: todas las retracciones (${retracciones.length}) son exactamente ${dist} mm`,
        retracciones.length > 0 && retracciones.every(x => Math.abs(x - dist) < EPS),
        `(valores: ${[...new Set(retracciones)]})`,
    );
}

// Todas las verificaciones de un perfil; devuelve su retracción.
async function probarPerfil({ laminar, revisar, pagina }, id) {
    const nombre = `perfil revisado ${id}`;
    const perfil = await pagina.evaluate(i => JSON.parse(JSON.stringify(window.buscarImpresora(i))), id);
    const r = await laminar({ caso: 'cubo', impresoraId: id, calidad: 'normal', material: 'pla' });
    revisar(`${nombre}: sin macros {...} sin reemplazar`, !/\{[^}]*\}/.test(r.gcode));
    revisarTemperaturas(revisar, nombre, r.g.lineas, perfil.limites);
    revisarCama(revisar, nombre, r.g.lineas, perfil.dispositivo);
    revisarRetraccion(revisar, nombre, r.g.lineas, perfil.proceso.outputRetractDist);
    return perfil.proceso.outputRetractDist;
}

// Bowden vs. directos: la retracción del perfil Bowden es mayor que la de cada directo.
function revisarBowden(revisar, dists) {
    for (const id of BOWDEN.filter(i => dists[i] !== undefined)) {
        const directos = IDS.filter(i => !BOWDEN.includes(i) && dists[i] !== undefined);
        const maxDirecto = Math.max(...directos.map(i => dists[i]));
        revisar(
            `Bowden ${id}: retracción ${dists[id]} mm > la mayor de los directos (${maxDirecto} mm)`,
            dists[id] > maxDirecto && dists[id] === 5,
        );
    }
}

export async function probarPerfilesRevisados(ctx) {
    const lista = await ctx.pagina.evaluate(() => window.impresoras);
    const dists = {};
    for (const id of IDS) {
        const enLista = lista.find(i => i.id === id);
        ctx.revisar(`perfil revisado ${id}: aparece en la lista como revisado`, enLista?.estado === 'revisado');
        if (enLista) dists[id] = await probarPerfil(ctx, id);
    }
    revisarBowden(ctx.revisar, dists);
    // El revisado tapa a su equivalente importado.
    for (const tapado of ['kiri-creality-k1', 'kiri-anycubic-kobra-2']) {
        ctx.revisar(`el importado ${tapado} no se lista (lo tapa el revisado)`, !lista.some(i => i.id === tapado));
    }
}
