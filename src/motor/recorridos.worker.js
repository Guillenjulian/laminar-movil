// Lee un G-code y arma los recorridos para la vista previa capa por capa.
//
// Recibe: { gcode: string, maxSegmentos }
// Manda:  { tipo: 'listo', posiciones: Uint16Array (6 por segmento, ver CUANTIZADO), colores: Uint8Array (6 por segmento),
//           tipos: Uint8Array (tipo de línea de cada segmento, índice en TIPOS),
//           inicioCapa: Uint32Array (índice del primer segmento de cada capa, + uno final),
//           pausaCapa: Float64Array (posición en el texto del G-code donde insertar una pausa
//                      antes de cada capa: justo antes de subir Z, con la capa anterior terminada),
//           zCapa: Float32Array, caja: {min, max}, incompleta: bool }
//
// Sólo se guardan los movimientos que extruyen (los viajes no se dibujan).
// Los tramos seguidos casi alineados se unen en uno: a la vista es igual y
// usa mucha menos memoria (un G-code grande tiene millones de tramos cortitos).
const q = v => Math.max(0, Math.min(65535, Math.round((v + CUANTIZADO.DESPLAZAMIENTO) * CUANTIZADO.ESCALA)));

const DESVIO = 0.02;     // mm: cuánto se puede apartar de la recta el punto que se saca
const LARGO_CURVA = 3;   // mm: largo máximo de un tramo unido que no es recto (para no aplanar curvas)

import { TIPOS, CUANTIZADO } from './tipos-linea.js';
import { MARCA as MARCA_ESPIRAL } from './espiral.js';

const OTRO = TIPOS.length - 1;

function tipoDe(nombre) {
    const i = TIPOS.findIndex(t => t.claves.some(c => nombre.startsWith(c)));
    return i < 0 ? OTRO : i;
}

// Arrays que crecen al doble cuando se llenan.
class Lista {
    constructor(Tipo, capacidad) { this.Tipo = Tipo; this.datos = new Tipo(capacidad); this.n = 0; }
    asegurar(extra) {
        if (this.n + extra <= this.datos.length) return;
        const nuevo = new this.Tipo(Math.max(this.datos.length * 2, this.n + extra));
        nuevo.set(this.datos);
        this.datos = nuevo;
    }
    final() { return this.datos.slice(0, this.n); }
}

// Valor numérico de un parámetro (ej. 'X') dentro de una línea, o NaN.
function valor(linea, letra, desde) {
    const i = linea.indexOf(letra, desde);
    if (i < 0) return NaN;
    return parseFloat(linea.slice(i + 1));
}

export function leer(gcode, maxSegmentos) {
    const pos = new Lista(Uint16Array, 6 * 65536);
    const col = new Lista(Uint8Array, 6 * 65536);
    const tip = new Lista(Uint8Array, 65536);
    const inicioCapa = [], zCapa = [];
    let x = 0, y = 0, z = 0, e = 0;
    let absoluto = true, eAbsoluto = true;
    let tipo = OTRO, enPieza = false, capaZ = NaN, incompleta = false, vueltaNueva = false;
    let segmentos = 0;
    // último segmento guardado (para unir los alineados): inicio (sx, sy), fin (ux, uy)
    let sx = 0, sy = 0, ux = 0, uy = 0, uz = NaN, utipo = -1, recto = true;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];

    const pausaCapa = [];
    let offCambioZ = -1, offUltimaExtrusion = -1; // posiciones en el texto (para las pausas)

    let inicio = 0;
    while (inicio < gcode.length) {
        let fin = gcode.indexOf('\n', inicio);
        if (fin < 0) fin = gcode.length;
        const linea = gcode.slice(inicio, fin);
        const offLinea = inicio;
        inicio = fin + 1;

        const c0 = linea.charCodeAt(0);
        if (c0 === 59 /* ; */) {
            if (linea.startsWith('; feature ')) {
                tipo = tipoDe(linea.slice(10));
                enPieza = true; // lo de antes (purga del G-code de inicio) no se dibuja
            } else if (linea.startsWith(MARCA_ESPIRAL)) {
                vueltaNueva = true; // modo jarrón: acá empieza otra vuelta (ver espiral.js)
            }
            continue;
        }
        const pc = linea.indexOf(';');
        const sinComentario = pc < 0 ? linea : linea.slice(0, pc);
        if (c0 === 77 /* M */) {
            if (sinComentario.startsWith('M82')) eAbsoluto = true;
            else if (sinComentario.startsWith('M83')) eAbsoluto = false;
            continue;
        }
        if (c0 !== 71 /* G */) continue;
        const g = parseInt(sinComentario.slice(1));
        if (g === 90) { absoluto = true; eAbsoluto = true; continue; }
        if (g === 91) { absoluto = false; eAbsoluto = false; continue; }
        if (g === 92) {
            const ne = valor(sinComentario, 'E', 1);
            if (!isNaN(ne)) e = ne;
            continue;
        }
        if (g < 0 || g > 3) continue;

        // Movimiento (G2/G3 se toman como recta hasta el punto final).
        const vx = valor(sinComentario, 'X', 1), vy = valor(sinComentario, 'Y', 1);
        const vz = valor(sinComentario, 'Z', 1), ve = valor(sinComentario, 'E', 1);
        const nx = isNaN(vx) ? x : absoluto ? vx : x + vx;
        const ny = isNaN(vy) ? y : absoluto ? vy : y + vy;
        const nz = isNaN(vz) ? z : absoluto ? vz : z + vz;
        let extruye = false;
        if (!isNaN(ve)) {
            extruye = eAbsoluto ? ve > e + 1e-6 : ve > 1e-6;
            e = eAbsoluto ? ve : e + ve;
        }
        if (extruye && enPieza && (nx !== x || ny !== y)) {
            // ¿Capa nueva? (cambió la altura a la que se extruye). En espiral la Z
            // sube en cada tramo (la línea trae Z): ahí la capa la marca MARCA_ESPIRAL.
            const enEspiral = !isNaN(vz);
            if (vueltaNueva || (nz !== capaZ && !enEspiral) || isNaN(capaZ)) {
                vueltaNueva = false;
                // La pausa va antes del movimiento que subió Z (si fue después de la última
                // extrusión de la capa anterior); si no, antes de esta línea.
                pausaCapa.push(offCambioZ > offUltimaExtrusion ? offCambioZ : offLinea);
                capaZ = nz;
                inicioCapa.push(segmentos);
                zCapa.push(nz);
                utipo = -1;
            }
            // ¿Se puede unir con el anterior? Tiene que seguir desde donde terminó, y el
            // punto que se saca (x, y) tiene que quedar casi sobre la recta nueva.
            let unir = false;
            if (utipo === tipo && ux === x && uy === y && uz === nz) {
                const lx = nx - sx, ly = ny - sy, largo = Math.hypot(lx, ly);
                const avanza = (x - sx) * lx + (y - sy) * ly > 0 && (nx - x) * lx + (ny - y) * ly > 0;
                const desvio = largo > 0 ? Math.abs((x - sx) * ly - (y - sy) * lx) / largo : Infinity;
                const sigueRecto = recto && desvio < 1e-4;
                unir = avanza && desvio < DESVIO && (sigueRecto || largo < LARGO_CURVA);
                if (unir) recto = sigueRecto;
            }
            if (unir) {
                pos.datos[pos.n - 3] = q(nx);
                pos.datos[pos.n - 2] = q(ny);
            } else {
                if (segmentos >= maxSegmentos) {
                    incompleta = true;
                    break;
                }
                pos.asegurar(6);
                col.asegurar(6);
                tip.asegurar(1);
                tip.datos[tip.n++] = tipo;
                const p = pos.datos, c = col.datos, color = TIPOS[tipo].color;
                p[pos.n] = q(x); p[pos.n + 1] = q(y); p[pos.n + 2] = q(nz);
                p[pos.n + 3] = q(nx); p[pos.n + 4] = q(ny); p[pos.n + 5] = q(nz);
                for (let k = 0; k < 6; k++) c[col.n + k] = color[k % 3];
                pos.n += 6;
                col.n += 6;
                segmentos++;
                utipo = tipo; sx = x; sy = y; recto = true;
            }
            ux = nx; uy = ny; uz = nz;
            offUltimaExtrusion = offLinea;
            if (nx < min[0]) min[0] = nx; if (nx > max[0]) max[0] = nx;
            if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
            if (ny < min[1]) min[1] = ny; if (ny > max[1]) max[1] = ny;
            if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
            if (nz < min[2]) min[2] = nz; if (nz > max[2]) max[2] = nz;
        }
        if (nz !== z) offCambioZ = offLinea;
        x = nx; y = ny; z = nz;
    }
    inicioCapa.push(segmentos);
    return {
        posiciones: pos.final(),
        colores: col.final(),
        tipos: tip.final(),
        inicioCapa: Uint32Array.from(inicioCapa),
        pausaCapa: Float64Array.from(pausaCapa),
        zCapa: Float32Array.from(zCapa),
        caja: { min, max },
        incompleta,
    };
}

self.onmessage = e => {
    try {
        const r = leer(e.data.gcode, e.data.maxSegmentos || Infinity);
        self.postMessage({ tipo: 'listo', ...r },
            [r.posiciones.buffer, r.colores.buffer, r.tipos.buffer, r.inicioCapa.buffer, r.zCapa.buffer, r.pausaCapa.buffer]);
    } catch (err) {
        self.postMessage({ tipo: 'error', mensaje: err.message || String(err) });
    }
};
