// Aplica el idioma al DOM y cablea el selector de idioma (ADR 0008, B.4 y B.6). Sólo lo importa main.js.
// No toca el DOM al importarse. El HTML está en español: en español no se recorre el DOM al arrancar.
import { $ } from './util-dom.js';
import { alCambiarIdioma, cambiarIdioma, existe, idiomaActual, marcar, t } from './idioma.js';
import { ATRIBUTOS_TRADUCIBLES } from '../textos/atributos.js';

/** Nombre de cada idioma, escrito en ese idioma (las claves viven en idioma.json). */
const NOMBRE = { es: marcar('idioma.nombre.es'), en: marcar('idioma.nombre.en') };

/** El otro idioma. @param {import('../textos/traducir.js').Idioma} cual @returns {'es'|'en'} */
const otroDe = cual => (cual === 'es' ? 'en' : 'es');

/**
 * Aplica el idioma actual al DOM bajo `raiz`: [data-t] (textContent), [data-t-html] (innerHTML) y
 * [data-t-attr="atributo:clave;…"]. Una clave que no existe deja el texto como está. `data-t-html` es sólo para
 * claves cuyo HTML es nuestro (`<b>`, `<small>`, `<br>`); nunca para valores del usuario. No incluye a `raiz`.
 * @param {ParentNode} raiz  `document` o un contenedor
 * @returns {void}
 */
export function traducirDom(raiz) {
    for (const el of raiz.querySelectorAll('[data-t]')) {
        const clave = el.getAttribute('data-t');
        if (existe(clave)) el.textContent = t(clave); // t-dinamica: viene de data-t
    }
    for (const el of raiz.querySelectorAll('[data-t-html]')) {
        const clave = el.getAttribute('data-t-html');
        if (existe(clave)) el.innerHTML = t(clave); // t-dinamica: viene de data-t-html
    }
    for (const el of raiz.querySelectorAll('[data-t-attr]')) {
        for (const par of el.getAttribute('data-t-attr').split(';')) {
            const corte = par.indexOf(':');
            const atributo = par.slice(0, corte).trim();
            const clave = par.slice(corte + 1).trim();
            if (corte > 0 && ATRIBUTOS_TRADUCIBLES.includes(atributo) && existe(clave))
                el.setAttribute(atributo, t(clave)); // t-dinamica: viene de data-t-attr;
        }
    }
}

/**
 * Cablea `#idioma` (alterna es/en con `cambiarIdioma`, pone su `lang` y su texto, y anuncia en `#estadoIdioma`),
 * se suscribe a `alCambiarIdioma` para volver a llamar a `traducirDom(document)` y, si el idioma actual no es
 * español, lo aplica ya. Llamar una vez, después de `iniciarIdioma`.
 * @returns {void}
 */
export function iniciarIdiomaDom() {
    const boton = $('idioma');
    const estado = $('estadoIdioma');
    /** El botón nombra el idioma de destino, en ese idioma. */
    const pintarBoton = () => {
        const destino = otroDe(idiomaActual());
        const nombre = t(NOMBRE[destino]); // t-dinamica: tabla NOMBRE con marcar
        boton.textContent = nombre;
        boton.lang = destino;
        boton.setAttribute('aria-label', t('idioma.cambiarA', { idioma: nombre }));
    };
    const aplicar = () => {
        traducirDom(document);
        pintarBoton();
    };
    alCambiarIdioma(aplicar);
    if (idiomaActual() === 'es') pintarBoton();
    else aplicar();
    boton.addEventListener('click', async () => {
        const antes = idiomaActual();
        const destino = otroDe(antes);
        try {
            // Un doble toque: sólo el último pedido anuncia (el otro devuelve false).
            if (await cambiarIdioma(destino)) {
                estado.textContent = t('idioma.anuncio', { idioma: t(NOMBRE[destino]) }); // t-dinamica: tabla NOMBRE
            }
        } catch (_error) {
            if (idiomaActual() === antes) estado.textContent = t('idioma.error');
        }
    });
}
