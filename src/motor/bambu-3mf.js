// Arma el .gcode.3mf de Bambu Lab (ADR 0005, sección 3.3): un ZIP con el G-code de la placa, su MD5 y los textos
// que escribe `bambu-xml.js`. Puro (sin DOM, sin `self`); sólo importa jszip, `md5.js` y `bambu-xml.js`.
//
// Flujo: el G-code se codifica UNA vez a UTF-8; esos mismos bytes alimentan al MD5 (de a 4 MB, cediendo el hilo
// entre trozo y trozo para no congelar la interfaz) y van al ZIP tal cual. El ZIP sale con DEFLATE nivel 1 (rápido).
//
// Blob: `generateAsync({ type: 'blob' })` anda en el navegador y en Node 22 (que tiene `Blob` global), así que no
// hace falta envolver nada a mano: el ZIP no se carga entero como arreglo de JS.

import JSZip from 'jszip';
import { Md5 } from './md5.js';
import { armarContentTypes, armarModelSettings, armarModelo, armarRels, armarSliceInfo } from './bambu-xml.js';

/** Nombres exactos de las entradas del ZIP (tabla 1.1 del ADR 0005), para no repetir cadenas en otros módulos. */
export const ENTRADAS = {
    contentTypes: '[Content_Types].xml',
    rels: '_rels/.rels',
    modelo: '3D/3dmodel.model',
    gcode: 'Metadata/plate_1.gcode',
    md5: 'Metadata/plate_1.gcode.md5',
    sliceInfo: 'Metadata/slice_info.config',
    modelSettings: 'Metadata/model_settings.config',
    miniatura: 'Metadata/plate_1.png',
    miniaturaChica: 'Metadata/plate_1_small.png',
};

const TROZO_MD5 = 4 * 1024 * 1024; // bytes que se le dan al MD5 por vuelta
// JSZip crea entradas de carpeta ("Metadata/") salvo que se le diga que no; un 3MF de Bambu no las lleva
const SIN_CARPETAS = { createFolders: false };

/** Cede el hilo un instante para que la interfaz pueda repintar. */
const ceder = () => new Promise(resolver => setTimeout(resolver, 0));

/**
 * MD5 de los bytes en mayúsculas, de a trozos de 4 MB y cediendo el hilo entre uno y otro.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>} 32 caracteres hexadecimales en mayúsculas
 */
async function md5Mayusculas(bytes) {
    const md5 = new Md5();
    for (let desde = 0; desde < bytes.length; desde += TROZO_MD5) {
        md5.agregar(bytes.subarray(desde, desde + TROZO_MD5));
        if (desde + TROZO_MD5 < bytes.length) await ceder();
    }
    return md5.hex(true);
}

/**
 * Arma un .gcode.3mf de Bambu con una sola placa (ver la tabla de la sección 1.1 del ADR 0005).
 * El G-code se codifica una sola vez en UTF-8; ese mismo arreglo alimenta al MD5 y al ZIP.
 * Si hay `info.miniatura` se agregan las dos miniaturas; sin `miniaturaChica`, la chica repite la grande.
 * @param {string} gcode G-code final, con las pausas ya insertadas
 * @param {import('./bambu-xml.js').InfoBambu} info
 * @param {{alProgreso?: (fraccion:number) => void}} [opciones] `alProgreso` recibe 0..1, creciente
 * @returns {Promise<Blob>} ZIP (DEFLATE nivel 1, `type: 'application/octet-stream'`)
 * @throws {Error} 'El G-code está vacío.' sin texto; 'Falta el modelo de impresora Bambu.' sin `info.modelo.id`
 */
export async function armarGcode3mf(gcode, info, opciones = {}) {
    if (!gcode) throw new Error('El G-code está vacío.');
    if (!info?.modelo?.id) throw new Error('Falta el modelo de impresora Bambu.');
    const bytes = new TextEncoder().encode(gcode);
    const conMiniatura = Boolean(info.miniatura);

    const zip = new JSZip();
    zip.file(ENTRADAS.contentTypes, armarContentTypes(conMiniatura), SIN_CARPETAS);
    zip.file(ENTRADAS.rels, armarRels(conMiniatura), SIN_CARPETAS);
    zip.file(ENTRADAS.modelo, armarModelo(info.nombre), SIN_CARPETAS);
    zip.file(ENTRADAS.gcode, bytes, SIN_CARPETAS);
    zip.file(ENTRADAS.md5, await md5Mayusculas(bytes), SIN_CARPETAS);
    zip.file(ENTRADAS.sliceInfo, armarSliceInfo(info), SIN_CARPETAS);
    zip.file(ENTRADAS.modelSettings, armarModelSettings(info.nombre), SIN_CARPETAS);
    if (conMiniatura) {
        zip.file(ENTRADAS.miniatura, info.miniatura, SIN_CARPETAS);
        zip.file(ENTRADAS.miniaturaChica, info.miniaturaChica ?? info.miniatura, SIN_CARPETAS);
    }

    let ultimo = 0;
    const alProgreso = opciones.alProgreso;
    return zip.generateAsync(
        {
            type: 'blob',
            mimeType: 'application/octet-stream',
            compression: 'DEFLATE',
            compressionOptions: { level: 1 },
            streamFiles: true,
        },
        meta => {
            const fraccion = Math.min(1, meta.percent / 100);
            if (alProgreso && fraccion > ultimo) alProgreso(fraccion);
            ultimo = Math.max(ultimo, fraccion);
        },
    );
}
