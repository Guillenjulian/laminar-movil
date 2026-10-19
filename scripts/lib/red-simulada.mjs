// Impresoras simuladas (OctoPrint y Moonraker) con page.route, para las áreas de scripts/app/red*.mjs (ADR 0007, T8).
// `simular` registra cada pedido (método, URL, X-Api-Key, cuerpo) y contesta según `modo`, que cada caso cambia:
// todo ('abortar' = el pedido falla de red), version/subida (código HTTP), colgar (la subida no responde hasta
// `liberar()`), cuerpo (respuesta cruda de la subida), estado (texto de /api/job o de print_stats).

export const IP = 'http://192.168.1.50';
export const IP_B = 'http://192.168.1.51';
export const MOON = `${IP}:7125`;
export const CLAVE = 'SECRETO-123'; // centinela: no puede aparecer en el DOM, en la consola ni en los storages
export const CLAVE_B = 'OTRA-CLAVE-456';
export const NOMBRE = 'cubo-20mm_rapido.gcode';

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'x-api-key, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
};

const json = (route, status, cuerpo) =>
    route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });

// Respuesta a una subida (POST) según el tipo y el modo.
function responderSubida(route, modo, tipo, colgadas) {
    if (modo.colgar) return void colgadas.push(route);
    if (modo.cuerpo !== null) return route.fulfill({ status: modo.subida, headers: CORS, body: modo.cuerpo });
    const ok =
        tipo === 'octoprint'
            ? { done: true, files: { local: {} } }
            : { item: { path: NOMBRE, root: 'gcodes' }, print_started: true };
    return json(route, modo.subida, ok);
}

// Respuesta a una lectura (GET) de versión o de estado.
function responderLectura(route, modo, ruta) {
    if (ruta === '/api/version') {
        return json(route, modo.version, { api: '0.1', server: '1.10.0', text: 'OctoPrint 1.10.0' });
    }
    if (ruta === '/api/job') return json(route, 200, { state: modo.estado });
    if (ruta === '/server/info') {
        return json(route, modo.version, { result: { klippy_state: 'ready', moonraker_version: 'v0.9.3' } });
    }
    if (ruta === '/printer/objects/query?print_stats') {
        return json(route, 200, { result: { status: { print_stats: { state: modo.estado } } } });
    }
    return route.fulfill({ status: 404, headers: CORS, body: '' }); // la sonda no-cors a "/" cae acá
}

function crearManejador(tipo, modo, registro, colgadas) {
    return async route => {
        const req = route.request();
        if (modo.todo === 'abortar') return route.abort('failed');
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        registro.push({
            metodo: req.method(),
            url: req.url(),
            clave: req.headers()['x-api-key'],
            tipoContenido: req.headers()['content-type'] || '',
            cuerpo: req.postDataBuffer(),
        });
        if (req.method() === 'POST') return responderSubida(route, modo, tipo, colgadas);
        const url = new URL(req.url());
        return responderLectura(route, modo, url.pathname + url.search);
    };
}

/**
 * Simula una impresora en `origen` y anota la ruta en `rutas` (para quitarla con page.unroute).
 * @param {import('playwright-core').Page} pagina
 * @param {Array} rutas
 * @param {string} origen
 * @param {'octoprint'|'moonraker'} tipo
 */
export function simular(pagina, rutas, origen, tipo) {
    const registro = [];
    const colgadas = [];
    const modo = {
        todo: null,
        version: 200,
        subida: 201,
        colgar: false,
        cuerpo: null,
        estado: tipo === 'octoprint' ? 'Operational' : 'standby',
    };
    const manejador = crearManejador(tipo, modo, registro, colgadas);
    rutas.push([`${origen}/**`, manejador]);
    return {
        modo,
        registro,
        listo: pagina.route(`${origen}/**`, manejador),
        pedidos: (metodo, ruta) => registro.filter(r => r.metodo === metodo && (!ruta || r.url === origen + ruta)),
        subidas: () => registro.filter(r => r.metodo === 'POST'),
        liberar: () => colgadas.splice(0).forEach(r => r.abort('failed').catch(() => {})),
        vaciar: () => registro.splice(0),
    };
}

/** Partes de un multipart ya registrado: `{ nombre, archivo, contenido }`. */
export function partes(pedido) {
    const m = /boundary=(.+)$/.exec(pedido?.tipoContenido ?? '');
    if (!m || !pedido.cuerpo) return [];
    return pedido.cuerpo
        .toString('utf8')
        .split('--' + m[1])
        .filter(p => p.startsWith('\r\n'))
        .map(p => {
            const corte = p.indexOf('\r\n\r\n');
            const cab = p.slice(0, corte);
            return {
                nombre: /name="([^"]*)"/.exec(cab)?.[1],
                archivo: /filename="([^"]*)"/.exec(cab)?.[1],
                contenido: p.slice(corte + 4, p.lastIndexOf('\r\n')),
            };
        });
}
