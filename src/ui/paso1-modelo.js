// Paso 1: subir un modelo y dejarlo bien puesto en la cama (ADR 0001, sección 3.3).
//
// Responsabilidad: subir/abrir un modelo (STL, OBJ, 3MF, foto para litofanía, ejemplo o reciente),
// mostrarlo en el visor y ajustarlo (escala, rotación, apoyar cara, avisos). Es el dueño exclusivo de
// `visor`, la instancia de crearVisor del paso 1.
//
// Flujo: iniciarPaso1 cablea los controles -> cargarArchivo (despacha por tipo) -> leerModelo
// (convierte y arma la vista) -> montarModelo (crea la pieza en `estado` y llena el visor) -> ajuste.aplicar
// (ajuste-modelo: escala, rotación, textos y avisos). "Siguiente" va al paso 2. Importarlo no toca el DOM.

import { leerParaVista, convertirAStl } from '../motor/motor.js';
import { buscarImpresora } from '../perfiles/perfiles.js';
import * as almacen from '../almacen.js';
import { crearVisor } from './visor-carga.js';
import { tipoArchivo, prepararLitofania } from './litofania.js';
import { prepararTorre } from './torres.js';
import { $ } from './util-dom.js';
import { estado, crearPieza } from './estado.js';
import { iniciarRecientes, mostrarRecientes, programarGuardado, guardarPendiente } from './recientes.js';
import { irA, abrirHoja, cerrarHojas, alMostrarPaso } from './navegacion.js';
import { crearAjuste } from './ajuste-modelo.js';
import { crearPiezas } from './piezas-ui.js';
import { crearBloqueosUI } from './bloqueos-ui.js';

export { mostrarRecientes }; // main.js lo importa desde acá (ADR 0001)

let visor = null; // visor del modelo (se crea al cargar el primer modelo)
let litofania = null; // hoja "Litofanía desde una foto" (se crea en iniciarPaso1)
let torres = null; // hoja "Torre de calibración" (se crea en iniciarPaso1)
const ajuste = crearAjuste({
    visor: () => visor,
    alCambiar: () => {
        programarGuardado();
        piezas.reacomodar();
        bloqueos.sincronizar(); // después de acomodar: si cambió la pieza, vacía las zonas y lo avisa (ADR 0004)
    },
    alActivarCara: () => bloqueos.apagar(), // "apoyar cara" y "marcar zona" son modos excluyentes
    torres: () => torres,
});
const piezas = crearPiezas({
    visor: () => visor,
    ajuste,
    ejemplo: bufferEjemplo,
    leer: (nombre, buffer) => leerModelo(nombre, buffer, tipoArchivo(nombre), null), // mismo camino que cargarArchivo
    elegirOtro: elegirOtroModelo,
    guardar: almacen.guardarModelo, // las piezas agregadas también van a recientes
    alReacomodar: () => bloqueos.dibujar(), // cambió la pieza activa, las copias o sus posiciones: las marcas siguen
});
// Panel "Zona sin soporte" (ADR 0004): sólo modelos; el aviso va a la región viva del panel.
const bloqueos = crearBloqueosUI({
    visor: () => visor,
    avisar: msg => {
        $('bloqueoAyuda').textContent = msg;
    },
    nuevoId: () => ++estado.ultimoIdBloqueo,
    cancelarCara: () => ajuste.cancelarCara(),
});

/**
 * Cablea #archivo, #foto, #otroModelo, #ejemplo, #siguiente, la lista de recientes, escala,
 * rotaciones, "ajustar a la cama", "restablecer" y "apoyar cara"; crea la hoja de litofanía y se
 * suscribe a alMostrarPaso para pausar el visor fuera del paso 1. Llamar una vez, después de
 * iniciarNavegacion().
 * @returns {void}
 */
export function iniciarPaso1() {
    alMostrarPaso(paso => visor?.pausar(paso !== 1));
    litofania = prepararLitofania({
        abrir: () => abrirHoja('litofania'),
        cerrar: cerrarHojas,
        cargar: (nombre, generar) => cargarArchivo(nombre, null, { generar }),
    });
    torres = prepararTorre({
        abrir: () => abrirHoja('torre'),
        cerrar: cerrarHojas,
        cargar: (nombre, generar, torre) => cargarArchivo(nombre, null, { generar, guardar: false, torre }),
        contexto: () => ({ impresoraId: estado.impresoraId, material: estado.material }),
    });
    $('botonTorre').onclick = torres.abrir;
    conectarSubida();
    ajuste.conectar();
    piezas.conectar();
    bloqueos.conectar();
}

/**
 * Pone la cama del visor con la impresora elegida y recalcula los avisos del modelo.
 * Callback de impresoras ("alElegir"). No hace nada si el visor aún no existe.
 * @returns {void}
 */
export function alCambiarImpresora() {
    if (visor) {
        const d = buscarImpresora(estado.impresoraId).dispositivo;
        visor.ponerCama({ x: d.bedWidth, y: d.bedDepth, z: d.maxHeight });
    }
    ajuste.actualizarAviso();
    piezas.reacomodar();
}

/**
 * Vuelve a la pantalla inicial del paso 1 (olvida el modelo, lo quita del visor, deshabilita
 * #siguiente y relista recientes). Equivale a tocar #otroModelo.
 * @returns {void}
 */
export function elegirOtroModelo() {
    guardarPendiente();
    estado.piezas = [];
    estado.activa = null;
    estado.torre = null;
    visor?.quitarModelo();
    bloqueos.dibujar(); // sin pieza: esconde el panel y saca las marcas
    $('conModelo').hidden = true;
    $('sinModelo').hidden = false;
    $('siguiente').disabled = true;
    mostrarRecientes();
}

/** Cablea la subida: archivo, foto, otro modelo, ejemplo, recientes y "Siguiente". */
function conectarSubida() {
    $('archivo').onchange = alElegirArchivo;
    $('foto').onchange = alElegirArchivo;
    $('otroModelo').onclick = elegirOtroModelo;
    $('siguiente').onclick = () => irA(2);
    $('ejemplo').onclick = async () => {
        try {
            await cargarArchivo('cubo-20mm.stl', await bufferEjemplo());
        } catch (err) {
            alert('No pudimos leer el archivo: ' + err.message);
        }
    };
    iniciarRecientes((nombre, stl, transformacion) => cargarArchivo(nombre, stl, { esStl: true, transformacion }));
}

/** Descarga el cubo de ejemplo (lo usan #ejemplo y "Agregar cubo de ejemplo"). */
async function bufferEjemplo() {
    const r = await fetch(new URL('ejemplos/cubo-20mm.stl', document.baseURI));
    if (!r.ok) throw new Error('No se pudo descargar el ejemplo (' + r.status + ')');
    return r.arrayBuffer();
}

/** Handler de #archivo y #foto: lee el archivo elegido y lo carga. */
async function alElegirArchivo(e) {
    const archivo = e.target.files[0];
    e.target.value = ''; // para poder elegir el mismo archivo otra vez
    if (archivo) await cargarArchivo(archivo.name, await archivo.arrayBuffer());
}

/**
 * Acepta STL, OBJ y 3MF (estos dos se convierten a STL en un worker). Una foto abre la hoja de
 * litofanía.
 * `esStl`: el buffer ya es STL aunque el nombre diga .obj/.3mf (los recientes guardan el STL
 * convertido con el nombre original). `generar`: función que devuelve una promesa con el STL.
 * `transformacion`: `{ rotacion, escala }` guardada de un reciente (si falta, identidad y 100 %).
 */
async function cargarArchivo(
    nombre,
    buffer,
    { guardar = true, esStl = false, generar = null, transformacion = null, torre = null } = {},
) {
    const tipo = esStl || generar ? 'stl' : tipoArchivo(nombre);
    if (tipo === 'imagen') return litofania.abrirFoto(nombre, buffer);
    if (!tipo) {
        alert('No sabemos leer ese archivo. Elegí un modelo STL, OBJ o 3MF (o una foto para hacer una litofanía).');
        return;
    }
    $('cargando').hidden = false;
    $('sinModelo').hidden = true;
    try {
        const datos = await leerModelo(nombre, buffer, tipo, generar);
        montarModelo(nombre, datos, transformacion, torre, generar ? 'litofania' : 'modelo');
        // Guardarlo en recientes (si falla, por ejemplo por falta de espacio, no pasa nada).
        if (guardar)
            await almacen.guardarModelo(nombre, datos.buffer).catch(err => console.warn('No se guardó el modelo', err));
    } catch (err) {
        // Si ya había un modelo cargado, queda ése; si no, volvemos a la pantalla inicial.
        $('sinModelo').hidden = !!estado.stl;
        alert('No pudimos leer el archivo: ' + err.message);
    } finally {
        $('cargando').hidden = true;
    }
}

/**
 * Convierte el archivo a STL si hace falta y arma la vista previa.
 * @returns {Promise<{buffer: ArrayBuffer, vertices: Float32Array, triangulos: number, tamano: object}>}
 */
async function leerModelo(nombre, buffer, tipo, generar) {
    if (generar) buffer = await generar();
    else if (tipo !== 'stl') buffer = (await convertirAStl(nombre, buffer)).stl;
    // La vista previa se arma en un worker; le pasamos una copia del archivo.
    const { vertices, triangulos, tamano } = await leerParaVista(buffer.slice(0));
    return { buffer, vertices, triangulos, tamano };
}

/** Llena `estado`, crea el visor si falta, pone cama y modelo y actualiza los textos del paso. */
function montarModelo(nombre, { buffer, vertices, triangulos, tamano }, transformacion, torre, origen) {
    estado.resultado = null;
    estado.torre = torre; // la torre fija sus alturas: sin escala ni rotación
    estado.cambios = []; // los cambios por altura dependen del modelo
    $('ajustesModelo').hidden = !!torre;

    $('conModelo').hidden = false;
    if (!visor) {
        // Mientras three.js carga, la medida real no existe: al quedar listo se rehace con ella (ADR 0006).
        visor = crearVisor($('visor'), {
            alListo: () => {
                ajuste.aplicar();
                piezas.reacomodar();
            },
        });
    }
    const imp = buscarImpresora(estado.impresoraId).dispositivo;
    visor.ponerCama({ x: imp.bedWidth, y: imp.bedDepth, z: imp.maxHeight });

    // La pieza se crea antes (para tener su id) pero entra en `estado` después del visor: si ponerModelo
    // lanza, estado no apunta a una pieza sin malla.
    const pieza = crearPieza({
        nombre,
        stl: buffer,
        vista: { triangulos, tamano },
        transformacion: transformacion ?? almacen.normalizarTransformacion(),
        origen: torre ? 'torre' : origen,
    });
    visor.ponerModelo(vertices, pieza.id);
    estado.piezas = [pieza];
    estado.activa = pieza.id;
    $('nombreModelo').textContent = nombre;
    ajuste.cancelarCara();
    ajuste.aplicar();
    piezas.dibujar();
    bloqueos.dibujar(); // el panel sólo se ve con un modelo (no con torre ni litofanía)
    $('siguiente').disabled = false;
}
