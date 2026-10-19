// Lector de G-code para la vista previa: arma los recorridos capa por capa.
// Lo usa recorridos.worker.js (que sólo agrega el mensaje del worker).
//
// Es puro (sin `self` ni DOM) y vive en un módulo aparte para poder probarlo en Node.
// Procesa G-codes enormes: en el bucle por línea no se arman objetos ni closures; el estado
// está en campos de `Lector` y los resultados van a arrays tipados que crecen al doble
// (`Lista`, en recorridos-lista.js) dentro de `Tramos` (recorridos-tramos.js).
//
// Sólo se guardan los movimientos que extruyen (los viajes no se dibujan).
// Los tramos seguidos casi alineados se unen en uno: a la vista es igual y
// usa mucha menos memoria (un G-code grande tiene millones de tramos cortitos).
import { MARCA as MARCA_ESPIRAL } from './espiral.js';
import { OTRO, tipoDe, valor } from './recorridos-lista.js';
import { Tramos } from './recorridos-tramos.js';
import { NIVELES } from './recorridos-niveles.js';

/** Estado del recorrido del G-code y los resultados que se van armando. */
class Lector {
    /**
     * @param {number} maxSegmentos tope de tramos guardados
     * @param {number} nivel nivel de simplificación (0 a 3)
     */
    constructor(maxSegmentos, nivel) {
        this.tramos = new Tramos(maxSegmentos, nivel);
        this.leidoHasta = 0; // posición en el texto de la primera línea no leída
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
        this.vueltaNueva = false;
        // posiciones en el texto (para las pausas)
        this.offCambioZ = -1;
        this.offUltimaExtrusion = -1;
    }

    /**
     * Lee todo el G-code (se corta si se llena `maxSegmentos`).
     * @param {string} gcode
     * @returns {void}
     */
    leer(gcode) {
        let inicio = 0;
        this.leidoHasta = gcode.length;
        while (inicio < gcode.length) {
            let fin = gcode.indexOf('\n', inicio);
            if (fin < 0) fin = gcode.length;
            const offLinea = inicio;
            inicio = fin + 1;
            if (!this.linea(gcode.slice(offLinea, fin), offLinea)) {
                this.leidoHasta = offLinea;
                break;
            }
        }
    }

    /**
     * Procesa una línea.
     * @param {string} linea línea del G-code
     * @param {number} offLinea posición de la línea en el texto
     * @returns {boolean} false cuando hay que dejar de leer
     */
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

    /**
     * Línea de comentario: `; feature` cambia el tipo de línea; MARCA_ESPIRAL abre otra vuelta.
     * @param {string} linea comentario completo
     * @returns {void}
     */
    comentario(linea) {
        if (linea.startsWith('; feature ')) {
            this.tipo = tipoDe(linea.slice(10));
            this.enPieza = true; // lo de antes (purga del G-code de inicio) no se dibuja
        } else if (linea.startsWith(MARCA_ESPIRAL)) {
            this.vueltaNueva = true; // modo jarrón: acá empieza otra vuelta (ver espiral.js)
        }
    }

    /**
     * Comando G: G90/G91 (modo), G92 (E) y G0-G3 (movimiento).
     * @param {string} sinComentario línea sin el comentario
     * @param {number} offLinea posición de la línea en el texto
     * @returns {boolean} false cuando hay que dejar de leer
     */
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

    /**
     * Movimiento (G2/G3 se toman como recta hasta el punto final).
     * @param {string} s línea sin el comentario
     * @param {number} offLinea posición de la línea en el texto
     * @returns {boolean} false si se llenó `maxSegmentos`
     */
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

    /**
     * ¿El valor de E de este movimiento extruye? Actualiza el E acumulado.
     * @param {number} ve valor de E de la línea (NaN si no trae)
     * @returns {boolean}
     */
    extruye(ve) {
        if (isNaN(ve)) return false;
        const eAbs = this.eAbsoluto;
        const extruye = eAbs ? ve > this.e + 1e-6 : ve > 1e-6;
        this.e = eAbs ? ve : this.e + ve;
        return extruye;
    }

    /**
     * Una extrusión de (x, y) a (nx, ny, nz): detecta capa nueva y la une al tramo anterior o agrega uno.
     * @param {number} nx X final
     * @param {number} ny Y final
     * @param {number} nz Z final
     * @param {boolean} enEspiral la línea trae Z (la Z sube en cada tramo)
     * @param {number} offLinea posición de la línea en el texto
     * @returns {boolean} false si se llenó `maxSegmentos`
     */
    extrusion(nx, ny, nz, enEspiral, offLinea) {
        // ¿Capa nueva? (cambió la altura a la que se extruye). En espiral la capa la marca MARCA_ESPIRAL.
        if (this.vueltaNueva || (nz !== this.capaZ && !enEspiral) || isNaN(this.capaZ)) {
            // Si ya no entra ningún tramo, no se abre la capa (quedaría vacía).
            if (this.tramos.llena()) return false;
            this.capaNueva(nz, offLinea);
        }
        const { tramos, x, y, tipo } = this;
        if (tramos.puedeUnir(x, y, nx, ny, nz, tipo)) tramos.unir(nx, ny, nz);
        else if (!tramos.agregarTramo(x, y, nx, ny, nz, tipo)) return false;
        this.offUltimaExtrusion = offLinea;
        tramos.ampliarCaja(x, y, nx, ny, nz);
        return true;
    }

    /**
     * Empieza una capa: anota su Z y dónde va la pausa antes de ella.
     * @param {number} nz Z de la capa
     * @param {number} offLinea posición de la línea en el texto
     * @returns {void}
     */
    capaNueva(nz, offLinea) {
        this.vueltaNueva = false;
        this.capaZ = nz;
        // La pausa va antes del movimiento que subió Z (si fue después de la última
        // extrusión de la capa anterior); si no, antes de esta línea.
        this.tramos.nuevaCapa(nz, this.offCambioZ > this.offUltimaExtrusion ? this.offCambioZ : offLinea);
    }
}

/**
 * Lee un G-code y arma los recorridos para la vista previa capa por capa.
 *
 * @param {string} gcode
 * @param {number} maxSegmentos tope de tramos (Infinity para no limitar)
 * @param {{ nivel?: 0|1|2|3 }} [opciones] nivel de simplificación (ver recorridos-niveles.js); omitido = 0, igual que antes
 * @returns {{ posiciones: Uint16Array, colores: Uint8Array, tipos: Uint8Array, inicioCapa: Uint32Array,
 *   pausaCapa: Float64Array, zCapa: Float32Array, caja: {min: number[], max: number[]}, incompleta: boolean,
 *   nivel: number, simplificado: boolean, leidoHasta: number }}
 *   `nivel`: el usado; `simplificado`: nivel > 0 y se unió algún tramo que el nivel 0 no habría unido; `leidoHasta`:
 *   posición de la primera línea no leída (`gcode.length` si se leyó todo); `posiciones`: 6 por tramo (ver CUANTIZADO);
 *   `colores`: 6 por tramo; `tipos`: índice en TIPOS de cada tramo; `inicioCapa`: índice del primer tramo de cada capa, + uno final; `pausaCapa`: posición en el texto donde
 *   insertar una pausa antes de cada capa (justo antes de subir Z, con la capa anterior terminada).
 */
export function leer(gcode, maxSegmentos, opciones) {
    const nivel = NIVELES[opciones?.nivel] ? opciones.nivel : 0;
    const lector = new Lector(maxSegmentos, nivel);
    lector.leer(gcode);
    const { tramos, leidoHasta } = lector;
    return { ...tramos.resultado(), nivel, simplificado: tramos.simplificado, leidoHasta };
}
