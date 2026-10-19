// Transporte HTTP del envío por red local (ADR 0007, 6.5 y decisión 5 del CTO): un `fetch` con tope de tiempo,
// cancelación y, si la dirección es privada o `.local`, `targetAddressSpace: 'local'` (Chrome lo pide para hablarle
// a la red local desde una página https). Sin porcentaje de subida: `fetch` no lo da. No escribe nada en consola y
// ningún error lleva cabeceras ni la clave de API.
import { esDireccionLocal } from './direccion.js';

const TOPE_SONDA_MS = 4000;

/** Error del transporte; `causa` es 'red', 'tiempo' o 'cancelado'. El mensaje nunca incluye la petición. */
export class ErrorTransporte extends Error {
    /** @param {'red'|'tiempo'|'cancelado'} causa */
    constructor(causa) {
        super(`Falló el envío (${causa})`);
        this.name = 'ErrorTransporte';
        this.causa = causa;
    }
}

/** Opciones del fetch: sin cookies, sin caché y con `targetAddressSpace` sólo hacia la red local. */
function armarInit(peticion, signal) {
    const init = {
        method: peticion.metodo,
        headers: peticion.headers,
        signal,
        credentials: 'omit',
        cache: 'no-store',
    };
    if (peticion.cuerpo != null) init.body = peticion.cuerpo;
    if (esDireccionLocal(peticion.url)) init.targetAddressSpace = 'local';
    return init;
}

/**
 * Arma un transporte que manda una petición con `fetch` y devuelve `{ estado, texto }` (un 4xx/5xx no rechaza).
 * Rechaza con `ErrorTransporte`: 'red' (el fetch falló), 'tiempo' (pasó `tiempoMs`) o 'cancelado' (`senal` abortada).
 * `alProgreso` se ignora: con `fetch` no hay porcentaje de subida.
 * @param {{fetch?: typeof fetch}} [deps] fetch inyectable (por defecto, el global)
 * @returns {(peticion: {metodo: string, url: string, headers: Record<string,string>, cuerpo: any, tiempoMs: number},
 *   opciones?: {senal?: AbortSignal, alProgreso?: Function}) => Promise<{estado: number, texto: string}>}
 */
export function crearTransporte({ fetch: fetchInyectado } = {}) {
    return async function transporte(peticion, { senal } = {}) {
        if (senal?.aborted) throw new ErrorTransporte('cancelado');
        const control = new AbortController();
        let causa = 'red';
        const cortar = motivo => {
            causa = motivo;
            control.abort();
        };
        const alCancelar = () => cortar('cancelado');
        const timer = setTimeout(() => cortar('tiempo'), peticion.tiempoMs);
        senal?.addEventListener('abort', alCancelar);
        try {
            const enviar = fetchInyectado ?? globalThis.fetch;
            const respuesta = await enviar(peticion.url, armarInit(peticion, control.signal));
            return { estado: respuesta.status, texto: await respuesta.text() };
        } catch {
            // Se descarta el error original: podría traer la URL o cabeceras. Sólo importa la causa.
            throw new ErrorTransporte(causa);
        } finally {
            clearTimeout(timer);
            senal?.removeEventListener('abort', alCancelar);
        }
    };
}

/**
 * Sonda sin CORS: ¿hay algo escuchando en esa dirección? Una respuesta opaca alcanza. No manda cabeceras ni cuerpo.
 * @param {string} url
 * @param {typeof fetch} [fetchFn] por defecto, el fetch global
 * @returns {Promise<boolean>} true si el fetch resuelve; false si falla o pasan 4 segundos
 */
export async function sondaSinCors(url, fetchFn) {
    try {
        const enviar = fetchFn ?? globalThis.fetch;
        await enviar(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(TOPE_SONDA_MS) });
        return true;
    } catch {
        return false;
    }
}
