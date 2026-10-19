// Stepper de copias de la pieza activa (ADR 0003, secciones 5 y 6).
//
// Responsabilidad: los botones − / + y el número de #copiasPieza. Cambia `copias` de la pieza activa (mínimo 1,
// máximo el que dé `validarCantidad` con `MAX_PIEZAS` y `maxCopias()`) y avisa con `alCambiar` para que se reacomode.
// Con torre o litofanía no se muestra. No dibuja el visor ni acomoda. Importarlo no toca el DOM.
//
// Flujo: crearCopias(ctx) -> conectar() cablea los botones (una vez) -> dibujar() muestra el número, oculta
// o deshabilita según corresponda (llamar tras cualquier cambio de piezas o copias).

import { MAX_PIEZAS, maxCopias } from '../config.js';
import { validarCantidad } from '../motor/piezas.js';
import { estado, piezaActiva, copiasTotales } from './estado.js';
import { $ } from './util-dom.js';

/**
 * Crea el stepper de copias. No toca el DOM hasta `conectar()`.
 * @param {object} ctx
 * @param {() => void} ctx.alCambiar se llama después de cambiar las copias de la pieza activa
 * @returns {{conectar: () => void, dibujar: () => void}}
 *   `conectar()` cablea − y + (una vez); `dibujar()` refresca número, visibilidad y botones.
 */
export function crearCopias(ctx) {
    return { conectar: () => conectar(ctx), dibujar };
}

/** Cablea − y +. */
function conectar(ctx) {
    $('copiasMenos').onclick = () => cambiar(ctx, -1);
    $('copiasMas').onclick = () => cambiar(ctx, 1);
}

/** Suma `delta` copias a la pieza activa (respeta el mínimo y el máximo), invalida el resultado y avisa. */
function cambiar(ctx, delta) {
    const pieza = piezaActiva();
    if (!pieza || pieza.origen !== 'modelo') return;
    if (delta < 0 ? pieza.copias <= 1 : textoMaximo()) return;
    pieza.copias += delta;
    estado.resultado = null;
    ctx.alCambiar();
    const boton = $(delta < 0 ? 'copiasMenos' : 'copiasMas');
    if (boton.disabled) $(delta < 0 ? 'copiasMas' : 'copiasMenos').focus(); // no perder el foco al deshabilitarse
}

/** Mensaje de por qué no se puede sumar una copia más (o `null` si se puede). */
function textoMaximo() {
    return validarCantidad(estado.piezas.length, copiasTotales() + 1, MAX_PIEZAS, maxCopias());
}

/** Muestra el número de copias de la activa; oculta el stepper sin pieza o con torre/litofanía. */
function dibujar() {
    const pieza = piezaActiva();
    $('copiasPieza').hidden = !pieza || pieza.origen !== 'modelo';
    if (!pieza) return;
    const tope = textoMaximo();
    $('copiasNum').textContent = String(pieza.copias);
    $('copiasMenos').setAttribute('aria-label', `Quitar una copia de ${pieza.nombre}`);
    $('copiasMas').setAttribute('aria-label', `Agregar una copia de ${pieza.nombre}`);
    $('copiasMenos').disabled = pieza.copias <= 1;
    $('copiasMas').disabled = !!tope;
    $('copiasAyuda').textContent = tope ?? '';
    $('copiasAyuda').hidden = !tope;
}
