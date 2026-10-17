// Materiales en la interfaz: la tarjeta del material elegido (paso 2), con el
// precio del rollo, y las filas "Filamento" y "Costo" del resumen (paso 4).
//
// Los precios se guardan en el celu (IndexedDB) como un solo ajuste:
//   'precios' -> { pla: 18000, petg: 21000, ... }   (pesos por rollo de 1 kg)

import { materiales, armarConfiguracion } from '../perfiles/perfiles.js';
import * as formato from './formato.js';
import * as almacen from '../almacen.js';

// Se leen una sola vez al cargar la app (main.js ya espera con top-level await).
let precios = (await almacen.leerAjuste('precios').catch(() => null)) || {};

const escapar = texto => String(texto).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Lista [id, material] sin las claves de comentario.
export function listaMateriales() {
    return Object.entries(materiales).filter(([id]) => !id.startsWith('_'));
}

export function material(id) {
    return materiales[id] || materiales.pla;
}

// Precio del rollo de 1 kg, o null si todavía no lo cargó.
export function precio(id) {
    return precios[id] > 0 ? precios[id] : null;
}

function guardarPrecio(id, valor) {
    precios = { ...precios };
    if (valor > 0) precios[id] = valor;
    else delete precios[id];
    almacen.guardarAjuste('precios', precios).catch(() => {});
}

// Tarjeta del material elegido: para qué sirve, temperaturas, avisos y precio.
// `config` son los datos de la configuración actual ({ impresoraId, calidad,
// material, ... }): con eso armamos la configuración real y mostramos sus
// avisos (el del material, Bowden con TPU, temperatura recortada, etc.).
export function dibujarTarjeta(contenedor, config) {
    const id = config.material;
    const m = material(id);
    const { proceso, avisos } = armarConfiguracion(config);
    const ventilador = Math.round((proceso.outputFanSpeed || 0) / 255 * 100);
    const p = precio(id);
    contenedor.innerHTML = `<div class="tarjeta-material">
        <p class="descripcion">${escapar(m.descripcion || '')}</p>
        <small>Boquilla ${proceso.outputTemp} °C · cama ${proceso.outputBedTemp} °C · ventilador ${ventilador} %
            · ${formato.numero(m.densidad || 1.24, 2)} g/cm³</small>
        ${avisos.map(a => `<p class="aviso">${escapar(a)}</p>`).join('')}
        <label class="precio-rollo">
            <span>Precio del rollo (1 kg)</span>
            <span class="campo-precio">$ <input type="number" id="precioRollo" inputmode="numeric" min="0" step="1"
                placeholder="0" value="${p ?? ''}" aria-label="Precio del rollo de 1 kg de ${escapar(m.nombre)}, en pesos"></span>
        </label>
        <small>Sirve para estimar cuánto cuesta cada pieza. Queda guardado en el celu.</small>
    </div>`;
    contenedor.querySelector('#precioRollo').addEventListener('input', e => {
        // Pesos sin decimales: "18.000" o "18000" valen lo mismo.
        const valor = parseInt(e.target.value.replace(/\D/g, ''), 10);
        guardarPrecio(id, Number.isFinite(valor) ? valor : 0);
    });
}

// Filas del resumen del paso 4: filamento (con la densidad del material) y costo.
export function filasResumen(mmFilamento, diametro, id) {
    const m = material(id);
    const densidad = m.densidad || 1.24;
    const g = formato.gramos(mmFilamento, diametro, densidad);
    const p = precio(id);
    const costo = p
        ? `≈ ${formato.pesos(g * p / 1000)}`
        : '<button type="button" class="enlace" data-poner-precio>Poné el precio del rollo en el paso 2</button>';
    return [
        ['Filamento', formato.filamento(mmFilamento, diametro, densidad)],
        ['Costo', costo],
    ];
}

// "Poné el precio": vuelve al paso 2 (el resultado se abre reemplazando al
// paso 3, así que "atrás" lleva a la configuración) y pone el foco en el precio.
document.addEventListener('click', e => {
    if (!e.target.closest('[data-poner-precio]')) return;
    history.back();
    addEventListener('popstate', () => setTimeout(() => document.getElementById('precioRollo')?.focus(), 50), { once: true });
});
