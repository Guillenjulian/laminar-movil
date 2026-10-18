// Panel "Zona sin soporte" del paso 1 (ADR 0004, sección 2).
//
// Responsabilidad: el botón de modo "marcar" (con un toque sobre la pieza se agrega una esfera), el stepper del
// radio (2 a 40 mm), la lista de zonas de la pieza activa con chips quitables, el aviso al vaciarlas cuando cambia
// la pieza y las marcas en el visor. Guarda las zonas en `Pieza.bloqueos` (marco de la pieza, mm) y la firma
// [rotacion, escala] con que se marcaron en `Pieza.firmaBloqueos`. No dibuja el visor ni conoce el paso 2.
// Con torre o litofanía el panel no se muestra. El visor llega por función (se crea al cargar el primer modelo) y
// los ids de zona los da quien crea (`ctx.nuevoId`). Importarlo no toca el DOM.
//
// Flujo: crearBloqueosUI(ctx) -> conectar() cablea botón, stepper y lista (una vez) -> dibujar() tras cambiar de
// pieza activa o cargar un modelo -> sincronizar() en el `alCambiar` del ajuste (escala, rotación, apoyar cara).

import { MAX_BLOQUEOS, RADIO_INICIAL_MM, RADIO_MAX_MM, RADIO_MIN_MM, validarBloqueos } from '../motor/bloqueos.js';
import { estado, piezaActiva } from './estado.js';
import { $, escapar } from './util-dom.js';

/** Nota fija del panel (#bloqueoNota): una zona bajo el centro de un voladizo puede dejarlo sin apoyo. */
export const NOTA_VOLADIZO = 'Ojo: una zona debajo de un voladizo puede dejarlo sin ningún soporte.';

/** Aviso al vaciar las zonas porque cambió la pieza. */
export const AVISO_VACIADAS = 'Se quitaron las zonas sin soporte porque cambió la pieza';

/**
 * Firma de lo que fija el marco de la pieza: si cambia, las zonas ya no coinciden con la pieza.
 * @param {{rotacion: number[], escala: number}} pieza
 * @returns {string}
 */
export function firmaPieza(pieza) {
    return JSON.stringify([pieza.rotacion, pieza.escala]);
}

/**
 * HTML de la chip de la zona número `n` (de 1): botón que la elige para cambiarle el radio y botón de quitar.
 * El nombre de la pieza es texto del usuario (viene del archivo): se escapa.
 * @param {{id: number, radio: number}} zona
 * @param {number} n
 * @param {string} nombrePieza
 * @param {boolean} elegida
 * @returns {string}
 */
export function chipZona(zona, n, nombrePieza, elegida) {
    return `<li>
        <button type="button" class="chip" data-zona="${zona.id}" aria-pressed="${elegida}">Zona ${n} · ${zona.radio}&nbsp;mm</button>
        <button type="button" class="chip-quitar" data-quitar="${zona.id}" aria-label="Quitar zona ${n}, ${escapar(nombrePieza)}">×</button>
    </li>`;
}

/**
 * Crea el panel de zonas sin soporte. No toca el DOM hasta `conectar()`.
 * @param {object} ctx
 * @param {() => (object|null)} ctx.visor visor del paso 1 (null si todavía no se creó); se usan su
 *   `alTocarPunto(fn|null)` y su `marcasBloqueo` ({poner, quitar}, de `crearMarcasBloqueo`)
 * @param {(msg: string) => void} ctx.avisar muestra un aviso en la pantalla
 * @param {() => number} ctx.nuevoId id nuevo para una zona (`++ultimoIdBloqueo` en estado; nunca se reutiliza)
 * @param {() => void} [ctx.alCambiar] se llama tras agregar, cambiar el radio, quitar o vaciar zonas
 * @returns {{conectar: () => void, dibujar: () => void, sincronizar: () => void}}
 *   `conectar()` cablea botón, stepper de radio, lista y toques (una vez);
 *   `dibujar()` redibuja lista y marcas de la pieza activa (llamar al cambiar de pieza activa o cargar un modelo);
 *   `sincronizar()` compara `firmaBloqueos` con la actual y vacía las zonas si cambió la pieza.
 */
export function crearBloqueosUI(ctx) {
    const est = { ...ctx, conectado: false, modo: false, radio: RADIO_INICIAL_MM, elegida: null };
    return {
        conectar: () => conectar(est),
        dibujar: () => dibujar(est),
        sincronizar: () => sincronizar(est),
    };
}

/** La pieza activa si lleva zonas (sólo los modelos), o null. */
function pieza() {
    const p = piezaActiva();
    return p && p.origen === 'modelo' ? p : null;
}

/** Cablea el botón de modo, el stepper y la lista (chips: elegir y quitar). */
function conectar(est) {
    if (est.conectado) return;
    est.conectado = true;
    $('bloqueoMarcar').onclick = () => {
        est.modo = !est.modo;
        dibujar(est);
    };
    $('bloqueoRadioMenos').onclick = () => cambiarRadio(est, -1);
    $('bloqueoRadioMas').onclick = () => cambiarRadio(est, 1);
    $('bloqueoLista').onclick = e => {
        const quitar = e.target.closest('[data-quitar]');
        if (quitar) return quitarZona(est, Number(quitar.dataset.quitar));
        const chip = e.target.closest('[data-zona]');
        if (!chip) return;
        const id = Number(chip.dataset.zona);
        est.elegida = est.elegida === id ? null : id;
        const zona = pieza()?.bloqueos?.find(b => b.id === id);
        if (est.elegida !== null && zona) est.radio = zona.radio; // el stepper muestra el radio de la zona elegida
        dibujar(est);
    };
}

/** Toque sobre una pieza con el modo activo: agrega una esfera con el radio elegido en el punto tocado. */
function tocar(est, { id, punto }) {
    const p = pieza();
    if (!est.modo || !p || p.id !== id) return;
    // El tope no se chequea acá: `dibujar` apaga el modo al llegar a MAX_BLOQUEOS, y sin modo se sale arriba.
    const lista = (p.bloqueos ??= []);
    const zona = validarBloqueos([
        { id: est.nuevoId(), forma: 'esfera', centro: { x: punto.x, y: punto.y, z: punto.z }, radio: est.radio },
    ])[0];
    if (!zona) return;
    lista.push(zona);
    p.firmaBloqueos = firmaPieza(p);
    est.elegida = null;
    cambioDeZonas(est, `Zona ${lista.length} agregada, radio ${zona.radio} mm`);
}

/** Sube o baja el radio (2 a 40 mm); si hay una zona elegida, también se lo cambia a ella. */
function cambiarRadio(est, delta) {
    est.radio = Math.min(RADIO_MAX_MM, Math.max(RADIO_MIN_MM, est.radio + delta));
    const zona = pieza()?.bloqueos?.find(b => b.id === est.elegida);
    if (!zona) return dibujar(est);
    zona.radio = est.radio;
    cambioDeZonas(est, `Zona elegida, radio ${zona.radio} mm`);
}

/** Quita la zona `id` y deja el foco en la chip de quitar siguiente (o en el botón de marcar si no quedan). */
function quitarZona(est, id) {
    const p = pieza();
    if (!p?.bloqueos) return;
    const antes = p.bloqueos.findIndex(b => b.id === id);
    if (antes < 0) return;
    p.bloqueos.splice(antes, 1);
    if (est.elegida === id) est.elegida = null;
    cambioDeZonas(est, 'Zona quitada');
    const quitares = $('bloqueoLista').querySelectorAll('[data-quitar]');
    (quitares[Math.min(antes, quitares.length - 1)] ?? $('bloqueoMarcar')).focus();
}

/** Lo común a todo cambio de zonas: invalida el resultado, redibuja, anuncia y avisa a quien escucha. */
function cambioDeZonas(est, anuncio) {
    estado.resultado = null;
    dibujar(est);
    const ayuda = $('bloqueoAyuda');
    ayuda.textContent = [anuncio, ayuda.textContent].filter(Boolean).join('. '); // el anuncio y, si hay, el tope
    est.alCambiar?.();
}

/** Vacía las zonas de las piezas cuya firma cambió (escala, rotación o apoyar cara) y lo avisa. */
function sincronizar(est) {
    const cambiadas = estado.piezas.filter(p => p.bloqueos?.length && p.firmaBloqueos !== firmaPieza(p));
    if (!cambiadas.length) return;
    for (const p of cambiadas) {
        p.bloqueos = [];
        p.firmaBloqueos = null;
    }
    est.elegida = null;
    estado.resultado = null;
    dibujar(est);
    est.avisar(AVISO_VACIADAS);
    est.alCambiar?.();
}

/** Muestra u oculta el panel, dibuja botón, stepper, lista y marcas, y engancha o suelta el toque del visor. */
function dibujar(est) {
    const p = pieza();
    const zonas = p?.bloqueos ?? [];
    const lleno = zonas.length >= MAX_BLOQUEOS;
    if (!p || lleno) est.modo = false;
    $('bloqueosPanel').hidden = !p;
    $('bloqueoNota').textContent = NOTA_VOLADIZO;
    const marcar = $('bloqueoMarcar');
    marcar.setAttribute('aria-pressed', String(est.modo));
    marcar.disabled = lleno;
    marcar.textContent = est.modo ? 'Tocá la pieza para marcar' : 'Marcar zona sin soporte';
    for (const id of ['bloqueoRadioMenos', 'bloqueoRadioMas']) $(id).setAttribute('aria-describedby', 'bloqueoNota');
    $('bloqueoRadioNum').textContent = String(est.radio);
    $('bloqueoRadioMenos').disabled = est.radio <= RADIO_MIN_MM;
    $('bloqueoRadioMas').disabled = est.radio >= RADIO_MAX_MM;
    $('bloqueoLista').innerHTML = zonas.map((z, i) => chipZona(z, i + 1, p.nombre, z.id === est.elegida)).join('');
    $('bloqueoAyuda').textContent = lleno ? `Máximo ${MAX_BLOQUEOS} zonas por pieza: quitá una para marcar otra.` : '';
    ponerMarcas(est, p, zonas);
}

/** Marcas del visor (una esfera por zona y copia) y toque con el modo activo; sin visor todavía, no hace nada. */
function ponerMarcas(est, p, zonas) {
    const visor = est.visor();
    if (!visor) return;
    if (p && zonas.length) visor.marcasBloqueo?.poner(zonas, p.posiciones ?? []);
    else visor.marcasBloqueo?.quitar();
    visor.alTocarPunto(est.modo ? toque => tocar(est, toque) : null);
}
