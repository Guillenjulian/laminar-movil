// Pruebas de armarGcode3mf (ADR 0005, T4) en Node: se arma un .gcode.3mf y se abre con jszip para revisar entradas,
// bytes del G-code, MD5, slice_info, rels, pausas, errores y un G-code de 40 MB.

import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { ENTRADAS, armarGcode3mf } from '../../src/motor/bambu-3mf.js';
import { insertarPausas } from '../../src/motor/pausas.js';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const info = {
    nombre: 'cubo-20mm',
    tiempo: 1919.6,
    gramos: 4.368,
    metros: 1.4637,
    modelo: { id: 'N2S' },
    filamento: { tipo: 'PLA', color: '#FFAA00', trayInfoIdx: 'GFL99' },
};
const md5De = bytes => createHash('md5').update(bytes).digest('hex').toUpperCase();
const abrir = async blob => JSZip.loadAsync(await blob.arrayBuffer());
const bytesDe = (zip, nombre) => zip.file(nombre).async('uint8array');
const textoDe = (zip, nombre) => zip.file(nombre).async('string');
const iguales = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const mensaje = fn =>
    fn().then(
        () => null,
        e => e.message,
    );
const mismos = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function gcodeDePrueba() {
    const capa = n => `;LAYER:${n}\nG1 X${n} Y${n} E0.5 F1200 ; capa ñandú, pieza áéíóú\n`;
    return `; Cabecera con tildes y ñ: Laminación ñoña\n${capa(0)}; ${'x'.repeat(10 * 1024)}\n${capa(1)}${capa(2)}`;
}

async function probarEntradasYBytes({ revisar }) {
    const gcode = gcodeDePrueba();
    const entrada = new TextEncoder().encode(gcode);
    const zip = await abrir(await armarGcode3mf(gcode, info));
    const sinMini = Object.values(ENTRADAS).filter(n => !n.endsWith('.png'));
    revisar('bambu-3mf: entradas exactas sin miniatura', mismos(Object.keys(zip.files), sinMini));
    const chico = new Uint8Array([137, 80, 78, 71, 9, 8, 7]);
    const conMini = await abrir(await armarGcode3mf(gcode, { ...info, miniatura: PNG, miniaturaChica: chico }));
    revisar('bambu-3mf: entradas exactas con miniatura', mismos(Object.keys(conMini.files), Object.values(ENTRADAS)));
    revisar(
        'bambu-3mf: los PNG del zip son los pasados, byte a byte',
        iguales(await bytesDe(conMini, ENTRADAS.miniatura), PNG) &&
            iguales(await bytesDe(conMini, ENTRADAS.miniaturaChica), chico),
    );
    const soloGrande = await abrir(await armarGcode3mf(gcode, { ...info, miniatura: PNG }));
    revisar(
        'bambu-3mf: sin miniaturaChica, la chica es la grande byte a byte',
        iguales(await bytesDe(soloGrande, ENTRADAS.miniaturaChica), PNG),
    );
    const sinNombre = await abrir(await armarGcode3mf(gcode, { ...info, nombre: undefined }));
    const textos = [ENTRADAS.modelo, ENTRADAS.modelSettings, ENTRADAS.sliceInfo];
    const todos = (await Promise.all(textos.map(t => textoDe(sinNombre, t)))).join('');
    revisar(
        'bambu-3mf: sin info.nombre el título es "pieza", no "undefined"',
        todos.includes('pieza') && !todos.includes('undefined'),
    );
    const adentro = await bytesDe(zip, ENTRADAS.gcode);
    revisar('bambu-3mf: plate_1.gcode idéntico byte a byte (ñ, tildes, línea de 10 KB)', iguales(adentro, entrada));
    const md5 = await textoDe(zip, ENTRADAS.md5);
    revisar('bambu-3mf: md5 = node:crypto de los bytes UTF-8', md5 === md5De(entrada), md5);
    revisar('bambu-3mf: md5 de 32 caracteres, mayúsculas y sin \\n', /^[0-9A-F]{32}$/.test(md5));
    const otro = await abrir(await armarGcode3mf(gcode.replace('Laminación', 'Laminacióm'), info));
    revisar('bambu-3mf: el md5 cambia si cambia un byte', (await textoDe(otro, ENTRADAS.md5)) !== md5);
    return conMini;
}

async function probarXml({ revisar }, zip) {
    const slice = await textoDe(zip, ENTRADAS.sliceInfo);
    const valor = k => new RegExp(`key="${k}" value="([^"]*)"`).exec(slice)?.[1];
    revisar(
        'bambu-3mf: slice_info coherente con info',
        valor('prediction') === '1920' &&
            valor('weight') === '4.37' &&
            valor('printer_model_id') === 'N2S' &&
            slice.includes('used_g="4.37"') &&
            slice.includes('type="PLA"') &&
            slice.includes('color="#FFAA00"'),
    );
    const tipos = await textoDe(zip, ENTRADAS.contentTypes);
    revisar(
        'bambu-3mf: Content_Types declara rels, model, gcode y png',
        ['rels', 'model', 'gcode', 'png'].every(e => tipos.includes(`Extension="${e}"`)),
    );
    const rels = await textoDe(zip, ENTRADAS.rels);
    const destinos = [...rels.matchAll(/Target="\/([^"]+)"/g)].map(m => m[1]);
    revisar(
        'bambu-3mf: rels apuntan a entradas que existen',
        destinos.length === 4 && destinos.every(d => zip.file(d)),
    );
}

async function probarPausas({ revisar }) {
    const base = gcodeDePrueba();
    const pausas = [
        { capa: 1, offset: base.indexOf(';LAYER:1'), z: 0.4 },
        { capa: 2, offset: base.indexOf(';LAYER:2'), z: 0.6 },
    ];
    const conPausas = insertarPausas(base, pausas, ['M400 U1']);
    const dentro = await textoDe(await abrir(await armarGcode3mf(conPausas, info)), ENTRADAS.gcode);
    const offsets = t => [...t.matchAll(/M400 U1/g)].map(m => m.index);
    const previas = [...dentro.matchAll(/; --- PAUSA: [^\n]*---\nM400 U1\n/g)];
    revisar(
        'bambu-3mf: dos M400 U1, cada uno tras su línea PAUSA, mismo offset que sin zip',
        previas.length === 2 && mismos(offsets(dentro), offsets(conPausas)) && dentro === conPausas,
    );
}

async function probarErrores({ revisar }) {
    const sinModelo = 'Falta el modelo de impresora Bambu.';
    revisar(
        'bambu-3mf: error con G-code vacío',
        (await mensaje(() => armarGcode3mf('', info))) === 'El G-code está vacío.',
    );
    const a = await mensaje(() => armarGcode3mf('G28', { ...info, modelo: undefined }));
    const b = await mensaje(() => armarGcode3mf('G28', { ...info, modelo: {} }));
    revisar('bambu-3mf: error sin modelo', a === sinModelo && b === sinModelo);
}

async function probarGrande({ revisar }) {
    const capa = ';LAYER\nG1 X10.123 Y20.456 E0.0123 F1800 ; relleno ñandú\n'.repeat(1000);
    const gcode = capa.repeat(Math.ceil((40 * 1024 * 1024) / capa.length));
    const progreso = [];
    const t0 = performance.now();
    const blob = await armarGcode3mf(gcode, info, { alProgreso: f => progreso.push(f) });
    const seg = ((performance.now() - t0) / 1000).toFixed(1);
    const zip = await abrir(blob);
    const bytes = await bytesDe(zip, ENTRADAS.gcode);
    const crece = progreso.every((f, i) => f > 0 && f <= 1 && (i === 0 || f > progreso[i - 1]));
    const mb = n => (n / 1048576).toFixed(1);
    console.log(
        `    40 MB: ${seg} s, zip ${mb(blob.size)} MB, ${progreso.length} avisos, rss ${mb(process.memoryUsage().rss)} MB`,
    );
    revisar(
        'bambu-3mf: 40 MB, md5 correcto, alProgreso creciente que termina en 1, zip < 1/4',
        (await textoDe(zip, ENTRADAS.md5)) === md5De(bytes) &&
            bytes.length >= 40 * 1048576 &&
            progreso.length > 1 &&
            crece &&
            progreso.at(-1) === 1 &&
            blob.size < bytes.length / 4,
    );
}

/**
 * Corre todas las pruebas del .gcode.3mf de Bambu (ADR 0005, T4).
 * @param {{revisar: (nombre:string, condicion:boolean, detalle?:string) => void}} ayudas
 */
export async function probarBambu3mf({ revisar }) {
    console.log('\n▶ .gcode.3mf de Bambu');
    const zip = await probarEntradasYBytes({ revisar });
    await probarXml({ revisar }, zip);
    await probarPausas({ revisar });
    await probarErrores({ revisar });
    await probarGrande({ revisar });
}
