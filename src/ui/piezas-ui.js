// Varias piezas, copias y acomodo en el paso 1 (ADR 0003, secciones 2, 4, 5 y 6).
//
// Responsabilidad: la lista de chips de #listaPiezas, "Agregar pieza" (archivo o cubo de ejemplo),
// quitar una pieza y elegir la pieza activa (tocando su chip o la pieza en el visor). No es dueño del
// visor ni del ajuste: se los pasan como funciones/objetos (se leen en el momento, porque el visor se
// crea al cargar el primer modelo). Lee `estado.piezas` y `estado.activa` en el momento.
// `reacomodar()` corre `acomodarPiezas`, muestra en el visor dónde va cada copia (las que no entran, en rojo),
// avisa "No entran todas en la cama" y deshabilita "Siguiente". El stepper de copias está en `copias-ui.js`.
//
// Flujo: crearPiezas(ctx) -> conectar() cablea los botones (una vez) -> dibujar() (llamar al cargar un
// modelo) muestra u oculta chips y "Agregar pieza" -> agregar / quitar / activar actualizan `estado`,
// el visor y el ajuste (escala y rotación de la activa) -> reacomodar() tras cada cambio. Importarlo no toca el DOM.

import { MAX_PIEZAS, maxCopias } from '../config.js';
import { validarCantidad } from '../motor/piezas.js';
import { acomodarPiezas } from './acomodo.js';
import { crearCopias } from './copias-ui.js';
import { estado, crearPieza, piezaActiva, copiasTotales } from './estado.js';
import { $, escapar } from './util-dom.js';

const TEXTO_NO_ENTRAN = 'No entran todas en la cama: achicá, rotá, bajá las copias o quitá piezas.';

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
 * @param {(nombre: string, stl: ArrayBuffer) => (Promise<void>|void)} ctx.guardar guarda el modelo en recientes
 *   (el mismo camino que usa paso1 al montar un modelo)
 * @returns {{conectar: () => void, dibujar: () => void, reacomodar: () => void}}
 *   `conectar()` cablea chips, copias, "Agregar pieza" y "Ejemplo" (una vez);
 *   `dibujar()` redibuja chips y "Agregar pieza" (llamar tras cargar un modelo desde cero);
 *   `reacomodar()` acomoda todas las copias y refresca visor, copias, aviso y "Siguiente" (llamar al cambiar
 *   escala, rotación, copias, piezas o impresora; paso1 lo engancha en `alCambiar` del ajuste).
 */
export function crearPiezas(ctx) {
    const u = { ctx, visor: null };
    u.copias = crearCopias({ alCambiar: () => reacomodar(u) });
    return {
        conectar: () => {
            conectar(u);
            u.copias.conectar();
        },
        dibujar: () => dibujar(u),
        reacomodar: () => reacomodar(u),
    };
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
    if (sinLugar()) return;
    $('cargando').hidden = false;
    try {
        const d = await u.ctx.leer(nombre, await obtener());
        if (!estado.piezas.length || sinLugar()) return; // cambió mientras leía
        const pieza = crearPieza({ nombre, stl: d.buffer, vista: { triangulos: d.triangulos, tamano: d.tamano } });
        u.ctx.visor().ponerModelo(d.vertices, pieza.id);
        pieza.tamano = u.ctx.visor().tamanoModelo(pieza.id); // medida real para el acomodo
        estado.piezas.push(pieza);
        Promise.resolve(u.ctx.guardar(nombre, d.buffer)).catch(() => {}); // a recientes (sin espacio, no pasa nada)
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

/** Dibuja las chips (sólo con 2 o más piezas) y "Agregar pieza" (sólo con modelos, hasta el tope). */
function dibujar(u) {
    enlazarVisor(u);
    const piezas = estado.piezas;
    const activa = piezaActiva();
    $('listaPiezas').hidden = piezas.length < 2;
    $('listaPiezas').innerHTML = piezas.length < 2 ? '' : piezas.map((p, i) => chip(p, i + 1, p === activa)).join('');
    $('agregarPieza').hidden = piezas.length === 0 || piezas.some(p => p.origen !== 'modelo');
    botonesAgregar();
}

/** Mensaje de por qué no se puede agregar otra pieza (o `null` si se puede). */
function sinLugar() {
    return validarCantidad(estado.piezas.length + 1, copiasTotales() + 1, MAX_PIEZAS, maxCopias());
}

/** Habilita o deshabilita "Agregar pieza" y el ejemplo, con el texto que explica el tope. */
function botonesAgregar() {
    const motivo = sinLugar();
    const texto = estado.piezas.length >= MAX_PIEZAS ? `Máximo ${MAX_PIEZAS} piezas` : 'Máximo de copias';
    $('agregarArchivo').disabled = !!motivo;
    $('agregarEjemplo').disabled = !!motivo;
    $('agregarArchivo').textContent = motivo ? texto : 'Agregar pieza';
    $('agregarEjemplo').textContent = motivo ? texto : 'Agregar cubo de ejemplo';
}

/** Acomoda las copias, las muestra en el visor (en rojo las que no entran) y refresca aviso y "Siguiente". */
function reacomodar(u) {
    const visor = u.ctx.visor();
    if (!visor || !estado.piezas.length) return;
    const { fuera } = acomodarPiezas();
    const sola = estado.piezas.length === 1 && estado.piezas[0].copias === 1; // como siempre: la malla sola
    let base = 0;
    for (const p of estado.piezas) {
        const locales = fuera.filter(k => k >= base && k < base + p.copias).map(k => k - base);
        visor.ponerCopias(p.id, sola ? [] : p.posiciones, sola ? [] : locales);
        base += p.copias;
    }
    const bloquea = !estado.entra && !sola;
    $('avisoEntran').textContent = bloquea ? TEXTO_NO_ENTRAN : '';
    $('avisoEntran').hidden = !bloquea;
    $('siguiente').disabled = bloquea;
    $('listaPiezas').dataset.copias = String(copiasTotales());
    for (const [i, p] of estado.piezas.entries()) {
        const boton = $('listaPiezas').querySelector(`.chip[data-id="${p.id}"]`);
        if (boton) boton.textContent = etiqueta(p, i + 1);
    }
    botonesAgregar();
    u.copias.dibujar();
}

/** Texto de la chip: número, nombre y, si hay más de una, las copias. */
function etiqueta(pieza, n) {
    return `${n}. ${pieza.nombre}${pieza.copias > 1 ? ` ×${pieza.copias}` : ''}`;
}

/** HTML de la chip número `n`: botón con el nombre (`aria-pressed` si es la activa) y botón de quitar. */
function chip(pieza, n, activa) {
    const nombre = escapar(pieza.nombre);
    return `<li>
        <button type="button" class="chip" data-id="${pieza.id}" aria-pressed="${activa}">${escapar(etiqueta(pieza, n))}</button>
        <button type="button" class="chip-quitar" data-quitar="${pieza.id}" aria-label="Quitar pieza ${n}, ${nombre}">×</button>
    </li>`;
}

/** Foco a la chip de la pieza `id`; sin chips (o `id` null), a "Agregar pieza". */
function enfocar(id) {
    const chipPieza = id === null ? null : $('listaPiezas').querySelector(`[data-id="${id}"]`);
    (chipPieza ?? $('agregarArchivo')).focus();
}
