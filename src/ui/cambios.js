// Sección "Cambios por altura" del paso 2 (ADR 0002): a partir de cierta altura (mm) cambia el relleno,
// la temperatura, la velocidad o el ventilador. Imita a avanzado.js: dependencias inyectadas.
// Flujo: crearCambios({ estado, alCambiar }) -> dibujar() lee estado.cambios y estado.avanzado en el momento;
// cada edición modifica estado.cambios (no se persiste: depende del modelo), valida con validarCambios y
// muestra los errores en castellano. paso3-laminar.js pasa estado.cambios a armarConfiguracion.
// Hoja de nivel 0: no toca el DOM al importarse.

import { validarCambios, resumenCambios as detalleCambios } from '../perfiles/cambios.js';
import { $ } from './util-dom.js';

const MAX_CAMBIOS = 8;
// Propiedad -> etiqueta, unidad, factor (relleno se guarda 0..1 y se ve en %), límites, paso y valor inicial.
const PROPIEDADES = {
    relleno: { texto: 'Relleno', unidad: '%', factor: 100, min: 0, max: 100, paso: 5, inicial: 0.2 },
    tempBoquilla: { texto: 'Temperatura', unidad: '°C', factor: 1, min: 150, max: 300, paso: 5, inicial: 210 },
    velocidad: { texto: 'Velocidad', unidad: '%', factor: 1, min: 50, max: 150, paso: 5, inicial: 100 },
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

/** Lee un número escrito con coma o punto (NaN si está vacío). @param {string} texto @returns {number} */
const leerNumero = texto => (texto.trim() === '' ? NaN : Number(texto.replace(',', '.')));

/** HTML de una propiedad de un cambio: casilla "cambiar" + valor con su unidad.
 *  @param {number} i @param {object} c @param {string} clave @param {boolean} apagado @returns {string} */
function filaPropiedad(i, c, clave, apagado) {
    const p = PROPIEDADES[clave];
    const activa = c[clave] !== undefined;
    const valor = activa ? Math.round(c[clave] * p.factor * 100) / 100 : '';
    const sinValor = apagado || !activa ? 'disabled' : '';
    return `<div class="cambio-prop">
        <label><input type="checkbox" data-i="${i}" data-on="${clave}" ${activa ? 'checked' : ''} ${apagado ? 'disabled' : ''}> ${p.texto}</label>
        <span><input type="number" inputmode="decimal" aria-label="${p.texto} (${p.unidad})" data-i="${i}" data-k="${clave}"
            min="${p.min}" max="${p.max}" step="${p.paso}" value="${valor}" ${sinValor}> ${p.unidad}</span>
    </div>`;
}

/** HTML de un cambio (altura "desde" + propiedades + Quitar). @param {number} i @param {object} c
 *  @param {boolean} apagado @returns {string} */
function filaCambio(i, c, apagado) {
    const props = Object.keys(PROPIEDADES).map(k => filaPropiedad(i, c, k, apagado));
    const desde = Number.isFinite(c.desdeMm) ? c.desdeMm : '';
    const off = apagado ? 'disabled' : '';
    return `<div class="cambio">
        <div class="cambio-cabeza">
            <label>Desde <input type="number" inputmode="decimal" aria-label="Altura desde (mm)" data-i="${i}" data-k="desdeMm"
                min="0" max="1000" step="0.5" value="${desde}" ${off}> mm</label>
            <button type="button" class="boton enlace" data-quitar="${i}" ${off}>Quitar</button>
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
    else c[k] = leerNumero(campo.value) / PROPIEDADES[k].factor;
}

/**
 * Arma la sección. Dibuja desde `estado.cambios` y `estado.avanzado`; `alCambiar` se llama tras cada edición.
 * @param {{ estado: object, alCambiar: () => void }} deps
 * @returns {{ dibujar: () => void }}
 */
export function crearCambios({ estado, alCambiar = () => {} }) {
    const apagado = () => Boolean(estado.avanzado?.alturaVariable && !estado.avanzado?.jarron);

    function dibujar() {
        const lista = estado.cambios;
        const off = apagado();
        $('cambLista').innerHTML = lista.map((c, i) => filaCambio(i, c, off)).join('');
        $('cambAgregar').disabled = off || lista.length >= MAX_CAMBIOS;
        $('cambAlturaVariable').hidden = !off;
        const { cambios: ok, errores } = validarCambios(lista);
        $('cambErrores').hidden = off || errores.length === 0;
        $('cambErrores').innerHTML = errores.map(e => `<div>${e}</div>`).join('');
        $('cambDetalle').textContent = ok.length ? detalleCambios(ok) : '';
        const resumen = lista.length ? `Cambios por altura: ${resumenCambios(lista)}` : 'Cambios por altura';
        $('cambiosAltura').querySelector('summary').textContent = resumen;
    }

    function modificar(accion) {
        accion(estado.cambios);
        dibujar();
        alCambiar();
    }

    $('cambLista').addEventListener('change', e => {
        const c = estado.cambios[e.target.dataset.i];
        if (c) modificar(() => aplicarEdicion(c, e.target));
    });
    $('cambLista').addEventListener('click', e => {
        const quitar = e.target.closest('[data-quitar]');
        if (quitar) modificar(lista => lista.splice(Number(quitar.dataset.quitar), 1));
    });
    $('cambAgregar').addEventListener('click', () =>
        modificar(lista => {
            const ultimo = lista.at(-1)?.desdeMm;
            lista.push({ desdeMm: Number.isFinite(ultimo) ? ultimo + 5 : 5, relleno: PROPIEDADES.relleno.inicial });
        }),
    );
    return { dibujar };
}
