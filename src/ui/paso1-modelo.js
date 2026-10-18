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
import { $, escapar } from './util-dom.js';
import { estado, matrizModelo } from './estado.js';
import { irA, abrirHoja, cerrarHojas, alMostrarPaso } from './navegacion.js';

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

/**
 * Relee los modelos guardados y dibuja la lista de recientes.
 * @returns {Promise<void>}
 */
export async function mostrarRecientes() {
    const lista = await almacen.listarModelos().catch(() => []);
    $('recientes').hidden = lista.length === 0;
    $('listaRecientes').innerHTML = lista
        .map(
            m => `<li>
        <button class="reciente" data-id="${m.id}">
            <b>${escapar(m.nombre)}</b>
            <small>${new Date(m.fecha).toLocaleDateString('es-AR')} · ${formato.bytes(m.bytes)}</small>
        </button>
        <button class="borrar" data-borrar="${m.id}" aria-label="Borrar ${escapar(m.nombre)}">×</button>
    </li>`,
        )
        .join('');
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
        if (modelo && stl) await cargarArchivo(modelo.nombre, stl, { esStl: true });
    };
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
 */
async function cargarArchivo(nombre, buffer, { guardar = true, esStl = false, generar = null } = {}) {
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
        montarModelo(nombre, datos);
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
function montarModelo(nombre, { buffer, vertices, triangulos, tamano }) {
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
}
