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
import { estado, crearPieza, piezaActiva, matrizPieza } from './estado.js';
import { $, escapar } from './util-dom.js';

const EJEMPLO = 'ejemplos/cubo-20mm.stl';

/**
 * Crea el manejo de piezas. No toca el DOM hasta `conectar()`.
 * @param {object} ctx
 * @param {() => (object|null)} ctx.visor visor del paso 1 (null si todavía no se creó)
 * @param {{aplicar: () => void}} ctx.ajuste ajuste del modelo: `aplicar()` muestra escala y rotación de la activa
 * @param {(nombre: string, buffer: ArrayBuffer) => Promise<{buffer: ArrayBuffer, vertices: Float32Array,
 *   triangulos: number, tamano: object}>} ctx.leer lee y convierte un archivo a STL con el mismo camino que
 *   paso1 (STL, OBJ o 3MF); lanza si no sabe leerlo
 * @param {() => void} ctx.elegirOtro vuelve a la pantalla inicial (se llama si se quita la última pieza)
 * @returns {{conectar: () => void, dibujar: () => void}}
 *   `conectar()` cablea chips, "Agregar pieza" y "Ejemplo" (una vez);
 *   `dibujar()` redibuja chips y "Agregar pieza" (llamar tras cargar un modelo desde cero).
 */
export function crearPiezas(ctx) {
    const u = { ctx, visor: null };
    return { conectar: () => conectar(u), dibujar: () => dibujar(u) };
}

/** Id de la malla de la pieza en el visor (la cargada desde cero usa `idVisor` 0, ver paso1-modelo). */
function idVisor(p) {
    return p.idVisor ?? p.id;
}

/** Cablea la lista de chips, el botón de archivo, su input y el ejemplo. */
function conectar(u) {
    $('listaPiezas').onclick = e => {
        const boton = e.target.closest('button');
        if (!boton) return;
        if (boton.dataset.quitar) quitar(u, Number(boton.dataset.quitar));
        else if (boton.dataset.id) {
            activar(u, Number(boton.dataset.id));
            enfocar(Number(boton.dataset.id));
        }
    };
    $('agregarArchivo').onclick = () => $('archivoPieza').click();
    $('archivoPieza').onchange = async e => {
        const archivo = e.target.files[0];
        e.target.value = ''; // para poder elegir el mismo archivo otra vez
        if (archivo) await agregar(u, archivo.name, await archivo.arrayBuffer());
    };
    $('agregarEjemplo').onclick = async () => {
        const r = await fetch(new URL(EJEMPLO, document.baseURI));
        await agregar(u, 'cubo-20mm.stl', await r.arrayBuffer());
    };
}

/** Lee el archivo, lo suma como pieza nueva, la deja activa y le da el foco a su chip. */
async function agregar(u, nombre, buffer) {
    if (estado.piezas.length >= MAX_PIEZAS) return;
    $('cargando').hidden = false;
    try {
        const d = await u.ctx.leer(nombre, buffer);
        if (!estado.piezas.length || estado.piezas.length >= MAX_PIEZAS) return; // cambió mientras leía
        const pieza = crearPieza({ nombre, stl: d.buffer, vista: { triangulos: d.triangulos, tamano: d.tamano } });
        u.ctx.visor().ponerModelo(d.vertices, pieza.id);
        estado.piezas.push(pieza);
        estado.resultado = null;
        activar(u, pieza.id);
        enfocar(pieza.id);
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
    u.ctx.visor().quitarModelo(idVisor(estado.piezas[i]));
    estado.piezas.splice(i, 1);
    estado.resultado = null;
    if (!estado.piezas.length) return u.ctx.elegirOtro();
    if (!estado.piezas.some(p => p.id === estado.activa)) estado.activa = estado.piezas[0].id;
    activar(u, estado.activa);
    enfocar(estado.piezas[Math.min(i, estado.piezas.length - 1)].id);
}

/** Hace activa a la pieza `id`: resalta su malla y muestra su escala y rotación. */
function activar(u, id) {
    estado.activa = id;
    const visor = u.ctx.visor();
    $('nombreModelo').textContent = piezaActiva().nombre;
    u.ctx.ajuste.aplicar();
    // Hasta T10 el ajuste aplica la matriz de la activa a la malla 0: devolvemos a cada pieza la suya.
    for (const p of estado.piezas) visor.ponerTransformacion(matrizPieza(p), idVisor(p));
    visor.resaltarPieza(idVisor(piezaActiva())); // después de ponerModelo y ponerTransformacion
    dibujar(u);
}

/** Enlaza el toque en el visor (una vez por visor): tocar una pieza la vuelve la activa. */
function enlazarVisor(u) {
    const visor = u.ctx.visor();
    if (!visor || visor === u.visor) return;
    u.visor = visor;
    visor.alTocarPieza(vid => {
        const pieza = estado.piezas.find(p => idVisor(p) === vid);
        if (pieza && pieza !== piezaActiva()) activar(u, pieza.id);
    });
}

/** Muestra las chips (con 2 o más piezas) y "Agregar pieza" (sólo con modelos, hasta MAX_PIEZAS). */
function dibujar(u) {
    enlazarVisor(u);
    const piezas = estado.piezas;
    const activa = piezaActiva();
    $('listaPiezas').hidden = piezas.length < 2;
    $('listaPiezas').innerHTML = piezas.map(p => chip(p, p === activa)).join('');
    $('agregarPieza').hidden = piezas.length === 0 || piezas.some(p => p.origen !== 'modelo');
    const lleno = piezas.length >= MAX_PIEZAS;
    $('agregarArchivo').disabled = lleno;
    $('agregarEjemplo').disabled = lleno;
    $('agregarArchivo').textContent = lleno ? `Máximo ${MAX_PIEZAS} piezas` : 'Agregar pieza';
}

/** HTML de una chip: botón con el nombre (`aria-pressed` si es la activa) y botón de quitar. */
function chip(pieza, activa) {
    const nombre = escapar(pieza.nombre);
    return `<li>
        <button type="button" class="chip" data-id="${pieza.id}" aria-pressed="${activa}">${nombre}</button>
        <button type="button" class="chip-quitar" data-quitar="${pieza.id}" aria-label="Quitar ${nombre}">×</button>
    </li>`;
}

/** Foco a la chip de la pieza `id`; si no hay chips, a "Agregar pieza". */
function enfocar(id) {
    const chipPieza = $('listaPiezas').querySelector(`[data-id="${id}"]`);
    (chipPieza ?? $('agregarArchivo')).focus();
}
