// Paso 1: subir un modelo y dejarlo bien puesto en la cama (ADR 0001, sección 3.3).
//
// Responsabilidad: subir/abrir un modelo (STL, OBJ, 3MF, foto para litofanía, ejemplo o reciente),
// mostrarlo en el visor y ajustarlo (escala, rotación, apoyar cara, avisos). Es el dueño exclusivo de
// `visor`, la instancia de crearVisor del paso 1.
//
// Flujo: iniciarPaso1 cablea los controles -> cargarArchivo (despacha por tipo) -> leerModelo
// (convierte y arma la vista) -> montarModelo (llena `estado` y el visor) -> aplicarTransformacion
// (escala, rotación, textos y avisos). "Siguiente" va al paso 2. Importarlo no toca el DOM.

import { leerParaVista, convertirAStl } from '../motor/motor.js';
import * as transformar from '../motor/transformar.js';
import { buscarImpresora } from '../perfiles/perfiles.js';
import { maxTriangulos } from '../config.js';
import * as almacen from '../almacen.js';
import { crearVisor } from './visor.js';
import { tipoArchivo, prepararLitofania } from './litofania.js';
import * as formato from './formato.js';
import { $ } from './util-dom.js';
import { estado, matrizModelo } from './estado.js';
import { iniciarRecientes, mostrarRecientes, programarGuardado } from './recientes.js';
import { irA, abrirHoja, cerrarHojas, alMostrarPaso } from './navegacion.js';

export { mostrarRecientes }; // main.js lo importa desde acá (ADR 0001)

let visor = null; // visor del modelo (se crea al cargar el primer modelo)
let litofania = null; // hoja "Litofanía desde una foto" (se crea en iniciarPaso1)

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
    conectarSubida();
    conectarTransformacion();
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
    actualizarAvisoModelo();
}

/**
 * Vuelve a la pantalla inicial del paso 1 (olvida el modelo, lo quita del visor, deshabilita
 * #siguiente y relista recientes). Equivale a tocar #otroModelo.
 * @returns {void}
 */
export function elegirOtroModelo() {
    estado.stl = null;
    estado.vista = null;
    visor?.quitarModelo();
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
        const r = await fetch(new URL('ejemplos/cubo-20mm.stl', document.baseURI));
        await cargarArchivo('cubo-20mm.stl', await r.arrayBuffer());
    };
    iniciarRecientes((nombre, stl, transformacion) => cargarArchivo(nombre, stl, { esStl: true, transformacion }));
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
    { guardar = true, esStl = false, generar = null, transformacion = null } = {},
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
        montarModelo(nombre, datos, transformacion);
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
function montarModelo(nombre, { buffer, vertices, triangulos, tamano }, transformacion) {
    estado.nombre = nombre;
    estado.stl = buffer;
    estado.vista = { triangulos, tamano };
    estado.resultado = null;
    ({ rotacion: estado.rotacion, escala: estado.escala } = transformacion ?? almacen.normalizarTransformacion());

    $('conModelo').hidden = false;
    if (!visor) visor = crearVisor($('visor'));
    const imp = buscarImpresora(estado.impresoraId).dispositivo;
    visor.ponerCama({ x: imp.bedWidth, y: imp.bedDepth, z: imp.maxHeight });
    visor.ponerModelo(vertices);

    $('nombreModelo').textContent = nombre;
    activarElegirCara(false);
    aplicarTransformacion();
    $('siguiente').disabled = false;
}

// --- Modelo en la cama: avisos, escala, rotaciones y "apoyar cara" ---

/** Avisos sobre el modelo: si es muy pesado (se va a simplificar) o si no entra en la cama. */
function actualizarAvisoModelo() {
    if (!estado.vista) return;
    const { triangulos } = estado.vista;
    const tamano = tamanoActual();
    const imp = buscarImpresora(estado.impresoraId);
    const d = imp.dispositivo;
    const avisos = [];
    const noEntra = tamano.x > d.bedWidth || tamano.y > d.bedDepth || tamano.z > d.maxHeight;
    if (noEntra) {
        avisos.push(
            `<b>No entra en la ${imp.nombre}</b> (${d.bedWidth} × ${d.bedDepth} × ${d.maxHeight} mm). ` +
                'Rotalo o achicalo con los botones de abajo.',
        );
    }
    $('ajustarCama').hidden = !noEntra;
    const max = maxTriangulos();
    if (triangulos > max) {
        avisos.push(
            `<b>Modelo pesado:</b> tiene ${formato.triangulos(triangulos)}. Para que el celu no se quede ` +
                `sin memoria, antes de laminar lo vamos a simplificar a unos ${formato.triangulos(max)}. ` +
                'Se pueden perder detalles muy finos.',
        );
    }
    $('avisoModelo').innerHTML = avisos.join('<br><br>');
    $('avisoModelo').hidden = avisos.length === 0;
}

/** Tamaño del modelo como va a quedar en la cama. */
function tamanoActual() {
    return visor?.tamanoModelo() || estado.vista.tamano;
}

/** Aplica rotación y escala al visor y refresca escala, textos, "restablecer" y avisos. */
function aplicarTransformacion() {
    visor.ponerTransformacion(matrizModelo());
    const pct = Math.round(estado.escala * 1000) / 10;
    $('escala').value = pct;
    $('datosModelo').textContent =
        `${formato.milimetros(tamanoActual())} · ${formato.triangulos(estado.vista.triangulos)}`;
    $('restablecerModelo').hidden = estado.escala === 1 && transformar.esIdentidad(estado.rotacion);
    actualizarAvisoModelo();
    programarGuardado();
}

/** Cambia la escala (entre 0,01 y 20) y reaplica la transformación; ignora valores no positivos. */
function ponerEscala(s) {
    if (!(s > 0)) return;
    estado.escala = Math.min(20, Math.max(0.01, s));
    aplicarTransformacion();
}

/** "Apoyar cara": el usuario toca una cara y el modelo gira para que quede sobre la cama. */
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

/** Cablea escala, rotaciones, "ajustar a la cama", "restablecer" y "apoyar cara". */
function conectarTransformacion() {
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
        const t = tamanoActual(),
            s = estado.escala;
        const factor = Math.min(d.bedWidth / t.x, d.bedDepth / t.y, d.maxHeight / t.z) * 0.98;
        ponerEscala(Math.floor(s * factor * 100) / 100);
    };

    $('restablecerModelo').onclick = () => {
        estado.rotacion = transformar.identidad();
        estado.escala = 1;
        activarElegirCara(false);
        aplicarTransformacion();
    };
    $('apoyarCara').onclick = () => activarElegirCara(!estado.eligiendoCara);
}
