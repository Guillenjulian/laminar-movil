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

/**
 * Valida una config cruda y renormaliza la dirección; lo que no cumple el formato se descarta.
 * @param {any} crudo
 * @returns {ConfigRed|null} null si no cumple
 */
export function validarConfig(crudo) {
    if (!esObjeto(crudo) || !TIPOS.includes(crudo.tipo) || typeof crudo.claveApi !== 'string') return null;
    if (typeof crudo.direccion !== 'string') return null;
    const dir = normalizarDireccion(crudo.direccion);
    if (!dir.ok) return null;
    return { tipo: crudo.tipo, direccion: dir.direccion, claveApi: crudo.claveApi, imprimir: crudo.imprimir === true };
}

/**
 * Copia segura para logs y mensajes: la clave se oculta.
 * @param {ConfigRed} config
 * @returns {ConfigRed} copia con claveApi '•••' (o '' si no hay)
 */
export function describirConfig(config) {
    return { ...config, claveApi: config.claveApi ? '•••' : '' };
}

/** El registro guardado, o uno vacío si falta o está corrupto (versión, forma). */
async function leerRegistro(almacen) {
    const guardado = await almacen.leerAjuste(CLAVE_AJUSTE);
    if (esObjeto(guardado) && guardado.version === 1 && esObjeto(guardado.porImpresora)) return guardado;
    return { version: 1, porImpresora: {} };
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
            if (!valida) throw new Error('La configuración de red no es válida');
            const registro = await leerRegistro(almacen);
            registro.porImpresora[impresoraId] = valida;
            await almacen.guardarAjuste(CLAVE_AJUSTE, registro);
        },
        async borrar(impresoraId) {
            const registro = await leerRegistro(almacen);
            delete registro.porImpresora[impresoraId];
            await almacen.guardarAjuste(CLAVE_AJUSTE, registro);
        },
    };
}
