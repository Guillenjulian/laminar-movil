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
    const est = { ...ctx, conectado: false, pintado: false };
    return { conectar: () => conectar(est), dibujar: () => dibujar(est) };
}

/** Cablea el cambio de opción del grupo (una vez). Los radios no se redibujan: solo se actualiza el aviso. */
function conectar(est) {
    if (est.conectado) return;
    est.conectado = true;
    $('tipoSoportes').addEventListener('change', e => {
        const { name, value } = /** @type {HTMLInputElement} */ (e.target);
        if (name !== 'tipoSoportes') return;
        estado.soportes = normalizarSoportes(value);
        avisarZonas();
        est.alCambiar();
    });
}

/** HTML de una opción: radio con nombre, y la ayuda fuera del label, asociada con aria-describedby. */
function opcion(tipo, marcado) {
    const { nombre, ayuda } = OPCIONES_SOPORTE[tipo];
    return `<div class="opcion-soporte">
        <label class="opcion">
            <input type="radio" name="tipoSoportes" value="${tipo}" aria-describedby="ayudaSoportes-${tipo}" ${marcado ? 'checked' : ''}>
            <span><b>${nombre}</b></span>
        </label>
        <small id="ayudaSoportes-${tipo}">${ayuda}</small>
    </div>`;
}

/** Texto de "N zonas sin soporte" en la región viva, que siempre está en el DOM (se vacía, no se oculta). */
function avisarZonas() {
    const texto = textoZonasSinSoporte(zonasVigentes());
    const aviso = $('tipoSoportesZonas');
    if (aviso.textContent !== texto) aviso.textContent = texto; // no re-anunciar si no cambió
}

/** Pinta los tres radios la primera vez; después solo marca el tipo vigente (p. ej. tras cargar preferencias). */
function dibujar(est) {
    const tipo = normalizarSoportes(estado.soportes);
    if (!est.pintado) {
        $('tipoSoportes').innerHTML = TIPOS_SOPORTE.map(t => opcion(t, t === tipo)).join('');
        est.pintado = true;
    } else {
        for (const radio of $('tipoSoportes').querySelectorAll('input')) radio.checked = radio.value === tipo;
    }
    avisarZonas();
}
