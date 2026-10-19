// Idioma activo y `t()` (ADR 0008, B.6). Hoja de src/ui/: sólo importa almacen y textos/*.
// No toca el DOM al importarse. Los diccionarios (textos/es.js y en.js) se cargan con import() dinámico.
import { leerAjuste, guardarAjuste } from '../almacen.js';
import { IDIOMA_BASE, IDIOMAS, LOCALES, elegirIdioma, traducir } from '../textos/traducir.js';

/** @typedef {import('../textos/traducir.js').Idioma} Idioma */
/** @typedef {import('../textos/traducir.js').Diccionario} Diccionario */
/** @typedef {import('../textos/traducir.js').Valores} Valores */

// En desarrollo (y en Node, sin Vite) una clave inexistente se marca "⟦clave⟧" y se avisa una vez, y hay respaldo
// español (para ver qué falta). En producción no hay respaldo: la clave inexistente sale cruda, siempre igual.
// `globalThis.IDIOMA_DESARROLLO = false` simula producción en las pruebas de Node (Vite define import.meta.env).
const DESARROLLO = import.meta.env ? import.meta.env.DEV : globalThis.IDIOMA_DESARROLLO !== false;

/** @type {Idioma} */
let idioma = IDIOMA_BASE;
/** @type {Diccionario} */
let diccionario = {};
/** @type {Diccionario} */
let respaldo = {};
/** Diccionarios ya cargados o instalados, por idioma. @type {Map<Idioma, Diccionario>} */
const cargados = new Map();
/** @type {Set<(idioma: Idioma) => void>} */
const suscriptos = new Set();
const avisadas = new Set();
// Cuenta los pedidos (`iniciarIdioma` y `cambiarIdioma`) en el orden en que se piden, no en el que terminan de
// cargar: sólo el último activa y avisa. Si la carga del último falla queda el idioma que estaba.
let solicitud = 0;

/** Avisa una vez por mensaje (sólo desarrollo). @param {string} mensaje @returns {void} */
function avisar(mensaje) {
    if (avisadas.has(mensaje)) return;
    avisadas.add(mensaje);
    console.warn(`[idioma] ${mensaje}`);
}

/**
 * Traduce una clave con el idioma actual. Si la clave no existe devuelve la clave (en desarrollo, marcada
 * "⟦clave⟧", y avisa en la consola; si cae al respaldo español, avisa "falta en en: clave"). Antes de
 * `iniciarIdioma` devuelve siempre la clave. No escapa HTML: si el resultado va a innerHTML con valores del
 * usuario, pasalos por `escapar` de util-dom.
 * @param {string} clave  literal ('area.concepto'); para claves dinámicas ver `marcar`
 * @param {Valores} [valores]  `n` elige el plural
 * @returns {string}
 */
export function t(clave, valores) {
    if (existe(clave)) return traducir(diccionario, respaldo, clave, valores, idioma);
    if (!DESARROLLO) return clave;
    if (Object.prototype.hasOwnProperty.call(respaldo, clave)) {
        avisar(`falta en ${idioma}: ${clave}`);
        return traducir(diccionario, respaldo, clave, valores, idioma);
    }
    avisar(`falta la clave: ${clave}`);
    return `⟦${clave}⟧`;
}

/**
 * Marca una clave para el escáner de pruebas y la devuelve igual (para tablas { id: clave }).
 * @param {string} clave
 * @returns {string}
 */
export function marcar(clave) {
    return clave;
}

/**
 * ¿Existe la clave en el idioma actual? (para los textos de perfiles, que tienen un respaldo en el .json).
 * @param {string} clave
 * @returns {boolean}
 */
export function existe(clave) {
    return Object.prototype.hasOwnProperty.call(diccionario, clave);
}

/** @returns {Idioma} idioma activo ('es' por defecto antes de iniciar) */
export function idiomaActual() {
    return idioma;
}

/** @returns {string} locale para Intl y para <html lang>: 'es-AR' o 'en-US' */
export function localeActual() {
    return LOCALES[idioma];
}

/** Carga (o reutiliza) el diccionario de un idioma. @param {Idioma} cual @returns {Promise<Diccionario>} */
async function cargar(cual) {
    if (!cargados.has(cual)) {
        const modulo = await (cual === 'en' ? import('../textos/en.js') : import('../textos/es.js'));
        cargados.set(cual, modulo.default);
    }
    return cargados.get(cual);
}

/** Respaldo del idioma: el español, sólo en desarrollo (en producción nunca hay). */
async function respaldoDe(cual) {
    return DESARROLLO && cual !== IDIOMA_BASE ? cargar(IDIOMA_BASE) : {};
}

/** Deja activo un idioma ya cargado y pone <html lang>. */
function activar(cual, dic, resp) {
    idioma = cual;
    diccionario = dic;
    respaldo = resp;
    if (typeof document !== 'undefined') document.documentElement.lang = LOCALES[cual];
}

/**
 * Elige el idioma (preferencia guardada, si no `navigator.languages`), carga su diccionario con import() y pone
 * <html lang>. Llamar una vez, en paralelo con `cargarPreferencias`. Nunca lanza: si falla la carga queda en 'es'
 * sin diccionario (el HTML ya está en español).
 * @param {{ navegador?: readonly string[] }} [opciones]  `navegador` reemplaza `navigator.languages` (pruebas)
 * @returns {Promise<Idioma>}
 */
export async function iniciarIdioma(opciones) {
    const orden = ++solicitud;
    try {
        let guardado = null;
        try {
            guardado = await leerAjuste('idioma');
        } catch (_error) {
            // Sin almacenamiento (modo privado, etc.): se decide por el navegador.
        }
        const navegador = opciones?.navegador ?? (typeof navigator === 'undefined' ? [] : navigator.languages);
        const elegido = elegirIdioma(guardado, navegador);
        const dic = await cargar(elegido);
        const resp = await respaldoDe(elegido);
        if (orden === solicitud) activar(elegido, dic, resp); // si no, un cambiarIdioma del usuario ya ganó
    } catch (_error) {
        if (orden === solicitud) activar(IDIOMA_BASE, {}, {});
    }
    return idioma;
}

/**
 * Cambia el idioma: carga el diccionario, guarda la preferencia, pone <html lang> y avisa a los suscriptores
 * (después de haber cambiado todo). Si la carga falla no cambia nada y lanza. Lo llama el usuario: es el único
 * lugar donde se guarda la preferencia (si guardarla falla, el cambio igual vale). Con varios pedidos a la vez
 * gana el último que tuvo su diccionario; los demás no avisan, así los suscriptos sólo reciben el idioma activo.
 * @param {Idioma} nuevo
 * @returns {Promise<void>}
 */
export async function cambiarIdioma(nuevo) {
    if (!IDIOMAS.includes(nuevo)) throw new Error(`Idioma desconocido: ${nuevo}`);
    const orden = ++solicitud;
    const dic = await cargar(nuevo);
    const resp = await respaldoDe(nuevo);
    if (orden !== solicitud) return; // otro pedido llegó después: él decide
    activar(nuevo, dic, resp);
    try {
        await guardarAjuste('idioma', nuevo);
    } catch (_error) {
        // La preferencia no se pudo guardar: sigue valiendo en esta sesión.
    }
    if (orden !== solicitud) return; // otro cambio pasó mientras se guardaba: él avisa
    for (const fn of [...suscriptos]) {
        try {
            fn(nuevo);
        } catch (error) {
            console.error(error);
        }
    }
}

/**
 * Suscribe `fn` a los cambios de idioma. Cada módulo la usa en su `iniciarX` para redibujar sus textos.
 * Devuelve la función para desuscribirse (el contrato la declara `void`; devolverla no lo rompe).
 * @param {(idioma: Idioma) => void} fn
 * @returns {() => void}
 */
export function alCambiarIdioma(fn) {
    suscriptos.add(fn);
    return () => {
        suscriptos.delete(fn);
    };
}

/**
 * Instala diccionarios sin tocar almacen ni DOM (pruebas en Node). Deja activo `idioma`; `respaldo` queda como
 * diccionario del idioma base para los demás.
 * @param {Idioma} cual
 * @param {Diccionario} dic
 * @param {Diccionario} resp
 * @returns {void}
 */
export function ponerDiccionarios(cual, dic, resp) {
    cargados.set(cual, dic);
    if (DESARROLLO && cual !== IDIOMA_BASE && Object.keys(resp).length) cargados.set(IDIOMA_BASE, resp);
    idioma = cual;
    diccionario = dic;
    respaldo = DESARROLLO ? resp : {};
}
