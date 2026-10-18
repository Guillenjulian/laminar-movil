// Impresoras: elegir la impresora (hoja con búsqueda), mostrar la tarjeta de la elegida y
// administrar "Mi impresora" (formulario, copiar, editar, borrar).
//
// Flujo: iniciarImpresoras cablea los controles. Elegir una impresora actualiza
// estado.impresoraId/estado.calidad, avisa con `alElegir` (main redibuja el paso 2 y la cama
// del visor) y recién después guarda las preferencias. Nada toca el DOM al importarse.

import { estado, guardarPropias, guardarPreferencias } from './estado.js';
import { abrirHoja, cerrarHojas } from './navegacion.js';
import { $, escapar } from './util-dom.js';
import {
    listaImpresoras,
    buscarImpresora,
    existeImpresora,
    IMPRESORA_INICIAL,
    lineasPausa,
} from '../perfiles/perfiles.js';
import { PLANTILLAS_GCODE } from '../perfiles/generico.js';

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
                                `<button type="button" class="opcion impresora ${i.id === estado.impresoraId ? 'elegida' : ''}" data-id="${i.id}">
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

// --- Mi impresora (formulario) ---

// Se obtiene dentro de iniciarImpresoras (nada toca el DOM al importar).
let form;

function abrirFormulario(datos, titulo) {
    for (const [k, v] of Object.entries(datos)) {
        const campo = form.elements[k];
        if (!campo) continue;
        if (campo.type === 'checkbox') campo.checked = !!v;
        else campo.value = Array.isArray(v) ? v.join('\n') : v;
        // Valor que no está entre las opciones (ej. boquilla de 0,45): lo agregamos.
        if (campo.tagName === 'SELECT' && campo.value !== String(v)) {
            campo.add(new Option(`${String(v).replace('.', ',')} mm`, v));
            campo.value = v;
        }
    }
    form.dataset.id = datos.id;
    for (const c of ['inicio', 'fin', 'pausa']) form.elements[c].dataset.tocado = datos.inicio ? '1' : '';
    $('tituloMiImpresora').textContent = titulo;
    $('borrarImpresora').hidden = !estado.propias.some(p => p.id === datos.id);
    $('errorImpresora').hidden = true;
    abrirHoja('mi');
    form.parentElement.scrollTo?.(0, 0);
}

function datosNuevos() {
    const p = PLANTILLAS_GCODE.marlin;
    return {
        id: 'propia-' + Date.now().toString(36),
        nombre: '',
        ancho: 220,
        profundidad: 220,
        alto: 250,
        origenCentro: false,
        boquilla: 0.4,
        filamento: 1.75,
        extrusor: 'directo',
        retraccion: 0.8,
        hotendMax: 260,
        camaMax: 100,
        velocidad: 60,
        firmware: 'marlin',
        inicio: undefined,
        fin: undefined,
        _inicio: p.inicio,
        _fin: p.fin,
        _pausa: p.pausa,
    };
}

// Datos del formulario a partir de una impresora existente (para "Copiar como mía").
function datosDesde(imp) {
    const d = imp.dispositivo,
        normal = imp.calidades.normal?.proceso || {};
    const retraccion = imp.proceso.outputRetractDist ?? 1.5;
    return {
        id: imp.estado === 'propio' ? imp.id : 'propia-' + Date.now().toString(36),
        nombre: imp.estado === 'propio' ? imp.nombre : `${imp.nombre} (mía)`,
        ancho: d.bedWidth,
        profundidad: d.bedDepth,
        alto: d.maxHeight,
        origenCentro: !!d.originCenter,
        boquilla: d.extruders[0].extNozzle,
        filamento: d.extruders[0].extFilament,
        extrusor: retraccion > 2 ? 'bowden' : 'directo',
        retraccion,
        hotendMax: imp.limites?.hotendMax ?? 260,
        camaMax: imp.limites?.camaMax ?? 100,
        velocidad: normal.outputFeedrate ?? 60,
        firmware: imp.firmware || 'marlin',
        inicio: d.gcodePre,
        fin: d.gcodePost,
        pausa: lineasPausa(imp),
    };
}

// Arma los datos de la impresora propia desde form.elements.
function leerFormulario() {
    const f = form.elements,
        num = n => Number(f[n].value);
    const lineas = t =>
        t
            .split('\n')
            .map(l => l.trimEnd())
            .filter(Boolean);
    return {
        id: form.dataset.id,
        nombre: f.nombre.value.trim(),
        ancho: num('ancho'),
        profundidad: num('profundidad'),
        alto: num('alto'),
        origenCentro: f.origenCentro.checked,
        boquilla: num('boquilla'),
        filamento: num('filamento'),
        extrusor: f.extrusor.value,
        retraccion: num('retraccion'),
        hotendMax: num('hotendMax'),
        camaMax: num('camaMax'),
        velocidad: num('velocidad'),
        firmware: f.firmware.value,
        inicio: lineas(f.inicio.value),
        fin: lineas(f.fin.value),
        pausa: lineas(f.pausa.value),
    };
}

function mostrarErrorFormulario(campo) {
    $('errorImpresora').textContent =
        `Revisá "${campo.closest('label')?.firstChild.textContent.trim() || campo.name}": ` +
        (campo.validationMessage || 'valor inválido');
    $('errorImpresora').hidden = false;
    campo.focus();
}

function conectarAperturas() {
    $('nuevaImpresora').onclick = () => {
        const datos = datosNuevos();
        abrirFormulario(
            { ...datos, inicio: datos._inicio, fin: datos._fin, pausa: datos._pausa },
            'Agregar mi impresora',
        );
        for (const c of ['inicio', 'fin', 'pausa']) form.elements[c].dataset.tocado = '';
    };
    $('impresoraElegida').onclick = e => {
        if (e.target.id === 'editarImpresora') {
            abrirFormulario(
                estado.propias.find(p => p.id === estado.impresoraId),
                'Editar mi impresora',
            );
        } else if (e.target.id === 'copiarImpresora') {
            abrirFormulario(datosDesde(buscarImpresora(estado.impresoraId)), 'Mi impresora');
        }
    };
}

function conectarCampos() {
    // Si no editó el G-code a mano, al cambiar de firmware se pone la plantilla que corresponde.
    for (const c of ['inicio', 'fin', 'pausa']) {
        form.elements[c].addEventListener('input', e => {
            e.target.dataset.tocado = '1';
        });
    }
    form.elements.firmware.addEventListener('change', e => {
        const p = PLANTILLAS_GCODE[e.target.value];
        for (const c of ['inicio', 'fin', 'pausa']) {
            if (!form.elements[c].dataset.tocado) form.elements[c].value = p[c].join('\n');
        }
    });
    // Retracción típica según el extrusor.
    form.elements.extrusor.addEventListener('change', e => {
        form.elements.retraccion.value = e.target.value === 'bowden' ? 5 : 0.8;
    });
}

function conectarGuardado(alElegir) {
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!form.checkValidity()) {
            mostrarErrorFormulario([...form.elements].find(c => c.validity && !c.validity.valid));
            return;
        }
        const datos = leerFormulario();
        estado.propias = [...estado.propias.filter(p => p.id !== datos.id), datos];
        await guardarPropias();
        elegirImpresora(datos.id, alElegir);
        cerrarHojas();
    });
    $('borrarImpresora').onclick = async () => {
        if (!confirm('¿Borrar esta impresora?')) return;
        estado.propias = estado.propias.filter(p => p.id !== form.dataset.id);
        await guardarPropias();
        if (!existeImpresora(estado.impresoraId)) elegirImpresora(IMPRESORA_INICIAL, alElegir);
        cerrarHojas();
    };
}

/** Cablea #cambiarImpresora, #buscarImpresora, #listaImpresoras, #nuevaImpresora, #impresoraElegida,
 *  #borrarImpresora y el formulario #formImpresora (submit, firmware, extrusor, campos de G-code).
 *  @param {{ alElegir: () => void }} callbacks
 *  `alElegir` se llama al elegir/guardar/borrar una impresora, DESPUÉS de actualizar
 *  `estado.impresoraId`/`estado.calidad` y ANTES de guardar preferencias. @returns {void} */
export function iniciarImpresoras({ alElegir }) {
    form = $('formImpresora');
    conectarLista(alElegir);
    conectarAperturas();
    conectarCampos();
    conectarGuardado(alElegir);
}
