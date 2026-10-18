// Lógica de la app: 4 pasos (subir → configurar → laminar → listo).

import { laminar, leerRecorridos } from './motor/motor.js';
import { TIPOS, COLORES_FILAMENTO } from './motor/tipos-linea.js';
import { insertarPausas } from './motor/pausas.js';
import { buscarImpresora, materiales, armarConfiguracion, lineasPausa } from './perfiles/perfiles.js';
import { maxTriangulos, maxSegmentosVista } from './config.js';
import { crearVisor } from './ui/visor.js';
import * as formato from './ui/formato.js';
import * as almacen from './almacen.js';
import * as materialesUI from './ui/materiales.js';
import { $, escapar } from './ui/util-dom.js';
import { estado, matrizModelo, valoresActuales, cargarPreferencias } from './ui/estado.js';
import { iniciarNavegacion, mostrar, irA, alMostrarPaso } from './ui/navegacion.js';
import { iniciarImpresoras } from './ui/impresoras.js';
import { iniciarPaso2, dibujarOpciones, resumenPersonal } from './ui/paso2-config.js';
import { iniciarPaso1, alCambiarImpresora, elegirOtroModelo, mostrarRecientes } from './ui/paso1-modelo.js';

let visorCapas = null; // visor de la vista previa capa por capa (paso 4)

// PUENTE R3: pausa el visor de capas y la reproducción según el paso (pasa a vista-capas).
alMostrarPaso(p => {
    visorCapas?.pausar(p !== 4);
    if (p !== 4) pararReproduccion();
});
iniciarNavegacion();
iniciarPaso1();
materialesUI.iniciarMateriales();
iniciarImpresoras({
    alElegir: () => {
        dibujarOpciones();
        alCambiarImpresora();
    },
});
iniciarPaso2();

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
        personal: { ...estado.personal, avanzado: estado.avanzado },
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
            dispositivo,
            proceso,
            maxTriangulos: maxTriangulos(),
            transformacion: matrizModelo(),
            alProgresar: ponerProgreso,
            signal: estado.cancelar.signal,
        });
        const base = estado.nombre.replace(/\.(stl|obj|3mf)$/i, '').replace(/[^\w.-]+/g, '_');
        estado.resultado = {
            ...r,
            avisos,
            archivo: `${base}_${estado.calidad}.gcode`,
            impresoraId: estado.impresoraId,
        };
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
        notas.push(
            `Simplificamos el modelo de ${formato.triangulos(d.original)} a ${formato.triangulos(d.final)} ` +
                `para que entre en la memoria del celu (detalle mínimo ≈ ${formato.numero(d.precisionMm, 2)} mm).`,
        );
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
    b.textContent =
        n === 0
            ? '⏸ No se puede pausar en la primera capa'
            : estado.pausas.has(n)
              ? '✕ Quitar la pausa de esta capa'
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

function actualizarModoColor() {
    const conPausas = estado.pausas.size > 0;
    $('modoColor').hidden = !conPausas;
    $('modoColor')
        .querySelectorAll('[data-modo]')
        .forEach(b => b.classList.toggle('activo', b.dataset.modo === estado.modoColor));
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
    const tabla = [0, ...cortes].map((_, f) =>
        TIPOS.map(t => (porFilamento ? rgb(colorFilamento(f)).map(v => Math.round(v * t.brillo)) : t.color)),
    );
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
    elegirOtroModelo();
    irA(1);
};

// ---------------------------------------------------------------------------
// App instalable y offline: registrar el service worker (sólo en el build;
// en `npm run dev` molestaría porque guarda versiones viejas).

function registrarServiceWorker() {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
    navigator.serviceWorker
        .register('./sw.js')
        .then(registro => {
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
        })
        .catch(err => console.warn('No se pudo registrar el service worker', err));

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
