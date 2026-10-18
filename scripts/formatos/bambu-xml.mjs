// Pruebas de los textos XML del .gcode.3mf de Bambu (Node, sin ZIP ni navegador): XML bien formado, escapes,
// valores de slice_info.config, claves constantes, nombre con caracteres raros y miniaturas en rels / content types.
// Los valores se comparan contra la tabla de la sección 1.2 del ADR 0005, atributo por atributo.

import {
    armarContentTypes,
    armarModelo,
    armarModelSettings,
    armarRels,
    armarSliceInfo,
    escaparXml,
} from '../../src/motor/bambu-xml.js';

const NS_BAMBU = 'http://schemas.bambulab.com/package/2021';
const RARO = 'a<"&\'>ñ';
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

// Atributos de todas las etiquetas `nombre`, en orden: [{ Id: ..., Type: ... }, ...].
function etiquetas(xml, nombre) {
    const pares = texto => [...texto.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]);
    return [...xml.matchAll(new RegExp(`<${nombre}(\\s[^>]*?)?/?>`, 'g'))].map(m =>
        Object.fromEntries(pares(m[1] ?? '')),
    );
}
const metadatos = xml => Object.fromEntries(etiquetas(xml, 'metadata').map(a => [a.key, a.value]));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function salidasBienFormadas(revisar) {
    const filamentoRaro = { tipo: RARO, color: RARO, trayInfoIdx: RARO };
    const salidas = {
        'content types (sin png)': armarContentTypes(false),
        'content types (con png)': armarContentTypes(true),
        'rels (sin png)': armarRels(false),
        'rels (con png)': armarRels(true),
        modelo: armarModelo(RARO),
        model_settings: armarModelSettings(RARO),
        slice_info: armarSliceInfo({ ...info, nombre: RARO, modelo: { id: RARO }, filamento: filamentoRaro }),
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
    const sin = armarSliceInfo({ ...info, metros: undefined, boquilla: undefined, soportes: undefined });
    const usado = atributo(sin, 'filament id', 'used_m');
    revisar(
        'slice_info: sin metros se estiman de los gramos (4,368 g → 1,46 m); boquilla 0.4 y sin soportes por defecto',
        usado === '1.46' && clave(sin, 'nozzle_diameters') === '0.4' && clave(sin, 'support_used') === 'false',
        usado,
    );
}

function sliceInfoEscapado(revisar) {
    const filamento = { tipo: RARO, color: RARO, trayInfoIdx: RARO };
    const xml = armarSliceInfo({ ...info, nombre: RARO, modelo: { id: RARO }, filamento });
    const esc = escaparXml(RARO);
    revisar('slice_info: printer_model_id raro queda escapado', clave(xml, 'printer_model_id') === esc);
    revisar('slice_info: nombre raro queda escapado', atributo(xml, 'object identify_id', 'name') === esc);
    for (const k of ['color', 'type', 'tray_info_idx']) {
        revisar(`slice_info: filamento ${k} raro queda escapado`, atributo(xml, 'filament id', k) === esc);
    }
}

function constantes(revisar) {
    const si = armarSliceInfo(info);
    revisar(
        'slice_info: header_item iguales a la tabla',
        igual(etiquetas(si, 'header_item'), [
            { key: 'X-BBL-Client-Type', value: 'slicer' },
            { key: 'X-BBL-Client-Version', value: 'laminar-movil' },
        ]),
    );
    const meta = metadatos(si);
    revisar(
        'slice_info: claves constantes (index, timelapse_type, outside, label_object_enabled)',
        meta.index === '1' &&
            meta.timelapse_type === '0' &&
            meta.outside === 'false' &&
            meta.label_object_enabled === 'false',
        JSON.stringify(meta),
    );
    revisar('slice_info: exactamente las 9 claves de la tabla', Object.keys(meta).length === 9);
    revisar(
        'slice_info: object y filamento (id, skipped)',
        igual(etiquetas(si, 'object'), [{ identify_id: '1', name: 'cubo-20mm', skipped: 'false' }]) &&
            etiquetas(si, 'filament')[0].id === '1',
    );
    const ms = etiquetas(armarModelSettings('cubo-20mm'), 'metadata');
    revisar(
        'model_settings: metadatos iguales a la tabla',
        igual(ms, [
            { key: 'name', value: 'cubo-20mm' },
            { key: 'extruder', value: '1' },
            { key: 'plater_id', value: '1' },
            { key: 'plater_name', value: '' },
            { key: 'locked', value: 'false' },
            { key: 'object_id', value: '1' },
            { key: 'instance_id', value: '0' },
        ]),
        JSON.stringify(ms),
    );
    revisar('model_settings: <object id="1">', igual(etiquetas(armarModelSettings('x'), 'object'), [{ id: '1' }]));
}

function nombreRaro(revisar) {
    const esc = 'a&lt;&quot;&amp;&apos;&gt;ñ';
    revisar(
        'armarModelo: el nombre queda escapado',
        armarModelo(RARO).includes(`<metadata name="Title">${esc}</metadata>`),
    );
    revisar('armarModelSettings: el nombre queda escapado', clave(armarModelSettings(RARO), 'name') === esc);
}

function relacionesYTipos(revisar) {
    const rels = etiquetas(armarRels(true), 'Relationship');
    revisar(
        'armarRels(true): Id, Type y Target de cada Relationship',
        igual(rels, [
            {
                Target: '/3D/3dmodel.model',
                Id: 'rel-1',
                Type: 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel',
            },
            {
                Target: '/Metadata/plate_1.png',
                Id: 'rel-2',
                Type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail',
            },
            { Target: '/Metadata/plate_1.png', Id: 'rel-4', Type: `${NS_BAMBU}/cover-thumbnail-middle` },
            { Target: '/Metadata/plate_1_small.png', Id: 'rel-5', Type: `${NS_BAMBU}/cover-thumbnail-small` },
        ]),
        JSON.stringify(rels),
    );
    revisar(
        'armarRels(false): sólo la relación del modelo',
        igual(etiquetas(armarRels(false), 'Relationship'), rels.slice(0, 1)),
    );
    revisar('armarRels(true) menciona png', /png/.test(armarRels(true)));
    revisar('armarRels(false) no menciona png', !/png/i.test(armarRels(false)));
}

function tiposDeContenido(revisar) {
    const tipos = [
        { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' },
        { Extension: 'model', ContentType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' },
        { Extension: 'png', ContentType: 'image/png' },
        { Extension: 'gcode', ContentType: 'text/x.gcode' },
    ];
    const con = etiquetas(armarContentTypes(true), 'Default');
    revisar('armarContentTypes(true): Extension y ContentType de cada Default', igual(con, tipos), JSON.stringify(con));
    const sin = etiquetas(armarContentTypes(false), 'Default');
    revisar(
        'armarContentTypes(false): los mismos menos png',
        igual(
            sin,
            tipos.filter(t => t.Extension !== 'png'),
        ),
    );
}

/**
 * Corre las pruebas de bambu-xml.js.
 * @param {{revisar: (nombre: string, condicion: boolean, detalle?: string) => void}} ctx
 */
export function probarBambuXml({ revisar }) {
    console.log('\n▶ Textos XML de Bambu');
    salidasBienFormadas(revisar);
    escapes(revisar);
    sliceInfo(revisar);
    sliceInfoEscapado(revisar);
    constantes(revisar);
    nombreRaro(revisar);
    relacionesYTipos(revisar);
    tiposDeContenido(revisar);
}
