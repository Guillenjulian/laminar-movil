// Cliente del envío por red local (ADR 0007, 6.4): orquesta los pedidos de `peticiones.js` y los errores de
// `errores.js` sobre un transporte y una sonda que le inyectan. Nunca lanza, nunca reintenta solo, no escribe en
// consola y no deja la clave en ningún resultado: sólo viaja en la cabecera que arma `peticiones.js`.
import {
    empezoAImprimir,
    estaOcupada,
    leerVersion,
    peticionEstado,
    peticionSubida,
    peticionVersion,
} from './peticiones.js';
import { errorDeLectura, errorDeRespuesta, errorDeTransporte } from './errores.js';

/** @typedef {import('./errores.js').ErrorRed} ErrorRed */
/** La dirección llega ya normalizada (`normalizarDireccion`: http/https, sin barra final ni ruta). */
/** @typedef {{tipo: 'octoprint'|'moonraker', direccion: string, claveApi: string, imprimir: boolean}} ConfigRed */
/** @typedef {{alProgreso?: (fraccion: number) => void, senal?: AbortSignal}} OpcionesEnvio */
/** @typedef {{transporte: (peticion: object, opciones?: OpcionesEnvio) => Promise<{estado: number, texto: string}>,
 *   sonda: (url: string) => Promise<boolean>, origenApp: string}} DependenciasRed
 *  `sonda`: true si el host responde aunque el navegador no deje leer (ver `sondaSinCors`). */
/** @typedef {{ok: true, resumen: {nombre: string, ocupada: boolean|null}} | {ok: false, error: ErrorRed}} ResultadoPrueba */
/** @typedef {{ok: true, imprimiendo: boolean, nombre: string} | {ok: false, error: ErrorRed}} ResultadoEnvio */

/** La sonda recibe el origen de la impresora, sin ruta. Si lanza, es como si el host no respondiera. */
async function sondear(config, deps) {
    try {
        return Boolean(await deps.sonda(new URL(config.direccion).origin));
    } catch {
        return false;
    }
}

/** Error de un fallo sin respuesta HTTP. Sólo una falla de red consulta la sonda (tiempo y cancelado no). */
async function falloDeTransporte(causa, config, deps, imprimiendo) {
    const motivo = causa === 'tiempo' || causa === 'cancelado' ? causa : 'red';
    const alcanzable = motivo === 'red' && (await sondear(config, deps));
    return errorDeTransporte(motivo, {
        alcanzable,
        tipo: config.tipo,
        origenApp: deps.origenApp,
        http: /^http:/i.test(config.direccion),
        imprimiendo,
    });
}

/**
 * Manda un pedido y lo traduce. Devuelve `{ error }` o `{ respuesta }` si la fase fue un éxito.
 * Un solo intento: no hay reintento.
 */
async function pedir(fase, peticion, config, deps, opciones) {
    let respuesta;
    try {
        respuesta = await deps.transporte(peticion, opciones);
    } catch (e) {
        return { error: await falloDeTransporte(e?.causa, config, deps, fase === 'subida' && config.imprimir) };
    }
    const error = errorDeRespuesta(config.tipo, fase, respuesta, { tieneClave: Boolean(config.claveApi) });
    return error ? { error } : { respuesta };
}

/** Si algo inesperado se escapa (un transporte que rompe), se informa como falta de llegada, sin su texto. */
function errorInesperado(config, deps) {
    return errorDeTransporte('red', {
        alcanzable: false,
        tipo: config?.tipo,
        origenApp: deps?.origenApp,
        http: /^http:/i.test(String(config?.direccion)),
        imprimiendo: false,
    });
}

/**
 * Versión y luego estado. `resumen.ocupada` es null si el estado respondió algo que no se entiende: que la UI decida.
 * @param {ConfigRed} config
 * @param {DependenciasRed} deps
 * @returns {Promise<ResultadoPrueba>}
 */
async function probar(config, deps) {
    const version = await pedir('version', peticionVersion(config), config, deps);
    if (version.error) return { ok: false, error: version.error };
    const estado = await pedir('estado', peticionEstado(config), config, deps);
    if (estado.error) return { ok: false, error: estado.error };
    const leida = leerVersion(config.tipo, version.respuesta.texto);
    if (!leida) return { ok: false, error: errorDeLectura(config.tipo) };
    return { ok: true, resumen: { nombre: leida.nombre, ocupada: estaOcupada(config.tipo, estado.respuesta.texto) } };
}

/**
 * Prueba la conexión: pide la versión y, si responde bien, el estado. Que esté ocupada no es un error.
 * Nunca lanza.
 * @param {ConfigRed} config
 * @param {DependenciasRed} deps
 * @returns {Promise<ResultadoPrueba>}
 */
export async function probarConexion(config, deps) {
    try {
        return await probar(config, deps);
    } catch {
        return { ok: false, error: errorInesperado(config, deps) };
    }
}

/**
 * Un solo POST de subida; `imprimiendo` sólo si se pidió imprimir y la impresora lo confirma.
 * @param {ConfigRed} config
 * @param {File|Blob} archivo
 * @param {string} nombre
 * @param {DependenciasRed} deps
 * @param {OpcionesEnvio} [opciones]
 * @returns {Promise<ResultadoEnvio>}
 */
async function enviar(config, archivo, nombre, deps, opciones) {
    const subida = await pedir('subida', peticionSubida(config, archivo, nombre), config, deps, opciones);
    if (subida.error) return { ok: false, error: subida.error };
    const imprimiendo = empezoAImprimir(config.tipo, subida.respuesta.texto, config.imprimir);
    return { ok: true, imprimiendo, nombre };
}

/**
 * Sube el archivo (y lo manda a imprimir sólo si `config.imprimir`). Un único POST: nunca reintenta. Se cancela
 * con `opciones.senal`. Nunca lanza.
 * @param {ConfigRed} config
 * @param {File|Blob} archivo
 * @param {string} nombre
 * @param {DependenciasRed} deps
 * @param {OpcionesEnvio} [opciones]
 * @returns {Promise<ResultadoEnvio>}
 */
export async function enviarGcode(config, archivo, nombre, deps, opciones) {
    try {
        return await enviar(config, archivo, nombre, deps, opciones);
    } catch {
        return { ok: false, error: errorInesperado(config, deps) };
    }
}
