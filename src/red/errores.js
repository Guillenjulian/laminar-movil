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
        mensaje: 'La dirección no es válida ({motivo}).',
        pista: 'Probá con algo como http://192.168.1.50',
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
    rechazado: {
        mensaje: 'La impresora no aceptó el archivo (código {estado}).',
        pista: 'Probá de nuevo; si sigue, descargá el archivo y subilo desde la interfaz de la impresora.',
    },
    respuesta: {
        mensaje: 'Esa dirección no parece ser un {n}.',
        pista: '¿El puerto y el tipo de impresora son los correctos?',
    },
    tiempo: { mensaje: 'La impresora no respondió a tiempo.', pista: 'Revisá que esté prendida y en la misma red.' },
    cancelado: { mensaje: 'Envío cancelado.', pista: '' },
};

const NOMBRES = { octoprint: 'OctoPrint', moonraker: 'Moonraker' };

/** Arma el error de una clave de `TEXTOS` reemplazando las marcas de `datos`. */
function armar(clave, codigo, datos = {}, estadoHttp) {
    const llenar = t => t.replace(/\{(\w+)\}/g, (_, k) => String(datos[k] ?? ''));
    const { mensaje, pista } = TEXTOS[clave];
    const error = { codigo, mensaje: llenar(mensaje), pista: llenar(pista) };
    return estadoHttp === undefined ? error : { ...error, estadoHttp };
}

/** Lee el JSON de un texto; null si no es JSON de objeto. */
function leerJson(texto) {
    try {
        const valor = JSON.parse(texto);
        return valor && typeof valor === 'object' ? valor : null;
    } catch {
        return null;
    }
}

/** Qué se espera de un 200 en cada tipo y fase (formas tolerantes; el ADR las marca [A VALIDAR]). */
const FORMAS = {
    octoprint: {
        version: j => typeof j.server === 'string',
        estado: j => j.state != null,
    },
    moonraker: {
        version: j => typeof j.result?.moonraker_version === 'string',
        estado: j => j.result?.status != null && typeof j.result.status === 'object',
    },
};

/** Clave de `TEXTOS` y código para un HTTP que no es éxito. */
function claveDeEstado(estado, tieneClave) {
    if (estado === 401 || estado === 403) return [tieneClave ? 'clave-con' : 'clave-sin', 'clave'];
    if (estado === 409) return ['ocupada', 'ocupada'];
    if (estado === 404 || estado < 400) return ['respuesta', 'respuesta'];
    return ['rechazado', 'rechazado'];
}

/**
 * Traduce una respuesta HTTP que no es éxito. null si es éxito para esa fase.
 * @param {TipoRed} tipo
 * @param {'version'|'estado'|'subida'} fase
 * @param {Respuesta} respuesta
 * @param {{tieneClave: boolean}} contexto
 * @returns {ErrorRed|null}
 */
export function errorDeRespuesta(tipo, fase, respuesta, contexto) {
    const { estado, texto } = respuesta;
    const datos = { n: NOMBRES[tipo] ?? 'OctoPrint o Moonraker', estado };
    if (estado >= 200 && estado < 300) {
        if (fase === 'subida') return null;
        const json = leerJson(texto);
        if (json && FORMAS[tipo]?.[fase]?.(json)) return null;
        return armar('respuesta', 'respuesta', datos, estado);
    }
    const [clave, codigo] = claveDeEstado(estado, Boolean(contexto?.tieneClave));
    return armar(clave, codigo, datos, estado);
}

/**
 * Traduce un fallo sin respuesta HTTP.
 * `alcanzable`: lo que dijo la sonda. `imprimiendo`: el envío llevaba print=true (agrega el aviso de R2).
 * @param {'red'|'tiempo'|'cancelado'} causa
 * @param {{alcanzable: boolean, tipo: TipoRed, origenApp: string, http: boolean, imprimiendo: boolean}} contexto
 * @returns {ErrorRed}
 */
export function errorDeTransporte(causa, contexto) {
    if (causa === 'tiempo' || causa === 'cancelado') return armar(causa, causa);
    if (!contexto.alcanzable) return armar(contexto.http ? 'sin-llegada-http' : 'sin-llegada', 'sin-llegada');
    const bloqueado = armar(`bloqueado-${contexto.tipo}`, 'bloqueado', { origen: contexto.origenApp });
    if (!contexto.imprimiendo) return bloqueado;
    const aviso = armar('aviso-imprimiendo', 'bloqueado');
    return { ...bloqueado, pista: `${bloqueado.pista} ${aviso.pista}` };
}

/**
 * @param {string} motivo de normalizarDireccion
 * @returns {ErrorRed} código 'direccion'
 */
export function errorDeDireccion(motivo) {
    return armar('direccion', 'direccion', { motivo });
}
