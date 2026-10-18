// Pruebas de los textos XML del .gcode.3mf de Bambu (Node, sin ZIP ni navegador): XML bien formado, escapes,
// valores de slice_info.config, nombre con caracteres raros y miniaturas en rels / content types.

import {
    armarContentTypes,
    armarModelo,
    armarModelSettings,
    armarRels,
    armarSliceInfo,
    escaparXml,
} from '../../src/motor/bambu-xml.js';

// Chequeo propio: la declaración va primero y las etiquetas abren y cierran balanceadas.
function bienFormado(xml) {
    if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) return false;
    const pila = [];
    const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
    const cuerpo = xml.replace(/^<\?xml[^>]*\?>/, '');
    for (const m of cuerpo.matchAll(re)) {
        if (m[4]) continue;
        if (!m[1]) pila.push(m[2]);
        else if (pila.pop() !== m[2]) return false;
    }
    // lo que no es etiqueta no puede tener < ni > sueltos
    return pila.length === 0 && !/[<>]/.test(cuerpo.replace(re, ''));
}

// Valor del atributo `nombre` en la etiqueta que contiene `marca`.
const atributo = (xml, marca, nombre) => new RegExp(`<[^>]*${marca}[^>]*\\s${nombre}="([^"]*)"`).exec(xml)?.[1];
const clave = (xml, k) => atributo(xml, `key="${k}"`, 'value');

const info = {
    nombre: 'cubo-20mm',
    tiempo: 1919.6,
    gramos: 4.368,
    metros: 1.4637,
    modelo: { id: 'N2S' },
    boquilla: 0.4,
    filamento: { tipo: 'PLA', color: '#FFAA00', trayInfoIdx: 'GFL99' },
    soportes: true,
};
const RARO = 'a<"&\'>ñ';

function salidasBienFormadas(revisar) {
    const filamentoRaro = { tipo: RARO, color: RARO, trayInfoIdx: RARO };
    const salidas = {
        'content types (sin png)': armarContentTypes(false),
        'content types (con png)': armarContentTypes(true),
        'rels (sin png)': armarRels(false),
        'rels (con png)': armarRels(true),
        modelo: armarModelo(RARO),
        model_settings: armarModelSettings(RARO),
        slice_info: armarSliceInfo({ ...info, nombre: RARO, filamento: filamentoRaro }),
    };
    for (const [nombre, xml] of Object.entries(salidas)) {
        revisar(`bambu-xml: ${nombre} es XML bien formado y empieza con la declaración`, bienFormado(xml));
    }
    const roto = armarModelo('x').replace('<build/>', '<build>');
    revisar('bambu-xml: el chequeo de etiquetas detecta XML roto', !bienFormado(roto));
}

function escapes(revisar) {
    const todos = escaparXml('&<>"\'');
    revisar('bambu-xml: escaparXml cambia & < > " \'', todos === '&amp;&lt;&gt;&quot;&apos;', todos);
    revisar(
        'bambu-xml: escaparXml deja igual el texto sin nada que escapar',
        escaparXml('cubo ñandú 20mm') === 'cubo ñandú 20mm',
    );
}

function sliceInfo(revisar) {
    const xml = armarSliceInfo(info);
    const esperado = {
        prediction: '1920',
        weight: '4.37',
        printer_model_id: 'N2S',
        nozzle_diameters: '0.4',
        support_used: 'true',
    };
    for (const [k, v] of Object.entries(esperado))
        revisar(`slice_info: ${k} = ${v}`, clave(xml, k) === v, clave(xml, k));
    const fil = { used_g: '4.37', used_m: '1.46', tray_info_idx: 'GFL99', type: 'PLA', color: '#FFAA00' };
    for (const [k, v] of Object.entries(fil)) {
        const real = atributo(xml, 'filament id', k);
        revisar(`slice_info: filamento ${k} = ${v}`, real === v, real);
    }
    revisar('slice_info: nombre del objeto', atributo(xml, 'object identify_id', 'name') === 'cubo-20mm');
    const sin = armarSliceInfo({ ...info, metros: undefined, boquilla: undefined, soportes: undefined });
    const usado = atributo(sin, 'filament id', 'used_m');
    revisar(
        'slice_info: sin metros se estiman de los gramos (4,368 g → 1,46 m); boquilla 0.4 y sin soportes por defecto',
        usado === '1.46' && clave(sin, 'nozzle_diameters') === '0.4' && clave(sin, 'support_used') === 'false',
        usado,
    );
}

function nombreRaro(revisar) {
    const esc = 'a&lt;&quot;&amp;&apos;&gt;ñ';
    revisar(
        'armarModelo: el nombre queda escapado',
        armarModelo(RARO).includes(`<metadata name="Title">${esc}</metadata>`),
    );
    revisar('armarModelSettings: el nombre queda escapado', clave(armarModelSettings(RARO), 'name') === esc);
}

function miniaturas(revisar) {
    const con = armarRels(true);
    revisar('armarRels(false) no menciona png', !/png/i.test(armarRels(false)));
    revisar(
        'armarRels(true) apunta a plate_1.png y plate_1_small.png',
        con.includes('plate_1.png') && con.includes('plate_1_small.png'),
    );
    revisar('armarContentTypes(true) declara png', armarContentTypes(true).includes('Extension="png"'));
    revisar('armarContentTypes(false) no declara png', !armarContentTypes(false).includes('png'));
    const ct = armarContentTypes(false);
    revisar(
        'armarContentTypes declara rels, model y gcode',
        ['rels', 'model', 'gcode'].every(e => ct.includes(`Extension="${e}"`)),
    );
}

export async function probarBambuXml({ revisar }) {
    salidasBienFormadas(revisar);
    escapes(revisar);
    sliceInfo(revisar);
    nombreRaro(revisar);
    miniaturas(revisar);
}
