// Vista previa capa por capa (paso 4): visor, deslizador y reproducción.
// Responsabilidad: es dueño exclusivo de `visorCapas`, `capas` y `reproduccion`; nadie más los toca.
// Flujo: paso4 llama armarVistaPrevia() al terminar de laminar; iniciarVistaCapas() (desde main.js,
// después de iniciarNavegacion) cablea los controles y se suscribe a alMostrarPaso para pausar el visor.
// No toca el DOM al importarse: todo manejador se registra dentro de iniciarVistaCapas().

import { estado } from './estado.js';
import { alMostrarPaso } from './navegacion.js';
import { $, escapar } from './util-dom.js';
import { crearVisor } from './visor.js';
import * as formato from './formato.js';
import { leerRecorridos } from '../motor/motor.js';
import { TIPOS, COLORES_FILAMENTO } from '../motor/tipos-linea.js';
import { buscarImpresora, lineasPausa } from '../perfiles/perfiles.js';
import { maxSegmentosVista } from '../config.js';

let visorCapas = null; // visor de la vista previa capa por capa (paso 4)
let capas = null; // { inicioCapa, zCapa, pausaCapa, tipos, total }
let reproduccion = null;

/**
 * Cablea #capa, #capaMenos, #capaMas, #soloCapa, #reproducir, #pausarCapa, #listaPausas y #modoColor;
 * se suscribe a alMostrarPaso (pausa el visor si paso ≠ 4 y para la reproducción).
 * Llamar una vez, después de iniciarNavegacion().
 * @returns {void}
 */
export function iniciarVistaCapas() {
    alMostrarPaso(p => {
        visorCapas?.pausar(p !== 4);
        if (p !== 4) pararReproduccion();
    });
    conectarCapas();
    conectarPausas();
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
        const r = await leerRecorridos(resultado.gcode, maxSegmentosVista());
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
    $('avisoVista').hidden = !r.incompleta;
    $('avisoVista').textContent = r.incompleta
        ? `El archivo es muy grande para mostrarlo entero en este equipo: la vista llega hasta la capa ${total}. El G-code está completo.`
        : '';
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

/**
 * Cablea el botón de pausa, la lista de filamentos (ir, quitar, elegir color) y el modo de color.
 * @returns {void}
 */
function conectarPausas() {
    $('pausarCapa').onclick = () => {
        const n = Number($('capa').value);
        if (!capas || n === 0) return;
        if (estado.pausas.has(n)) {
            estado.pausas.delete(n);
        } else {
            estado.pausas.set(n, { capa: n, offset: capas.pausaCapa[n], z: capas.zCapa[n] });
            estado.modoColor = 'filamento'; // con pausas, lo natural es ver los colores
        }
        dibujarPausas();
        irACapa(n);
    };

    // Lista de filamentos: tocar uno lleva a su primera capa; × quita la pausa; el color se elige.
    $('listaPausas').onclick = e => {
        const b = e.target.closest('button[data-capa]');
        if (!b) return;
        const n = Number(b.dataset.capa);
        if (b.classList.contains('quitar')) {
            estado.pausas.delete(n);
            dibujarPausas();
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

    $('modoColor').onclick = e => {
        const b = e.target.closest('[data-modo]');
        if (!b) return;
        estado.modoColor = b.dataset.modo;
        actualizarModoColor();
        pintarRecorridos();
    };
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
function dibujarPausas() {
    const lista = [...estado.pausas.values()].sort((a, b) => a.capa - b.capa);
    const total = capas?.total || 0;
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
        <input type="color" value="${colorFilamento(i)}" data-filamento="${i}" aria-label="Color del filamento ${i + 1}">
        <button type="button" class="ir" data-capa="${t.desde}">
            <b>Filamento ${i + 1}</b> · capas ${t.desde + 1}–${t.hasta + 1}
            ${t.pausa ? `<small>⏸ pausa en Z ${formato.numero(t.pausa.z, 2)} mm</small>` : ''}
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
