// Sección "Cambios por altura" del paso 2 (ADR 0002): a partir de cierta altura (mm) cambia el relleno,
// la temperatura, la velocidad o el ventilador. Imita a avanzado.js: dependencias inyectadas.
// Flujo: crearCambios({ estado, alCambiar }) -> dibujar() lee estado.cambios y estado.avanzado en el momento;
// cada edición modifica estado.cambios (no se persiste: depende del modelo), valida con validarCambios y
// muestra los errores en castellano. paso3-laminar.js pasa estado.cambios a armarConfiguracion.
// Hoja de nivel 0: no toca el DOM al importarse.

import { validarCambios, resumenCambios as detalleCambios } from '../perfiles/cambios.js';
import { $, escapar } from './util-dom.js';

const MAX_CAMBIOS = 8;
// Propiedad -> etiqueta, unidad, factor (relleno se guarda 0..1 y se ve en %), límites, paso y valor inicial.
const PROPIEDADES = {
    relleno: { texto: 'Relleno', unidad: '%', factor: 100, min: 0, max: 100, paso: 5, inicial: 0.2 },
    tempBoquilla: { texto: 'Temperatura', unidad: '°C', factor: 1, min: 150, max: 300, paso: 5, inicial: 210 },
    velocidad: {
        texto: 'Velocidad',
        unidad: '%',
        factor: 1,
        min: 50,
        max: 150,
        paso: 5,
        inicial: 100,
        ayuda: 'porcentaje de la velocidad configurada; el tope de caudal de la impresora puede limitarla',
    },
    ventilador: { texto: 'Ventilador', unidad: '%', factor: 1, min: 0, max: 100, paso: 5, inicial: 100 },
};

/**
 * Texto para el <summary> ("2 cambios" / "1 cambio" / "Sin cambios").
 * @param {object[]} cambios lista de cambios
 * @returns {string}
 */
export function resumenCambios(cambios) {
    const n = Array.isArray(cambios) ? cambios.length : 0;
    return n === 0 ? 'Sin cambios' : n === 1 ? '1 cambio' : `${n} cambios`;
}

/** Lee un número escrito con coma o punto (null si está vacío: validarCambios lo informa).
 *  @param {string} texto @returns {number|null} */
const leerNumero = texto => (texto.trim() === '' ? null : Number(texto.replace(',', '.')));

/** El error de relleno de perfiles/cambios.js habla en fracción (0 a 1): en pantalla va en %.
 *  @param {string} error @returns {string} */
const enPorcentaje = error => error.replace('relleno fuera de rango (0 a 1)', 'relleno fuera de rango (0 a 100 %)');

/** HTML de una propiedad de un cambio: casilla "cambiar" + valor con su unidad.
 *  @param {number} i @param {object} c @param {string} clave @param {boolean} apagado @returns {string} */
function filaPropiedad(i, c, clave, apagado) {
    const p = PROPIEDADES[clave];
    const activa = c[clave] !== undefined;
    const valor = verValor(c, clave);
    const sinValor = apagado || !activa ? 'disabled' : '';
    const ayuda = p.ayuda ? `<small>${p.ayuda}</small>` : '';
    const vacio = activa && !apagado && valor === '' ? '' : 'hidden';
    return `<div class="cambio-bloque"><div class="cambio-prop">
        <label><input type="checkbox" data-i="${i}" data-on="${clave}" ${activa ? 'checked' : ''} ${apagado ? 'disabled' : ''}> ${p.texto}</label>
        <span><input type="number" inputmode="decimal" aria-label="${p.texto} (${p.unidad})" data-i="${i}" data-k="${clave}"
            min="${p.min}" max="${p.max}" step="${p.paso}" value="${valor}" ${sinValor}> ${p.unidad}</span>
    </div>${ayuda}<small data-sinvalor ${vacio}>sin valor: se ignora</small></div>`;
}

/** Texto accesible de "Quitar". @param {number|string} desde altura (mm) o '' @returns {string} */
const etiquetaQuitar = desde => (desde === '' ? 'Quitar este cambio' : `Quitar el cambio desde ${desde} mm`);

/** HTML de un cambio (altura "desde" + propiedades + Quitar). @param {number} i @param {object} c
 *  @param {boolean} apagado todo deshabilitado @param {boolean} jarron sin relleno @returns {string} */
function filaCambio(i, c, apagado, jarron) {
    const props = Object.keys(PROPIEDADES).map(k => filaPropiedad(i, c, k, apagado || (jarron && k === 'relleno')));
    const desde = Number.isFinite(c.desdeMm) ? c.desdeMm : '';
    const off = apagado ? 'disabled' : '';
    return `<div class="cambio">
        <div class="cambio-cabeza">
            <label>Desde <input type="number" inputmode="decimal" aria-label="Altura desde (mm)" data-i="${i}" data-k="desdeMm"
                min="0" max="1000" step="0.5" value="${desde}" ${off}> mm</label>
            <button type="button" class="boton enlace" data-quitar="${i}" aria-label="${etiquetaQuitar(desde)}" ${off}>Quitar</button>
        </div>
        ${props.join('')}
    </div>`;
}

/** Aplica al cambio lo que el usuario tocó (casilla "cambiar", altura o valor de una propiedad).
 *  @param {object} c cambio @param {HTMLInputElement} campo @returns {void} */
function aplicarEdicion(c, campo) {
    const { k, on } = campo.dataset;
    if (on) {
        if (campo.checked) c[on] = PROPIEDADES[on].inicial;
        else delete c[on];
    } else if (k === 'desdeMm') c.desdeMm = leerNumero(campo.value);
    else {
        const v = leerNumero(campo.value);
        c[k] = v === null ? null : v / PROPIEDADES[k].factor;
    }
}

/** Valor que se ve en el campo de una propiedad ('' si no tiene). @param {object} c @param {string} k @returns {string|number} */
const verValor = (c, k) => (Number.isFinite(c[k]) ? Math.round(c[k] * PROPIEDADES[k].factor * 100) / 100 : '');

/** Errores, detalle y <summary>. @param {object} estado @returns {void} */
function dibujarResumen(estado) {
    const lista = estado.cambios;
    const { alturaVariable, jarron } = estado.avanzado || {};
    const { cambios: ok, errores } = validarCambios(lista);
    $('cambErrores').hidden = Boolean(alturaVariable && !jarron) || errores.length === 0;
    $('cambErrores').innerHTML = errores.map(e => `<div>${escapar(enPorcentaje(e))}</div>`).join('');
    $('cambDetalle').textContent = ok.length ? detalleCambios(ok) : '';
    const resumen = lista.length ? `Cambios por altura: ${resumenCambios(lista)}` : 'Cambios por altura';
    $('cambiosAltura').querySelector('summary').textContent = resumen;
}

/** Redibuja la lista, los carteles y el resumen; enfoca `enfocar` si se pasa (selector).
 *  @param {object} estado @param {string} enfocar @returns {void} */
function dibujarTodo(estado, enfocar) {
    const lista = estado.cambios;
    const { alturaVariable, jarron } = estado.avanzado || {};
    const off = Boolean(alturaVariable && !jarron);
    $('cambLista').innerHTML = lista.map((c, i) => filaCambio(i, c, off, Boolean(jarron))).join('');
    $('cambAgregar').disabled = off || lista.length >= MAX_CAMBIOS;
    $('cambAlturaVariable').hidden = !off;
    $('cambJarron').hidden = !jarron;
    dibujarResumen(estado);
    if (enfocar) ($('cambLista').querySelector(enfocar) || document.querySelector(enfocar))?.focus();
}

/** Edita un cambio desde su campo sin redibujar la lista (conserva el foco y el toque en "Quitar").
 *  @param {object} c cambio @param {HTMLInputElement} campo @returns {void} */
function editarCampo(c, campo) {
    aplicarEdicion(c, campo);
    if (campo.dataset.k === 'desdeMm') {
        const desde = Number.isFinite(c.desdeMm) ? c.desdeMm : '';
        campo.closest('.cambio').querySelector('[data-quitar]').setAttribute('aria-label', etiquetaQuitar(desde));
    }
    if (!campo.dataset.on) return;
    const numero = campo.closest('.cambio-prop').querySelector('[data-k]');
    numero.disabled = !campo.checked;
    numero.value = verValor(c, campo.dataset.on);
}

/** Muestra "sin valor: se ignora" junto a las propiedades tildadas con el campo vacío.
 *  @returns {void} */
function marcarSinValor() {
    for (const fila of $('cambLista').querySelectorAll('.cambio-bloque')) {
        const campo = fila.querySelector('[data-k]');
        const tildada = fila.querySelector('[data-on]').checked;
        fila.querySelector('[data-sinvalor]').hidden = !tildada || campo.disabled || campo.value.trim() !== '';
    }
}

/**
 * Arma la sección. Dibuja desde `estado.cambios` y `estado.avanzado`; `alCambiar` se llama tras cada edición.
 * Agregar y quitar redibujan la lista y dejan el foco en un campo cercano; editar sólo actualiza errores y resumen.
 * @param {{ estado: object, alCambiar: () => void }} deps
 * @returns {{ dibujar: (enfocar?: string) => void }} `enfocar`: selector (de la lista o `#id`) a enfocar
 */
export function crearCambios({ estado, alCambiar = () => {} }) {
    const dibujar = (enfocar = '') => dibujarTodo(estado, enfocar);
    const modificar = (accion, enfocar) => {
        accion(estado.cambios);
        dibujar(enfocar);
        alCambiar();
    };

    $('cambLista').addEventListener('change', e => {
        const c = estado.cambios[e.target.dataset.i];
        if (!c) return;
        editarCampo(c, e.target);
        marcarSinValor();
        dibujarResumen(estado);
        alCambiar();
    });
    $('cambLista').addEventListener('click', e => {
        const i = e.target.closest('[data-quitar]')?.dataset.quitar;
        if (i === undefined) return;
        // Tras quitar: el cambio que ocupa su lugar o, si era el último, "Agregar cambio".
        const hayOtro = Number(i) < estado.cambios.length - 1;
        modificar(lista => lista.splice(Number(i), 1), hayOtro ? `[data-i="${i}"][data-k="desdeMm"]` : '#cambAgregar');
    });
    $('cambAgregar').addEventListener('click', () => {
        const nueva = estado.cambios.length;
        modificar(lista => {
            const ultimo = lista.at(-1)?.desdeMm;
            lista.push({ desdeMm: Number.isFinite(ultimo) ? ultimo + 5 : 5, relleno: PROPIEDADES.relleno.inicial });
        }, `[data-i="${nueva}"][data-k="desdeMm"]`);
    });
    return { dibujar };
}
