// Piezas sueltas del lector de recorridos (recorridos-lector.js): arrays tipados que crecen,
// cuantizado de coordenadas y lectura de números y tipos de línea. Puro: sin `self` ni DOM.
import { TIPOS, CUANTIZADO } from './tipos-linea.js';

export const OTRO = TIPOS.length - 1;

/**
 * Cuantiza una coordenada (mm) a Uint16 (ver CUANTIZADO).
 * @param {number} v coordenada en mm
 * @returns {number} entero entre 0 y 65535
 */
export const q = v => Math.max(0, Math.min(65535, Math.round((v + CUANTIZADO.DESPLAZAMIENTO) * CUANTIZADO.ESCALA)));

/**
 * Índice en TIPOS del tipo de línea que Kiri nombra en `; feature <nombre>`.
 * @param {string} nombre texto después de `; feature `
 * @returns {number} índice en TIPOS (el último, OTRO, si no se reconoce)
 */
export function tipoDe(nombre) {
    const i = TIPOS.findIndex(t => t.claves.some(c => nombre.startsWith(c)));
    return i < 0 ? OTRO : i;
}

/** Array tipado que crece al doble cuando se llena. */
export class Lista {
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

/**
 * Valor numérico de un parámetro (ej. 'X') dentro de una línea.
 * @param {string} linea línea de G-code sin comentario
 * @param {string} letra letra del parámetro
 * @param {number} desde desde dónde buscar
 * @returns {number} el valor, o NaN si no está
 */
export function valor(linea, letra, desde) {
    const i = linea.indexOf(letra, desde);
    if (i < 0) return NaN;
    return parseFloat(linea.slice(i + 1));
}
