// Varias piezas en el paso 1 (ADR 0003, secciones 4, 5 y 7; todavía sin copias ni acomodo).
//
// Responsabilidad: la lista de chips de #listaPiezas, "Agregar pieza" (archivo o cubo de ejemplo),
// quitar una pieza y elegir la pieza activa (tocando su chip o la pieza en el visor). No es dueño del
// visor ni del ajuste: se los pasan como funciones/objetos (se leen en el momento, porque el visor se
// crea al cargar el primer modelo). Lee `estado.piezas` y `estado.activa` en el momento.
//
// Flujo: crearPiezas(ctx) -> conectar() cablea los botones (una vez) -> dibujar() (llamar al cargar un
// modelo) muestra u oculta chips y "Agregar pieza" -> agregar / quitar / activar actualizan `estado`,
// el visor y el ajuste (escala y rotación de la activa). Importarlo no toca el DOM.

import { MAX_PIEZAS } from '../config.js';
import { estado, crearPieza, piezaActiva } from './estado.js';
import { $, escapar } from './util-dom.js';

/**
 * Crea el manejo de piezas. No toca el DOM hasta `conectar()`.
 * @param {object} ctx
 * @param {() => (object|null)} ctx.visor visor del paso 1 (null si todavía no se creó)
 * @param {{aplicar: () => void}} ctx.ajuste ajuste del modelo: `aplicar()` muestra escala y rotación de la activa
 * @param {(nombre: string, buffer: ArrayBuffer) => Promise<{buffer: ArrayBuffer, vertices: Float32Array,
 *   triangulos: number, tamano: object}>} ctx.leer lee y convierte un archivo a STL con el mismo camino que
 *   paso1 (STL, OBJ o 3MF); lanza si no sabe leerlo
 * @param {() => Promise<ArrayBuffer>} ctx.ejemplo descarga el STL del cubo de ejemplo (lanza si falla)
 * @param {() => void} ctx.elegirOtro vuelve a la pantalla inicial (se llama si se quita la última pieza)
 * @returns {{conectar: () => void, dibujar: () => void}}
 *   `conectar()` cablea chips, "Agregar pieza" y "Ejemplo" (una vez);
 *   `dibujar()` redibuja chips y "Agregar pieza" (llamar tras cargar un modelo desde cero).
 */
export function crearPiezas(ctx) {
    const u = { ctx, visor: null };
    return { conectar: () => conectar(u), dibujar: () => dibujar(u) };
}

/** Cablea la lista de chips, el botón de archivo, su input y el ejemplo. */
function conectar(u) {
    $('listaPiezas').onclick = e => {
        const boton = e.target.closest('button');
        if (boton?.dataset.quitar) quitar(u, Number(boton.dataset.quitar));
        else if (boton?.dataset.id) activar(u, Number(boton.dataset.id));
    };
    $('agregarArchivo').onclick = () => $('archivoPieza').click();
    $('archivoPieza').onchange = async e => {
        const archivo = e.target.files[0];
        e.target.value = ''; // para poder elegir el mismo archivo otra vez
        if (archivo) await agregar(u, archivo.name, () => archivo.arrayBuffer());
    };
    $('agregarEjemplo').onclick = () => agregar(u, 'cubo-20mm.stl', u.ctx.ejemplo);
}

/** Lee el archivo (`obtener` devuelve su buffer), lo suma como pieza nueva, la deja activa y enfoca su chip. */
async function agregar(u, nombre, obtener) {
    if (estado.piezas.length >= MAX_PIEZAS) return;
    $('cargando').hidden = false;
    try {
        const d = await u.ctx.leer(nombre, await obtener());
        if (!estado.piezas.length || estado.piezas.length >= MAX_PIEZAS) return; // cambió mientras leía
        const pieza = crearPieza({ nombre, stl: d.buffer, vista: { triangulos: d.triangulos, tamano: d.tamano } });
        u.ctx.visor().ponerModelo(d.vertices, pieza.id);
        estado.piezas.push(pieza);
        estado.resultado = null;
        dibujar(u);
        activar(u, pieza.id);
        enfocar(pieza.id);
        $('avisoPiezas').textContent = `Pieza agregada: ${nombre}`;
    } catch (err) {
        alert('No pudimos leer el archivo: ' + err.message);
    } finally {
        $('cargando').hidden = true;
    }
}

/** Quita la pieza `id` del visor y de `estado`; si era la activa, pasa a serlo la primera. */
function quitar(u, id) {
    const i = estado.piezas.findIndex(p => p.id === id);
    if (i < 0) return;
    const { nombre } = estado.piezas[i];
    u.ctx.visor().quitarModelo(id);
    estado.piezas.splice(i, 1);
    estado.resultado = null;
    // Defensiva: con una sola pieza no hay chips (no se puede quitar), pero si pasara es "elegir otro modelo".
    if (!estado.piezas.length) return u.ctx.elegirOtro();
    if (!estado.piezas.some(p => p.id === estado.activa)) estado.activa = estado.piezas[0].id;
    dibujar(u);
    activar(u, estado.activa);
    enfocar(estado.piezas.length > 1 ? estado.piezas[Math.min(i, estado.piezas.length - 1)].id : null);
    $('avisoPiezas').textContent = `Pieza quitada: ${nombre}`;
}

/** Hace activa a la pieza `id`: resalta su malla y muestra su escala y rotación (no reescribe las chips). */
function activar(u, id) {
    estado.activa = id;
    $('nombreModelo').textContent = piezaActiva().nombre;
    for (const b of $('listaPiezas').querySelectorAll('.chip'))
        b.setAttribute('aria-pressed', b.dataset.id === String(id));
    u.ctx.ajuste.aplicar();
    u.ctx.visor().resaltarPieza(id); // después de ponerModelo y ponerTransformacion, que lo pierden
}

/** Enlaza el toque en el visor (una vez por visor): tocar una pieza la vuelve la activa. */
function enlazarVisor(u) {
    const visor = u.ctx.visor();
    if (!visor || visor === u.visor) return;
    u.visor = visor;
    visor.alTocarPieza(id => {
        if (estado.piezas.some(p => p.id === id) && id !== piezaActiva().id) activar(u, id);
    });
}

/** Dibuja las chips (sólo con 2 o más piezas) y "Agregar pieza" (sólo con modelos, hasta MAX_PIEZAS). */
function dibujar(u) {
    enlazarVisor(u);
    const piezas = estado.piezas;
    const activa = piezaActiva();
    $('listaPiezas').hidden = piezas.length < 2;
    $('listaPiezas').innerHTML = piezas.length < 2 ? '' : piezas.map((p, i) => chip(p, i + 1, p === activa)).join('');
    $('agregarPieza').hidden = piezas.length === 0 || piezas.some(p => p.origen !== 'modelo');
    const lleno = piezas.length >= MAX_PIEZAS;
    $('agregarArchivo').disabled = lleno;
    $('agregarEjemplo').disabled = lleno;
    $('agregarArchivo').textContent = lleno ? `Máximo ${MAX_PIEZAS} piezas` : 'Agregar pieza';
    $('agregarEjemplo').textContent = lleno ? `Máximo ${MAX_PIEZAS} piezas` : 'Agregar cubo de ejemplo';
}

/** HTML de la chip número `n`: botón con el nombre (`aria-pressed` si es la activa) y botón de quitar. */
function chip(pieza, n, activa) {
    const nombre = escapar(pieza.nombre);
    return `<li>
        <button type="button" class="chip" data-id="${pieza.id}" aria-pressed="${activa}">${n}. ${nombre}</button>
        <button type="button" class="chip-quitar" data-quitar="${pieza.id}" aria-label="Quitar pieza ${n}, ${nombre}">×</button>
    </li>`;
}

/** Foco a la chip de la pieza `id`; sin chips (o `id` null), a "Agregar pieza". */
function enfocar(id) {
    const chipPieza = id === null ? null : $('listaPiezas').querySelector(`[data-id="${id}"]`);
    (chipPieza ?? $('agregarArchivo')).focus();
}
