// Configuración del envío por red local, por impresora (ADR 0007, 6.6 y sección 3). Vive en una sola clave de ajustes
// (`redImpresoras`), sólo en este celu. La clave de API nunca se escribe en consola ni en mensajes de error: para
// mostrar una config hay que pasar por `describirConfig`.
import { normalizarDireccion } from './direccion.js';

/** @typedef {{tipo: 'octoprint'|'moonraker', direccion: string, claveApi: string, imprimir: boolean}} ConfigRed */
/** @typedef {{leerAjuste: (clave: string) => Promise<any>, guardarAjuste: (clave: string, valor: any) => Promise<void>}} AlmacenAjustes */

/** Clave de ajustes donde se guardan todas las configuraciones. */
export const CLAVE_AJUSTE = 'redImpresoras';
const TIPOS = ['octoprint', 'moonraker'];
const esObjeto = x => x !== null && typeof x === 'object' && !Array.isArray(x);

/** ¿La clave sirve como valor de una cabecera HTTP? Sólo Latin-1 imprimible (sin control, saltos ni DEL). */
const esValorDeCabecera = clave => /^[\x20-\x7e\xa0-\xff]*$/.test(clave);

/** Aviso para quien guarda una clave que no viaja en una cabecera (nunca repite la clave). */
const AVISO_CLAVE =
    'La clave de API tiene caracteres que no se pueden enviar (saltos de línea, tabulaciones o símbolos raros)';

/**
 * Valida una config cruda y renormaliza la dirección; lo que no cumple el formato se descarta.
 * La clave se recorta (trim) y se descarta si tiene caracteres que no van en una cabecera HTTP.
 * @param {any} crudo
 * @returns {ConfigRed|null} null si no cumple
 */
export function validarConfig(crudo) {
    if (!esObjeto(crudo) || !TIPOS.includes(crudo.tipo) || typeof crudo.claveApi !== 'string') return null;
    if (typeof crudo.direccion !== 'string') return null;
    const claveApi = crudo.claveApi.trim();
    if (!esValorDeCabecera(claveApi)) return null;
    const dir = normalizarDireccion(crudo.direccion);
    if (!dir.ok) return null;
    return { tipo: crudo.tipo, direccion: dir.direccion, claveApi, imprimir: crudo.imprimir === true };
}

/**
 * Copia segura para logs y mensajes: sólo los campos conocidos y la clave oculta.
 * @param {ConfigRed|null|undefined} config
 * @returns {Partial<ConfigRed>|''} copia con claveApi '•••' (o '' si no hay); '' si no hay config
 */
export function describirConfig(config) {
    if (!esObjeto(config)) return '';
    const { tipo, direccion, imprimir, claveApi } = config;
    return { tipo, direccion, claveApi: claveApi ? '•••' : '', imprimir };
}

/** Registro vacío, sin prototipo: así ids como `__proto__` o `constructor` son claves comunes. */
const registroVacio = () => ({ version: 1, porImpresora: Object.create(null) });

/**
 * El registro guardado (al escribir, con `porImpresora` sin prototipo). Uno corrupto (forma o versión menor) se reemplaza por uno
 * vacío al guardar; uno de versión MAYOR (de una app más nueva) se lee como vacío pero `paraEscribir` lo rechaza.
 */
async function leerRegistro(almacen, paraEscribir = false) {
    const guardado = await almacen.leerAjuste(CLAVE_AJUSTE);
    if (paraEscribir && esObjeto(guardado) && Number.isInteger(guardado.version) && guardado.version > 1) {
        throw new Error('Configuración de una versión más nueva de la app');
    }
    if (!esObjeto(guardado) || guardado.version !== 1 || !esObjeto(guardado.porImpresora)) return registroVacio();
    if (!paraEscribir) return guardado;
    return { version: 1, porImpresora: Object.assign(Object.create(null), guardado.porImpresora) };
}

/**
 * Repositorio de configuraciones por impresora sobre el almacén de ajustes.
 * @param {AlmacenAjustes} almacen
 * @returns {{leer: (impresoraId: string) => Promise<ConfigRed|null>,
 *   guardar: (impresoraId: string, config: ConfigRed) => Promise<void>,
 *   borrar: (impresoraId: string) => Promise<void>}}
 */
export function crearRepositorioRed(almacen) {
    return {
        async leer(impresoraId) {
            const { porImpresora } = await leerRegistro(almacen);
            return Object.hasOwn(porImpresora, impresoraId) ? validarConfig(porImpresora[impresoraId]) : null;
        },
        async guardar(impresoraId, config) {
            const valida = validarConfig(config);
            if (!valida) {
                const claveMala = typeof config?.claveApi === 'string' && !esValorDeCabecera(config.claveApi.trim());
                throw new Error(claveMala ? AVISO_CLAVE : 'La configuración de red no es válida');
            }
            const registro = await leerRegistro(almacen, true);
            registro.porImpresora[impresoraId] = valida;
            await almacen.guardarAjuste(CLAVE_AJUSTE, registro);
        },
        async borrar(impresoraId) {
            const registro = await leerRegistro(almacen, true);
            delete registro.porImpresora[impresoraId];
            await almacen.guardarAjuste(CLAVE_AJUSTE, registro);
        },
    };
}
