// Lector de G-code para la vista previa: arma los recorridos capa por capa.
// Lo usa recorridos.worker.js (que sólo agrega el mensaje del worker).
//
// Es puro (sin `self` ni DOM) y vive en un módulo aparte para poder probarlo en Node.
// Procesa G-codes enormes: en el bucle por línea no se arman objetos ni closures; el estado
// está en campos de `Lector` y los resultados van a arrays tipados que crecen al doble.
//
// Sólo se guardan los movimientos que extruyen (los viajes no se dibujan).
// Los tramos seguidos casi alineados se unen en uno: a la vista es igual y
// usa mucha menos memoria (un G-code grande tiene millones de tramos cortitos).
import { TIPOS, CUANTIZADO } from './tipos-linea.js';
import { MARCA as MARCA_ESPIRAL } from './espiral.js';

const DESVIO = 0.02; // mm: cuánto se puede apartar de la recta el punto que se saca
const LARGO_CURVA = 3; // mm: largo máximo de un tramo unido que no es recto (para no aplanar curvas)
const OTRO = TIPOS.length - 1;

const q = v => Math.max(0, Math.min(65535, Math.round((v + CUANTIZADO.DESPLAZAMIENTO) * CUANTIZADO.ESCALA)));

function tipoDe(nombre) {
    const i = TIPOS.findIndex(t => t.claves.some(c => nombre.startsWith(c)));
    return i < 0 ? OTRO : i;
}

/** Array tipado que crece al doble cuando se llena. */
class Lista {
    /**
     * @param {Function} Tipo constructor del array tipado (Uint16Array, Uint8Array…)
     * @param {number} capacidad elementos iniciales
     */
    constructor(Tipo, capacidad) {
        this.Tipo = Tipo;
        this.datos = new Tipo(capacidad);
        this.n = 0;
    }
    /** Deja lugar para `extra` elementos más. */
    asegurar(extra) {
        if (this.n + extra <= this.datos.length) return;
        const nuevo = new this.Tipo(Math.max(this.datos.length * 2, this.n + extra));
        nuevo.set(this.datos);
        this.datos = nuevo;
    }
    /** Copia justa de lo escrito. */
    final() {
        return this.datos.slice(0, this.n);
    }
}

// Valor numérico de un parámetro (ej. 'X') dentro de una línea, o NaN.
function valor(linea, letra, desde) {
    const i = linea.indexOf(letra, desde);
    if (i < 0) return NaN;
    return parseFloat(linea.slice(i + 1));
}

/** Estado del recorrido del G-code y los resultados que se van armando. */
class Lector {
    /** @param {number} maxSegmentos tope de tramos guardados */
    constructor(maxSegmentos) {
        this.maxSegmentos = maxSegmentos;
        this.pos = new Lista(Uint16Array, 6 * 65536);
        this.col = new Lista(Uint8Array, 6 * 65536);
        this.tip = new Lista(Uint8Array, 65536);
        this.inicioCapa = [];
        this.zCapa = [];
        this.pausaCapa = [];
        this.min = [Infinity, Infinity, Infinity];
        this.max = [-Infinity, -Infinity, -Infinity];
        // posición y modo actuales
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.e = 0;
        this.absoluto = true;
        this.eAbsoluto = true;
        this.tipo = OTRO;
        this.enPieza = false;
        this.capaZ = NaN;
        this.incompleta = false;
        this.vueltaNueva = false;
        this.segmentos = 0;
        // último tramo guardado (para unir los alineados): inicio (sx, sy), fin (ux, uy, uz)
        this.sx = 0;
        this.sy = 0;
        this.ux = 0;
        this.uy = 0;
        this.uz = NaN;
        this.utipo = -1;
        this.recto = true;
        // posiciones en el texto (para las pausas)
        this.offCambioZ = -1;
        this.offUltimaExtrusion = -1;
    }

    /** Lee todo el G-code (se corta si se llena `maxSegmentos`). */
    leer(gcode) {
        let inicio = 0;
        while (inicio < gcode.length) {
            let fin = gcode.indexOf('\n', inicio);
            if (fin < 0) fin = gcode.length;
            const offLinea = inicio;
            inicio = fin + 1;
            if (!this.linea(gcode.slice(offLinea, fin), offLinea)) break;
        }
        this.inicioCapa.push(this.segmentos);
    }

    /** Una línea. Devuelve false cuando hay que dejar de leer. */
    linea(linea, offLinea) {
        const c0 = linea.charCodeAt(0);
        if (c0 === 59 /* ; */) {
            this.comentario(linea);
            return true;
        }
        const pc = linea.indexOf(';');
        const sinComentario = pc < 0 ? linea : linea.slice(0, pc);
        if (c0 === 77 /* M */) {
            if (sinComentario.startsWith('M82')) this.eAbsoluto = true;
            else if (sinComentario.startsWith('M83')) this.eAbsoluto = false;
            return true;
        }
        if (c0 !== 71 /* G */) return true;
        return this.comandoG(sinComentario, offLinea);
    }

    comentario(linea) {
        if (linea.startsWith('; feature ')) {
            this.tipo = tipoDe(linea.slice(10));
            this.enPieza = true; // lo de antes (purga del G-code de inicio) no se dibuja
        } else if (linea.startsWith(MARCA_ESPIRAL)) {
            this.vueltaNueva = true; // modo jarrón: acá empieza otra vuelta (ver espiral.js)
        }
    }

    comandoG(sinComentario, offLinea) {
        const g = parseInt(sinComentario.slice(1));
        if (g === 90 || g === 91) {
            this.absoluto = this.eAbsoluto = g === 90;
            return true;
        }
        if (g === 92) {
            const ne = valor(sinComentario, 'E', 1);
            if (!isNaN(ne)) this.e = ne;
            return true;
        }
        if (g < 0 || g > 3) return true;
        return this.movimiento(sinComentario, offLinea);
    }

    // Movimiento (G2/G3 se toman como recta hasta el punto final).
    movimiento(s, offLinea) {
        const { x, y, z, absoluto } = this;
        const vx = valor(s, 'X', 1),
            vy = valor(s, 'Y', 1);
        const vz = valor(s, 'Z', 1),
            ve = valor(s, 'E', 1);
        const nx = isNaN(vx) ? x : absoluto ? vx : x + vx;
        const ny = isNaN(vy) ? y : absoluto ? vy : y + vy;
        const nz = isNaN(vz) ? z : absoluto ? vz : z + vz;
        const extruye = this.extruye(ve);
        if (extruye && this.enPieza && (nx !== x || ny !== y)) {
            if (!this.extrusion(nx, ny, nz, !isNaN(vz), offLinea)) return false;
        }
        if (nz !== z) this.offCambioZ = offLinea;
        this.x = nx;
        this.y = ny;
        this.z = nz;
        return true;
    }

    // ¿El valor de E de este movimiento extruye? Actualiza el E acumulado.
    extruye(ve) {
        if (isNaN(ve)) return false;
        const eAbs = this.eAbsoluto;
        const extruye = eAbs ? ve > this.e + 1e-6 : ve > 1e-6;
        this.e = eAbs ? ve : this.e + ve;
        return extruye;
    }

    // Una extrusión de (x, y) a (nx, ny, nz). `enEspiral`: la línea trae Z (la Z sube en cada tramo).
    // Devuelve false si se llenó `maxSegmentos`.
    extrusion(nx, ny, nz, enEspiral, offLinea) {
        // ¿Capa nueva? (cambió la altura a la que se extruye). En espiral la capa la marca MARCA_ESPIRAL.
        if (this.vueltaNueva || (nz !== this.capaZ && !enEspiral) || isNaN(this.capaZ)) {
            this.capaNueva(nz, offLinea);
        }
        if (this.puedeUnir(nx, ny, nz)) {
            // el punto que se saca es el final del tramo anterior: lo movemos al nuevo
            const p = this.pos;
            p.datos[p.n - 3] = q(nx);
            p.datos[p.n - 2] = q(ny);
        } else if (!this.agregarTramo(nx, ny, nz)) {
            return false;
        }
        this.ux = nx;
        this.uy = ny;
        this.uz = nz;
        this.offUltimaExtrusion = offLinea;
        this.ampliarCaja(nx, ny, nz);
        return true;
    }

    capaNueva(nz, offLinea) {
        this.vueltaNueva = false;
        // La pausa va antes del movimiento que subió Z (si fue después de la última
        // extrusión de la capa anterior); si no, antes de esta línea.
        this.pausaCapa.push(this.offCambioZ > this.offUltimaExtrusion ? this.offCambioZ : offLinea);
        this.capaZ = nz;
        this.inicioCapa.push(this.segmentos);
        this.zCapa.push(nz);
        this.utipo = -1;
    }

    // ¿Se puede unir con el anterior? Tiene que seguir desde donde terminó, y el
    // punto que se saca (x, y) tiene que quedar casi sobre la recta nueva.
    puedeUnir(nx, ny, nz) {
        const { x, y, sx, sy } = this;
        if (this.utipo !== this.tipo || this.ux !== x || this.uy !== y || this.uz !== nz) return false;
        const lx = nx - sx,
            ly = ny - sy,
            largo = Math.hypot(lx, ly);
        const avanza = (x - sx) * lx + (y - sy) * ly > 0 && (nx - x) * lx + (ny - y) * ly > 0;
        const desvio = largo > 0 ? Math.abs((x - sx) * ly - (y - sy) * lx) / largo : Infinity;
        const sigueRecto = this.recto && desvio < 1e-4;
        const unir = avanza && desvio < DESVIO && (sigueRecto || largo < LARGO_CURVA);
        if (unir) this.recto = sigueRecto;
        return unir;
    }

    // Guarda un tramo nuevo de (x, y) a (nx, ny) a la altura nz.
    agregarTramo(nx, ny, nz) {
        if (this.segmentos >= this.maxSegmentos) {
            this.incompleta = true;
            return false;
        }
        const { pos, col, tip, x, y, tipo } = this;
        pos.asegurar(6);
        col.asegurar(6);
        tip.asegurar(1);
        tip.datos[tip.n++] = tipo;
        const p = pos.datos,
            c = col.datos,
            color = TIPOS[tipo].color;
        p[pos.n] = q(x);
        p[pos.n + 1] = q(y);
        p[pos.n + 2] = q(nz);
        p[pos.n + 3] = q(nx);
        p[pos.n + 4] = q(ny);
        p[pos.n + 5] = q(nz);
        for (let k = 0; k < 6; k++) c[col.n + k] = color[k % 3];
        pos.n += 6;
        col.n += 6;
        this.segmentos++;
        this.utipo = tipo;
        this.sx = x;
        this.sy = y;
        this.recto = true;
        return true;
    }

    // Caja que abarca el tramo de (x, y, nz) a (nx, ny, nz).
    ampliarCaja(nx, ny, nz) {
        const { min, max, x, y } = this;
        if (nx < min[0]) min[0] = nx;
        if (nx > max[0]) max[0] = nx;
        if (x < min[0]) min[0] = x;
        if (x > max[0]) max[0] = x;
        if (ny < min[1]) min[1] = ny;
        if (ny > max[1]) max[1] = ny;
        if (y < min[1]) min[1] = y;
        if (y > max[1]) max[1] = y;
        if (nz < min[2]) min[2] = nz;
        if (nz > max[2]) max[2] = nz;
    }

    resultado() {
        return {
            posiciones: this.pos.final(),
            colores: this.col.final(),
            tipos: this.tip.final(),
            inicioCapa: Uint32Array.from(this.inicioCapa),
            pausaCapa: Float64Array.from(this.pausaCapa),
            zCapa: Float32Array.from(this.zCapa),
            caja: { min: this.min, max: this.max },
            incompleta: this.incompleta,
        };
    }
}

/**
 * Lee un G-code y arma los recorridos para la vista previa capa por capa.
 *
 * @param {string} gcode
 * @param {number} maxSegmentos tope de tramos (Infinity para no limitar)
 * @returns {{ posiciones: Uint16Array, colores: Uint8Array, tipos: Uint8Array, inicioCapa: Uint32Array,
 *   pausaCapa: Float64Array, zCapa: Float32Array, caja: {min: number[], max: number[]}, incompleta: boolean }}
 *   `posiciones`: 6 por tramo (ver CUANTIZADO); `colores`: 6 por tramo; `tipos`: índice en TIPOS de cada tramo;
 *   `inicioCapa`: índice del primer tramo de cada capa, + uno final; `pausaCapa`: posición en el texto donde
 *   insertar una pausa antes de cada capa (justo antes de subir Z, con la capa anterior terminada).
 */
export function leer(gcode, maxSegmentos) {
    const lector = new Lector(maxSegmentos);
    lector.leer(gcode);
    return lector.resultado();
}
