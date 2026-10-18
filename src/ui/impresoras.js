// Impresoras: elegir la impresora (hoja con búsqueda) y mostrar la tarjeta de la elegida.
// "Mi impresora" (formulario, copiar, editar, borrar) vive en formulario-impresora.js.
//
// Flujo: iniciarImpresoras cablea los controles. Elegir una impresora actualiza
// estado.impresoraId/estado.calidad, avisa con `alElegir` (main redibuja el paso 2 y la cama
// del visor) y recién después guarda las preferencias. Nada toca el DOM al importarse.

import { estado, guardarPreferencias } from './estado.js';
import { abrirHoja, cerrarHojas } from './navegacion.js';
import { iniciarFormularioImpresora } from './formulario-impresora.js';
import { $, escapar } from './util-dom.js';
import { listaImpresoras, buscarImpresora } from '../perfiles/perfiles.js';

const ETIQUETAS = {
    revisado: 'Perfil armado a mano',
    importado: 'Importado de Kiri · sin revisar',
    propio: 'Tuya',
};

function detalleImpresora(i) {
    const d = i.dispositivo;
    return `Cama ${d.bedWidth} × ${d.bedDepth} × ${d.maxHeight} mm · boquilla ${d.extruders[0].extNozzle.toLocaleString('es-AR', { maximumFractionDigits: 2 })} mm`;
}

/** Dibuja en #impresoraElegida la tarjeta de la impresora elegida (nombre, etiqueta de estado,
 *  medidas, aviso y botón Editar/Copiar). @returns {void} */
export function dibujarImpresoraElegida() {
    const imp = buscarImpresora(estado.impresoraId);
    $('impresoraElegida').innerHTML = `<div class="impresora-elegida">
        <b>${escapar(imp.nombre)}</b> <span class="etiqueta ${imp.estado}">${ETIQUETAS[imp.estado]}</span>
        <small>${detalleImpresora(imp)}</small>
        ${imp.aviso ? `<p class="aviso">${escapar(imp.aviso)}</p>` : ''}
        ${imp.estado === 'importado' ? '<p class="nota">Valores traídos de Kiri:Moto sin revisar. Mirá el G-code de inicio antes de imprimir.</p>' : ''}
        <button type="button" class="boton chico" id="${imp.estado === 'propio' ? 'editarImpresora' : 'copiarImpresora'}">
            ${imp.estado === 'propio' ? 'Editar' : 'Copiar como mía para ajustarla'}</button>
    </div>`;
}

function elegirImpresora(id, alElegir) {
    estado.impresoraId = id;
    const imp = buscarImpresora(id);
    if (!imp.calidades[estado.calidad]) estado.calidad = Object.keys(imp.calidades)[0];
    alElegir();
    guardarPreferencias();
}

function dibujarListaImpresoras() {
    const q = $('buscarImpresora').value.trim().toLowerCase();
    const lista = listaImpresoras().filter(i => !q || `${i.marca} ${i.nombre}`.toLowerCase().includes(q));
    const grupos = [];
    for (const i of lista) {
        const titulo =
            i.estado === 'propio'
                ? 'Tus impresoras'
                : i.estado === 'revisado'
                  ? 'Perfiles armados a mano'
                  : `${i.marca} · importadas de Kiri (sin revisar)`;
        if (grupos.at(-1)?.titulo !== titulo) grupos.push({ titulo, items: [] });
        grupos.at(-1).items.push(i);
    }
    $('listaImpresoras').innerHTML =
        grupos
            .map(
                g =>
                    `<h3>${escapar(g.titulo)}</h3>` +
                    g.items
                        .map(
                            i =>
                                `<button type="button" class="opcion impresora ${i.id === estado.impresoraId ? 'elegida' : ''}" data-id="${escapar(i.id)}">
            <span><b>${escapar(i.nombre)}</b><br><small>${detalleImpresora(i)}</small></span>
        </button>`,
                        )
                        .join(''),
            )
            .join('') ||
        '<p class="nota">No encontramos esa impresora. Podés agregarla con "Agregar mi impresora".</p>';
}

function conectarLista(alElegir) {
    $('cambiarImpresora').onclick = () => {
        $('buscarImpresora').value = '';
        dibujarListaImpresoras();
        abrirHoja('impresoras');
    };
    $('buscarImpresora').addEventListener('input', dibujarListaImpresoras);
    $('listaImpresoras').onclick = e => {
        const b = e.target.closest('[data-id]');
        if (!b) return;
        elegirImpresora(b.dataset.id, alElegir);
        cerrarHojas();
    };
}

/** Cablea #cambiarImpresora, #buscarImpresora, #listaImpresoras y, vía formulario-impresora.js,
 *  "Mi impresora" (#nuevaImpresora, #impresoraElegida, #borrarImpresora, #formImpresora).
 *  @param {{ alElegir: () => void }} callbacks
 *  `alElegir` se llama al elegir/guardar/borrar una impresora, DESPUÉS de actualizar
 *  `estado.impresoraId`/`estado.calidad` y ANTES de guardar preferencias. @returns {void} */
export function iniciarImpresoras({ alElegir }) {
    conectarLista(alElegir);
    iniciarFormularioImpresora({ elegir: id => elegirImpresora(id, alElegir) });
}
