// Pedidos y lecturas de OctoPrint y Moonraker (ADR 0007, 6.2 y sección 2). Puro: arma descripciones de pedidos
// (el transporte los envía) e interpreta textos de respuesta. Sin imports, sin DOM, sin red.
// La clave va sólo en la cabecera X-Api-Key, nunca en la URL.
//
// Fuentes de la API: las del ADR, sección 2. La doc oficial de OctoPrint y Moonraker no se pudo consultar desde
// acá, así que los [A VALIDAR] siguen abiertos hasta probar con hardware (tarea T10).
// El texto de ayuda de CORS vive en errores.js (`bloqueado-*`): es la fuente única.

/** @typedef {{tipo: 'octoprint'|'moonraker', direccion: string, claveApi: string, imprimir: boolean}} ConfigRed */
/** @typedef {{metodo: 'GET'|'POST', url: string, headers: Record<string,string>, cuerpo: FormData|null, tiempoMs: number}} Peticion */

const LECTURA_MS = 8000;
const SUBIDA_MS = 600000; // 10 minutos: un G-code grande por wifi tarda
const PROHIBIDOS = /[/\\:*?"<>|]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const SOLO_SEPARADORES = /^[./\\\s]*$/;
const MAX_PUNTOS = 100; // puntos de código del nombre
const MAX_BYTES = 200; // bytes UTF-8 del nombre
const EXT = '.gcode';
const NOMBRE_POR_DEFECTO = `laminar-movil${EXT}`;
const OCUPADA_OCTOPRINT = /^(printing|paused|pausing|resuming|cancelling|finishing|starting|transferring)/i;

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
 * @param {ConfigRed} config
 * @returns {Peticion}
 */
export function peticionVersion(config) {
    return lectura(config, config.tipo === 'octoprint' ? '/api/version' : '/server/info');
}

/**
 * Pedido para saber si la impresora está ocupada. OctoPrint: GET /api/job · Moonraker: GET
 * /printer/objects/query?print_stats.
 * @param {ConfigRed} config
 * @returns {Peticion}
 */
export function peticionEstado(config) {
    return lectura(config, config.tipo === 'octoprint' ? '/api/job' : '/printer/objects/query?print_stats');
}

/** Corta a `maxPuntos` puntos de código y `maxBytes` bytes UTF-8 sin partir un par sustituto. */
function cortar(texto, maxPuntos, maxBytes) {
    const codificador = new TextEncoder();
    const salida = [];
    let bytes = 0;
    for (const c of Array.from(texto)) {
        bytes += codificador.encode(c).length;
        if (salida.length >= maxPuntos || bytes > maxBytes) break;
        salida.push(c);
    }
    return salida.join('');
}

/**
 * Nombre seguro para la impresora: sin caracteres de control, con `/ \ : * ? " < > |` pasados a `_`, siempre con
 * extensión `.gcode`, de hasta 100 puntos de código y 200 bytes UTF-8. Vacío, `.`, `..` o sólo separadores dan
 * `laminar-movil.gcode`.
 */
function sanearNombre(nombre) {
    const base = String(nombre ?? '')
        .replace(CONTROL, '')
        .trim();
    if (SOLO_SEPARADORES.test(base)) return NOMBRE_POR_DEFECTO;
    const limpio = base.replace(PROHIBIDOS, '_');
    const conExt = limpio.toLowerCase().endsWith(EXT) ? limpio : limpio + EXT;
    const ext = conExt.slice(-EXT.length);
    const raiz = conExt.slice(0, -EXT.length);
    return cortar(raiz, MAX_PUNTOS - EXT.length, MAX_BYTES - EXT.length) + ext;
}

/**
 * Arma el multipart de la subida. Sólo sube (sin `select`/`print`) salvo que `config.imprimir`. El `Content-Type`
 * no se pone: lo arma el navegador con el boundary. tiempoMs 600000.
 * @param {ConfigRed} config
 * @param {File|Blob} archivo
 * @param {string} nombre
 * @returns {Peticion}
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
 * Dice si la impresora informa que empezó a imprimir: `print_started` en Moonraker. En OctoPrint `done` sólo
 * significa "subida terminada", así que cuenta únicamente si el pedido llevaba print=true. [A VALIDAR] en
 * hardware (T10).
 * @param {'octoprint'|'moonraker'} tipo
 * @param {string} texto cuerpo de la respuesta de subida
 * @param {boolean} imprimir si el pedido de subida pedía imprimir; con false siempre da false
 * @returns {boolean}
 */
export function empezoAImprimir(tipo, texto, imprimir) {
    if (!imprimir) return false;
    const json = objetoJson(texto);
    if (!json) return false;
    return (tipo === 'octoprint' ? json.done : json.print_started) === true;
}
