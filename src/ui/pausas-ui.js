// Pausas de filamento de la vista previa (paso 4): lista de filamentos, marcas sobre el deslizador,
// modo de color y pintado de los recorridos.
// Responsabilidad: dibuja y cablea #pausarCapa, #listaPausas, #marcasPausa y #modoColor; los datos
// viven en `estado.pausas`, `estado.coloresFilamento` y `estado.modoColor` (se leen en el momento).
// Flujo: vista-capas llama conectarPausas(deps) una vez y le inyecta lo que es suyo: las capas, el visor,
// irACapa y pararReproduccion; luego llama dibujarPausas() cuando cambian las pausas.
// No toca el DOM al importarse: todo manejador se registra dentro de conectarPausas().

import { estado } from './estado.js';
import { $, escapar } from './util-dom.js';
import * as formato from './formato.js';
import { TIPOS, COLORES_FILAMENTO } from '../motor/tipos-linea.js';
import { buscarImpresora, lineasPausa } from '../perfiles/perfiles.js';

/**
 * Lo que vista-capas le presta a las pausas.
 * @typedef {object} DepsPausas
 * @property {() => ({inicioCapa: ArrayLike<number>, zCapa: ArrayLike<number>, pausaCapa: ArrayLike<number>, tipos: ArrayLike<number>, total: number}|null)} capas datos de capas actuales (o null).
 * @property {() => (object|null)} visor visor de la vista previa (o null).
 * @property {(n: number) => void} irACapa muestra la capa n.
 * @property {() => void} pararReproduccion detiene la reproducción.
 * @property {() => void} alCambiarPausas se llama después de cada cambio real de pausas (agregar o quitar).
 */

/** @type {DepsPausas|null} */
let deps = null;

/**
 * Cablea el botón de pausa, la lista de filamentos (ir, quitar, elegir color) y el modo de color.
 * Llamar una vez, desde iniciarVistaCapas().
 * @param {DepsPausas} d lo que necesita de vista-capas.
 * @returns {void}
 */
export function conectarPausas(d) {
    deps = d;
    $('pausarCapa').onclick = () => {
        const n = Number($('capa').value);
        const capas = deps.capas();
        if (!capas || n === 0) return;
        if (estado.pausas.has(n)) {
            estado.pausas.delete(n);
        } else {
            estado.pausas.set(n, { capa: n, offset: capas.pausaCapa[n], z: capas.zCapa[n] });
            estado.modoColor = 'filamento'; // con pausas, lo natural es ver los colores
        }
        dibujarPausas();
        d.alCambiarPausas();
        d.irACapa(n);
    };
    conectarLista(d);
    $('modoColor').onclick = e => {
        const b = e.target.closest('[data-modo]');
        if (!b) return;
        estado.modoColor = b.dataset.modo;
        actualizarModoColor();
        pintarRecorridos();
    };
}

/**
 * Cablea la lista de filamentos: tocar uno lleva a su primera capa, × quita la pausa y el color se elige.
 * @param {DepsPausas} d lo que necesita de vista-capas.
 * @returns {void}
 */
function conectarLista({ irACapa, pararReproduccion, alCambiarPausas }) {
    $('listaPausas').onclick = e => {
        const b = e.target.closest('button[data-capa]');
        if (!b) return;
        const n = Number(b.dataset.capa);
        if (b.classList.contains('quitar')) {
            estado.pausas.delete(n);
            dibujarPausas();
            alCambiarPausas();
        }
        pararReproduccion();
        irACapa(n);
    };
    $('listaPausas').addEventListener('input', e => {
        if (!e.target.matches('input[type=color]')) return;
        estado.coloresFilamento[Number(e.target.dataset.filamento)] = e.target.value;
        estado.modoColor = 'filamento';
        actualizarModoColor();
        pintarRecorridos();
    });
}

/**
 * Color elegido (o por defecto) del filamento i.
 * @param {number} i índice de filamento, desde 0.
 * @returns {string} color hexadecimal.
 */
function colorFilamento(i) {
    return estado.coloresFilamento[i] ?? COLORES_FILAMENTO[i % COLORES_FILAMENTO.length];
}

/**
 * Redibuja la lista de filamentos y las marcas de pausa sobre el deslizador.
 * @returns {void}
 */
export function dibujarPausas() {
    const lista = [...estado.pausas.values()].sort((a, b) => a.capa - b.capa);
    const total = deps?.capas()?.total || 0;
    // Tramos de capas que van con cada filamento (antes de la 1ª pausa, entre pausas, después).
    const tramos = [0, ...lista.map(p => p.capa)].map((desde, i, a) => ({
        desde,
        hasta: (a[i + 1] ?? total) - 1,
        pausa: lista[i - 1],
    }));
    $('listaPausas').innerHTML = lista.length
        ? tramos
              .map(
                  (t, i) => `<li>
        <input type="color" value="${escapar(colorFilamento(i))}" data-filamento="${i}" aria-label="Color del filamento ${i + 1}">
        <button type="button" class="ir" data-capa="${t.desde}">
            <b>Filamento ${i + 1}</b> · capas ${t.desde + 1}–${t.hasta + 1}
            ${t.pausa ? `<small><span aria-hidden="true">⏸</span> pausa en Z ${formato.numero(t.pausa.z, 2)} mm</small>` : ''}
        </button>
        ${t.pausa ? `<button type="button" class="quitar" data-capa="${t.desde}" aria-label="Quitar la pausa de la capa ${t.desde + 1}">×</button>` : ''}
    </li>`,
              )
              .join('') +
          `<li class="nota">La impresora se va a detener al empezar ${lista.length === 1 ? 'esa capa' : 'cada una de esas capas'}
        para que cambies el filamento (usa <code>${escapar(lineasPausa(buscarImpresora(estado.resultado.impresoraId)).join(' · '))}</code>).
        Los colores son sólo para la vista previa.</li>`
        : '';
    // marcas sobre el deslizador
    $('marcasPausa').innerHTML =
        total > 1
            ? lista.map(p => `<i style="left: calc(${p.capa / (total - 1)} * (100% - 24px) + 12px)"></i>`).join('')
            : '';
    if (!lista.length) estado.modoColor = 'tipo';
    actualizarModoColor();
    pintarRecorridos();
}

/**
 * Muestra u oculta el selector de modo de color y la leyenda según haya pausas y el modo elegido.
 * @returns {void}
 */
function actualizarModoColor() {
    const conPausas = estado.pausas.size > 0;
    $('modoColor').hidden = !conPausas;
    $('modoColor')
        .querySelectorAll('[data-modo]')
        .forEach(b => b.classList.toggle('activo', b.dataset.modo === estado.modoColor));
    $('leyenda').hidden = estado.modoColor !== 'tipo';
}

/**
 * Arma la tabla [filamento][tipo] -> [r, g, b] para pintar los recorridos.
 * @param {number[]} cortes capas donde empieza cada filamento después del primero, ordenadas.
 * @param {boolean} porFilamento true para usar el color de cada filamento; false, el color del tipo.
 * @returns {number[][][]}
 */
function tablaColores(cortes, porFilamento) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return [0, ...cortes].map((_, f) =>
        TIPOS.map(t => (porFilamento ? rgb(colorFilamento(f)).map(v => Math.round(v * t.brillo)) : t.color)),
    );
}

/**
 * Pinta los recorridos según el modo: por tipo de línea, o con el color de cada filamento
 * (cada tipo un poco más claro u oscuro para seguir distinguiéndolos).
 * @returns {void}
 */
function pintarRecorridos() {
    const capas = deps?.capas(),
        visorCapas = deps?.visor();
    if (!capas || !visorCapas) return;
    const { tipos, inicioCapa, total } = capas;
    const porFilamento = estado.modoColor === 'filamento';
    visorCapas.atenuarAbajo(!porFilamento);
    const cortes = [...estado.pausas.keys()].sort((a, b) => a - b);
    const tabla = tablaColores(cortes, porFilamento);
    visorCapas.pintarRecorridos(c => {
        let f = 0;
        for (let capa = 0; capa < total; capa++) {
            if (capa === cortes[f]) f++;
            const fila = tabla[f];
            for (let i = inicioCapa[capa], fin = inicioCapa[capa + 1]; i < fin; i++) {
                const [r, g, b] = fila[tipos[i]],
                    o = i * 6;
                c[o] = c[o + 3] = r;
                c[o + 1] = c[o + 4] = g;
                c[o + 2] = c[o + 5] = b;
            }
        }
    });
}
