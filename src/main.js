// Lógica de la app: 4 pasos (subir → configurar → laminar → listo).

import { laminar, leerParaVista, leerRecorridos } from './motor/motor.js';
import { TIPOS, COLORES_FILAMENTO } from './motor/tipos-linea.js';
import { insertarPausas } from './motor/pausas.js';
import * as transformar from './motor/transformar.js';
import {
    listaImpresoras, buscarImpresora, existeImpresora, ponerImpresorasPropias, IMPRESORA_INICIAL,
    materiales, opciones, armarConfiguracion, valoresDeCalidad, lineasPausa,
} from './perfiles/perfiles.js';
import { PLANTILLAS_GCODE } from './perfiles/generico.js';
import { iconoRelleno } from './ui/iconos-relleno.js';
import { maxTriangulos, maxSegmentosVista } from './config.js';
import { crearVisor } from './ui/visor.js';
import * as formato from './ui/formato.js';
import * as almacen from './almacen.js';
import * as materialesUI from './ui/materiales.js';

const $ = id => document.getElementById(id);

const estado = {
    paso: 1,
    nombre: '',          // nombre del archivo STL
    stl: null,           // ArrayBuffer original (se copia en cada laminado)
    vista: null,         // { triangulos, tamano } (tamaño original, sin transformar)
    rotacion: transformar.identidad(), // rotaciones del modelo en la cama (matriz 3×3)
    escala: 1,           // escala uniforme (1 = 100 %)
    eligiendoCara: false,
    impresoraId: IMPRESORA_INICIAL,
    propias: [],         // datos de "Mi impresora" (guardados en el celu)
    calidad: 'normal',
    material: 'pla',
    soportes: false,
    personal: {},        // ajustes de "Personalizar" que el usuario cambió (el resto sale de la calidad)
    resultado: null,     // { gcode, info, archivo, impresoraId }
    pausas: new Map(),   // capa -> { capa, offset, z }: pausas para cambiar filamento
    coloresFilamento: [...COLORES_FILAMENTO], // color de cada filamento (1º, 2º, ...) en la vista previa
    modoColor: 'tipo',   // vista previa coloreada por 'tipo' de línea o por 'filamento'
    cancelar: null,      // AbortController del laminado en curso
};

let visor = null;      // visor del modelo (paso 1)
let visorCapas = null; // visor de la vista previa capa por capa (paso 4)

// ---------------------------------------------------------------------------
// Navegación entre pasos. Usamos el historial del navegador para que el botón
// "atrás" del celu vuelva al paso anterior en vez de salir de la app.

// `hoja` es una pantalla que se abre encima ('impresoras' o 'mi'), con su nivel
// (cuántas hojas hay abiertas) para poder cerrarlas todas juntas.
function mostrar(paso, hoja = null) {
    $('hojaImpresoras').hidden = hoja !== 'impresoras';
    $('hojaMiImpresora').hidden = hoja !== 'mi';
    if (paso === estado.paso && estado.yaMostrado) return;
    estado.yaMostrado = true;
    estado.paso = paso;
    document.querySelectorAll('.pantalla, .acciones > div').forEach(el => {
        el.hidden = Number(el.dataset.paso) !== paso;
    });
    document.querySelectorAll('.pasos li').forEach(li => {
        const n = Number(li.dataset.paso);
        li.classList.toggle('actual', n === paso);
        li.classList.toggle('hecho', n < paso);
    });
    $('atras').hidden = paso === 1;
    visor?.pausar(paso !== 1);
    visorCapas?.pausar(paso !== 4);
    if (paso !== 4) pararReproduccion();
    $('main').scrollTo(0, 0);
}

function irA(paso, { reemplazar = false } = {}) {
    history[reemplazar ? 'replaceState' : 'pushState']({ paso }, '');
    mostrar(paso);
}

function abrirHoja(hoja) {
    const nivel = (history.state?.nivel || 0) + 1;
    history.pushState({ paso: estado.paso, hoja, nivel }, '');
    mostrar(estado.paso, hoja);
}

// Cierra todas las hojas abiertas (vuelve en el historial lo necesario).
function cerrarHojas() {
    const nivel = history.state?.nivel || 0;
    if (nivel) history.go(-nivel);
}

window.addEventListener('popstate', e => {
    if (estado.paso === 3) estado.cancelar?.abort();
    mostrar(e.state?.paso || 1, e.state?.hoja);
});
document.querySelectorAll('[data-cerrar]').forEach(b => { b.onclick = () => history.back(); });
$('atras').onclick = () => history.back();
history.replaceState({ paso: 1 }, '');

// ---------------------------------------------------------------------------
// Paso 1: subir el STL

async function cargarArchivo(nombre, buffer, { guardar = true } = {}) {
    if (!/\.stl$/i.test(nombre)) {
        alert('Ese archivo no es un .stl. Elegí un modelo en formato STL.');
        return;
    }
    $('cargando').hidden = false;
    $('sinModelo').hidden = true;
    try {
        // La vista previa se arma en un worker; le pasamos una copia del archivo.
        const { vertices, triangulos, tamano } = await leerParaVista(buffer.slice(0));
        estado.nombre = nombre;
        estado.stl = buffer;
        estado.vista = { triangulos, tamano };
        estado.resultado = null;
        estado.rotacion = transformar.identidad();
        estado.escala = 1;

        $('conModelo').hidden = false;
        if (!visor) visor = crearVisor($('visor'));
        const imp = buscarImpresora(estado.impresoraId).dispositivo;
        visor.ponerCama({ x: imp.bedWidth, y: imp.bedDepth, z: imp.maxHeight });
        visor.ponerModelo(vertices);

        $('nombreModelo').textContent = nombre;
        activarElegirCara(false);
        aplicarTransformacion();
        $('siguiente').disabled = false;

        // Guardarlo en recientes (si falla, por ejemplo por falta de espacio, no pasa nada).
        if (guardar) await almacen.guardarModelo(nombre, buffer).catch(err => console.warn('No se guardó el modelo', err));
    } catch (err) {
        // Si ya había un modelo cargado, queda ése; si no, volvemos a la pantalla inicial.
        $('sinModelo').hidden = !!estado.stl;
        alert('No pudimos leer el archivo: ' + err.message);
    } finally {
        $('cargando').hidden = true;
    }
}

// Avisos sobre el modelo: si es muy pesado (se va a simplificar) o si no entra en la cama.
function actualizarAvisoModelo() {
    if (!estado.vista) return;
    const { triangulos } = estado.vista;
    const tamano = tamanoActual();
    const imp = buscarImpresora(estado.impresoraId);
    const d = imp.dispositivo;
    const avisos = [];
    const noEntra = tamano.x > d.bedWidth || tamano.y > d.bedDepth || tamano.z > d.maxHeight;
    if (noEntra) {
        avisos.push(`<b>No entra en la ${imp.nombre}</b> (${d.bedWidth} × ${d.bedDepth} × ${d.maxHeight} mm). ` +
            'Rotalo o achicalo con los botones de abajo.');
    }
    $('ajustarCama').hidden = !noEntra;
    const max = maxTriangulos();
    if (triangulos > max) {
        avisos.push(`<b>Modelo pesado:</b> tiene ${formato.triangulos(triangulos)}. Para que el celu no se quede ` +
            `sin memoria, antes de laminar lo vamos a simplificar a unos ${formato.triangulos(max)}. ` +
            'Se pueden perder detalles muy finos.');
    }
    $('avisoModelo').innerHTML = avisos.join('<br><br>');
    $('avisoModelo').hidden = avisos.length === 0;
}

async function alElegirArchivo(e) {
    const archivo = e.target.files[0];
    e.target.value = ''; // para poder elegir el mismo archivo otra vez
    if (archivo) await cargarArchivo(archivo.name, await archivo.arrayBuffer());
}
$('archivo').onchange = alElegirArchivo;

// "Elegir otro modelo": vuelve a la pantalla inicial (archivo, ejemplo y recientes).
$('otroModelo').onclick = () => {
    estado.stl = null;
    estado.vista = null;
    visor?.quitarModelo();
    $('conModelo').hidden = true;
    $('sinModelo').hidden = false;
    $('siguiente').disabled = true;
    mostrarRecientes();
};

// Lista de modelos recientes guardados en el celu.
async function mostrarRecientes() {
    const lista = await almacen.listarModelos().catch(() => []);
    $('recientes').hidden = lista.length === 0;
    $('listaRecientes').innerHTML = lista.map(m => `<li>
        <button class="reciente" data-id="${m.id}">
            <b>${escapar(m.nombre)}</b>
            <small>${new Date(m.fecha).toLocaleDateString('es-AR')} · ${formato.bytes(m.bytes)}</small>
        </button>
        <button class="borrar" data-borrar="${m.id}" aria-label="Borrar ${escapar(m.nombre)}">×</button>
    </li>`).join('');
}

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
    if (modelo && stl) await cargarArchivo(modelo.nombre, stl);
};

function escapar(texto) {
    return texto.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

$('ejemplo').onclick = async () => {
    const r = await fetch(new URL('ejemplos/cubo-20mm.stl', document.baseURI));
    await cargarArchivo('cubo-20mm.stl', await r.arrayBuffer());
};

$('siguiente').onclick = () => irA(2);

// --- Modelo en la cama: escala, rotaciones y "apoyar cara" ---

// Matriz final: primero las rotaciones, después la escala.
function matrizModelo() {
    return transformar.multiplicar(transformar.escala(estado.escala), estado.rotacion);
}

// Tamaño del modelo como va a quedar en la cama.
function tamanoActual() {
    return visor?.tamanoModelo() || estado.vista.tamano;
}

function aplicarTransformacion() {
    visor.ponerTransformacion(matrizModelo());
    const pct = Math.round(estado.escala * 1000) / 10;
    $('escala').value = pct;
    $('datosModelo').textContent = `${formato.milimetros(tamanoActual())} · ${formato.triangulos(estado.vista.triangulos)}`;
    $('restablecerModelo').hidden = estado.escala === 1 && transformar.esIdentidad(estado.rotacion);
    actualizarAvisoModelo();
}

function ponerEscala(s) {
    if (!(s > 0)) return;
    estado.escala = Math.min(20, Math.max(0.01, s));
    aplicarTransformacion();
}

$('escalaMenos').onclick = () => ponerEscala(Math.round(estado.escala * 10 - 1) / 10 || 0.05);
$('escalaMas').onclick = () => ponerEscala(Math.round(estado.escala * 10 + 1) / 10);
$('escala').addEventListener('change', e => ponerEscala(Number(e.target.value) / 100));

document.querySelectorAll('[data-rotar]').forEach(b => {
    b.onclick = () => {
        estado.rotacion = transformar.multiplicar(transformar.rotacion90(b.dataset.rotar), estado.rotacion);
        aplicarTransformacion();
    };
});

// "Achicar para que entre": la escala más grande que entra en la cama (con un 2 % de margen).
$('ajustarCama').onclick = () => {
    const d = buscarImpresora(estado.impresoraId).dispositivo;
    const t = tamanoActual(), s = estado.escala;
    const factor = Math.min(d.bedWidth / t.x, d.bedDepth / t.y, d.maxHeight / t.z) * 0.98;
    ponerEscala(Math.floor(s * factor * 100) / 100);
};

$('restablecerModelo').onclick = () => {
    estado.rotacion = transformar.identidad();
    estado.escala = 1;
    activarElegirCara(false);
    aplicarTransformacion();
};

// "Apoyar cara": el usuario toca una cara y el modelo gira para que quede sobre la cama.
function activarElegirCara(activo) {
    estado.eligiendoCara = activo;
    $('apoyarCara').classList.toggle('activo', activo);
    $('apoyarCara').textContent = activo ? 'Cancelar' : 'Apoyar cara';
    $('ayudaCara').hidden = !activo;
    visor?.elegirCara(activo, normal => {
        // La normal viene en coordenadas de la impresora; la escala es uniforme, así
        // que alcanza con agregar la rotación que la lleva hacia abajo.
        estado.rotacion = transformar.multiplicar(transformar.rotacionQueApoya(normal), estado.rotacion);
        activarElegirCara(false);
        aplicarTransformacion();
    });
}
$('apoyarCara').onclick = () => activarElegirCara(!estado.eligiendoCara);

// ---------------------------------------------------------------------------
// Paso 2: impresora, calidad, material y soportes (todo en una sola pantalla)

function opcion(grupo, valor, titulo, detalle, marcado) {
    return `<label class="opcion">
        <input type="radio" name="${grupo}" value="${valor}" ${marcado ? 'checked' : ''}>
        <span><b>${titulo}</b>${detalle ? `<br><small>${detalle}</small>` : ''}</span>
    </label>`;
}

const ETIQUETAS = {
    revisado: 'Perfil armado a mano',
    importado: 'Importado de Kiri · sin revisar',
    propio: 'Tuya',
};

function detalleImpresora(i) {
    const d = i.dispositivo;
    return `Cama ${d.bedWidth} × ${d.bedDepth} × ${d.maxHeight} mm · boquilla ${d.extruders[0].extNozzle.toLocaleString('es-AR', { maximumFractionDigits: 2 })} mm`;
}

function dibujarOpciones() {
    const imp = buscarImpresora(estado.impresoraId);
    $('impresoraElegida').innerHTML = `<div class="impresora-elegida">
        <b>${escapar(imp.nombre)}</b> <span class="etiqueta ${imp.estado}">${ETIQUETAS[imp.estado]}</span>
        <small>${detalleImpresora(imp)}</small>
        ${imp.aviso ? `<p class="aviso">${escapar(imp.aviso)}</p>` : ''}
        ${imp.estado === 'importado' ? '<p class="nota">Valores traídos de Kiri:Moto sin revisar. Mirá el G-code de inicio antes de imprimir.</p>' : ''}
        <button type="button" class="boton chico" id="${imp.estado === 'propio' ? 'editarImpresora' : 'copiarImpresora'}">
            ${imp.estado === 'propio' ? 'Editar' : 'Copiar como mía para ajustarla'}</button>
    </div>`;
    $('calidades').innerHTML = Object.entries(imp.calidades).map(([id, c]) =>
        opcion('calidad', id, c.nombre, c.descripcion, id === estado.calidad)).join('');
    $('materiales').innerHTML = materialesUI.listaMateriales().map(([id, m]) =>
        opcion('material', id, m.nombre, `${m.proceso.outputTemp}&nbsp;°C · cama ${m.proceso.outputBedTemp}&nbsp;°C`,
            id === estado.material)).join('');
    dibujarMaterial();
    $('soportes').checked = estado.soportes;
    dibujarPersonalizar();
}

// Tarjeta del material elegido (descripción, avisos y precio del rollo).
function dibujarMaterial() {
    const { impresoraId, calidad, material, soportes, personal } = estado;
    materialesUI.dibujarTarjeta($('tarjetaMaterial'), { impresoraId, calidad, material, soportes, personal });
}

// --- Personalizar: relleno, paredes y adhesión ---

// Valores actuales: los de la calidad, pisados por lo que cambió el usuario.
function valoresActuales() {
    return { ...valoresDeCalidad(estado.impresoraId, estado.calidad), ...estado.personal };
}

// Guarda un cambio. Si coincide con el valor de la calidad, se borra el
// "personalizado" (así, si después cambia la calidad, ese valor la sigue).
function cambiarPersonal(clave, valor) {
    const base = valoresDeCalidad(estado.impresoraId, estado.calidad);
    if (base[clave] === valor) delete estado.personal[clave];
    else estado.personal[clave] = valor;
    dibujarPersonalizar();
    guardarPreferencias();
}

function dibujarPersonalizar() {
    const v = valoresActuales();
    $('patrones').innerHTML = Object.entries(opciones.patrones).filter(([id]) => !id.startsWith('_')).map(([id, p]) =>
        `<label class="patron" title="${p.descripcion}">
            <input type="radio" name="patron" value="${id}" ${id === v.patron ? 'checked' : ''}>
            ${iconoRelleno(id)}<span>${p.nombre}</span>
        </label>`).join('');
    $('densidad').value = Math.round(v.densidad * 100);
    $('densidadValor').textContent = `${Math.round(v.densidad * 100)} %`;
    $('atajosDensidad').innerHTML = opciones.densidades.map(d =>
        `<button type="button" class="atajo ${Math.abs(d.valor - v.densidad) < 0.001 ? 'activo' : ''}" data-densidad="${d.valor}">
            ${d.nombre} <small>${Math.round(d.valor * 100)} %</small></button>`).join('');
    document.querySelectorAll('.contador').forEach(c => { c.querySelector('output').textContent = v[c.dataset.clave]; });
    $('adhesiones').innerHTML = Object.entries(opciones.adhesiones).map(([id, a]) =>
        opcion('adhesion', id, a.nombre, a.descripcion, id === v.adhesion)).join('');

    const cambiados = Object.keys(estado.personal).length;
    $('personalizar').querySelector('summary').textContent = cambiados
        ? `Personalizado: ${resumenPersonal(v)}`
        : 'Personalizar relleno, paredes y adhesión';
    $('restablecer').hidden = !cambiados;
}

function resumenPersonal(v) {
    return `${opciones.patrones[v.patron]?.nombre || v.patron} ${Math.round(v.densidad * 100)} % · ` +
        `${v.paredes} paredes · ${opciones.adhesiones[v.adhesion]?.nombre}`;
}

$('densidad').addEventListener('input', e => {
    $('densidadValor').textContent = `${e.target.value} %`;
});
$('atajosDensidad').onclick = e => {
    const b = e.target.closest('[data-densidad]');
    if (b) cambiarPersonal('densidad', Number(b.dataset.densidad));
};
document.querySelectorAll('.contador').forEach(c => c.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const clave = c.dataset.clave;
    const nuevo = Math.min(Number(c.dataset.max), Math.max(Number(c.dataset.min), valoresActuales()[clave] + Number(b.dataset.delta)));
    cambiarPersonal(clave, nuevo);
}));
$('restablecer').onclick = () => {
    estado.personal = {};
    dibujarPersonalizar();
    guardarPreferencias();
};

document.querySelector('[data-paso="2"].pantalla').addEventListener('change', e => {
    const { name, value, checked } = e.target;
    if (name === 'calidad') {
        estado.calidad = value;
        dibujarPersonalizar();
    }
    if (name === 'material') {
        estado.material = value;
        dibujarMaterial();
    }
    if (e.target.id === 'soportes') estado.soportes = checked;
    if (name === 'patron') return cambiarPersonal('patron', value);
    if (name === 'adhesion') return cambiarPersonal('adhesion', value);
    if (e.target.id === 'densidad') return cambiarPersonal('densidad', Number(value) / 100);
    guardarPreferencias();
});

function elegirImpresora(id) {
    estado.impresoraId = id;
    const imp = buscarImpresora(id);
    if (!imp.calidades[estado.calidad]) estado.calidad = Object.keys(imp.calidades)[0];
    dibujarOpciones();
    if (visor) {
        const d = imp.dispositivo;
        visor.ponerCama({ x: d.bedWidth, y: d.bedDepth, z: d.maxHeight });
    }
    actualizarAvisoModelo();
    guardarPreferencias();
}

// --- Elegir impresora (hoja con búsqueda) ---

$('cambiarImpresora').onclick = () => {
    $('buscarImpresora').value = '';
    dibujarListaImpresoras();
    abrirHoja('impresoras');
};
$('buscarImpresora').addEventListener('input', dibujarListaImpresoras);

function dibujarListaImpresoras() {
    const q = $('buscarImpresora').value.trim().toLowerCase();
    const lista = listaImpresoras().filter(i => !q || `${i.marca} ${i.nombre}`.toLowerCase().includes(q));
    const grupos = [];
    for (const i of lista) {
        const titulo = i.estado === 'propio' ? 'Tus impresoras'
            : i.estado === 'revisado' ? 'Perfiles armados a mano'
            : `${i.marca} · importadas de Kiri (sin revisar)`;
        if (grupos.at(-1)?.titulo !== titulo) grupos.push({ titulo, items: [] });
        grupos.at(-1).items.push(i);
    }
    $('listaImpresoras').innerHTML = grupos.map(g => `<h3>${escapar(g.titulo)}</h3>` + g.items.map(i =>
        `<button type="button" class="opcion impresora ${i.id === estado.impresoraId ? 'elegida' : ''}" data-id="${i.id}">
            <span><b>${escapar(i.nombre)}</b><br><small>${detalleImpresora(i)}</small></span>
        </button>`).join('')).join('') || '<p class="nota">No encontramos esa impresora. Podés agregarla con "Agregar mi impresora".</p>';
}

$('listaImpresoras').onclick = e => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    elegirImpresora(b.dataset.id);
    cerrarHojas();
};

// --- Mi impresora (formulario) ---

const form = $('formImpresora');

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
        id: 'propia-' + Date.now().toString(36), nombre: '', ancho: 220, profundidad: 220, alto: 250,
        origenCentro: false, boquilla: 0.4, filamento: 1.75, extrusor: 'directo', retraccion: 0.8,
        hotendMax: 260, camaMax: 100, velocidad: 60, firmware: 'marlin', inicio: undefined, fin: undefined,
        _inicio: p.inicio, _fin: p.fin, _pausa: p.pausa,
    };
}

// Datos del formulario a partir de una impresora existente (para "Copiar como mía").
function datosDesde(imp) {
    const d = imp.dispositivo, normal = imp.calidades.normal?.proceso || {};
    const retraccion = imp.proceso.outputRetractDist ?? 1.5;
    return {
        id: imp.estado === 'propio' ? imp.id : 'propia-' + Date.now().toString(36),
        nombre: imp.estado === 'propio' ? imp.nombre : `${imp.nombre} (mía)`,
        ancho: d.bedWidth, profundidad: d.bedDepth, alto: d.maxHeight, origenCentro: !!d.originCenter,
        boquilla: d.extruders[0].extNozzle, filamento: d.extruders[0].extFilament,
        extrusor: retraccion > 2 ? 'bowden' : 'directo', retraccion,
        hotendMax: imp.limites?.hotendMax ?? 260, camaMax: imp.limites?.camaMax ?? 100,
        velocidad: normal.outputFeedrate ?? 60, firmware: imp.firmware || 'marlin',
        inicio: d.gcodePre, fin: d.gcodePost, pausa: lineasPausa(imp),
    };
}

$('nuevaImpresora').onclick = () => {
    const datos = datosNuevos();
    abrirFormulario({ ...datos, inicio: datos._inicio, fin: datos._fin, pausa: datos._pausa }, 'Agregar mi impresora');
    for (const c of ['inicio', 'fin', 'pausa']) form.elements[c].dataset.tocado = '';
};
$('impresoraElegida').onclick = e => {
    if (e.target.id === 'editarImpresora') {
        abrirFormulario(estado.propias.find(p => p.id === estado.impresoraId), 'Editar mi impresora');
    } else if (e.target.id === 'copiarImpresora') {
        abrirFormulario(datosDesde(buscarImpresora(estado.impresoraId)), 'Mi impresora');
    }
};

// Si no editó el G-code a mano, al cambiar de firmware se pone la plantilla que corresponde.
for (const c of ['inicio', 'fin', 'pausa']) {
    form.elements[c].addEventListener('input', e => { e.target.dataset.tocado = '1'; });
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

form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.checkValidity()) {
        const malo = [...form.elements].find(c => c.validity && !c.validity.valid);
        $('errorImpresora').textContent = `Revisá "${malo.closest('label')?.firstChild.textContent.trim() || malo.name}": ` +
            (malo.validationMessage || 'valor inválido');
        $('errorImpresora').hidden = false;
        malo.focus();
        return;
    }
    const f = form.elements, num = n => Number(f[n].value);
    const lineas = t => t.split('\n').map(l => l.trimEnd()).filter(Boolean);
    const datos = {
        id: form.dataset.id, nombre: f.nombre.value.trim(),
        ancho: num('ancho'), profundidad: num('profundidad'), alto: num('alto'), origenCentro: f.origenCentro.checked,
        boquilla: num('boquilla'), filamento: num('filamento'), extrusor: f.extrusor.value, retraccion: num('retraccion'),
        hotendMax: num('hotendMax'), camaMax: num('camaMax'), velocidad: num('velocidad'), firmware: f.firmware.value,
        inicio: lineas(f.inicio.value), fin: lineas(f.fin.value), pausa: lineas(f.pausa.value),
    };
    estado.propias = [...estado.propias.filter(p => p.id !== datos.id), datos];
    await guardarPropias();
    elegirImpresora(datos.id);
    cerrarHojas();
});

$('borrarImpresora').onclick = async () => {
    if (!confirm('¿Borrar esta impresora?')) return;
    estado.propias = estado.propias.filter(p => p.id !== form.dataset.id);
    await guardarPropias();
    if (!existeImpresora(estado.impresoraId)) elegirImpresora(IMPRESORA_INICIAL);
    cerrarHojas();
};

async function guardarPropias() {
    ponerImpresorasPropias(estado.propias);
    await almacen.guardarAjuste('impresorasPropias', estado.propias).catch(() => {});
}

// Las elecciones del paso 2 se recuerdan para la próxima vez.
function guardarPreferencias() {
    const { impresoraId, calidad, material, soportes, personal } = estado;
    almacen.guardarAjuste('preferencias', { impresoraId, calidad, material, soportes, personal }).catch(() => {});
}

async function cargarPreferencias() {
    estado.propias = (await almacen.leerAjuste('impresorasPropias').catch(() => null)) || [];
    ponerImpresorasPropias(estado.propias);
    const p = await almacen.leerAjuste('preferencias').catch(() => null);
    if (!p) return;
    // Sólo usamos lo que todavía existe (puede haber cambiado algún perfil).
    if (existeImpresora(p.impresoraId)) estado.impresoraId = p.impresoraId;
    if (buscarImpresora(estado.impresoraId).calidades[p.calidad]) estado.calidad = p.calidad;
    if (materiales[p.material]) estado.material = p.material;
    estado.soportes = !!p.soportes;
    // Del personalizado, sólo lo que sigue siendo válido.
    const pers = p.personal || {};
    if (opciones.patrones[pers.patron]) estado.personal.patron = pers.patron;
    if (opciones.adhesiones[pers.adhesion]) estado.personal.adhesion = pers.adhesion;
    for (const clave of ['densidad', 'paredes', 'arriba', 'abajo']) {
        if (typeof pers[clave] === 'number') estado.personal[clave] = pers[clave];
    }
}

// ---------------------------------------------------------------------------
// Paso 3: laminar

// Cada etapa del motor ocupa un tramo de la barra de progreso.
const ETAPAS = {
    leyendo: { desde: 0, hasta: 2, texto: 'Leyendo el archivo…' },
    reduciendo: { desde: 2, hasta: 10, texto: 'Simplificando la malla…' },
    laminando: { desde: 10, hasta: 60, texto: 'Cortando en capas…' },
    preparando: { desde: 60, hasta: 92, texto: 'Armando los recorridos…' },
    exportando: { desde: 92, hasta: 100, texto: 'Generando el G-code…' },
};

function ponerProgreso(etapa, valor) {
    const e = ETAPAS[etapa] || ETAPAS.leyendo;
    const pct = Math.round(e.desde + (e.hasta - e.desde) * Math.min(1, valor));
    $('relleno').style.width = pct + '%';
    $('progreso').setAttribute('aria-valuenow', pct);
    $('porcentaje').textContent = pct + ' %';
    $('etapa').textContent = e.texto;
}

// Evita que el celu apague la pantalla mientras lamina (si se bloquea, el
// navegador puede frenar o matar el worker).
async function mantenerPantalla() {
    try {
        return await navigator.wakeLock?.request('screen');
    } catch {
        return null;
    }
}

async function empezarLaminado() {
    const { dispositivo, proceso, avisos } = armarConfiguracion({
        impresoraId: estado.impresoraId,
        calidad: estado.calidad,
        material: estado.material,
        soportes: estado.soportes,
        personal: estado.personal,
    });

    irA(3);
    $('tituloLaminando').textContent = 'Laminando…';
    $('errorLaminado').hidden = true;
    $('cancelar').textContent = 'Cancelar';
    ponerProgreso('leyendo', 0);

    estado.cancelar = new AbortController();
    const bloqueo = await mantenerPantalla();
    try {
        const r = await laminar({
            stl: estado.stl.slice(0), // copia: el original queda para volver a laminar
            dispositivo, proceso,
            maxTriangulos: maxTriangulos(),
            transformacion: matrizModelo(),
            alProgresar: ponerProgreso,
            signal: estado.cancelar.signal,
        });
        const base = estado.nombre.replace(/\.stl$/i, '').replace(/[^\w.-]+/g, '_');
        estado.resultado = { ...r, avisos, archivo: `${base}_${estado.calidad}.gcode`, impresoraId: estado.impresoraId };
        mostrarResultado();
        irA(4, { reemplazar: true }); // así "atrás" desde el resultado vuelve a la configuración
    } catch (err) {
        if (err.name === 'AbortError') return;
        $('tituloLaminando').textContent = 'No se pudo laminar';
        $('errorLaminado').textContent = err.message;
        $('errorLaminado').hidden = false;
        $('cancelar').textContent = 'Volver';
    } finally {
        bloqueo?.release();
        estado.cancelar = null;
    }
}

$('laminar').onclick = empezarLaminado;
$('cancelar').onclick = () => {
    estado.cancelar?.abort();
    history.back();
};

// ---------------------------------------------------------------------------
// Paso 4: resultado, compartir y descargar

function mostrarResultado() {
    const { info, gcode, avisos, archivo } = estado.resultado;
    const imp = buscarImpresora(estado.impresoraId);
    const cal = imp.calidades[estado.calidad];
    const filas = [
        ['Tiempo estimado', formato.duracion(info.tiempo)],
        ...materialesUI.filasResumen(info.filamento, imp.dispositivo.extruders[0].extFilament, estado.material),
        ['Capas', formato.numero(info.capas)],
        ['Calidad', `${cal.nombre} · ${materiales[estado.material].nombre}${estado.soportes ? ' · con soportes' : ''}`],
        ['Relleno y adhesión', resumenPersonal(valoresActuales())],
        ['Tamaño', formato.milimetros(info.tamano)],
        ['Archivo', formato.bytes(gcode.length)],
    ];
    $('resumen').innerHTML = filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('nombreArchivo').textContent = archivo;

    const notas = [...avisos];
    if (info.decimado) {
        const d = info.decimado;
        notas.push(`Simplificamos el modelo de ${formato.triangulos(d.original)} a ${formato.triangulos(d.final)} ` +
            `para que entre en la memoria del celu (detalle mínimo ≈ ${formato.numero(d.precisionMm, 2)} mm).`);
    }
    $('avisoResultado').innerHTML = notas.join('<br><br>');
    $('avisoResultado').hidden = notas.length === 0;

    // "Compartir" sólo si el navegador puede compartir archivos (Android/iOS sí; la mayoría de las PCs no).
    $('compartir').hidden = !navigator.canShare?.({ files: [archivoGcode()] });
    $('descargar').classList.toggle('primario', $('compartir').hidden);

    armarVistaPrevia();
}

// --- Vista previa capa por capa ---

let capas = null; // { inicioCapa, zCapa, total }
let reproduccion = null;

async function armarVistaPrevia() {
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
        const total = r.inicioCapa.length - 1;
        if (!total) throw new Error('el G-code no tiene recorridos');
        if (!visorCapas) visorCapas = crearVisor($('visorCapas'));
        const d = buscarImpresora(resultado.impresoraId).dispositivo;
        visorCapas.ponerCama({ x: d.bedWidth, y: d.bedDepth, z: d.maxHeight });
        visorCapas.ponerRecorridos(r, { origenCentro: d.originCenter });
        visorCapas.pausar(estado.paso !== 4);
        capas = { inicioCapa: r.inicioCapa, zCapa: r.zCapa, pausaCapa: r.pausaCapa, tipos: r.tipos, total };

        $('capa').max = total - 1;
        $('leyenda').innerHTML = TIPOS.slice(0, -1).map(t =>
            `<li><i style="background: rgb(${t.color.join(',')})"></i>${t.nombre}</li>`).join('');
        $('avisoVista').hidden = !r.incompleta;
        $('avisoVista').textContent = r.incompleta
            ? `El archivo es muy grande para mostrarlo entero en este equipo: la vista llega hasta la capa ${total}. El G-code está completo.`
            : '';
        $('cargandoCapas').hidden = true;
        $('controlCapas').hidden = false;
        irACapa(total - 1);
    } catch (err) {
        $('cargandoCapas').textContent = 'No se pudo armar la vista previa: ' + err.message;
    }
}

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
    b.textContent = n === 0 ? '⏸ No se puede pausar en la primera capa'
        : estado.pausas.has(n) ? '✕ Quitar la pausa de esta capa'
        : '⏸ Pausar acá para cambiar filamento';
}

// --- Pausas para cambiar filamento ---

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

function colorFilamento(i) {
    return estado.coloresFilamento[i] ?? COLORES_FILAMENTO[i % COLORES_FILAMENTO.length];
}

function dibujarPausas() {
    const lista = [...estado.pausas.values()].sort((a, b) => a.capa - b.capa);
    const total = capas?.total || 0;
    // Tramos de capas que van con cada filamento (antes de la 1ª pausa, entre pausas, después).
    const tramos = [0, ...lista.map(p => p.capa)].map((desde, i, a) => ({ desde, hasta: (a[i + 1] ?? total) - 1, pausa: lista[i - 1] }));
    $('listaPausas').innerHTML = lista.length ? tramos.map((t, i) => `<li>
        <input type="color" value="${colorFilamento(i)}" data-filamento="${i}" aria-label="Color del filamento ${i + 1}">
        <button type="button" class="ir" data-capa="${t.desde}">
            <b>Filamento ${i + 1}</b> · capas ${t.desde + 1}–${t.hasta + 1}
            ${t.pausa ? `<small>⏸ pausa en Z ${formato.numero(t.pausa.z, 2)} mm</small>` : ''}
        </button>
        ${t.pausa ? `<button type="button" class="quitar" data-capa="${t.desde}" aria-label="Quitar la pausa de la capa ${t.desde + 1}">×</button>` : ''}
    </li>`).join('') + `<li class="nota">La impresora se va a detener al empezar ${lista.length === 1 ? 'esa capa' : 'cada una de esas capas'}
        para que cambies el filamento (usa <code>${escapar(lineasPausa(buscarImpresora(estado.resultado.impresoraId)).join(' · '))}</code>).
        Los colores son sólo para la vista previa.</li>` : '';
    // marcas sobre el deslizador
    $('marcasPausa').innerHTML = total > 1 ? lista.map(p =>
        `<i style="left: calc(${p.capa / (total - 1)} * (100% - 24px) + 12px)"></i>`).join('') : '';
    if (!lista.length) estado.modoColor = 'tipo';
    actualizarModoColor();
    pintarRecorridos();
}

function actualizarModoColor() {
    const conPausas = estado.pausas.size > 0;
    $('modoColor').hidden = !conPausas;
    $('modoColor').querySelectorAll('[data-modo]').forEach(b =>
        b.classList.toggle('activo', b.dataset.modo === estado.modoColor));
    $('leyenda').hidden = estado.modoColor !== 'tipo';
}

// Pinta los recorridos según el modo: por tipo de línea, o con el color de cada
// filamento (cada tipo un poco más claro u oscuro para seguir distinguiéndolos).
function pintarRecorridos() {
    if (!capas || !visorCapas) return;
    const { tipos, inicioCapa, total } = capas;
    const porFilamento = estado.modoColor === 'filamento';
    visorCapas.atenuarAbajo(!porFilamento);
    const cortes = [...estado.pausas.keys()].sort((a, b) => a - b);
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    // tabla [filamento][tipo] -> [r, g, b]
    const tabla = [0, ...cortes].map((_, f) => TIPOS.map(t => porFilamento
        ? rgb(colorFilamento(f)).map(v => Math.round(v * t.brillo))
        : t.color));
    visorCapas.pintarRecorridos(c => {
        let f = 0;
        for (let capa = 0; capa < total; capa++) {
            if (capa === cortes[f]) f++;
            const fila = tabla[f];
            for (let i = inicioCapa[capa], fin = inicioCapa[capa + 1]; i < fin; i++) {
                const [r, g, b] = fila[tipos[i]], o = i * 6;
                c[o] = c[o + 3] = r; c[o + 1] = c[o + 4] = g; c[o + 2] = c[o + 5] = b;
            }
        }
    });
}

$('capa').addEventListener('input', e => { pararReproduccion(); irACapa(Number(e.target.value)); });
$('capaMenos').onclick = () => { pararReproduccion(); irACapa(Number($('capa').value) - 1); };
$('capaMas').onclick = () => { pararReproduccion(); irACapa(Number($('capa').value) + 1); };
$('soloCapa').onchange = () => irACapa(Number($('capa').value));

// "Play": recorre todas las capas en unos 8 segundos (empieza de abajo si está al final).
$('reproducir').onclick = () => {
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
};

function pararReproduccion() {
    if (!reproduccion) return;
    clearInterval(reproduccion);
    reproduccion = null;
    $('reproducir').textContent = '▶';
    $('reproducir').setAttribute('aria-label', 'Reproducir');
}

// Usamos text/plain: varios celus no dejan compartir tipos "raros" como text/x-gcode.
function archivoGcode() {
    const { gcode, archivo, impresoraId } = estado.resultado;
    const final = insertarPausas(gcode, [...estado.pausas.values()], lineasPausa(buscarImpresora(impresoraId)));
    return new File([final], archivo, { type: 'text/plain' });
}

$('compartir').onclick = async () => {
    try {
        await navigator.share({ files: [archivoGcode()], title: estado.resultado.archivo });
    } catch (err) {
        if (err.name !== 'AbortError') alert('No se pudo compartir: ' + err.message);
    }
};

$('descargar').onclick = () => {
    const url = URL.createObjectURL(archivoGcode());
    const a = document.createElement('a');
    a.href = url;
    a.download = estado.resultado.archivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

$('otro').onclick = () => {
    estado.resultado = null;
    $('otroModelo').click();
    irA(1);
};

// ---------------------------------------------------------------------------
// App instalable y offline: registrar el service worker (sólo en el build;
// en `npm run dev` molestaría porque guarda versiones viejas).

function registrarServiceWorker() {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
    navigator.serviceWorker.register('./sw.js').then(registro => {
        // Si hay una versión nueva esperando, ofrecemos actualizar (no lo hacemos
        // solos para no cortar un laminado a la mitad).
        const ofrecer = sw => {
            if (!sw || !navigator.serviceWorker.controller) return;
            $('actualizacion').hidden = false;
            $('actualizar').onclick = () => sw.postMessage('actualizar');
        };
        ofrecer(registro.waiting);
        registro.addEventListener('updatefound', () => {
            const nuevo = registro.installing;
            nuevo.addEventListener('statechange', () => nuevo.state === 'installed' && ofrecer(nuevo));
        });
    }).catch(err => console.warn('No se pudo registrar el service worker', err));

    let recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!recargando && !$('actualizacion').hidden) {
            recargando = true;
            location.reload();
        }
    });
}

// ---------------------------------------------------------------------------
await cargarPreferencias();
dibujarOpciones();
mostrar(1);
mostrarRecientes();
almacen.pedirAlmacenamientoPersistente();
registrarServiceWorker();
