// Hoja "Enviar por red local" (ADR 0007, 6.7): tipo, dirección, clave de API, imprimir al terminar,
// Probar conexión, Guardar, Quitar y Abrir la impresora.
//
// Flujo: iniciarRedHoja cablea #hojaRed una vez; abrirRedHoja carga la config de la impresora elegida
// (`estado.impresoraId`, leído en el momento) y abre la hoja. Los módulos de src/red/ llegan inyectados
// por `ctx` (main.js los cablea), así que acá no se importa nada de ellos. La clave de API nunca vuelve
// al DOM: al reabrir el campo queda vacío (vacío = no cambiar, y sólo si la dirección y el tipo no
// cambiaron). Mensajes con textContent. Nada toca el DOM al importarse.

import { estado } from './estado.js';
import { abrirHoja, cerrarHojas, devolverFocoAlCerrar } from './navegacion.js';
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
const ERROR_CLAVE = 'Cambió la dirección o el tipo: escribí la clave de nuevo.';

let ctx = null;
let form = null;
let idActual = ''; // impresora cuya config se está editando
let guardada = null; // config guardada (conserva la clave si el campo queda vacío y nada cambió)
let abridor = null; // elemento que abrió la hoja, para devolverle el foco
let prueba = 0; // número de la última prueba (descarta respuestas viejas)
let abriendo = false; // hay una apertura en curso (doble toque)
let marcarAbierta = null;

function direccionValida() {
    const r = ctx.normalizarDireccion(form.elements.direccion.value);
    return r.ok ? r.direccion : '';
}

function mostrarEstado(texto, esError = false) {
    $('estadoRed').textContent = texto;
    $('estadoRed').classList.toggle('error', esError);
}

// Marca o limpia el campo con error, lo enfoca y muestra el mensaje.
function fallo(campo, texto) {
    campo.setAttribute('aria-invalid', 'true');
    mostrarEstado(texto, true);
    campo.focus();
}

// Config del formulario, o null (con aviso) si la dirección no sirve o falta reescribir la clave.
function leerConfig() {
    const e = form.elements;
    const direccion = direccionValida();
    if (!direccion) return fallo(e.direccion, ERROR_DIRECCION);
    const igual = guardada?.direccion === direccion && guardada?.tipo === e.tipo.value;
    if (!e.claveApi.value && guardada?.claveApi && !igual) return fallo(e.claveApi, ERROR_CLAVE);
    const claveApi = e.claveApi.value || (igual ? guardada.claveApi : '');
    return { tipo: e.tipo.value, direccion, claveApi, imprimir: e.imprimir.checked };
}

function habilitarBotones(si) {
    for (const id of ['probarRed', 'quitarRed']) $(id).disabled = !si;
    form.querySelector('[type=submit]').disabled = !si;
}

async function probar() {
    $('ayudaRed').hidden = true;
    const config = leerConfig();
    if (!config) return;
    const mia = ++prueba;
    $('probarRed').disabled = true;
    mostrarEstado('Probando…');
    try {
        const r = await ctx.probarConexion(config);
        if (mia !== prueba) return;
        if (r.ok) return mostrarEstado(`Conectó con ${r.resumen.nombre}.`);
        mostrarEstado([r.error.mensaje, r.error.pista].filter(Boolean).join(' '), true);
        $('ayudaRed').hidden = !['bloqueado', 'sin-llegada'].includes(r.error.codigo);
    } catch {
        if (mia === prueba) mostrarEstado('No se pudo probar la conexión. Probá de nuevo.', true);
    } finally {
        if (mia === prueba) $('probarRed').disabled = false;
    }
}

// Guarda o quita (según `accion`) sin doble toque; si falla avisa y deja todo como estaba.
async function persistir(accion, fallido) {
    habilitarBotones(false);
    try {
        await accion();
        ctx.alGuardar();
        cerrarHojas();
    } catch {
        mostrarEstado(fallido, true);
    } finally {
        habilitarBotones(true);
    }
}

function guardar(e) {
    e.preventDefault();
    const config = leerConfig();
    if (config) persistir(() => ctx.repositorio.guardar(idActual, config), 'No se pudo guardar. Probá de nuevo.');
}

function abrirImpresora() {
    const direccion = direccionValida();
    if (direccion) window.open(direccion, '_blank', 'noopener');
}

function alternarClave() {
    const ver = $('verClaveRed').getAttribute('aria-pressed') !== 'true';
    $('verClaveRed').setAttribute('aria-pressed', String(ver));
    $('verClaveRed').setAttribute('aria-label', ver ? 'Ocultar la clave' : 'Mostrar la clave');
    $('verClaveRed').textContent = ver ? 'Ocultar' : 'Mostrar';
    form.elements.claveApi.type = ver ? 'text' : 'password';
}

// Al cerrar la hoja: se descarta la prueba en vuelo y la clave guardada sale de memoria.
function alCerrar() {
    prueba++;
    guardada = null;
    form.elements.claveApi.value = ''; // la clave tipeada no queda en el campo
    habilitarBotones(true);
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
        form.elements.direccion.removeAttribute('aria-invalid');
        $('abrirImpresoraRed').disabled = !direccionValida();
    });
    form.elements.claveApi.addEventListener('input', () => form.elements.claveApi.removeAttribute('aria-invalid'));
    form.addEventListener('submit', guardar);
    $('probarRed').onclick = probar;
    $('quitarRed').onclick = () =>
        persistir(() => ctx.repositorio.borrar(idActual), 'No se pudo quitar. Probá de nuevo.');
    $('abrirImpresoraRed').onclick = abrirImpresora;
    $('verClaveRed').onclick = alternarClave;
    marcarAbierta = devolverFocoAlCerrar(
        'hojaRed',
        () => abridor,
        () => $('configurarRed'),
        alCerrar,
    );
}

function rellenar(config) {
    const e = form.elements;
    e.tipo.value = config?.tipo || 'octoprint';
    e.direccion.value = config?.direccion || '';
    e.claveApi.value = '';
    e.claveApi.placeholder = config?.claveApi ? 'guardada' : '';
    e.claveApi.type = 'password';
    e.imprimir.checked = !!config?.imprimir;
    for (const c of [e.direccion, e.claveApi]) c.removeAttribute('aria-invalid');
    $('verClaveRed').setAttribute('aria-pressed', 'false');
    $('verClaveRed').setAttribute('aria-label', 'Mostrar la clave');
    $('verClaveRed').textContent = 'Mostrar';
    $('quitarRed').hidden = !config;
    $('ayudaRed').hidden = true;
    mostrarEstado('');
    $('abrirImpresoraRed').disabled = !direccionValida();
}

/**
 * Carga la config de la impresora elegida (`estado.impresoraId`) y abre la hoja.
 * @returns {Promise<void>}
 */
export async function abrirRedHoja() {
    if (abriendo) return;
    abriendo = true;
    abridor = document.activeElement;
    prueba++;
    $('probarRed').disabled = false;
    try {
        const id = estado.impresoraId;
        let leida = null;
        try {
            leida = await ctx.repositorio.leer(id);
        } catch {
            leida = null; // sin config legible: se abre vacía
        }
        idActual = id;
        guardada = leida;
        rellenar(guardada);
        $('impresoraRed').textContent = `Impresora: ${buscarImpresora(id).nombre}`;
        abrirHoja('red');
        marcarAbierta();
        form.elements.tipo.focus();
    } finally {
        abriendo = false;
    }
}
