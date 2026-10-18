// Ayudas compartidas por las pruebas del motor (scripts/motor/*.mjs): leer el G-code como la vista previa, probar una
// pausa insertada, resumir un G-code, y leer movimientos y capas. No prueban nada por sí solas.

import { insertarPausas } from '../../src/motor/pausas.js';

// El lector de la vista previa es un worker: lo cargamos en Node simulando `self`.
globalThis.self ??= {};
export const { leer: leerRecorridos } = await import('../../src/motor/recorridos.worker.js');

// Inserta una pausa antes de la capa `capa` y verifica que quede justo entre la
// última extrusión de la capa anterior y la primera de esa capa.
export function probarPausa(gcode, capa) {
    const r = leerRecorridos(gcode, Infinity);
    const conPausa = insertarPausas(gcode, [{ capa, offset: r.pausaCapa[capa], z: r.zCapa[capa] }], ['M600']);
    const lineas = conPausa.split('\n');
    const iPausa = lineas.indexOf('M600');
    let z = 0,
        zAntes = NaN,
        zDespues = NaN;
    for (let i = 0; i < lineas.length; i++) {
        const m = lineas[i].match(/^G[01] .*Z(-?[\d.]+)/);
        if (m) z = +m[1];
        if (/^G1 .*X.*E\d|^G1 .*Y.*E\d/.test(lineas[i])) {
            if (i < iPausa) zAntes = z;
            else if (isNaN(zDespues)) zDespues = z;
        }
    }
    const ok =
        conPausa.split('\nM600\n').length === 2 &&
        Math.abs(zAntes - r.zCapa[capa - 1]) < 0.001 &&
        Math.abs(zDespues - r.zCapa[capa]) < 0.001;
    return {
        ok,
        detalle: `capa ${capa + 1}: Z antes ${zAntes}, después ${zDespues} (esperado ${r.zCapa[capa - 1].toFixed(2)} → ${r.zCapa[capa].toFixed(2)})`,
    };
}

// Datos útiles de un G-code para comparar.
export function analizar(gcode) {
    const lineas = gcode.split('\n');
    // Sólo la pieza: desde la primera línea que Kiri marca con "; feature" hasta la
    // última extrusión (así no cuentan la purga del inicio ni los movimientos del final).
    const desde = lineas.findIndex(l => l.startsWith('; feature'));
    let hasta = lineas.length - 1;
    while (hasta > desde && !/^G1 .*E\d/.test(lineas[hasta])) hasta--;
    const pieza = lineas.slice(desde, hasta + 1);
    const extrusiones = pieza.filter(l => /^G1 .*E\d/.test(l));
    const valores = eje =>
        extrusiones
            .map(l => l.match(new RegExp(eje + '(-?[\\d.]+)')))
            .filter(Boolean)
            .map(m => +m[1]);
    const zs = pieza
        .map(l => l.match(/^G[01] .*Z([\d.]+)/))
        .filter(Boolean)
        .map(m => +m[1]);
    const xs = valores('X'),
        ys = valores('Y');
    const min = v => v.reduce((a, b) => Math.min(a, b), Infinity);
    const max = v => v.reduce((a, b) => Math.max(a, b), -Infinity);
    return {
        lineas,
        extrusiones: extrusiones.length,
        capas: lineas.filter(l => l.startsWith(';LAYER:')).length,
        x: [min(xs), max(xs)],
        y: [min(ys), max(ys)],
        zMax: max(zs),
        tiene: prefijo => lineas.some(l => l.startsWith(prefijo)),
    };
}

export const filamento = r => (r.info.filamento / 1000).toFixed(2) + ' m';

// Movimientos con su posición (Kiri a veces escribe sólo X o sólo Y).
export const movimientos = lineas => {
    let x = 0,
        y = 0,
        z = 0,
        f = 0;
    return lineas
        .map(l => {
            if (!/^G[01] /.test(l)) return null;
            const v = letra => {
                const m = l.match(new RegExp(` ${letra}(-?[\\d.]+)`));
                return m ? +m[1] : NaN;
            };
            const x0 = x,
                y0 = y;
            if (!isNaN(v('X'))) x = v('X');
            if (!isNaN(v('Y'))) y = v('Y');
            if (!isNaN(v('Z'))) z = v('Z');
            if (!isNaN(v('F'))) f = v('F');
            return { x0, y0, x, y, z, f, e: v('E'), xy: !isNaN(v('X')) || !isNaN(v('Y')), linea: l };
        })
        .filter(Boolean);
};

export const capaDe = (r, n) => {
    const l = r.g.lineas;
    return l.slice(l.indexOf(`;LAYER:${n}`), l.indexOf(`;LAYER:${n + 1}`));
};
