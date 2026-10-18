// Texto del aviso de la vista previa capa por capa (ADR 0006). Puro: sin DOM ni imports.

/**
 * Texto del aviso de la vista previa, o '' si no hace falta. Se usa `simplificado` (se unió algo que el nivel 0 no
 * habría unido), no `nivel > 0`. Si es `incompleta` manda ese texto (con o sin `simplificado`).
 * @param {{ simplificado: boolean, incompleta: boolean }} r resultado de leer
 * @param {number} capas capas que se pueden ver
 * @returns {string}
 */
export function textoAvisoVista(r, capas) {
    if (r.incompleta) {
        return `El archivo es muy grande para mostrarlo entero en este equipo: la vista llega hasta la capa ${capas}. El G-code está completo.`;
    }
    if (r.simplificado) {
        return 'Para que entre en este equipo, la vista previa está simplificada: se unen tramos cortos. El G-code está completo y no cambia.';
    }
    return '';
}
