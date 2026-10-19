// Navegación entre pasos y hojas (ADR 0001, sección 3.2).
//
// Responsabilidad: mostrar el paso y la hoja correctos y mantener el historial del navegador para que
// el botón "atrás" del celu vuelva al paso anterior (o cierre la hoja) en vez de salir de la app.
//
// Flujo: irA / abrirHoja empujan una entrada de historial y llaman a `mostrar`; popstate (atrás o
// adelante) y #atras también terminan en `mostrar`. `mostrar` actualiza el DOM y avisa a los
// suscriptores de `alMostrarPaso`. Importarlo no toca el DOM: los listeners se registran en
// `iniciarNavegacion`.

import { estado } from './estado.js';
import { $ } from './util-dom.js';

/** @type {Array<(paso: number) => void>} */
const suscriptores = [];
let yaMostrado = false; // false hasta que se muestra el primer paso
let recorridoPendiente = false; // hay un history.go() sin su popstate todavía
let irAlTerminar = false; // se pidió "Ir al paso 1" mientras se cerraba una hoja

/**
 * Registra popstate, [data-cerrar], #atras y deja el historial en {paso:1}. Llamar una vez.
 * @returns {void}
 */
export function iniciarNavegacion() {
    window.addEventListener('popstate', e => {
        if (estado.paso === 3) estado.cancelar?.abort();
        recorridoPendiente = false;
        mostrar(e.state?.paso || 1, e.state?.hoja);
        if (irAlTerminar) {
            irAlTerminar = false;
            irAPaso1();
        }
    });
    document.querySelectorAll('[data-cerrar]').forEach(b => {
        b.onclick = () => history.back();
    });
    $('atras').onclick = () => history.back();
    history.replaceState({ paso: 1 }, '');
}

/**
 * Muestra un paso y (opcional) una hoja encima. Si el paso no cambió sólo ajusta las hojas.
 * Al cambiar de paso: actualiza .pantalla/.acciones/.pasos, #atras, scroll de #main y avisa a los
 * suscriptores de alMostrarPaso.
 * @param {1|2|3|4} paso
 * @param {'impresoras'|'mi'|'litofania'|'torre'|'red'|null} [hoja]
 * @returns {void}
 */
export function mostrar(paso, hoja = null) {
    $('hojaImpresoras').hidden = hoja !== 'impresoras';
    $('hojaMiImpresora').hidden = hoja !== 'mi';
    $('hojaLitofania').hidden = hoja !== 'litofania';
    $('hojaTorre').hidden = hoja !== 'torre';
    $('hojaRed').hidden = hoja !== 'red';
    if (paso === estado.paso && yaMostrado) return;
    yaMostrado = true;
    estado.paso = paso;
    document.querySelectorAll('.pantalla, .acciones > div').forEach(el => {
        el.hidden = Number(el.dataset.paso) !== paso;
    });
    document.querySelectorAll('.pasos li').forEach(li => {
        const n = Number(li.dataset.paso);
        li.classList.toggle('actual', n === paso);
        li.classList.toggle('hecho', n < paso);
    });
    $('atras').hidden = paso === 1;
    suscriptores.forEach(fn => fn(paso));
    $('main').scrollTo(0, 0);
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
 * Abre una hoja encima del paso actual (nivel de historial +1).
 * @param {'impresoras'|'mi'|'litofania'|'torre'|'red'} hoja
 * @returns {void}
 */
export function abrirHoja(hoja) {
    const nivel = (history.state?.nivel || 0) + 1;
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
 * para no retroceder de más y salir de la app. En el paso 1 no hace nada. Después enfoca el paso 1.
 * @returns {void}
 */
export function irAPaso1() {
    if (recorridoPendiente) {
        irAlTerminar = true;
        return;
    }
    if (estado.paso === 1) return;
    recorridoPendiente = true;
    window.addEventListener('popstate', enfocarPaso1, { once: true });
    history.go(-((history.state?.nivel || 0) + 1));
}

/** Pasa el foco al título (o primer control) visible del paso 1. @returns {void} */
function enfocarPaso1() {
    const el = [...document.querySelectorAll('.pantalla[data-paso="1"] h2, .pantalla[data-paso="1"] button')].find(
        x => x.offsetParent,
    );
    if (!el) return;
    if (el.tagName === 'H2') el.tabIndex = -1; // los botones ya son enfocables: no los sacamos del orden de tabulación
    el.focus();
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
