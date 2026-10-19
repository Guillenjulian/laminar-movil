// Dirección de la impresora (ADR 0007, 6.1 y sección 5): valida y normaliza lo que escribe el usuario y dice si la
// dirección es "local". Puro: sin imports, sin DOM, sin red.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const SUFIJOS_LOCALES = ['.local', '.lan', '.home.arpa'];

/** Host sin corchetes (IPv6) y en minúsculas, o null si no se puede leer la URL. */
function hostDe(url) {
    try {
        return new URL(url).hostname
            .toLowerCase()
            .replace(/^\[|\]$/g, '')
            .replace(/\.$/, '');
    } catch {
        return null;
    }
}

/** `localhost` y `*.localhost`. */
function esLoopback(host) {
    return host === 'localhost' || host.endsWith('.localhost');
}

/** IPv4 privada: 10/8, 172.16/12 o 192.168/16. */
function esIpv4Privada(host) {
    const m = IPV4.exec(host);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** IPv6 local: fc00::/7 (únicas locales) o fe80::/10 (de enlace). El URL ya la deja en forma canónica. */
function esIpv6Local(host) {
    return host.includes(':') && /^(f[cd]|fe[89ab])[0-9a-f]{0,2}:/.test(host);
}

/**
 * Dice si una dirección apunta a la red local: IPv4 privada, `.local`, `.lan`, `.home.arpa`, un nombre de una sola
 * etiqueta o IPv6 fc00::/7 / fe80::/10. La usa el transporte para decidir `targetAddressSpace: 'local'`.
 * @param {string} url dirección completa (con esquema)
 * @returns {boolean}
 */
export function esDireccionLocal(url) {
    const host = hostDe(url);
    if (!host) return false;
    if (esIpv4Privada(host) || esIpv6Local(host)) return true;
    if (IPV4.test(host) || host.includes(':')) return false; // IP pública o loopback
    if (esLoopback(host)) return false; // loopback, no es la red local
    if (SUFIJOS_LOCALES.some(s => host.endsWith(s))) return true;
    return !host.includes('.'); // "octopi" a secas
}

/** Es un nombre de host (no una IP literal, ni loopback) y tiene al menos un punto. */
function esNombreConPunto(host) {
    return host.includes('.') && !IPV4.test(host) && !host.includes(':') && !esLoopback(host);
}

/** Agrega `http://` si el usuario no escribió esquema. "octopi:5000" no es un esquema: es host y puerto. */
function conEsquema(texto) {
    return /^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i.test(texto) ? texto : `http://${texto}`;
}

/**
 * Valida y normaliza lo que escribió el usuario. Acepta sólo http/https, sin usuario ni contraseña, query ni
 * fragmento; saca las barras finales y conserva el prefijo de ruta. El motivo nunca repite lo escrito.
 * `nombreSinLocal`: es http y el host tiene punto pero no es una dirección local (ni IP privada, ni `.local`):
 * Chrome no lo exime del contenido mixto sin `targetAddressSpace` (ver decisión 5).
 * @param {string} texto
 * @returns {{ok: true, direccion: string, http: boolean, nombreSinLocal: boolean} | {ok: false, motivo: string}}
 */
export function normalizarDireccion(texto) {
    const crudo = String(texto ?? '').trim();
    if (!crudo) return { ok: false, motivo: 'Escribí la dirección de la impresora.' };
    if (/[?#]/.test(crudo)) return { ok: false, motivo: 'La dirección no puede llevar "?" ni "#".' };
    let url;
    try {
        url = new URL(conEsquema(crudo));
    } catch {
        return { ok: false, motivo: 'No se entiende la dirección. Probá con algo como 192.168.1.50.' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, motivo: 'La dirección tiene que empezar con http:// o https://.' };
    }
    if (url.username || url.password) {
        return { ok: false, motivo: 'La dirección no puede llevar usuario ni contraseña; la clave va aparte.' };
    }
    const host = url.hostname.replace(/\.$/, ''); // "x.local." es lo mismo que "x.local"
    const puerto = url.port ? `:${url.port}` : '';
    const direccion = `${url.protocol}//${host}${puerto}${url.pathname.replace(/\/+$/, '')}`;
    const http = url.protocol === 'http:';
    const nombreSinLocal = http && esNombreConPunto(host.replace(/^\[|\]$/g, '')) && !esDireccionLocal(direccion);
    return { ok: true, direccion, http, nombreSinLocal };
}
