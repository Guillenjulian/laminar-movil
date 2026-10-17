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

export function espiralar(gcode) {
    const lineas = gcode.split('\n');
    const salida = [];
    let x = NaN, y = NaN, z = NaN;   // posición actual
    let zExtrusion = NaN;            // Z de la última extrusión
    let xFin = NaN, yFin = NaN;      // dónde terminó la última extrusión

    let i = 0;
    while (i < lineas.length) {
        const linea = lineas[i];
        const esMov = /^G[01]\s/.test(linea);
        const sinComentario = linea.split(';')[0];
        const vz = esMov ? num(' ' + sinComentario, 'Z') : NaN;
        const soloZ = esMov && !isNaN(vz) && !/[XYE]/.test(sinComentario.slice(2));

        if (soloZ) {
            const capa = vueltaDesde(i + 1);
            const sube = vz - zExtrusion;
            if (capa && sube > 1e-6 && sube <= 1 && x === xFin && y === yFin) {
                // Convertir: la Z va de zExtrusion a vz según lo recorrido.
                salida.push(MARCA);
                let recorrido = 0, px = xFin, py = yFin;
                for (let k = i + 1; k < capa.fin; k++) {
                    const l = lineas[k];
                    if (!/^G1\s/.test(l)) { salida.push(l); continue; }
                    const s = ' ' + l.split(';')[0];
                    const nx = isNaN(num(s, 'X')) ? px : num(s, 'X');
                    const ny = isNaN(num(s, 'Y')) ? py : num(s, 'Y');
                    const viaje = !(num(s, 'E') > 0);
                    if (!viaje) recorrido += Math.hypot(nx - px, ny - py);
                    px = nx; py = ny;
                    if (viaje) { salida.push(l); continue; } // el acercamiento corto, a la Z de antes
                    const zk = zExtrusion + sube * Math.min(1, recorrido / capa.largo);
                    salida.push(l.replace(/^(G1(?:\s+[XY]-?[\d.]+)+)/, `$1 Z${zk.toFixed(4)}`));
                }
                x = xFin = px; y = yFin = py; z = zExtrusion = vz;
                i = capa.fin;
                continue;
            }
        }

        salida.push(linea);
        if (esMov) {
            const s = ' ' + sinComentario;
            const vx = num(s, 'X'), vy = num(s, 'Y'), ve = num(s, 'E');
            if (!isNaN(vx)) x = vx;
            if (!isNaN(vy)) y = vy;
            if (!isNaN(vz)) z = vz;
            if (ve > 0 && (!isNaN(vx) || !isNaN(vy))) {
                zExtrusion = z; xFin = x; yFin = y;
            }
        }
        i++;
    }
    return salida.join('\n');

    // ¿Las líneas desde `desde` hasta el próximo movimiento de Z son una sola
    // vuelta de pura extrusión? Devuelve { fin, largo } o null.
    function vueltaDesde(desde) {
        let largo = 0, px = xFin, py = yFin, extrusiones = 0, movimientos = 0, k = desde;
        for (; k < lineas.length; k++) {
            const l = lineas[k];
            if (!l.startsWith('G')) continue;               // comentarios, M73, M106…
            if (!/^G1\s/.test(l)) break;
            const s = ' ' + l.split(';')[0];
            const vx = num(s, 'X'), vy = num(s, 'Y'), ve = num(s, 'E');
            // Se acepta un viaje corto al principio: en piezas redondas cada vuelta
            // arranca en el punto más cercano al final de la anterior, no en el mismo.
            if (movimientos++ === 0 && isNaN(ve) && isNaN(num(s, 'Z')) && (!isNaN(vx) || !isNaN(vy))) {
                const nx = isNaN(vx) ? px : vx, ny = isNaN(vy) ? py : vy;
                if (Math.hypot(nx - px, ny - py) > ACERCAMIENTO) return null;
                px = nx; py = ny;
                continue;
            }
            // Termina en el próximo cambio de Z, o en un viaje o retracción.
            if (!isNaN(num(s, 'Z')) || !(ve > 0) || (isNaN(vx) && isNaN(vy))) break;
            const nx = isNaN(vx) ? px : vx, ny = isNaN(vy) ? py : vy;
            largo += Math.hypot(nx - px, ny - py);
            px = nx; py = ny;
            extrusiones++;
        }
        // La capa tiene que ser una sola vuelta: después no puede extruir nada más
        // hasta el próximo cambio de Z (si hay relleno o varias islas, queda plana).
        for (let j = k; j < lineas.length; j++) {
            const s = ' ' + lineas[j].split(';')[0];
            if (!/^ G[0-3]\s/.test(s)) continue;
            const z = !isNaN(num(s, 'Z'));
            if (z && !/[XYE]/.test(s.slice(3))) break;    // cambio de capa
            if (num(s, 'E') > 0 && (!isNaN(num(s, 'X')) || !isNaN(num(s, 'Y')))) return null;
        }
        // Lo que no es movimiento al final (ej. ";LAYER:n") queda para lo que sigue.
        while (k > desde && !lineas[k - 1].startsWith('G')) k--;
        if (!extrusiones || largo <= 0) return null;
        return { fin: k, largo };
    }
}
