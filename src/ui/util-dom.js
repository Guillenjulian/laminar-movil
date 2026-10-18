// Helpers mínimos de DOM y texto que usan todos los módulos de la interfaz.
// Flujo: no depende de nadie; main.js y los módulos de src/ui/ lo importan.
// No toca el DOM al importarse (sólo define funciones).

/**
 * Busca un elemento por id.
 * @param {string} id id del elemento en index.html.
 * @returns {HTMLElement}
 */
export const $ = id => document.getElementById(id);

/**
 * Escapa & < > " ' como entidades numéricas, para meter texto del usuario en innerHTML.
 * @param {string} texto
 * @returns {string}
 */
export function escapar(texto) {
    return texto.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}
