// Modelos recientes del paso 1: la lista, abrir/borrar uno y guardar su escala y rotación.
//
// Responsabilidad: dibujar #listaRecientes, abrir un reciente con su transformación guardada y
// guardar la transformación del modelo actual. El guardado espera 500 ms desde el último cambio
// (sin escribir en IndexedDB en cada toque) y, si queda uno pendiente, se hace de inmediato al
// salir del paso 1 o al ocultar la página (`pagehide`). Importarlo no toca el DOM.

import * as almacen from '../almacen.js';
import * as formato from './formato.js';
import { $, escapar } from './util-dom.js';
import { estado } from './estado.js';
import { alMostrarPaso } from './navegacion.js';

const ESPERA_MS = 500;
let temporizador = null;
let pendiente = null; // { nombre, bytes, transformacion } captado al programar

/**
 * Cablea la lista de recientes (abrir y borrar) y el guardado pendiente al salir.
 * @param {(nombre: string, stl: ArrayBuffer, transformacion: {rotacion: number[], escala: number}) => Promise<void>} abrir
 *   carga el modelo reciente en el visor con su transformación
 * @returns {void}
 */
export function iniciarRecientes(abrir) {
    alMostrarPaso(paso => paso !== 1 && guardarPendiente());
    addEventListener('pagehide', guardarPendiente);
    $('listaRecientes').onclick = async e => {
        const boton = e.target.closest('button');
        if (!boton) return;
        if (boton.dataset.borrar) {
            await almacen.borrarModelo(Number(boton.dataset.borrar));
            mostrarRecientes();
            return;
        }
        const id = Number(boton.dataset.id);
        const modelo = (await almacen.listarModelos()).find(m => m.id === id);
        const stl = await almacen.leerModelo(id);
        if (modelo && stl) await abrir(modelo.nombre, stl, almacen.normalizarTransformacion(modelo));
    };
}

/**
 * Relee los modelos guardados y dibuja la lista de recientes.
 * @returns {Promise<void>}
 */
export async function mostrarRecientes() {
    const lista = await almacen.listarModelos().catch(() => []);
    $('recientes').hidden = lista.length === 0;
    $('listaRecientes').innerHTML = lista
        .map(
            m => `<li>
        <button class="reciente" data-id="${m.id}">
            <b>${escapar(m.nombre)}</b>
            <small>${new Date(m.fecha).toLocaleDateString('es-AR')} · ${formato.bytes(m.bytes)}</small>
        </button>
        <button class="borrar" data-borrar="${m.id}" aria-label="Borrar ${escapar(m.nombre)}">×</button>
    </li>`,
        )
        .join('');
}

/**
 * Programa el guardado de rotación y escala del modelo actual en su reciente (500 ms después del
 * último cambio). Capta los valores ahora, así cambiar de modelo antes no los mezcla.
 * @returns {void}
 */
export function programarGuardado() {
    const { nombre, stl, rotacion, escala } = estado;
    pendiente = { nombre, bytes: stl.byteLength, transformacion: { rotacion, escala } };
    clearTimeout(temporizador);
    temporizador = setTimeout(guardarPendiente, ESPERA_MS);
}

/**
 * Ejecuta ya el guardado pendiente, si lo hay (no escribe de más).
 * @returns {void}
 */
export function guardarPendiente() {
    clearTimeout(temporizador);
    const p = pendiente;
    pendiente = null;
    if (p) almacen.guardarTransformacion(p.nombre, p.bytes, p.transformacion).catch(() => {});
}
