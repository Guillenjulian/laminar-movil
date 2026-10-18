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

export async function probarPerfilesRevisados({ laminar, revisar, pagina }) {
    const lista = await pagina.evaluate(() => window.impresoras);
    const perfiles = {};
    for (const id of IDS) {
        const nombre = `perfil revisado ${id}`;
        const enLista = lista.find(i => i.id === id);
        revisar(`${nombre}: aparece en la lista como revisado`, enLista?.estado === 'revisado');
        if (!enLista) continue;
        const perfil = await pagina.evaluate(i => JSON.parse(JSON.stringify(window.buscarImpresora(i))), id);
        const { hotendMax, camaMax } = perfil.limites;
        const d = perfil.dispositivo;
        const dist = perfil.proceso.outputRetractDist;
        perfiles[id] = { dist };

        const r = await laminar({ caso: 'cubo', impresoraId: id, calidad: 'normal', material: 'pla' });
        const lineas = r.g.lineas;
        revisar(`${nombre}: sin macros {...} sin reemplazar`, !/\{[^}]*\}/.test(r.gcode));

        const temps = lineas.map(l => l.match(/^M10[49] S(\d+)/)?.[1]).filter(Boolean);
        const pla = lineas.filter(l => /^M109 S/.test(l)).map(l => +l.match(/S(\d+)/)[1]);
        const bed = lineas
            .filter(l => /^M1[49]0 S|BED_TEMP=/.test(l))
            .map(
                l =>
                    +l
                        .match(/S(\d+)|BED_TEMP=(\d+)/)
                        .slice(1)
                        .find(Boolean),
            );
        // Klipper con macro (START_PRINT): la temperatura va como parámetro, no como M109.
        const viaMacro = lineas.filter(l => /EXTRUDER_TEMP=/.test(l)).map(l => +l.match(/EXTRUDER_TEMP=(\d+)/)[1]);
        const tPla = pla.length ? pla : viaMacro;
        revisar(
            `${nombre}: temperatura de PLA (${tPla}) dentro de hotendMax ${hotendMax}`,
            tPla.length > 0 && tPla.every(t => t === 200 && t <= hotendMax) && temps.every(t => +t <= hotendMax),
        );
        revisar(
            `${nombre}: cama (${bed}) dentro de camaMax ${camaMax}`,
            bed.every(t => t <= camaMax),
        );

        const e = extremos(lineas);
        const dentro = e.x[0] >= -EPS && e.x[1] <= d.bedWidth + EPS && e.y[0] >= -EPS && e.y[1] <= d.bedDepth + EPS;
        revisar(
            `${nombre}: X/Y dentro de la cama ${d.bedWidth}x${d.bedDepth}`,
            dentro && e.x[1] > e.x[0],
            `(X ${e.x}, Y ${e.y})`,
        );

        const retracciones = porCapa(lineas).capas.flatMap(c => c.retracciones);
        revisar(
            `${nombre}: todas las retracciones (${retracciones.length}) son exactamente ${dist} mm`,
            retracciones.length > 0 && retracciones.every(x => Math.abs(x - dist) < EPS),
            `(valores: ${[...new Set(retracciones)]})`,
        );
    }

    // Bowden vs. directos: la retracción del perfil Bowden es mayor que la de cada directo.
    for (const id of BOWDEN.filter(i => perfiles[i])) {
        const directos = IDS.filter(i => !BOWDEN.includes(i) && perfiles[i]);
        const maxDirecto = Math.max(...directos.map(i => perfiles[i].dist));
        revisar(
            `Bowden ${id}: retracción ${perfiles[id].dist} mm > la mayor de los directos (${maxDirecto} mm)`,
            perfiles[id].dist > maxDirecto && perfiles[id].dist === 5,
        );
    }

    // El revisado tapa a su equivalente importado.
    for (const tapado of ['kiri-creality-k1', 'kiri-anycubic-kobra-2']) {
        revisar(`el importado ${tapado} no se lista (lo tapa el revisado)`, !lista.some(i => i.id === tapado));
    }
}
