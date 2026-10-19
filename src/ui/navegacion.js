// Navegación entre pasos y hojas (ADR 0001, sección 3.2; accesibilidad: ADR 0008, A.2).
//
// Responsabilidad: mostrar el paso y la hoja correctos, mantener el historial del navegador para que el botón
// "atrás" del celu vuelva al paso anterior (o cierre la hoja) en vez de salir de la app, y cuidar el foco.
//
// Flujo: irA / abrirHoja empujan una entrada de historial y llaman a `mostrar`; popstate (atrás o
// adelante), Escape y #atras también terminan en `mostrar`. `mostrar` actualiza el DOM, marca el paso actual
// (`aria-current`), hace inert el fondo mientras hay una hoja, mueve el foco (al abrir una hoja, al cerrarla y al
// cambiar de paso) y avisa a los suscriptores de `alMostrarPaso`. Importarlo no toca el DOM: los listeners se
// registran en `iniciarNavegacion`.

import { estado } from './estado.js';
import { $ } from './util-dom.js';

/** @type {Array<(paso: number) => void>} */
const suscriptores = [];
const HOJAS = {
    impresoras: 'hojaImpresoras',
    mi: 'hojaMiImpresora',
    litofania: 'hojaLitofania',
    torre: 'hojaTorre',
    red: 'hojaRed',
};
/** Por nivel k, lo que se guardó al abrir la hoja del nivel k+1 (el nivel 0 es el paso). */
const pila = []; // { el: disparador, respaldo?, alCerrar? }
let nivelAbierto = 0; // nivel de hoja que muestra el DOM (0 = ninguna)
let yaMostrado = false; // false hasta que se muestra el primer paso
let recorridoPendiente = false; // hay un history.go() sin su popstate todavía
let irAlTerminar = false; // se pidió "Ir al paso 1" mientras se cerraba una hoja
let atrasPedido = false; // hay un history.back() sin su popstate todavía (doble toque, Escape repetido)

/**
 * Registra popstate, Escape, [data-cerrar], #atras y deja el historial en {paso:1}. Llamar una vez.
 * @returns {void}
 */
export function iniciarNavegacion() {
    window.addEventListener('popstate', e => {
        if (estado.paso === 3) estado.cancelar?.abort();
        recorridoPendiente = false;
        atrasPedido = false;
        mostrar(e.state?.paso || 1, e.state?.hoja);
        if (irAlTerminar) {
            irAlTerminar = false;
            irAPaso1();
        }
    });
    document.addEventListener('keydown', e => {
        const buscando = e.target.matches?.('input[type="search"]') && e.target.value;
        if (e.key === 'Escape' && nivelAbierto > 0 && !e.repeat && !e.isComposing && !buscando) pedirAtras();
    });
    document.querySelectorAll('[data-cerrar]').forEach(b => {
        b.onclick = pedirAtras;
    });
    $('atras').onclick = pedirAtras;
    history.replaceState({ paso: 1 }, '');
}

/**
 * Hace history.back() una sola vez por popstate: ignora un segundo pedido (doble toque, Escape repetido) mientras
 * el primero no terminó y los que llegan durante un recorrido de `cerrarHojas`/`irAPaso1`, que ya van a retroceder.
 * @returns {void}
 */
function pedirAtras() {
    if (atrasPedido || recorridoPendiente) return;
    atrasPedido = true;
    history.back();
}

/**
 * Muestra un paso y (opcional) una hoja encima. Si el paso no cambió sólo ajusta las hojas.
 * Al cambiar de paso: actualiza .pantalla/.acciones/.pasos (con `aria-current`), #atras, scroll de #main, avisa
 * a los suscriptores de alMostrarPaso y lleva el foco al paso (salvo en el primer mostrar o con una hoja encima).
 * @param {1|2|3|4} paso
 * @param {'impresoras'|'mi'|'litofania'|'torre'|'red'|null} [hoja]
 * @returns {void}
 */
export function mostrar(paso, hoja = null) {
    for (const [nombre, id] of Object.entries(HOJAS)) $(id).hidden = hoja !== nombre;
    ajustarHojas(hoja ? history.state?.nivel || 1 : 0, hoja);
    if (paso === estado.paso && yaMostrado) return;
    const primera = !yaMostrado;
    yaMostrado = true;
    estado.paso = paso;
    document.querySelectorAll('.pantalla, .acciones > div').forEach(el => {
        el.hidden = Number(el.dataset.paso) !== paso;
    });
    document.querySelectorAll('.pasos li').forEach(li => {
        const n = Number(li.dataset.paso);
        li.classList.toggle('actual', n === paso);
        li.classList.toggle('hecho', n < paso);
        if (n === paso) li.setAttribute('aria-current', 'step');
        else li.removeAttribute('aria-current');
    });
    $('atras').hidden = paso === 1;
    suscriptores.forEach(fn => fn(paso));
    $('main').scrollTo(0, 0);
    if (!primera && !hoja) enfocarPaso();
}

/**
 * Va a un paso agregando (o reemplazando) una entrada de historial.
 * @param {1|2|3|4} paso
 * @param {{reemplazar?: boolean}} [opciones]
 * @returns {void}
 */
export function irA(paso, { reemplazar = false } = {}) {
    history[reemplazar ? 'replaceState' : 'pushState']({ paso }, '');
    mostrar(paso);
}

/**
 * Abre una hoja encima del paso actual (nivel de historial +1). Guarda el elemento enfocado como disparador:
 * al cerrarse la hoja el foco vuelve a él, o a `respaldo` si ya no sirve, o al encabezado del paso.
 * @param {'impresoras'|'mi'|'litofania'|'torre'|'red'} hoja
 * @param {{respaldo?: HTMLElement|(() => HTMLElement|null), alCerrar?: () => void}} [opciones] `respaldo`: a quién
 *  enfocar si el disparador se ocultó o deshabilitó; `alCerrar`: se llama al cerrarse, antes de devolver el foco.
 * @returns {void}
 */
export function abrirHoja(hoja, { respaldo, alCerrar } = {}) {
    const nivel = (history.state?.nivel || 0) + 1;
    pila.length = nivel - 1;
    pila.push({ el: document.activeElement, respaldo, alCerrar });
    history.pushState({ paso: estado.paso, hoja, nivel }, '');
    mostrar(estado.paso, hoja);
}

/**
 * Cierra todas las hojas abiertas volviendo en el historial.
 * @returns {void}
 */
export function cerrarHojas() {
    const nivel = history.state?.nivel || 0;
    if (!nivel) return;
    recorridoPendiente = true;
    history.go(-nivel);
}

/**
 * Vuelve al paso 1 desde otro paso, retrocediendo en el historial (las hojas abiertas y el paso actual).
 * Si todavía hay un recorrido en curso (p. ej. se está cerrando la hoja de impresoras) espera a que termine,
 * para no retroceder de más y salir de la app. En el paso 1 no hace nada. El foco lo lleva `mostrar` al paso 1.
 * @returns {void}
 */
export function irAPaso1() {
    if (recorridoPendiente) {
        irAlTerminar = true;
        return;
    }
    if (estado.paso === 1) return;
    recorridoPendiente = true;
    history.go(-((history.state?.nivel || 0) + 1));
}

/**
 * Suscribe `fn` a los cambios de paso (se llama sólo cuando el paso realmente cambia, después de
 * actualizar el DOM).
 * @param {(paso: number) => void} fn
 * @returns {void}
 */
export function alMostrarPaso(fn) {
    suscriptores.push(fn);
}

/**
 * ¿El elemento está en el documento y se dibuja (aunque sea sólo para lectores)?
 * @param {Element|null|undefined} el
 * @returns {boolean}
 */
const visible = el => !!el && el.isConnected && el.getClientRects().length > 0;

/**
 * ¿Se le puede devolver el foco? Visible, habilitado y no el body.
 * @param {HTMLElement|null|undefined} el
 * @returns {boolean}
 */
const enfocable = el => visible(el) && el !== document.body && !el.disabled;

/**
 * Modal: con una hoja abierta el fondo (barra, #main y acciones) queda inert; al cerrar la última se saca.
 * Al abrir, el foco entra en la hoja; al cerrar vuelve al disparador, al respaldo o al encabezado.
 * @param {number} nivel nivel de hoja que queda abierto (0 = ninguna)
 * @param {string|null} hoja nombre de la hoja de arriba
 * @returns {void}
 */
function ajustarHojas(nivel, hoja) {
    const antes = nivelAbierto;
    if (nivel === antes) return;
    nivelAbierto = nivel;
    const fondo = [document.querySelector('body > header.barra'), $('main'), document.querySelector('footer.acciones')];
    for (const el of fondo) if (el) el.inert = nivel > 0;
    if (nivel > antes) return enfocarHoja(hoja);
    const cerradas = pila.splice(nivel); // entradas de las hojas cerradas; la primera tiene el disparador
    cerradas.forEach(c => c.alCerrar?.());
    const destino = cerradas[0];
    const respaldo = typeof destino?.respaldo === 'function' ? destino.respaldo() : destino?.respaldo;
    const el = [destino?.el, respaldo].find(enfocable);
    if (el) el.focus();
    else if (nivel > 0) enfocarHoja(hoja);
    else enfocarPaso();
}

/**
 * Foco dentro de la hoja: el campo de búsqueda si lo tiene; si no, su título (h1).
 * @param {string} hoja
 * @returns {void}
 */
function enfocarHoja(hoja) {
    const seccion = $(HOJAS[hoja]);
    const el = seccion.querySelector('input[type="search"]') || seccion.querySelector('h1');
    if (el.tagName === 'H1') el.tabIndex = -1;
    el.focus({ preventScroll: true });
}

/**
 * Foco en el paso actual: el primer h2 que se dibuje (en el paso 1 hay uno sólo para lectores) o la pantalla misma.
 * @returns {void}
 */
function enfocarPaso() {
    const pantalla = document.querySelector(`.pantalla[data-paso="${estado.paso}"]`);
    if (!pantalla) return;
    const el = [...pantalla.querySelectorAll('h2')].find(visible) || pantalla;
    if (!el.matches('button, input, select, textarea, a[href], [tabindex]')) el.tabIndex = -1;
    el.focus({ preventScroll: true });
}
