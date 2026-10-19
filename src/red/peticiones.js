// Pedidos y lecturas de OctoPrint y Moonraker (ADR 0007, 6.2 y sección 2). Puro: arma descripciones de pedidos
// (el transporte los envía) e interpreta textos de respuesta. Sin imports, sin DOM, sin red.
// La clave va sólo en la cabecera X-Api-Key, nunca en la URL.
//
// Fuentes de la API: las del ADR, sección 2. La doc oficial de OctoPrint y Moonraker no se pudo consultar desde
// acá, así que los [A VALIDAR] siguen abiertos hasta probar con hardware (tarea T10).

const LECTURA_MS = 8000;
const SUBIDA_MS = 600000; // 10 minutos: un G-code grande por wifi tarda
const PROHIBIDOS = /[/\\:*?"<>|]/g;
const MAX_NOMBRE = 100;
const OCUPADA_OCTOPRINT = /^(printing|paused|pausing|resuming|cancelling|finishing)/i;

/** @param {{claveApi: string}} c */
function cabeceras(c) {
    return c.claveApi ? { 'X-Api-Key': c.claveApi } : {};
}

/** Pedido GET de lectura a `ruta` (relativa a la dirección). */
function lectura(config, ruta) {
    return {
        metodo: 'GET',
        url: config.direccion + ruta,
        headers: cabeceras(config),
        cuerpo: null,
        tiempoMs: LECTURA_MS,
    };
}

/** Objeto JSON del texto, o null si no es un objeto (arrays, null, HTML, vacío). */
function objetoJson(texto) {
    try {
        const v = JSON.parse(texto);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
        return null;
    }
}

/**
 * Pedido para verificar la conexión. OctoPrint: GET /api/version · Moonraker: GET /server/info.
 * @param {{tipo: 'octoprint'|'moonraker', direccion: string, claveApi: string, imprimir: boolean}} config
 * @returns {{metodo: 'GET'|'POST', url: string, headers: Record<string,string>, cuerpo: FormData|null, tiempoMs: number}}
 */
export function peticionVersion(config) {
    return lectura(config, config.tipo === 'octoprint' ? '/api/version' : '/server/info');
}

/**
 * Pedido para saber si la impresora está ocupada. OctoPrint: GET /api/job · Moonraker: GET
 * /printer/objects/query?print_stats.
 * @param {{tipo: 'octoprint'|'moonraker', direccion: string, claveApi: string, imprimir: boolean}} config
 * @returns {{metodo: 'GET'|'POST', url: string, headers: Record<string,string>, cuerpo: FormData|null, tiempoMs: number}}
 */
export function peticionEstado(config) {
    return lectura(config, config.tipo === 'octoprint' ? '/api/job' : '/printer/objects/query?print_stats');
}

/** Nombre sin `/ \ : * ? " < > |` (cada uno pasa a `_`), de hasta 100 caracteres y conservando la extensión. */
function sanearNombre(nombre) {
    const limpio = String(nombre).replace(PROHIBIDOS, '_');
    if (limpio.length <= MAX_NOMBRE) return limpio;
    const ext = /\.[A-Za-z0-9]{1,10}$/.exec(limpio)?.[0] ?? '';
    return limpio.slice(0, MAX_NOMBRE - ext.length) + ext;
}

/**
 * Arma el multipart de la subida. Sólo sube (sin `select`/`print`) salvo que `config.imprimir`. El `Content-Type`
 * no se pone: lo arma el navegador con el boundary. tiempoMs 600000.
 * @param {{tipo: 'octoprint'|'moonraker', direccion: string, claveApi: string, imprimir: boolean}} config
 * @param {File|Blob} archivo
 * @param {string} nombre
 * @returns {{metodo: 'GET'|'POST', url: string, headers: Record<string,string>, cuerpo: FormData|null, tiempoMs: number}}
 */
export function peticionSubida(config, archivo, nombre) {
    const form = new FormData();
    form.append('file', archivo, sanearNombre(nombre));
    const octo = config.tipo === 'octoprint';
    if (!octo) form.append('root', 'gcodes');
    if (config.imprimir) {
        if (octo) form.append('select', 'true');
        form.append('print', 'true');
    }
    const ruta = octo ? '/api/files/local' : '/server/files/upload';
    return {
        metodo: 'POST',
        url: config.direccion + ruta,
        headers: cabeceras(config),
        cuerpo: form,
        tiempoMs: SUBIDA_MS,
    };
}

/**
 * Lee la respuesta de `peticionVersion`.
 * @param {'octoprint'|'moonraker'} tipo
 * @param {string} texto cuerpo de la respuesta
 * @returns {{nombre: string}|null} null si el cuerpo no es la respuesta esperada de ese tipo
 */
export function leerVersion(tipo, texto) {
    const json = objetoJson(texto);
    if (!json) return null;
    if (tipo === 'octoprint') {
        return typeof json.server === 'string' ? { nombre: `OctoPrint ${json.server}` } : null;
    }
    const version = json.result?.moonraker_version;
    return typeof version === 'string' ? { nombre: `Moonraker ${version}` } : null;
}

/**
 * Lee la respuesta de `peticionEstado`.
 * @param {'octoprint'|'moonraker'} tipo
 * @param {string} texto cuerpo de la respuesta
 * @returns {boolean|null} true = imprimiendo o en pausa; false = libre; null = no se entendió
 */
export function estaOcupada(tipo, texto) {
    const json = objetoJson(texto);
    if (!json) return null;
    if (tipo === 'octoprint') {
        return typeof json.state === 'string' ? OCUPADA_OCTOPRINT.test(json.state) : null;
    }
    const estado = json.result?.status?.print_stats?.state;
    return typeof estado === 'string' ? estado === 'printing' || estado === 'paused' : null;
}

/**
 * Dice si la impresora informa que empezó a imprimir: `print_started` en Moonraker, `done` en OctoPrint (sólo vale
 * si el pedido llevaba print=true). [A VALIDAR] en hardware (T10).
 * @param {'octoprint'|'moonraker'} tipo
 * @param {string} texto cuerpo de la respuesta de subida
 * @returns {boolean}
 */
export function empezoAImprimir(tipo, texto) {
    const json = objetoJson(texto);
    if (!json) return false;
    return (tipo === 'octoprint' ? json.done : json.print_started) === true;
}

/**
 * Texto de ayuda de CORS para la hoja, con el origen exacto a habilitar. Es texto plano: quien lo muestre en
 * `innerHTML` tiene que pasarlo por `escapar`.
 * @param {'octoprint'|'moonraker'} tipo
 * @param {string} origen `location.origin`
 * @returns {string}
 */
export function ayudaCors(tipo, origen) {
    if (tipo === 'octoprint') {
        return (
            'En OctoPrint: Ajustes > API > activá "Allow Cross Origin Resource Sharing (CORS)" y guardá. ' +
            `Es lo que deja que ${origen} hable con la impresora.`
        );
    }
    return (
        'En moonraker.conf agregá el origen de esta app y reiniciá Moonraker:\n\n' +
        `[authorization]\ncors_domains:\n    ${origen}`
    );
}
