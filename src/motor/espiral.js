// Modo jarrón en espiral.
//
// Kiri tiene "modo jarrón" (sliceFillType: 'vase'): una pared, sin agujeros,
// sin relleno y sin tapa, pero cada capa es una vuelta plana y entre capa y
// capa sube Z de golpe (queda una costura). Acá lo convertimos en espiral de
// verdad: en las capas que son una sola vuelta, sacamos el salto de Z y
// hacemos que la Z suba de a poco a lo largo de la vuelta, desde la altura de
// la capa anterior hasta la de esta.
//
// Una capa se convierte sólo si:
//   - empieza con un movimiento sólo de Z (el cambio de capa de Kiri),
//   - arranca donde terminó la anterior (o a menos de 2 mm, sin retraer),
//   - y sube como mucho 1 mm.
// La vuelta termina en el primer viaje, retracción o cambio de Z.
// Las capas del fondo (con relleno sólido y viajes) quedan como están.
//
// Al principio de cada vuelta deja el comentario MARCA: el lector de la vista
// previa (recorridos.worker.js) lo usa para saber dónde empieza cada capa, porque
// la Z ya no salta.

export const MARCA = '; capa en espiral';

const ACERCAMIENTO = 2; // mm: viaje máximo al empezar una vuelta

const num = (linea, letra) => {
    const m = linea.match(new RegExp(`\\s${letra}(-?[\\d.]+)`));
    return m ? +m[1] : NaN;
};

// Lee los ejes de una línea G0/G1 (sin el comentario). `soloZ`: es el cambio de capa de Kiri,
// un movimiento que sólo mueve Z.
function leerMovimiento(linea) {
    const sinComentario = linea.split(';')[0];
    const s = ' ' + sinComentario;
    const vz = num(s, 'Z');
    return {
        vx: num(s, 'X'),
        vy: num(s, 'Y'),
        ve: num(s, 'E'),
        vz,
        soloZ: !isNaN(vz) && !/[XYE]/.test(sinComentario.slice(2)),
    };
}

// Anota en `est` dónde está la herramienta después de un movimiento (y dónde terminó la última extrusión).
function registrarMovimiento(est, mov) {
    const { vx, vy, vz, ve } = mov;
    if (!isNaN(vx)) est.x = vx;
    if (!isNaN(vy)) est.y = vy;
    if (!isNaN(vz)) est.z = vz;
    if (ve > 0 && (!isNaN(vx) || !isNaN(vy))) {
        est.zExtrusion = est.z;
        est.xFin = est.x;
        est.yFin = est.y;
    }
}

// Recorre las líneas desde `desde` mientras sean la vuelta (un viaje corto al principio y después
// sólo extrusiones). Devuelve dónde se cortó (`k`), el largo extruido y cuántas extrusiones hubo;
// o null si el viaje del principio es demasiado largo.
function recorrerVuelta(lineas, desde, xFin, yFin) {
    let largo = 0,
        px = xFin,
        py = yFin,
        extrusiones = 0,
        movimientos = 0,
        k = desde;
    for (; k < lineas.length; k++) {
        const l = lineas[k];
        if (!l.startsWith('G')) continue; // comentarios, M73, M106…
        if (!/^G1\s/.test(l)) break;
        const { vx, vy, vz, ve } = leerMovimiento(l);
        const nx = isNaN(vx) ? px : vx,
            ny = isNaN(vy) ? py : vy;
        // Se acepta un viaje corto al principio: en piezas redondas cada vuelta
        // arranca en el punto más cercano al final de la anterior, no en el mismo.
        if (movimientos++ === 0 && isNaN(ve) && isNaN(vz) && (!isNaN(vx) || !isNaN(vy))) {
            if (Math.hypot(nx - px, ny - py) > ACERCAMIENTO) return null;
        } else {
            // Termina en el próximo cambio de Z, o en un viaje o retracción.
            if (!isNaN(vz) || !(ve > 0) || (isNaN(vx) && isNaN(vy))) break;
            largo += Math.hypot(nx - px, ny - py);
            extrusiones++;
        }
        px = nx;
        py = ny;
    }
    return { k, largo, extrusiones };
}

// ¿Hay más extrusión después de `desde`, antes del próximo cambio de Z? Entonces la capa
// tiene relleno o varias islas y queda plana.
function extruyeDespues(lineas, desde) {
    for (let j = desde; j < lineas.length; j++) {
        const s = ' ' + lineas[j].split(';')[0];
        if (!/^ G[0-3]\s/.test(s)) continue;
        const z = !isNaN(num(s, 'Z'));
        if (z && !/[XYE]/.test(s.slice(3))) return false; // cambio de capa
        if (num(s, 'E') > 0 && (!isNaN(num(s, 'X')) || !isNaN(num(s, 'Y')))) return true;
    }
    return false;
}

// ¿Las líneas desde `desde` hasta el próximo movimiento de Z son una sola vuelta de pura
// extrusión? Devuelve { fin, largo } o null.
function vueltaDesde(lineas, desde, xFin, yFin) {
    const r = recorrerVuelta(lineas, desde, xFin, yFin);
    if (!r || extruyeDespues(lineas, r.k)) return null;
    let k = r.k;
    // Lo que no es movimiento al final (ej. ";LAYER:n") queda para lo que sigue.
    while (k > desde && !lineas[k - 1].startsWith('G')) k--;
    if (!r.extrusiones || r.largo <= 0) return null;
    return { fin: k, largo: r.largo };
}

// Pasa una línea de la vuelta a espiral: la extrusión sube su Z según lo recorrido (`prog.recorrido`);
// el acercamiento corto se queda a la Z de antes. `prog` lleva { px, py, recorrido }.
function lineaEnEspiral(l, prog, zBase, sube, largo) {
    const { vx, vy, ve } = leerMovimiento(l);
    const nx = isNaN(vx) ? prog.px : vx;
    const ny = isNaN(vy) ? prog.py : vy;
    const viaje = !(ve > 0);
    if (!viaje) prog.recorrido += Math.hypot(nx - prog.px, ny - prog.py);
    prog.px = nx;
    prog.py = ny;
    if (viaje) return l;
    const zk = zBase + sube * Math.min(1, prog.recorrido / largo);
    return l.replace(/^(G1(?:\s+[XY]-?[\d.]+)+)/, `$1 Z${zk.toFixed(4)}`);
}

// Escribe en `salida` la vuelta que empieza después de la línea `i` (el cambio de capa) con la
// Z subiendo de a poco, y deja `est` donde termina la vuelta.
function convertirVuelta(lineas, i, capa, vz, est, salida) {
    const sube = vz - est.zExtrusion;
    const prog = { px: est.xFin, py: est.yFin, recorrido: 0 };
    salida.push(MARCA);
    for (let k = i + 1; k < capa.fin; k++) {
        const l = lineas[k];
        salida.push(/^G1\s/.test(l) ? lineaEnEspiral(l, prog, est.zExtrusion, sube, capa.largo) : l);
    }
    est.x = est.xFin = prog.px;
    est.y = est.yFin = prog.py;
    est.z = est.zExtrusion = vz;
}

// Si la línea `i` (sólo Z) abre una vuelta que se puede convertir, devuelve { fin, largo }; si no, null.
function vueltaConvertible(lineas, i, vz, est) {
    const capa = vueltaDesde(lineas, i + 1, est.xFin, est.yFin);
    const sube = vz - est.zExtrusion;
    const ok = capa && sube > 1e-6 && sube <= 1 && est.x === est.xFin && est.y === est.yFin;
    return ok ? capa : null;
}

export function espiralar(gcode) {
    const lineas = gcode.split('\n');
    const salida = [];
    // Posición actual, Z de la última extrusión y dónde terminó.
    const est = { x: NaN, y: NaN, z: NaN, zExtrusion: NaN, xFin: NaN, yFin: NaN };

    let i = 0;
    while (i < lineas.length) {
        const linea = lineas[i];
        const mov = /^G[01]\s/.test(linea) ? leerMovimiento(linea) : null;
        const capa = mov && mov.soloZ ? vueltaConvertible(lineas, i, mov.vz, est) : null;
        if (capa) {
            convertirVuelta(lineas, i, capa, mov.vz, est, salida);
            i = capa.fin;
            continue;
        }
        salida.push(linea);
        if (mov) registrarMovimiento(est, mov);
        i++;
    }
    return salida.join('\n');
}
