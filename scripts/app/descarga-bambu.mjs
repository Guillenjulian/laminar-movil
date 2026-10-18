// Descarga del .gcode.3mf de una Bambu y vuelta al .gcode de una Ender (ADR 0005, T7).
//
// Flujo: elige la Bambu Lab A1, lamina el cubo y baja el archivo sin pausas, con una pausa (capa 10) y con
// dos (capas 10 y 30: prueba que el cache no sirve un archivo viejo). Abre cada descarga con jszip: nombre
// *.gcode.3mf, las entradas de ENTRADAS, un M400 U1 por pausa en la capa marcada y el MD5 de plate_1.gcode.
// Después vuelve a la Ender 3 V3 SE, lamina, marca una pausa y comprueba que la descarga sigue siendo un
// .gcode de texto con M600, sin ZIP.
//
// Precondición: paso 2 visible con el cubo de 20 mm cargado y la Ender 3 V3 SE elegida (tras descarga.mjs).
// Deja: paso 2, otra vez con la Ender 3 V3 SE y el cubo, sin resultado en pantalla (igual que descarga.mjs).

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { ENTRADAS } from '../../src/motor/bambu-3mf.js';

const NOMBRE = 'cubo-20mm_rapido';
const OBLIGATORIAS = [
    ENTRADAS.contentTypes,
    ENTRADAS.rels,
    ENTRADAS.modelo,
    ENTRADAS.gcode,
    ENTRADAS.md5,
    ENTRADAS.sliceInfo,
    ENTRADAS.modelSettings,
];
const md5De = datos => createHash('md5').update(datos).digest('hex').toUpperCase();

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarDescargaBambu(ctx) {
    await elegirYLaminar(ctx, 'bambu-lab-a1');
    await revisarSinPausas(ctx);
    await marcarPausa(ctx, 10);
    await revisarUnaPausa(ctx);
    await marcarPausa(ctx, 30);
    await revisarDosPausas(ctx);
    await revisarOtroMaterial(ctx);
    await elegirYLaminar(ctx, 'creality-ender-3-v3-se');
    await revisarEnder(ctx);
    await ctx.page.goBack();
}

/** Desde el paso 2: elige la impresora, lamina y espera el paso 4. */
async function elegirYLaminar({ page: pagina, ok: revisar, visible, esperarResultado }, id) {
    await pagina.tap('#cambiarImpresora');
    await pagina.tap(`[data-id="${id}"]`);
    revisar(`${id}: elegida`, (await visible('section[data-paso="2"]')) && !(await visible('#hojaImpresoras')));
    await pagina.tap('#laminar');
    await esperarResultado();
}

/** Marca una pausa en la capa n (índice de #capa) de la vista previa. */
async function marcarPausa({ page: pagina }, n) {
    await pagina.locator('#capa').fill(String(n));
    await pagina.tap('#pausarCapa');
}

/** Toca Descargar y devuelve el nombre sugerido y los bytes. */
async function descargar({ page: pagina }) {
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    return { nombre: descarga.suggestedFilename(), bytes: fs.readFileSync(await descarga.path()) };
}

/** Abre el .gcode.3mf: devuelve el zip, el G-code y el texto del MD5. */
async function abrir(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    return {
        zip,
        gcode: await zip.file(ENTRADAS.gcode).async('string'),
        md5: await zip.file(ENTRADAS.md5).async('string'),
    };
}

async function revisarSinPausas(ctx) {
    const { page: pagina, ok: revisar } = ctx;
    revisar(
        'Bambu: #nombreArchivo muestra el .gcode.3mf',
        (await pagina.textContent('#nombreArchivo')) === `${NOMBRE}.gcode.3mf`,
    );
    revisar(
        'Bambu: el botón dice "Compartir archivo"',
        (await pagina.textContent('#compartir')) === 'Compartir archivo',
    );
    const { nombre, bytes } = await descargar(ctx);
    revisar('Bambu: la descarga se llama *.gcode.3mf', nombre === `${NOMBRE}.gcode.3mf`, nombre);
    const { zip, gcode, md5 } = await abrir(bytes);
    const entradas = Object.keys(zip.files).sort();
    revisar(
        'Bambu: el ZIP tiene exactamente las entradas de ENTRADAS',
        entradas.join('|') === [...OBLIGATORIAS].sort().join('|'),
        entradas.join(', '),
    );
    revisar('Bambu: sin pausas no hay M400 U1', !gcode.includes('M400 U1'));
    revisar('Bambu: el MD5 es el de plate_1.gcode', md5 === md5De(gcode), md5);
    const info = await zip.file(ENTRADAS.sliceInfo).async('string');
    revisar('Bambu: slice_info.config con printer_model_id N2S', /printer_model_id" value="N2S"/.test(info));
    revisar('Bambu: el filamento es PLA', /type="PLA"/.test(info));
    revisar(
        'Bambu: los botones quedan habilitados',
        !(await pagina.isDisabled('#descargar')) && !(await pagina.isDisabled('#compartir')),
    );
}

/** Z (mm) de la primera pausa de la lista, de su texto ("⏸ pausa en Z 3,08 mm"). */
async function zDeLaPausa(pagina) {
    const texto = await pagina.locator('#listaPausas small').first().textContent();
    return Number(texto.match(/Z ([\d,]+)/)[1].replace(',', '.'));
}

/** Cuenta los M400 U1 y da la Z de la primera G1 Z que sigue al primero. */
function pausasDe(gcode) {
    const l = gcode.split('\n'),
        i = l.indexOf('M400 U1');
    const sigue = l.slice(i + 1).find(x => /^G1 Z[\d.]+/.test(x));
    return { n: l.filter(x => x === 'M400 U1').length, z: sigue && Number(sigue.match(/^G1 Z([\d.]+)/)[1]) };
}

async function revisarUnaPausa(ctx) {
    const { page: pagina, ok: revisar } = ctx;
    const { nombre, bytes } = await descargar(ctx);
    const { gcode, md5 } = await abrir(bytes);
    const { n, z } = pausasDe(gcode);
    const marcada = await zDeLaPausa(pagina);
    revisar('Bambu con una pausa: *.gcode.3mf', nombre === `${NOMBRE}.gcode.3mf`, nombre);
    revisar(
        'Bambu con una pausa: un M400 U1 en la capa marcada',
        n === 1 && Math.abs(z - marcada) < 0.006,
        `${n} veces, Z ${z} (marcada ${marcada})`,
    );
    revisar('Bambu con una pausa: el MD5 coincide con el G-code del ZIP', md5 === md5De(gcode));
}

// El archivo tiene que cambiar al cambiar las pausas: si el cache no se invalida, sale el de una sola pausa.
async function revisarDosPausas(ctx) {
    const { ok: revisar } = ctx;
    const { bytes } = await descargar(ctx);
    const { gcode, md5 } = await abrir(bytes);
    const { n } = pausasDe(gcode);
    revisar('Bambu con dos pausas: dos M400 U1 (el cache se renueva)', n === 2, `${n}`);
    revisar('Bambu con dos pausas: el MD5 sigue coincidiendo', md5 === md5De(gcode));
}

// Otro material y a laminar de nuevo: el archivo no puede ser el del resultado anterior (slice_info con PETG, sin pausas).
async function revisarOtroMaterial(ctx) {
    const { page: pagina, ok: revisar } = ctx;
    await pagina.goBack();
    await pagina.tap('label.opcion:has(input[value="petg"])');
    await pagina.tap('#laminar');
    await ctx.esperarResultado();
    const { bytes } = await descargar(ctx);
    const { zip, gcode } = await abrir(bytes);
    const info = await zip.file(ENTRADAS.sliceInfo).async('string');
    revisar('Bambu con PETG: slice_info con type="PETG"', /type="PETG"/.test(info) && !/type="PLA"/.test(info));
    revisar('Bambu con PETG: sin las pausas del resultado anterior', !gcode.includes('M400 U1'));
    await pagina.goBack();
    await pagina.tap('label.opcion:has(input[value="pla"])');
}

/** Cuenta los `File` con contenido que arma la app (los vacíos de canShare no cuentan), sin tocar el código de la app:
 *  envuelve `window.File` en la página. @returns {Promise<void>} */
const contarArchivos = pagina =>
    pagina.evaluate(() => {
        const Original = window.File;
        window.__archivos = 0;
        window.__FileOriginal = Original;
        window.File = class extends Original {
            constructor(partes, ...resto) {
                super(partes, ...resto);
                if (partes.some(p => (p.size ?? p.length) > 0)) window.__archivos++;
            }
        };
    });
const archivosArmados = pagina => pagina.evaluate(() => window.__archivos);

async function revisarEnder(ctx) {
    const { page: pagina, ok: revisar } = ctx;
    revisar(
        'Ender: #nombreArchivo sigue siendo el .gcode',
        (await pagina.textContent('#nombreArchivo')) === `${NOMBRE}.gcode`,
    );
    revisar(
        'Ender: el botón sigue diciendo "Compartir G-code"',
        (await pagina.textContent('#compartir')) === 'Compartir G-code',
    );
    await contarArchivos(pagina);
    await marcarPausa(ctx, 10);
    await pagina.waitForTimeout(1500); // más que la espera de la precarga (500 ms)
    revisar(
        'Ender: no se arma nada antes de tocar Descargar',
        (await archivosArmados(pagina)) === 0,
        `${await archivosArmados(pagina)} archivos`,
    );
    const { nombre, bytes } = await descargar(ctx);
    revisar('Ender: se arma al tocar Descargar', (await archivosArmados(pagina)) === 1);
    await pagina.evaluate(() => (window.File = window.__FileOriginal));
    const texto = bytes.toString('utf8');
    revisar('Ender: la descarga sigue llamándose *.gcode', nombre === `${NOMBRE}.gcode`, nombre);
    revisar(
        'Ender: texto plano (no es un ZIP) con un M600 y sin M400 U1',
        bytes.subarray(0, 2).toString() !== 'PK' && texto.split('\nM600\n').length === 2 && !texto.includes('M400 U1'),
    );
}
