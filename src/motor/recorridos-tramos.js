// Acumulador de tramos del lector de recorridos (recorridos-lector.js): guarda los tramos que
// extruyen en arrays tipados, une los que quedan alineados y lleva la caja y el inicio de cada capa.
// Puro: sin `self` ni DOM. Se usa en el bucle caliente de `leer`: los métodos reciben números
// y no arman objetos ni closures.
import { TIPOS } from './tipos-linea.js';
import { Lista, q } from './recorridos-lista.js';
import { NIVELES } from './recorridos-niveles.js';

const NIVEL_0 = NIVELES[0];

/**
 * Distancia de un punto a un segmento.
 * @param {number} px X del punto
 * @param {number} py Y del punto
 * @param {number} ax X del inicio del segmento
 * @param {number} ay Y del inicio del segmento
 * @param {number} bx X del final del segmento
 * @param {number} by Y del final del segmento
 * @returns {number} mm
 */
export function distanciaASegmento(px, py, ax, ay, bx, by) {
    const dx = bx - ax,
        dy = by - ay,
        l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Tramos guardados hasta ahora y el último (para unir los alineados). */
export class Tramos {
    /**
     * @param {number} maxSegmentos tope de tramos guardados
     * @param {number} [nivel] nivel de simplificación (0 a 3, ver recorridos-niveles.js)
     */
    constructor(maxSegmentos, nivel = 0) {
        this.maxSegmentos = maxSegmentos;
        this.nivel = nivel;
        // cuánto se puede apartar de la recta el punto que se saca, y largo máximo de un tramo unido que no es recto
        this.desvio = NIVELES[nivel].desvio;
        this.largoCurva = NIVELES[nivel].largoCurva;
        this.simplificado = false; // ¿se unió algo que el nivel 0 no habría unido?
        this.sacados = new Float64Array(64); // puntos sacados del último tramo (x, y), sólo con nivel > 0
        this.nSacados = 0;
        this.pos = new Lista(Uint16Array, 6 * 65536);
        this.col = new Lista(Uint8Array, 6 * 65536);
        this.tip = new Lista(Uint8Array, 65536);
        this.inicioCapa = [];
        this.zCapa = [];
        this.pausaCapa = [];
        this.min = [Infinity, Infinity, Infinity];
        this.max = [-Infinity, -Infinity, -Infinity];
        this.segmentos = 0;
        this.incompleta = false;
        // último tramo guardado: inicio (sx, sy), fin (ux, uy, uz), su tipo y si es recto
        this.sx = 0;
        this.sy = 0;
        this.ux = 0;
        this.uy = 0;
        this.uz = NaN;
        this.utipo = -1;
        this.recto = true;
    }

    /**
     * ¿Se llenó `maxSegmentos`? Si es así, deja el resultado `incompleta`.
     * @returns {boolean}
     */
    llena() {
        if (this.segmentos < this.maxSegmentos) return false;
        this.incompleta = true;
        return true;
    }

    /**
     * Empieza una capa: anota dónde va la pausa, su Z y su primer tramo.
     * @param {number} nz Z de la capa
     * @param {number} offPausa posición en el texto donde insertar la pausa antes de la capa
     * @returns {void}
     */
    nuevaCapa(nz, offPausa) {
        this.pausaCapa.push(offPausa);
        this.inicioCapa.push(this.segmentos);
        this.zCapa.push(nz);
        this.utipo = -1;
    }

    /**
     * ¿Se puede unir con el tramo anterior? Tiene que seguir desde donde terminó, y el
     * punto que se saca (x, y) tiene que quedar casi sobre la recta nueva.
     * @param {number} x X del punto actual
     * @param {number} y Y del punto actual
     * @param {number} nx X final
     * @param {number} ny Y final
     * @param {number} nz Z final
     * @param {number} tipo tipo de línea (índice en TIPOS)
     * @returns {boolean}
     */
    puedeUnir(x, y, nx, ny, nz, tipo) {
        const { sx, sy } = this;
        if (this.utipo !== tipo || this.ux !== x || this.uy !== y || this.uz !== nz) return false;
        const lx = nx - sx,
            ly = ny - sy,
            largo = Math.hypot(lx, ly);
        const avanza = (x - sx) * lx + (y - sy) * ly > 0 && (nx - x) * lx + (ny - y) * ly > 0;
        const desvio = largo > 0 ? Math.abs((x - sx) * ly - (y - sy) * lx) / largo : Infinity;
        const sigueRecto = this.recto && desvio < 1e-4;
        let unir = avanza && desvio < this.desvio && (sigueRecto || largo < this.largoCurva);
        if (unir && this.nivel > 0) unir = this.confirmar(x, y, nx, ny, sigueRecto, desvio, largo);
        if (unir) this.recto = sigueRecto;
        return unir;
    }

    /**
     * Sólo con nivel > 0: confirma la unión comprobando que todos los puntos sacados del tramo (no sólo el último)
     * queden a menos de `desvio` del tramo nuevo, así el error no se acumula. Si el nivel 0 ya lo uniría, se une sin
     * esa comprobación: un nivel mayor nunca da más tramos que el anterior (con arcos chicos, la comprobación
     * completa rechazaba uniones que el nivel 0, que acumula error, hacía). Anota si el nivel 0 no lo habría unido.
     * Cota de error: las uniones que el nivel 0 hace tienen su error acumulado (sin tope fijo; medido hasta ~0,06 mm),
     * el resto queda a menos de `desvio` de todos los puntos.
     * @param {number} x X del punto que se saca
     * @param {number} y Y del punto que se saca
     * @param {number} nx X final
     * @param {number} ny Y final
     * @param {boolean} sigueRecto el tramo sigue siendo recto
     * @param {number} desvio distancia de (x, y) a la recta nueva
     * @param {number} largo largo del tramo nuevo
     * @returns {boolean} true si se une (y entonces (x, y) pasa a ser un punto sacado)
     */
    confirmar(x, y, nx, ny, sigueRecto, desvio, largo) {
        const { sx, sy, sacados } = this;
        const loUniriaElNivel0 = desvio < NIVEL_0.desvio && (sigueRecto || largo < NIVEL_0.largoCurva);
        if (!sigueRecto && !loUniriaElNivel0) {
            for (let i = 0; i < this.nSacados; i += 2) {
                if (distanciaASegmento(sacados[i], sacados[i + 1], sx, sy, nx, ny) >= this.desvio) return false;
            }
        }
        if (!loUniriaElNivel0) this.simplificado = true;
        if (this.nSacados + 2 > sacados.length) {
            this.sacados = new Float64Array(sacados.length * 2);
            this.sacados.set(sacados);
        }
        this.sacados[this.nSacados++] = x;
        this.sacados[this.nSacados++] = y;
        return true;
    }

    /**
     * Une el tramo nuevo al anterior: el punto que se saca es el final del anterior, lo movemos al nuevo.
     * @param {number} nx X final
     * @param {number} ny Y final
     * @param {number} nz Z final
     * @returns {void}
     */
    unir(nx, ny, nz) {
        const p = this.pos;
        p.datos[p.n - 3] = q(nx);
        p.datos[p.n - 2] = q(ny);
        this.ux = nx;
        this.uy = ny;
        this.uz = nz;
    }

    /**
     * Guarda un tramo nuevo de (x, y) a (nx, ny) a la altura nz.
     * @param {number} x X inicial
     * @param {number} y Y inicial
     * @param {number} nx X final
     * @param {number} ny Y final
     * @param {number} nz Z del tramo
     * @param {number} tipo tipo de línea (índice en TIPOS)
     * @returns {boolean} false si se llenó `maxSegmentos` (queda `incompleta`)
     */
    agregarTramo(x, y, nx, ny, nz, tipo) {
        if (this.llena()) return false;
        const { pos, col, tip } = this;
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
        this.nSacados = 0;
        this.utipo = tipo;
        this.sx = x;
        this.sy = y;
        this.recto = true;
        this.ux = nx;
        this.uy = ny;
        this.uz = nz;
        return true;
    }

    /**
     * Agranda la caja para que abarque el tramo de (x, y, nz) a (nx, ny, nz).
     * @param {number} x X inicial
     * @param {number} y Y inicial
     * @param {number} nx X final
     * @param {number} ny Y final
     * @param {number} nz Z del tramo
     * @returns {void}
     */
    ampliarCaja(x, y, nx, ny, nz) {
        const { min, max } = this;
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

    /**
     * Cierra la última capa y arma lo que devuelve `leer`.
     * @returns {{ posiciones: Uint16Array, colores: Uint8Array, tipos: Uint8Array, inicioCapa: Uint32Array,
     *   pausaCapa: Float64Array, zCapa: Float32Array, caja: {min: number[], max: number[]}, incompleta: boolean }}
     *   arrays tipados con copia justa de lo escrito
     */
    resultado() {
        this.inicioCapa.push(this.segmentos);
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
