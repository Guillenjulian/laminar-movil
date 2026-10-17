// Lógica de la app: 4 pasos (subir → configurar → laminar → listo).

import { laminar, leerParaVista } from './motor/motor.js';
import { impresoras, materiales, buscarImpresora, armarConfiguracion } from './perfiles/perfiles.js';
import { maxTriangulos } from './config.js';
import { crearVisor } from './ui/visor.js';
import * as formato from './ui/formato.js';
import * as almacen from './almacen.js';

const $ = id => document.getElementById(id);

const estado = {
    paso: 1,
    nombre: '',          // nombre del archivo STL
    stl: null,           // ArrayBuffer original (se copia en cada laminado)
    vista: null,         // { triangulos, tamano }
    impresoraId: impresoras[0].id,
    calidad: 'normal',
    material: 'pla',
    soportes: false,
    resultado: null,     // { gcode, info, archivo }
    cancelar: null,      // AbortController del laminado en curso
};

let visor = null;

// ---------------------------------------------------------------------------
// Navegación entre pasos. Usamos el historial del navegador para que el botón
// "atrás" del celu vuelva al paso anterior en vez de salir de la app.

function mostrar(paso) {
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
    $('main').scrollTo(0, 0);
}

function irA(paso, { reemplazar = false } = {}) {
    history[reemplazar ? 'replaceState' : 'pushState']({ paso }, '');
    mostrar(paso);
}

window.addEventListener('popstate', e => {
    if (estado.paso === 3) estado.cancelar?.abort();
    mostrar(e.state?.paso || 1);
});
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

        $('conModelo').hidden = false;
        if (!visor) visor = crearVisor($('visor'));
        const imp = buscarImpresora(estado.impresoraId).dispositivo;
        visor.ponerCama({ x: imp.bedWidth, y: imp.bedDepth, z: imp.maxHeight });
        visor.ponerModelo(vertices);

        $('nombreModelo').textContent = nombre;
        $('datosModelo').textContent = `${formato.milimetros(tamano)} · ${formato.triangulos(triangulos)}`;
        actualizarAvisoModelo();
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
    const { triangulos, tamano } = estado.vista;
    const imp = buscarImpresora(estado.impresoraId);
    const d = imp.dispositivo;
    const avisos = [];
    if (tamano.x > d.bedWidth || tamano.y > d.bedDepth || tamano.z > d.maxHeight) {
        avisos.push(`<b>No entra en la ${imp.nombre}</b> (${d.bedWidth} × ${d.bedDepth} × ${d.maxHeight} mm). ` +
            'Achicalo o rotalo en tu programa de diseño.');
    }
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

// ---------------------------------------------------------------------------
// Paso 2: impresora, calidad, material y soportes (todo en una sola pantalla)

function opcion(grupo, valor, titulo, detalle, marcado) {
    return `<label class="opcion">
        <input type="radio" name="${grupo}" value="${valor}" ${marcado ? 'checked' : ''}>
        <span><b>${titulo}</b>${detalle ? `<br><small>${detalle}</small>` : ''}</span>
    </label>`;
}

function dibujarOpciones() {
    const imp = buscarImpresora(estado.impresoraId);
    $('impresoras').innerHTML = impresoras.map(i => {
        const d = i.dispositivo;
        return opcion('impresora', i.id, i.nombre, `Cama ${d.bedWidth} × ${d.bedDepth} × ${d.maxHeight} mm · ` +
            `boquilla ${formato.numero(d.extruders[0].extNozzle, 1)} mm`, i.id === imp.id);
    }).join('');
    $('calidades').innerHTML = Object.entries(imp.calidades).map(([id, c]) =>
        opcion('calidad', id, c.nombre, c.descripcion, id === estado.calidad)).join('');
    $('materiales').innerHTML = Object.entries(materiales).filter(([id]) => !id.startsWith('_')).map(([id, m]) =>
        opcion('material', id, m.nombre, `Boquilla ${m.proceso.outputTemp} °C · cama ${m.proceso.outputBedTemp} °C`,
            id === estado.material)).join('');
    $('soportes').checked = estado.soportes;
}

document.querySelector('[data-paso="2"].pantalla').addEventListener('change', e => {
    const { name, value, checked } = e.target;
    if (name === 'impresora') {
        estado.impresoraId = value;
        const imp = buscarImpresora(value);
        if (!imp.calidades[estado.calidad]) estado.calidad = Object.keys(imp.calidades)[0];
        dibujarOpciones();
        if (visor) {
            const d = imp.dispositivo;
            visor.ponerCama({ x: d.bedWidth, y: d.bedDepth, z: d.maxHeight });
        }
        actualizarAvisoModelo();
    }
    if (name === 'calidad') estado.calidad = value;
    if (name === 'material') estado.material = value;
    if (e.target.id === 'soportes') estado.soportes = checked;
    guardarPreferencias();
});

// Las elecciones del paso 2 se recuerdan para la próxima vez.
function guardarPreferencias() {
    const { impresoraId, calidad, material, soportes } = estado;
    almacen.guardarAjuste('preferencias', { impresoraId, calidad, material, soportes }).catch(() => {});
}

async function cargarPreferencias() {
    const p = await almacen.leerAjuste('preferencias').catch(() => null);
    if (!p) return;
    // Sólo usamos lo que todavía existe (puede haber cambiado algún perfil).
    const imp = impresoras.find(i => i.id === p.impresoraId);
    if (imp) estado.impresoraId = imp.id;
    if (buscarImpresora(estado.impresoraId).calidades[p.calidad]) estado.calidad = p.calidad;
    if (materiales[p.material]) estado.material = p.material;
    estado.soportes = !!p.soportes;
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
        extras: estado.soportes ? { sliceSupportType: 'automatic' } : {},
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
            alProgresar: ponerProgreso,
            signal: estado.cancelar.signal,
        });
        const base = estado.nombre.replace(/\.stl$/i, '').replace(/[^\w.-]+/g, '_');
        estado.resultado = { ...r, avisos, archivo: `${base}_${estado.calidad}.gcode` };
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
        ['Filamento', formato.filamento(info.filamento, imp.dispositivo.extruders[0].extFilament)],
        ['Capas', formato.numero(info.capas)],
        ['Calidad', `${cal.nombre} · ${materiales[estado.material].nombre}${estado.soportes ? ' · con soportes' : ''}`],
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
}

// Usamos text/plain: varios celus no dejan compartir tipos "raros" como text/x-gcode.
function archivoGcode() {
    const { gcode, archivo } = estado.resultado;
    return new File([gcode], archivo, { type: 'text/plain' });
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
