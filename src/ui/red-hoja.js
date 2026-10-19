// Hoja "Enviar por red local" (ADR 0007, 6.7): tipo, dirección, clave de API, imprimir al terminar,
// Probar conexión, Guardar, Quitar y Abrir la impresora.
//
// Flujo: iniciarRedHoja cablea #hojaRed una vez; abrirRedHoja carga la config de la impresora elegida
// (`estado.impresoraId`, leído en el momento) y abre la hoja. Los módulos de src/red/ llegan inyectados
// por `ctx` (main.js los cablea), así que acá no se importa nada de ellos. La clave de API nunca vuelve
// al DOM: al reabrir el campo queda vacío (vacío = no cambiar). Mensajes con textContent.
// Nada toca el DOM al importarse.

import { estado } from './estado.js';
import { abrirHoja, cerrarHojas } from './navegacion.js';
import { $ } from './util-dom.js';
import { buscarImpresora } from '../perfiles/perfiles.js';

/**
 * @typedef {Object} ContextoRed
 * @property {() => void} alGuardar se llama tras guardar o quitar (main: actualizarEnvio).
 * @property {{leer: Function, guardar: Function, borrar: Function}} repositorio `crearRepositorioRed(almacen)`.
 * @property {(config: object) => Promise<object>} probarConexion `probarConexion(config, deps)` con deps ya aplicadas.
 * @property {(texto: string) => {ok: boolean, direccion?: string, motivo?: string}} normalizarDireccion
 */

const ERROR_DIRECCION = 'La dirección no es válida. Probá con algo como http://192.168.1.50';

let ctx = null;
let form = null;
let idActual = ''; // impresora cuya config se está editando
let guardada = null; // config guardada (conserva la clave si el campo queda vacío)
let abridor = null; // elemento que abrió la hoja, para devolverle el foco
let prueba = 0; // número de la última prueba (descarta respuestas viejas)

function direccionValida() {
    const r = ctx.normalizarDireccion(form.elements.direccion.value);
    return r.ok ? r.direccion : '';
}

function mostrarEstado(texto, esError = false) {
    const el = $('estadoRed');
    el.textContent = texto;
    el.classList.toggle('error', esError);
}

function configActual(direccion) {
    const e = form.elements;
    return {
        tipo: e.tipo.value,
        direccion,
        claveApi: e.claveApi.value || guardada?.claveApi || '',
        imprimir: e.imprimir.checked,
    };
}

async function probar() {
    const direccion = direccionValida();
    $('ayudaRed').hidden = true;
    if (!direccion) return mostrarEstado(ERROR_DIRECCION, true);
    const mia = ++prueba;
    $('probarRed').disabled = true;
    mostrarEstado('Probando…');
    const r = await ctx.probarConexion(configActual(direccion));
    if (mia !== prueba) return;
    $('probarRed').disabled = false;
    if (r.ok) return mostrarEstado(`Conectó con ${r.resumen.nombre}.`);
    mostrarEstado([r.error.mensaje, r.error.pista].filter(Boolean).join(' '), true);
    $('ayudaRed').hidden = !['bloqueado', 'sin-llegada'].includes(r.error.codigo);
}

async function guardar(e) {
    e.preventDefault();
    const direccion = direccionValida();
    if (!direccion) return mostrarEstado(ERROR_DIRECCION, true);
    await ctx.repositorio.guardar(idActual, configActual(direccion));
    ctx.alGuardar();
    cerrarHojas();
}

async function quitar() {
    await ctx.repositorio.borrar(idActual);
    ctx.alGuardar();
    cerrarHojas();
}

function abrirImpresora() {
    const direccion = direccionValida();
    if (direccion) window.open(direccion, '_blank', 'noopener');
}

// Al cerrarse la hoja (botón o atrás del celu) el foco vuelve a quien la abrió.
function devolverFoco() {
    let abierta = false;
    new MutationObserver(() => {
        const ahora = !$('hojaRed').hidden;
        if (abierta && !ahora) abridor?.focus?.();
        abierta = ahora;
    }).observe($('hojaRed'), { attributes: true, attributeFilter: ['hidden'] });
}

/**
 * Cablea la hoja una vez (desde main.js).
 * @param {ContextoRed} contexto funciones de config-red y cliente, ya con sus dependencias.
 * @returns {void}
 */
export function iniciarRedHoja(contexto) {
    ctx = contexto;
    form = $('formRed');
    $('origenRed').textContent = location.origin;
    form.elements.direccion.addEventListener('input', () => {
        $('abrirImpresoraRed').disabled = !direccionValida();
    });
    form.addEventListener('submit', guardar);
    $('probarRed').onclick = probar;
    $('quitarRed').onclick = quitar;
    $('abrirImpresoraRed').onclick = abrirImpresora;
    devolverFoco();
}

/**
 * Carga la config de la impresora elegida (`estado.impresoraId`) y abre la hoja.
 * @returns {Promise<void>}
 */
export async function abrirRedHoja() {
    abridor = document.activeElement;
    idActual = estado.impresoraId;
    guardada = await ctx.repositorio.leer(idActual);
    const e = form.elements;
    e.tipo.value = guardada?.tipo || 'octoprint';
    e.direccion.value = guardada?.direccion || '';
    e.claveApi.value = '';
    e.claveApi.placeholder = guardada?.claveApi ? 'guardada' : '';
    e.imprimir.checked = !!guardada?.imprimir;
    $('impresoraRed').textContent = `Impresora: ${buscarImpresora(idActual).nombre}`;
    $('quitarRed').hidden = !guardada;
    $('ayudaRed').hidden = true;
    mostrarEstado('');
    $('abrirImpresoraRed').disabled = !direccionValida();
    abrirHoja('red');
    e.tipo.focus();
}
