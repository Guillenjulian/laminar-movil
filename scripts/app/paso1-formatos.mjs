// Paso 1: otros formatos (OBJ, 3MF) y litofanía desde una foto.
//
// Flujo de probarFormatos: carga un OBJ, un 3MF (en pulgadas, dos copias), abre la hoja de litofanía
// con un PNG y genera el modelo, abre el OBJ desde "recientes" y vuelve al cubo.
//
// Precondición: paso 1 con algún modelo cargado (el cubo).
// Deja: paso 1 con el cubo cargado; en recientes quedan caja.obj, dos-cubos.3mf y degrade-litofania.stl.

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { pngGrises } from '../lib/png.mjs';

const MEDIDAS_OBJ = /^30,0 × 10,0 × 5,0 mm · 12 triángulos$/;

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarFormatos(ctx) {
    await probarObj(ctx);
    await probar3mf(ctx);
    await probarLitofania(ctx);
    await probarObjReciente(ctx);
}

// OBJ: caja de 30 × 10 × 5 con caras cuadradas e índices negativos.
async function probarObj({ page: pagina, ok: revisar, tmp, elegirArchivo }) {
    const obj = path.join(tmp, 'caja.obj');
    fs.writeFileSync(
        obj,
        'v 0 0 0\nv 30 0 0\nv 30 10 0\nv 0 10 0\nv 0 0 5\nv 30 0 5\nv 30 10 5\nv 0 10 5\n' +
            'f 1/1/1 4/1/1 3/1/1 2/1/1\nf 5 6 7 8\nf -8 -7 -3 -4\nf 2 3 7 6\nf -6 -5 -1 -2\nf 4 1 5 8\n',
    );
    await elegirArchivo(obj);
    const datos = await pagina.textContent('#datosModelo');
    revisar('OBJ: medidas y triángulos', MEDIDAS_OBJ.test(datos), datos);
}

// Un cubo de 1 pulgada: vértices y triángulos en el XML de 3MF.
function mallaCubo() {
    const vertices = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
    ];
    const triangulos = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ];
    return (
        '<mesh><vertices>' +
        vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('') +
        '</vertices><triangles>' +
        triangulos.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('') +
        '</triangles></mesh>'
    );
}

// 3MF: un cubo de 1 pulgada repetido dos veces (el segundo corrido 2" en X).
async function probar3mf({ page: pagina, ok: revisar, tmp, elegirArchivo, captura }) {
    const zip = new JSZip();
    zip.file(
        '3D/3dmodel.model',
        `<?xml version="1.0" encoding="UTF-8"?>
<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><object id="1" type="model">${mallaCubo()}</object></resources>
<build><item objectid="1"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></build></model>`,
    );
    const tmf = path.join(tmp, 'dos-cubos.3mf');
    fs.writeFileSync(tmf, await zip.generateAsync({ type: 'nodebuffer' }));
    await elegirArchivo(tmf);
    const datos = await pagina.textContent('#datosModelo');
    revisar('3MF: medidas en mm y triángulos', /^76,2 × 25,4 × 25,4 mm · 24 triángulos$/.test(datos), datos);
    await captura('1-3mf');
}

// Litofanía: PNG en escala de grises de 40 × 20 (degradé de negro a blanco).
async function probarLitofania({ page: pagina, ok: revisar, visible, tmp, captura }) {
    const datos = () => pagina.textContent('#datosModelo');
    const png = path.join(tmp, 'degrade.png');
    fs.writeFileSync(
        png,
        pngGrises(40, 20, x => Math.round((255 * x) / 39)),
    );
    await pagina.tap('#otroModelo');
    await pagina.setInputFiles('#foto', png);
    await pagina.waitForSelector('#hojaLitofania:not([hidden])');
    revisar(
        'foto: abre la hoja de litofanía',
        (await pagina.isChecked('input[name=tipo][value=litofania]')) &&
            (await pagina.inputValue('#formLitofania [name=ancho]')) === '100' &&
            (await pagina.textContent('#medidasLitofania')) === '100,0 × 50,0 × 3,2 mm',
        await pagina.textContent('#medidasLitofania'),
    );
    await captura('1-litofania');
    await pagina.tap('#generarLitofania');
    await pagina.waitForFunction(
        () => document.getElementById('nombreModelo').textContent === 'degrade-litofania.stl',
        null,
        { timeout: 60000 },
    );
    revisar(
        'litofanía: modelo cargado con medidas coherentes',
        !(await visible('#hojaLitofania')) && /^100,0 × 50,0 × 3,[0-2] mm/.test(await datos()),
        await datos(),
    );
    await pagina.waitForTimeout(500);
    await captura('1-litofania-modelo');
}

// El OBJ quedó en recientes ya convertido a STL: se abre sin volver a convertirlo.
async function probarObjReciente({ page: pagina, ok: revisar, visible, elegirArchivo }) {
    const datos = () => pagina.textContent('#datosModelo');
    await pagina.tap('#otroModelo');
    await pagina.tap('.reciente:has-text("caja.obj")');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'caja.obj');
    revisar('abrir un OBJ reciente', MEDIDAS_OBJ.test(await datos()), await datos());

    // Dejar el cubo cargado para seguir como antes.
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    revisar(
        'de vuelta al cubo',
        /^20,0 × 20,0 × 20,0 mm/.test(await datos()) && (await visible('section[data-paso="1"]')),
    );
}
