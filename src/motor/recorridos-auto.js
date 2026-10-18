// Elige solo el nivel de detalle de la vista previa (ADR 0006, decisión 2). Puro, sin DOM ni `self`.
// Lee con el nivel 0; si se llena el tope de tramos, proyecta cuántos faltaban y reintenta con un nivel mayor.
// Como mucho 3 lecturas: la tercera ya va con el nivel 3, entre o no entre.
import { leer } from './recorridos-lector.js';
import { siguienteNivel } from './recorridos-niveles.js';

/** Cantidad máxima de lecturas por G-code (la primera se corta apenas se llena el tope, así que cuesta poco). */
export const MAX_LECTURAS = 3;
const NIVEL_MAXIMO = 3;

/**
 * Nivel con el que reintentar después de una lectura que se llenó.
 * @param {ReturnType<typeof leer>} r la lectura incompleta
 * @param {string} gcode
 * @param {number} maxSegmentos
 * @param {number} lecturas lecturas hechas hasta ahora
 * @returns {0|1|2|3}
 */
function nivelDeReintento(r, gcode, maxSegmentos, lecturas) {
    // La última lectura permitida va directo al nivel más alto: no hay otra oportunidad de corregir.
    if (lecturas + 1 >= MAX_LECTURAS || r.nivel >= NIVEL_MAXIMO) return NIVEL_MAXIMO;
    if (!(r.leidoHasta > 0)) return NIVEL_MAXIMO;
    // Tramos que daría el nivel actual si se leyera todo el texto.
    const proyectado = (maxSegmentos * gcode.length) / r.leidoHasta;
    return siguienteNivel(proyectado, maxSegmentos, /** @type {0|1|2} */ (r.nivel));
}

/**
 * Lee con el nivel mínimo que entra en `maxSegmentos` (reintenta con niveles más altos, hasta 3 lecturas).
 * @param {string} gcode
 * @param {number} maxSegmentos
 * @param {typeof leer} [lector] función de lectura; se inyecta en las pruebas para contar las lecturas
 * @returns {ReturnType<typeof leer>} el resultado de la última lectura; `incompleta` sólo es true si ni el nivel 3 entra
 */
export function leerAuto(gcode, maxSegmentos, lector = leer) {
    let r = lector(gcode, maxSegmentos, { nivel: 0 });
    for (let lecturas = 1; r.incompleta && r.nivel < NIVEL_MAXIMO && lecturas < MAX_LECTURAS; lecturas++) {
        const nivel = nivelDeReintento(r, gcode, maxSegmentos, lecturas);
        r = lector(gcode, maxSegmentos, { nivel });
    }
    return r;
}
