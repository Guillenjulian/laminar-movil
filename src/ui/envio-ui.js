// Envío del G-code a la impresora por red local, desde el paso 4 (ADR 0007, 6.8). Experimental.
// Responsabilidad: mostrar #enviarRed (sólo si la impresora del resultado es de G-code plano y tiene config) y
// #configurarRed (siempre que sea de G-code plano), enviar el MISMO archivo que Descargar (con las pausas de ahora,
// que pide a entrega-ui), mostrar "Enviando…" con Cancelar y dejar el resultado en #estadoEntrega con textContent.
// Nunca esconde Descargar ni Compartir. Con `imprimir` prendido pide confirm() antes de cada envío y nunca reintenta.
// Flujo: main.js llama `iniciarEnvio(ctx)` una vez (ctx trae el repositorio y `enviarGcode` ya con sus deps);
// paso4 llama `actualizarEnvio()` al mostrar el resultado y `cancelarEnvio()` al elegir otro modelo.
// Lee estado.resultado en el momento. No toca el DOM al importarse.

import { estado } from './estado.js';
import { $ } from './util-dom.js';
import { archivoEntrega, entregaDe } from './entrega-ui.js';
import { nombreEntrega } from './entrega.js';

/**
 * @typedef {Object} ContextoEnvio
 * @property {{leer: (impresoraId: string) => Promise<object|null>}} repositorio `crearRepositorioRed(almacen)`.
 * @property {(config: object, archivo: File, nombre: string, opciones?: {senal?: AbortSignal}) => Promise<object>} enviarGcode
 *   `enviarGcode(config, archivo, nombre, deps, opciones)` con `deps` ya aplicadas (nunca lanza).
 * @property {() => void} abrirConfiguracion abre la hoja de red (main: abrirRedHoja).
 */

const CONFIRMAR = '¿Empezar a imprimir ahora? Fijate que la cama esté libre.';
const CON_AYUDA = ['bloqueado', 'sin-llegada']; // errores donde conviene mostrar el plan B de la hoja

let ctx = null;
let control = null; // AbortController del envío en curso; null si no hay
let vez = 0; // número de la última actualización (descarta lecturas viejas)

function mostrarEstado(texto) {
    $('estadoEntrega').textContent = texto;
}

// ¿La impresora del resultado se entrega como G-code plano? (las Bambu no entran en v1)
function esGcodePlano() {
    return !!estado.resultado && entregaDe().formato === 'gcode';
}

function fallo(codigo, mensaje) {
    return { ok: false, error: { codigo, mensaje, pista: '' } };
}

// Deja el resultado a la vista; ante bloqueado/sin-llegada ofrece abrir la hoja (plan B).
function mostrarResultadoEnvio(r) {
    if (r.ok) {
        mostrarEstado(`Listo: subido a la impresora${r.imprimiendo ? ' y empezó a imprimir' : ''}.`);
        return;
    }
    mostrarEstado([r.error.mensaje, r.error.pista].filter(Boolean).join(' '));
    $('ayudaEnvioRed').hidden = !CON_AYUDA.includes(r.error.codigo);
}

// Muestra u oculta el progreso. Al terminar, si el foco estaba en el progreso vuelve a un botón visible.
function progreso(activo) {
    const enfocadoAdentro = $('envioRed').contains(document.activeElement);
    $('progresoEnvioRed').textContent = activo ? 'Enviando…' : '';
    $('cancelarEnvio').hidden = !activo;
    $('enviarRed').disabled = activo;
    if (activo) $('cancelarEnvio').focus();
    else if (enfocadoAdentro) [$('enviarRed'), $('configurarRed')].find(b => !b.hidden)?.focus();
}

// Pide el archivo con las pausas de ahora y lo manda; todo error vuelve como resultado, nunca lanza.
async function subir(config, resultado) {
    try {
        const archivo = await archivoEntrega();
        const nombre = nombreEntrega(resultado.archivo, 'gcode');
        return await ctx.enviarGcode(config, archivo, nombre, { senal: control.signal });
    } catch (err) {
        if (control.signal.aborted) return fallo('cancelado', 'Envío cancelado.');
        return fallo('archivo', `No se pudo armar el archivo: ${err.message}`);
    }
}

// Lee la config y pide confirmación si va a imprimir. null = no se envía.
async function prepararEnvio(resultado) {
    const config = await ctx.repositorio.leer(resultado.impresoraId);
    if (!config) return null;
    return config.imprimir && !confirm(CONFIRMAR) ? null : config;
}

async function enviar() {
    if (control || !esGcodePlano()) return; // doble toque
    const resultado = estado.resultado;
    control = new AbortController();
    mostrarEstado('');
    $('ayudaEnvioRed').hidden = true;
    progreso(true);
    let r = null;
    try {
        const config = await prepararEnvio(resultado);
        if (config) r = await subir(config, resultado);
    } catch {
        r = fallo('config', 'No se pudo leer la configuración de red.');
    } finally {
        control = null;
        progreso(false);
    }
    if (r && estado.resultado === resultado) mostrarResultadoEnvio(r);
    else if (!r) actualizarEnvio();
}

/**
 * Cablea #enviarRed, #configurarRed, #cancelarEnvio y #ayudaEnvioRed una vez (desde main.js).
 * @param {ContextoEnvio} contexto
 * @returns {void}
 */
export function iniciarEnvio(contexto) {
    ctx = contexto;
    $('enviarRed').onclick = enviar;
    $('cancelarEnvio').onclick = () => control?.abort();
    $('configurarRed').onclick = () => ctx.abrirConfiguracion();
    $('ayudaEnvioRed').onclick = () => ctx.abrirConfiguracion();
}

/**
 * Muestra u oculta los botones según `estado.resultado` y la config guardada de su impresora.
 * @returns {Promise<void>}
 */
export async function actualizarEnvio() {
    const mia = ++vez;
    const plano = esGcodePlano();
    $('configurarRed').hidden = !plano;
    $('enviarRed').hidden = true;
    $('ayudaEnvioRed').hidden = true;
    if (!plano) return;
    const config = await ctx.repositorio.leer(estado.resultado.impresoraId).catch(() => null); // ilegible: sólo configurar
    if (mia === vez && esGcodePlano()) $('enviarRed').hidden = !config;
}

/**
 * Cancela un envío en curso, si lo hay (al elegir otro modelo).
 * @returns {void}
 */
export function cancelarEnvio() {
    control?.abort();
    vez++;
    for (const id of ['enviarRed', 'configurarRed', 'ayudaEnvioRed']) $(id).hidden = true;
}
