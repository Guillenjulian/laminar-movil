// Entrega del paso 4: qué archivo se baja o se comparte y cuándo se arma (ADR 0005, 3.5).
// Responsabilidad: leer `estado` y el perfil de la impresora, armar el archivo con `entrega.js` (.gcode o
// .gcode.3mf), guardar el último File en un cache por pausas, precargarlo y esperar su armado con los botones
// deshabilitados. Sale de paso4-resultado.js para que éste quede corto; no toca el DOM salvo #compartir y #descargar.
// Flujo: paso4 llama `precargar`/`programarPrecarga` al mostrar el resultado o cambiar las pausas, y
// `esperarArchivo(boton)` al tocar Compartir o Descargar; `soltarEntrega` al elegir otro modelo.
// No toca el DOM al importarse.

import { estado } from './estado.js';
import { $ } from './util-dom.js';
import * as materialesUI from './materiales.js';
import { armarEntrega, nombreEntrega } from './entrega.js';
import { buscarImpresora, lineasPausa, salidaDe } from '../perfiles/perfiles.js';

// Tipos que se prueban con canShare para el .gcode.3mf, en orden (ADR 0005, 3.5). El G-code plano usa text/plain.
const MIMES_3MF = ['application/octet-stream', 'application/zip', 'model/3mf'];
const MS_PRECARGA = 500; // espera tras cambiar las pausas antes de armar el archivo por adelantado

/** Último archivo armado: `{ resultado, clave, promesa }`. Guarda el File y nada más (no el string ni el zip). */
let cache = null;
/** MIME que aceptó `canShare` para el archivo (lo fija `puedeCompartir`); null = el del archivo. */
let mimeCompartir = null;
/** Función que recibe el avance 0..1 mientras un botón espera el armado; null si nadie espera. */
let avance = null;
let temporizador = 0;

/** Perfil de la impresora del resultado y cómo se entrega. @returns {{imp: object, formato: 'gcode'|'gcode.3mf'}} */
export function entregaDe() {
    const imp = buscarImpresora(estado.resultado.impresoraId);
    return { imp, formato: salidaDe(imp) };
}

/** Datos del .gcode.3mf: tiempo, gramos y material (el modelo Bambu va aparte, en `salida`).
 *  @returns {import('../motor/bambu-xml.js').InfoBambu} */
function infoBambu(imp) {
    const { info, archivo } = estado.resultado;
    const ext = imp.dispositivo.extruders[0];
    return {
        nombre: archivo.replace(/\.gcode$/i, ''),
        tiempo: info.tiempo,
        gramos: materialesUI.gramosDe(info.filamento, ext.extFilament, estado.material),
        metros: info.filamento / 1000,
        boquilla: ext.extNozzle,
        filamento: { tipo: materialesUI.material(estado.material).nombre, color: '#FFFFFF', trayInfoIdx: 'GFL99' },
        soportes: estado.soportes,
    };
}

/** Archivo a entregar con las pausas de ahora (.gcode, o .gcode.3mf en las Bambu). Se arma una vez por
 *  combinación de pausas: la clave es la impresora, el material y los offsets ordenados; si cambia, se rearma.
 *  @returns {Promise<File>} */
export function archivoEntrega() {
    const resultado = estado.resultado;
    const { imp, formato: tipo } = entregaDe();
    const pausas = [...estado.pausas.values()].sort((x, y) => x.offset - y.offset);
    const clave = [resultado.impresoraId, estado.material, estado.soportes, ...pausas.map(p => p.offset)].join('|');
    if (cache?.resultado === resultado && cache.clave === clave) return cache.promesa;
    const salida = { formato: tipo, pausa: lineasPausa(imp), modelo: imp.modeloBambu };
    const promesa = armarEntrega(resultado, pausas, salida, tipo === 'gcode.3mf' ? infoBambu(imp) : undefined, f =>
        avance?.(f),
    );
    cache = { resultado, clave, promesa };
    promesa.catch(() => cache?.promesa === promesa && (cache = null)); // un fallo no se queda en el cache
    return promesa;
}

/** Arma por adelantado el .gcode.3mf (sin esperarlo) para que Compartir lo tenga listo. Sólo en las Bambu.
 *  @returns {void} */
export function precargar() {
    clearTimeout(temporizador);
    if (!estado.resultado || entregaDe().formato !== 'gcode.3mf') return;
    archivoEntrega().catch(() => {}); // si falla, el error se muestra al tocar el botón
}

/** Espera el archivo con los botones deshabilitados y "Armando el archivo…" (con el avance) en el que se tocó.
 *  @param {HTMLElement} boton @returns {Promise<File>} */
export async function esperarArchivo(boton) {
    if (entregaDe().formato !== 'gcode.3mf') return archivoEntrega(); // el .gcode plano sale al instante, como antes
    const botones = [$('compartir'), $('descargar')];
    const texto = boton.textContent;
    const pintar = f => (boton.textContent = `Armando el archivo… ${Math.round((f || 0) * 100)} %`);
    botones.forEach(b => (b.disabled = true));
    avance = pintar;
    pintar(0);
    try {
        return await archivoEntrega();
    } finally {
        avance = null;
        boton.textContent = texto;
        botones.forEach(b => (b.disabled = false));
    }
}

/** Vuelve a precargar poco después, cuando dejaron de cambiar las pausas. @returns {void} */
export function programarPrecarga() {
    clearTimeout(temporizador);
    temporizador = setTimeout(precargar, MS_PRECARGA);
}

/** Suelta el archivo guardado (al elegir otro modelo). @returns {void} */
export function soltarEntrega() {
    clearTimeout(temporizador);
    cache = null;
}

/** ¿Se puede compartir? Prueba `canShare` con un File vacío del nombre y MIME finales (no arma el ZIP) y se queda
 *  con el primer MIME aceptado.  @param {string} archivo `resultado.archivo` @returns {boolean} */
export function puedeCompartir(archivo) {
    const { formato: tipo } = entregaDe();
    const nombre = nombreEntrega(archivo, tipo);
    const tipos = tipo === 'gcode.3mf' ? MIMES_3MF : ['text/plain'];
    mimeCompartir = tipos.find(type => navigator.canShare?.({ files: [new File([], nombre, { type })] })) ?? null;
    return mimeCompartir !== null;
}

/** El archivo con el MIME que aceptó `canShare` (sin copiar los datos). @param {File} archivo @returns {File} */
export function paraCompartir(archivo) {
    return mimeCompartir && mimeCompartir !== archivo.type
        ? new File([archivo], archivo.name, { type: mimeCompartir })
        : archivo;
}
