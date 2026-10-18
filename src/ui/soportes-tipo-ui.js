// Selector del tipo de soporte del paso 2 (ADR 0004, sección 3): 'no' | 'normal' | 'arbol'.
//
// Responsabilidad: dibujar las tres opciones de #tipoSoportes (radios con una línea de ayuda cada una), guardar la
// elegida en `estado.soportes` (siempre pasada por `normalizarSoportes`) y avisar con `alCambiar`. Si el tipo no es
// 'no' y hay zonas sin soporte marcadas, lo dice en #tipoSoportesZonas ("N zonas sin soporte"). No conoce el panel
// de zonas del paso 1: cuenta las zonas leyendo `estado`. Importarlo no toca el DOM.
//
// Flujo: crearTipoSoportes(ctx) -> conectar() cablea el cambio (una vez) -> dibujar() marca el tipo de
// `estado.soportes` (llamar al entrar al paso 2 y tras cargar preferencias).

import { TIPOS_SOPORTE, normalizarSoportes } from '../perfiles/soportes.js';
import { estado } from './estado.js';
import { $ } from './util-dom.js';

/** Texto de cada opción: nombre y línea de ayuda. */
export const OPCIONES_SOPORTE = {
    no: { nombre: 'No', ayuda: 'Sin soportes. La impresión más rápida; los voladizos quedan en el aire.' },
    normal: { nombre: 'Normal', ayuda: 'Columnas desde la cama. Firmes, pero gastan más filamento y tardan más.' },
    arbol: {
        nombre: 'Árbol',
        ayuda: 'Ramas finas que apoyan sólo donde hace falta. Menos material y más fáciles de quitar.',
    },
};

/**
 * Texto de las zonas sin soporte para el paso 2 y el paso 4.
 * @param {number} n cantidad de zonas
 * @returns {string} '' | '1 zona sin soporte' | 'N zonas sin soporte'
 */
export function textoZonasSinSoporte(n) {
    if (!n) return '';
    return n === 1 ? '1 zona sin soporte' : `${n} zonas sin soporte`;
}

/**
 * Cuántas zonas sin soporte cuentan en total (todas las piezas): 0 si el tipo es 'no'. Lee `estado` en el momento.
 * @returns {number}
 */
export function zonasVigentes() {
    if (normalizarSoportes(estado.soportes) === 'no') return 0;
    return estado.piezas.reduce((suma, p) => suma + (p.bloqueos?.length ?? 0), 0);
}

/**
 * Crea el selector de tipo de soporte. No toca el DOM hasta `conectar()`.
 * @param {object} ctx
 * @param {() => void} ctx.alCambiar se llama tras cambiar `estado.soportes` (paso2 guarda preferencias)
 * @returns {{conectar: () => void, dibujar: () => void}}
 *   `conectar()` cablea el cambio de opción (una vez);
 *   `dibujar()` marca el tipo de `estado.soportes` y muestra "N zonas sin soporte" si corresponde.
 */
export function crearTipoSoportes(ctx) {
    return { conectar: () => conectar(ctx), dibujar };
}

/** Cablea el cambio de opción del grupo; el foco vuelve al radio elegido porque se redibuja. */
function conectar(ctx) {
    $('tipoSoportes').addEventListener('change', e => {
        const { name, value } = /** @type {HTMLInputElement} */ (e.target);
        if (name !== 'tipoSoportes') return;
        estado.soportes = normalizarSoportes(value);
        dibujar();
        $('tipoSoportes').querySelector('input:checked')?.focus();
        ctx.alCambiar();
    });
}

/** HTML de una opción: radio con nombre y ayuda (la ayuda queda asociada al radio con aria-describedby). */
function opcion(tipo, marcado) {
    const { nombre, ayuda } = OPCIONES_SOPORTE[tipo];
    return `<label class="opcion">
        <input type="radio" name="tipoSoportes" value="${tipo}" aria-describedby="ayudaSoportes-${tipo}" ${marcado ? 'checked' : ''}>
        <span><b>${nombre}</b><br><small id="ayudaSoportes-${tipo}">${ayuda}</small></span>
    </label>`;
}

/** Marca el tipo vigente y muestra las zonas si cuentan. */
function dibujar() {
    const tipo = normalizarSoportes(estado.soportes);
    $('tipoSoportes').innerHTML = TIPOS_SOPORTE.map(t => opcion(t, t === tipo)).join('');
    const texto = textoZonasSinSoporte(zonasVigentes());
    const aviso = $('tipoSoportesZonas');
    if (aviso.textContent !== texto) aviso.textContent = texto; // región viva: no re-anunciar si no cambió
    aviso.hidden = !texto;
}
