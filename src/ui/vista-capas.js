// Vista previa capa por capa (paso 4): visor, deslizador y reproducción.
// Responsabilidad: es dueño exclusivo de `visorCapas`, `capas` y `reproduccion`; nadie más los toca.
// Flujo: paso4 llama armarVistaPrevia() al terminar de laminar; iniciarVistaCapas() (desde main.js,
// después de iniciarNavegacion) cablea los controles y se suscribe a alMostrarPaso para pausar el visor.
// Las pausas de filamento (lista, colores, marcas) viven en pausas-ui.js, que recibe lo que necesita.
// No toca el DOM al importarse: todo manejador se registra dentro de iniciarVistaCapas().

import { estado } from './estado.js';
import { alMostrarPaso } from './navegacion.js';
import { $ } from './util-dom.js';
import { crearVisor } from './visor-carga.js';
import * as formato from './formato.js';
import { leerRecorridos } from '../motor/motor.js';
import { TIPOS } from '../motor/tipos-linea.js';
import { buscarImpresora } from '../perfiles/perfiles.js';
import { maxSegmentosVista } from '../config.js';
import { textoAvisoVista } from './aviso-vista.js';
import { conectarPausas, dibujarPausas } from './pausas-ui.js';

let visorCapas = null; // visor de la vista previa capa por capa (paso 4)
let capas = null; // { inicioCapa, zCapa, pausaCapa, tipos, total }
let reproduccion = null;

/**
 * Cablea #capa, #capaMenos, #capaMas, #soloCapa, #reproducir, #pausarCapa, #listaPausas y #modoColor;
 * se suscribe a alMostrarPaso (pausa el visor si paso ≠ 4 y para la reproducción).
 * Llamar una vez, después de iniciarNavegacion().
 * @param {{alCambiarPausas: () => void}} callbacks `alCambiarPausas`: lo llama cada cambio de pausas (main: precarga del paso 4).
 * @returns {void}
 */
export function iniciarVistaCapas({ alCambiarPausas }) {
    alMostrarPaso(p => {
        visorCapas?.pausar(p !== 4);
        if (p !== 4) pararReproduccion();
    });
    conectarCapas();
    conectarPausas({
        capas: () => capas,
        visor: () => visorCapas,
        irACapa,
        pararReproduccion,
        alCambiarPausas,
    });
}

/**
 * Lee los recorridos de `estado.resultado.gcode` en un worker, arma el visor y deja la última capa
 * visible. Reinicia pausas y modo de color. Si mientras tanto se laminó otra cosa, se descarta.
 * Nunca lanza: los errores se muestran en #cargandoCapas.
 * @returns {Promise<void>}
 */
export async function armarVistaPrevia() {
    const resultado = estado.resultado;
    capas = null;
    estado.pausas = new Map();
    estado.modoColor = 'tipo';
    dibujarPausas();
    pararReproduccion();
    visorCapas?.quitarRecorridos(); // liberar la memoria de la vista anterior
    $('controlCapas').hidden = true;
    $('cargandoCapas').hidden = false;
    $('cargandoCapas').textContent = 'Armando la vista previa…';
    try {
        const r = await leerRecorridos(resultado.gcode, maxSegmentosVista(), { auto: true });
        if (estado.resultado !== resultado) return; // ya se laminó otra cosa
        if (!(r.inicioCapa.length - 1)) throw new Error('el G-code no tiene recorridos');
        mostrarRecorridos(r, resultado);
    } catch (err) {
        $('cargandoCapas').textContent = 'No se pudo armar la vista previa: ' + err.message;
    }
}

/**
 * Crea el visor (si falta), fija la cama y los recorridos, arma la leyenda y deja la última capa.
 * @param {object} r recorridos leídos del G-code.
 * @param {object} resultado resultado del laminado (para la impresora).
 * @returns {void}
 */
function mostrarRecorridos(r, resultado) {
    const total = r.inicioCapa.length - 1;
    if (!visorCapas) visorCapas = crearVisor($('visorCapas'));
    const d = buscarImpresora(resultado.impresoraId).dispositivo;
    visorCapas.ponerCama({ x: d.bedWidth, y: d.bedDepth, z: d.maxHeight });
    visorCapas.ponerRecorridos(r, { origenCentro: d.originCenter });
    visorCapas.pausar(estado.paso !== 4);
    capas = { inicioCapa: r.inicioCapa, zCapa: r.zCapa, pausaCapa: r.pausaCapa, tipos: r.tipos, total };

    $('capa').max = total - 1;
    $('leyenda').innerHTML = TIPOS.slice(0, -1)
        .map(t => `<li><i style="background: rgb(${t.color.join(',')})"></i>${t.nombre}</li>`)
        .join('');
    const aviso = textoAvisoVista(r, total);
    $('avisoVista').hidden = !aviso;
    $('avisoVista').textContent = aviso;
    $('cargandoCapas').hidden = true;
    $('controlCapas').hidden = false;
    irACapa(total - 1);
}

/**
 * Muestra la capa n (acotada al rango) y actualiza el texto y el botón de pausa.
 * @param {number} n índice de capa, desde 0.
 * @returns {void}
 */
function irACapa(n) {
    if (!capas) return;
    n = Math.max(0, Math.min(capas.total - 1, n));
    $('capa').value = n;
    visorCapas.mostrarCapa(n, $('soloCapa').checked);
    const z = formato.numero(capas.zCapa[n], 2);
    $('textoCapa').textContent = `Capa ${n + 1}/${capas.total} · Z ${z} mm${estado.pausas.has(n) ? ' · ⏸' : ''}`;
    // botón de pausa según la capa
    const b = $('pausarCapa');
    b.disabled = n === 0;
    b.textContent =
        n === 0
            ? '⏸ No se puede pausar en la primera capa'
            : estado.pausas.has(n)
              ? '✕ Quitar la pausa de esta capa'
              : '⏸ Pausar acá para cambiar filamento';
}

/**
 * Cablea el deslizador, los botones de capa, "solo esta capa" y la reproducción.
 * @returns {void}
 */
function conectarCapas() {
    $('capa').addEventListener('input', e => {
        pararReproduccion();
        irACapa(Number(e.target.value));
    });
    $('capaMenos').onclick = () => {
        pararReproduccion();
        irACapa(Number($('capa').value) - 1);
    };
    $('capaMas').onclick = () => {
        pararReproduccion();
        irACapa(Number($('capa').value) + 1);
    };
    $('soloCapa').onchange = () => irACapa(Number($('capa').value));
    $('reproducir').onclick = alternarReproduccion;
}

/**
 * "Play": recorre todas las capas en unos 8 segundos (empieza de abajo si está al final).
 * @returns {void}
 */
function alternarReproduccion() {
    if (reproduccion) return pararReproduccion();
    if (!capas) return;
    let n = Number($('capa').value);
    if (n >= capas.total - 1) n = 0;
    const paso = Math.max(1, Math.round(capas.total / 240));
    $('reproducir').textContent = '❚❚';
    $('reproducir').setAttribute('aria-label', 'Pausar');
    reproduccion = setInterval(() => {
        irACapa(n);
        n += paso;
        if (n >= capas.total) {
            irACapa(capas.total - 1);
            pararReproduccion();
        }
    }, 33);
}

/**
 * Detiene la reproducción (si hay una) y restaura el botón.
 * @returns {void}
 */
function pararReproduccion() {
    if (!reproduccion) return;
    clearInterval(reproduccion);
    reproduccion = null;
    $('reproducir').textContent = '▶';
    $('reproducir').setAttribute('aria-label', 'Reproducir');
}
