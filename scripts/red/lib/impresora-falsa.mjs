// Ayudas compartidas de las pruebas del cliente de red (ADR 0007, T1): una impresora falsa (OctoPrint o Moonraker)
// que se usa como `transporte` y `sonda` del cliente, más espías y límites de tiempo. No es una prueba (sin export default).

export const CENTINELA = 'CLAVE-CENTINELA-123';
export const COLGADO = Symbol('colgado');

/** Un ErrorTransporte como el que rechaza el transporte real (name y causa). */
export function errorTransporte(causa, mensaje = `fallo: ${causa}`) {
    const e = new Error(mensaje);
    e.name = 'ErrorTransporte';
    e.causa = causa;
    return e;
}

/** Espía console.*; `restaurar()` lo deja como estaba y devuelve las llamadas (hay que restaurar antes de `revisar`). */
export function espiarConsola() {
    const metodos = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'];
    const originales = {};
    const llamadas = [];
    for (const m of metodos) {
        originales[m] = console[m];
        console[m] = (...args) => llamadas.push({ metodo: m, args });
    }
    return {
        restaurar() {
            for (const m of metodos) console[m] = originales[m];
            return llamadas;
        },
    };
}

/** Espera la promesa, pero si tarda más de `ms` devuelve COLGADO (una prueba que se cuelga no debe colgar la suite). */
export async function conLimite(promesa, ms = 2000) {
    let t;
    const limite = new Promise(resolver => {
        t = setTimeout(() => resolver(COLGADO), ms);
    });
    try {
        return await Promise.race([promesa, limite]);
    } finally {
        clearTimeout(t);
    }
}

/** Corre `fn` y nunca lanza: `{ lanzo: false, valor }` o `{ lanzo: true, error }`. */
export async function intentar(fn, ms = 2000) {
    try {
        return { lanzo: false, valor: await conLimite(fn(), ms) };
    } catch (error) {
        return { lanzo: true, error };
    }
}

const RUTAS = {
    octoprint: { version: '/api/version', estado: '/api/job', subida: '/api/files/local' },
    moonraker: {
        version: '/server/info',
        estado: '/printer/objects/query?print_stats',
        subida: '/server/files/upload',
    },
};
const METODOS = { version: 'GET', estado: 'GET', subida: 'POST' };
const json = (estado, objeto) => ({ estado, texto: JSON.stringify(objeto) });

function cuerpoVersion(tipo) {
    if (tipo === 'octoprint') return { api: '0.1', server: '1.10.0', text: 'OctoPrint 1.10.0' };
    return { result: { klippy_state: 'ready', klippy_connected: true, moonraker_version: 'v0.9.3' } };
}

function cuerpoEstado(tipo, ocupada) {
    if (tipo === 'octoprint') return { state: ocupada ? 'Printing' : 'Operational', job: {}, progress: {} };
    return { result: { status: { print_stats: { state: ocupada ? 'printing' : 'standby' } } } };
}

async function subirFalsa(ctx, peticion, opcionesEnvio) {
    const { tipo, modo, ocupada, subidas, avisarSubida } = ctx;
    const archivo = peticion.cuerpo.get('file');
    const partes = {};
    for (const [k, v] of peticion.cuerpo.entries()) if (k !== 'file') partes[k] = v;
    subidas.push({ nombre: archivo.name, contenido: await archivo.text(), partes });
    if (modo === 'colgada-subida') {
        avisarSubida();
        return new Promise((_, rechazar) => {
            const abortar = () => rechazar(errorTransporte('cancelado'));
            if (opcionesEnvio?.senal?.aborted) abortar();
            else opcionesEnvio?.senal?.addEventListener('abort', abortar);
        });
    }
    const imprimir = partes.print === 'true';
    if (imprimir && ocupada) return json(409, { error: 'Printer is busy' });
    if (tipo === 'octoprint') return json(201, { files: { local: { name: archivo.name } }, done: true });
    return json(201, { item: { path: archivo.name, root: 'gcodes' }, print_started: imprimir, action: 'create_file' });
}

/**
 * Impresora falsa. Opciones: `tipo`, `direccion`, `clave` ('' = no pide clave), `ocupada`, `respuestas` (pisa la
 * respuesta de una fase: `{ subida: { estado: 422, texto: '' } }`) y `modo`:
 *  normal | sin-red (rechaza 'red', la sonda dice false) | cors (rechaza 'red', la sonda dice true) | tiempo |
 *  ajena (200 con HTML) | 404 | json-roto | colgada-subida (la subida queda esperando hasta que aborten).
 * Devuelve `{ transporte, sonda, pedidos, subidas, sondeadas, enSubida }`; `enSubida` se resuelve cuando la subida
 * arrancó. Con `ocupada` la subida con print=true da 409 (como las impresoras reales); sin print se acepta.
 */
export function crearImpresoraFalsa(opciones = {}) {
    const { tipo = 'octoprint', direccion = 'http://192.168.1.50', clave = '', ocupada = false } = opciones;
    const { modo = 'normal', respuestas = {} } = opciones;
    const pedidos = [];
    const subidas = [];
    const sondeadas = [];
    let avisarSubida;
    const enSubida = new Promise(resolver => (avisarSubida = resolver));

    function faseDe(peticion) {
        const ruta = peticion.url.startsWith(direccion) ? peticion.url.slice(direccion.length) : null;
        const fase = Object.keys(RUTAS[tipo]).find(f => RUTAS[tipo][f] === ruta);
        return fase && METODOS[fase] === peticion.metodo ? fase : null;
    }

    async function transporte(peticion, opcionesEnvio) {
        const fase = faseDe(peticion);
        pedidos.push({ fase, metodo: peticion.metodo, url: peticion.url, headers: { ...peticion.headers } });
        if (modo === 'sin-red' || modo === 'cors') throw errorTransporte('red');
        if (modo === 'tiempo') throw errorTransporte('tiempo');
        if (modo === 'ajena') return { estado: 200, texto: '<html><body>Hola</body></html>' };
        if (modo === '404' || !fase) return { estado: 404, texto: 'Not Found' };
        if (clave && peticion.headers['X-Api-Key'] !== clave) {
            return { estado: tipo === 'octoprint' ? 403 : 401, texto: '' };
        }
        if (respuestas[fase]) return respuestas[fase];
        if (modo === 'json-roto') return { estado: 200, texto: '{"state":' };
        if (fase === 'version') return json(200, cuerpoVersion(tipo));
        if (fase === 'estado') return json(200, cuerpoEstado(tipo, ocupada));
        return subirFalsa({ tipo, modo, ocupada, subidas, avisarSubida }, peticion, opcionesEnvio);
    }

    async function sonda(url) {
        sondeadas.push(url);
        return modo === 'cors';
    }

    return { transporte, sonda, pedidos, subidas, sondeadas, enSubida };
}

// --- Ayudas para las pruebas del cliente (cliente.mjs) ---
export const ORIGEN_APP = 'https://laminar.ejemplo.app';
export const GCODE = 'G28\nG1 X10 Y10 E1\n';
export const cfg = (tipo, extra = {}) => ({
    tipo,
    direccion: 'http://192.168.1.50',
    claveApi: '',
    imprimir: false,
    ...extra,
});
export const armar = (opciones, tipo) => {
    const f = crearImpresoraFalsa({ tipo, ...opciones });
    return { f, deps: { transporte: f.transporte, sonda: f.sonda, origenApp: ORIGEN_APP } };
};
export const probar = (c, tipo, opciones) => {
    const { f, deps } = armar(opciones, tipo);
    return intentar(() => c.probarConexion(cfg(tipo, opciones?.config), deps)).then(r => ({ ...r, f }));
};
export const enviar = (c, tipo, opciones, nombre = 'cubo-20mm.gcode', envio) => {
    const { f, deps } = armar(opciones, tipo);
    return intentar(() => c.enviarGcode(cfg(tipo, opciones?.config), new Blob([GCODE]), nombre, deps, envio)).then(
        r => ({ ...r, f }),
    );
};

/** Dependencias cuyo transporte y sonda lanzan una excepción con la clave en el texto (para "nunca lanza"). */
export function transporteQueRompe() {
    return {
        transporte: async () => {
            throw new Error(`boom ${CENTINELA}`);
        },
        sonda: async () => {
            throw new Error('boom sonda');
        },
        origenApp: ORIGEN_APP,
    };
}

// Tabla compartida (transporte.mjs y direccion.mjs): [url, ¿es red local?]. Misma regla para targetAddressSpace y esDireccionLocal.
export const CASOS_LOCAL = [
    ['http://192.168.1.50/api/version', true],
    ['http://10.0.0.7:5000/api/version', true],
    ['http://172.16.4.2/api/version', true],
    ['http://172.31.255.1/api/version', true],
    ['http://octopi.local/api/version', true],
    ['http://OCTOPI.LOCAL:7125/server/info', true],
    ['https://192.168.1.50:8443/api/version', true],
    ['https://impresora.tail1234.ts.net/api/version', false],
    ['http://8.8.8.8/api/version', false],
    ['http://172.32.0.1/api/version', false],
    ['http://impresora.lan/api/version', true],
    ['http://x.home.arpa/api/version', true],
    ['http://octopi/api/version', true],
    ['http://mainsail:7125/server/info', true],
    ['http://[fd00::1]:5000/api/version', true],
    ['http://[fc00::2]/api/version', true],
    ['http://[fe80::1]/api/version', true],
    ['http://octopi.ejemplo.com/api/version', false],
    ['http://127.0.0.1:5000/api/version', false],
    ['http://[::1]:5000/api/version', false],
    ['http://[2001:db8::1]/api/version', false],
    ['https://ejemplo.com/api/version', false],
];
