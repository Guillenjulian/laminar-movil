// Errores del envío por red local (ADR 0007, 6.3): traduce respuestas HTTP y fallos de transporte a
// { codigo, mensaje, pista }. Puro: sin imports, sin DOM, sin console, sin fetch. Nunca pone la clave
// ni el cuerpo de la respuesta de la impresora en un texto (no lo controlamos).

/** @typedef {'octoprint'|'moonraker'} TipoRed */
/** @typedef {{estado: number, texto: string}} Respuesta */
/** @typedef {'direccion'|'sin-llegada'|'bloqueado'|'clave'|'ocupada'|'rechazado'|'respuesta'|'tiempo'|'cancelado'} CodigoError */
/** @typedef {{codigo: CodigoError, mensaje: string, pista: string, estadoHttp?: number}} ErrorRed */

/**
 * Todos los textos, por clave. Marcas: {n} nombre del tipo, {estado} código HTTP, {origen} origen de la app,
 * {motivo} motivo de la dirección. El navegador no distingue impresora apagada de bloqueo: los textos dicen las dos.
 */
const TEXTOS = {
    direccion: {
        mensaje: 'La dirección no es válida. Probá con algo como http://192.168.1.50',
        pista: '{motivo}',
    },
    'sin-llegada': {
        mensaje: 'No se pudo llegar a la impresora.',
        pista: 'Revisá que estén en el mismo Wi-Fi, que la IP sea la correcta y que esté prendida. Si la dirección es https, hace falta un certificado válido: uno autofirmado no sirve.',
    },
    'sin-llegada-http': {
        mensaje: 'No se pudo llegar a la impresora.',
        pista: 'Puede estar apagada o en otra red, o el navegador puede estar bloqueando el pedido. Revisá el Wi-Fi y la IP; en Chrome, fijate el permiso de Red local del sitio.',
    },
    'bloqueado-octoprint': {
        mensaje: 'La impresora respondió, pero no deja que esta página lea la respuesta (falta habilitar CORS).',
        pista: 'Habilitá este origen en la impresora: {origen}. En OctoPrint: Ajustes → API → activá "Allow Cross Origin Resource Sharing (CORS)".',
    },
    'bloqueado-moonraker': {
        mensaje: 'La impresora respondió, pero no deja que esta página lea la respuesta (falta habilitar CORS).',
        pista: 'Habilitá este origen en la impresora: {origen}. En moonraker.conf, sección [authorization], sumalo a cors_domains y reiniciá Moonraker.',
    },
    'bloqueado-otro': {
        mensaje: 'La impresora respondió, pero no deja que esta página lea la respuesta (falta habilitar CORS).',
        pista: 'Habilitá este origen en la impresora: {origen}. Buscá la opción de CORS en su configuración.',
    },
    'aviso-imprimiendo': {
        mensaje: '',
        pista: 'Con "empezar a imprimir" prendido, puede que el archivo haya llegado: mirá la impresora antes de reintentar.',
    },
    'clave-con': { mensaje: 'La API key no sirve.', pista: 'Revisá que esté bien copiada y que siga vigente.' },
    'clave-sin': {
        mensaje: 'Esta impresora pide una API key.',
        pista: 'Generala en la impresora y pegala en la configuración.',
    },
    ocupada: {
        mensaje: 'La impresora está imprimiendo ahora.',
        pista: 'Podés subir el archivo sin imprimir, o esperar a que termine.',
    },
    'rechazado-subida': {
        mensaje: 'La impresora no aceptó el archivo (código {estado}).',
        pista: 'Probá de nuevo; si sigue, descargá el archivo y subilo desde la interfaz de la impresora.',
    },
    rechazado: {
        mensaje: 'La impresora respondió con un error (código {estado}).',
        pista: 'Puede estar reiniciándose o con el firmware desconectado.',
    },
    respuesta: {
        mensaje: 'Esa dirección no parece ser un {n}.',
        pista: '¿El puerto y el tipo de impresora son los correctos?',
    },
    tiempo: { mensaje: 'La impresora no respondió a tiempo.', pista: 'Revisá que esté prendida y en la misma red.' },
    cancelado: { mensaje: 'Envío cancelado.', pista: '' },
};

const NOMBRES = { octoprint: 'OctoPrint', moonraker: 'Moonraker' };
const NEUTRO = 'OctoPrint o Moonraker';

/** Nombre del tipo; texto neutro si no es uno conocido (sin tocar el prototipo). */
const nombreDe = tipo => (typeof tipo === 'string' && Object.hasOwn(NOMBRES, tipo) ? NOMBRES[tipo] : NEUTRO);

/** `prefijo-tipo` si existe en `TEXTOS`; si no, `prefijo-otro`. */
const claveDeTipo = (prefijo, tipo) =>
    typeof tipo === 'string' && Object.hasOwn(TEXTOS, `${prefijo}-${tipo}`) ? `${prefijo}-${tipo}` : `${prefijo}-otro`;

/** Arma el error de una clave de `TEXTOS` reemplazando las marcas de `datos`. */
function armar(clave, codigo, datos = {}, estadoHttp) {
    const llenar = t => t.replace(/\{(\w+)\}/g, (_, k) => String(datos[k] ?? ''));
    const { mensaje, pista } = TEXTOS[clave];
    const error = { codigo, mensaje: llenar(mensaje), pista: llenar(pista) };
    return estadoHttp === undefined ? error : { ...error, estadoHttp };
}

/** Clave de `TEXTOS` y código para un HTTP que no es éxito. */
function claveDeEstado(fase, estado, tieneClave) {
    if (estado === 401 || estado === 403) return [tieneClave ? 'clave-con' : 'clave-sin', 'clave'];
    if (estado === 409) return ['ocupada', 'ocupada'];
    if (estado === 404 || estado < 400) return ['respuesta', 'respuesta'];
    return [fase === 'subida' ? 'rechazado-subida' : 'rechazado', 'rechazado'];
}

/**
 * Traduce el estado HTTP de una respuesta. null si es éxito (2xx). Sólo mira el estado: que el cuerpo sea lo
 * esperado lo decide `peticiones.js` (`leerVersion`, `estaOcupada`) y, si no, se usa `errorDeLectura`.
 * @param {TipoRed} tipo
 * @param {'version'|'estado'|'subida'} fase
 * @param {Respuesta} respuesta
 * @param {{tieneClave: boolean}} contexto
 * @returns {ErrorRed|null}
 */
export function errorDeRespuesta(tipo, fase, respuesta, contexto) {
    const { estado } = respuesta;
    if (estado >= 200 && estado < 300) return null;
    const [clave, codigo] = claveDeEstado(fase, estado, Boolean(contexto?.tieneClave));
    return armar(clave, codigo, { n: nombreDe(tipo), estado }, estado);
}

/**
 * Error para un 2xx cuyo cuerpo no es lo esperado (la lectura de `peticiones.js` dio null).
 * @param {TipoRed} tipo
 * @returns {ErrorRed} código 'respuesta'
 */
export function errorDeLectura(tipo) {
    return armar('respuesta', 'respuesta', { n: nombreDe(tipo) });
}

/** Agrega el aviso de R2 a la pista si el envío llevaba print=true (puede que el archivo haya llegado). */
function conAviso(error, contexto) {
    if (!contexto.imprimiendo) return error;
    return { ...error, pista: `${error.pista} ${TEXTOS['aviso-imprimiendo'].pista}`.trim() };
}

/**
 * Traduce un fallo sin respuesta HTTP.
 * `alcanzable`: lo que dijo la sonda. `imprimiendo`: la subida llevaba print=true (agrega el aviso de R2 en `bloqueado` y `tiempo`).
 * @param {'red'|'tiempo'|'cancelado'} causa
 * @param {{alcanzable: boolean, tipo: TipoRed, origenApp: string, http: boolean, imprimiendo: boolean}} contexto
 * @returns {ErrorRed}
 */
export function errorDeTransporte(causa, contexto) {
    if (causa === 'cancelado') return armar(causa, causa);
    if (causa === 'tiempo') return conAviso(armar(causa, causa), contexto);
    if (!contexto.alcanzable) return armar(contexto.http ? 'sin-llegada-http' : 'sin-llegada', 'sin-llegada');
    const clave = claveDeTipo('bloqueado', contexto.tipo);
    return conAviso(armar(clave, 'bloqueado', { origen: contexto.origenApp }), contexto);
}

/**
 * @param {string} motivo de normalizarDireccion (oración completa, va de pista)
 * @returns {ErrorRed} código 'direccion'
 */
export function errorDeDireccion(motivo) {
    return armar('direccion', 'direccion', { motivo: typeof motivo === 'string' ? motivo : '' });
}
