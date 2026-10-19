// Helpers mínimos de DOM y texto que usan todos los módulos de la interfaz.
// Flujo: no depende de nadie; los módulos de src/ui/ lo importan.
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

const anunciados = new WeakMap();

/**
 * Muestra un mensaje en una región viva (`role="alert"` o `"status"`) para que el lector lo anuncie una sola vez.
 * Si el texto es igual al que ya está puesto no toca el nodo (así no se re-anuncia). Si no, quita `hidden` y
 * pone el texto en el siguiente frame (un nodo que aparece ya con texto no siempre se anuncia). Con texto vacío
 * lo vuelve a ocultar y lo vacía.
 * @param {HTMLElement} el  la región.
 * @param {string} texto  texto plano, o HTML ya escapado si `html` es true. Vacío oculta.
 * @param {boolean} [html]  true para ponerlo con innerHTML (conserva el marcado).
 * @returns {void}
 */
export function anunciar(el, texto, html = false) {
    const previo = anunciados.get(el);
    const igual = previo?.texto === (texto || '');
    if (igual && (!previo.escrito || previo.visible === !el.hidden)) return; // lo mismo, o ya en camino
    const nuevo = { texto: texto || '', visible: !!texto, escrito: false };
    anunciados.set(el, nuevo);
    const campo = html ? 'innerHTML' : 'textContent';
    if (!texto) {
        el.hidden = true;
        el[campo] = '';
        nuevo.escrito = true;
        return;
    }
    // Se muestra y se escribe junto, en el siguiente frame (no se ve la caja vacía); si la pestaña está en segundo
    // plano y el frame no corre, un temporizador lo escribe. Una sola escritura; si llegó otro mensaje, ese gana.
    const escribir = () => {
        if (anunciados.get(el) !== nuevo || nuevo.escrito) return;
        nuevo.escrito = true;
        el.hidden = false;
        el[campo] = texto;
    };
    requestAnimationFrame(escribir);
    setTimeout(escribir, 100);
}
