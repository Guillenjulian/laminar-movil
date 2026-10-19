// Textos XML/config de un .gcode.3mf de Bambu Lab (ADR 0005, sección 1.2).
//
// Funciones puras string → string, sin imports: una por entrada de texto del ZIP. Las arma `bambu-3mf.js`, que se
// ocupa del ZIP y del MD5. Todo texto que viene del usuario (nombre, color, tipo de filamento) pasa por `escaparXml`.
// Los números salen con punto decimal siempre (nada de locale).

/**
 * @typedef {object} InfoBambu
 * @property {string} nombre              nombre del objeto/archivo sin extensión (ej. "cubo-20mm")
 * @property {number} tiempo              segundos estimados (`info.tiempo` del motor)
 * @property {number} gramos              gramos de filamento (gramos = mm de filamento × área × densidad, ya calculado por la UI)
 * @property {number} [metros]            metros de filamento (`info.filamento` / 1000); si falta se estima de `gramos`
 * @property {{id:string, nombre?:string}} modelo   modelo Bambu (`modeloBambu` del perfil; `id` va a `printer_model_id`)
 * @property {number} [boquilla=0.4]      diámetro (mm)
 * @property {{tipo:string, color:string, trayInfoIdx:string}} filamento  ej. {tipo:'PLA', color:'#FFFFFF', trayInfoIdx:'GFL99'}
 * @property {boolean} [soportes=false]
 * @property {Uint8Array} [miniatura]     PNG 512×512 → Metadata/plate_1.png
 * @property {Uint8Array} [miniaturaChica] PNG 128×128 → Metadata/plate_1_small.png
 */

const CABECERA = '<?xml version="1.0" encoding="UTF-8"?>\n';

// Estimación de metros cuando falta `metros`: densidad 1,24 g/cm³ (PLA) y filamento de 1,75 mm.
const DENSIDAD_G_CM3 = 1.24;
const DIAMETRO_FILAMENTO_MM = 1.75;
const AREA_FILAMENTO_CM2 = Math.PI * (DIAMETRO_FILAMENTO_MM / 20) ** 2; // radio en cm = diámetro en mm / 20

const NS_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_BAMBU = 'http://schemas.bambulab.com/package/2021';

/**
 * Escapa & < > " ' para atributos y texto XML.
 * @param {string} s
 * @returns {string}
 */
export function escaparXml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * @param {boolean} conMiniatura hay PNG en el ZIP (la extensión `png` sólo se declara entonces)
 * @returns {string} [Content_Types].xml
 */
export function armarContentTypes(conMiniatura) {
    const png = conMiniatura ? ' <Default Extension="png" ContentType="image/png"/>\n' : '';
    return (
        `${CABECERA}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
        ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
        ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
        `${png} <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n`
    );
}

/** Línea `<Relationship>` de _rels/.rels. @param {string} destino @param {string} id @param {string} tipo @returns {string} */
const relacion = (destino, id, tipo) => ` <Relationship Target="${destino}" Id="${id}" Type="${tipo}"/>\n`;

/**
 * @param {boolean} conMiniatura incluye las relaciones de plate_1.png / plate_1_small.png
 * @returns {string} _rels/.rels
 */
export function armarRels(conMiniatura) {
    let filas = relacion('/3D/3dmodel.model', 'rel-1', 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel');
    if (conMiniatura) {
        filas += relacion('/Metadata/plate_1.png', 'rel-2', `${NS_RELS}/metadata/thumbnail`);
        filas += relacion('/Metadata/plate_1.png', 'rel-4', `${NS_BAMBU}/cover-thumbnail-middle`);
        filas += relacion('/Metadata/plate_1_small.png', 'rel-5', `${NS_BAMBU}/cover-thumbnail-small`);
    }
    return `${CABECERA}<Relationships xmlns="${NS_RELS}">\n${filas}</Relationships>\n`;
}

/**
 * @param {string} nombre título del modelo
 * @returns {string} 3D/3dmodel.model (sin malla: sólo cabecera y `<build/>` vacío)
 */
export function armarModelo(nombre) {
    return (
        `${CABECERA}<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="${NS_BAMBU}">\n` +
        ' <metadata name="Application">laminar-movil</metadata>\n' +
        ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n' +
        ` <metadata name="Title">${escaparXml(nombre)}</metadata>\n` +
        ' <resources/>\n <build/>\n</model>\n'
    );
}

/** Línea `<metadata key value/>` con la sangría dada (el valor ya viene escapado). @param {string} clave @param {string} valor @param {string} sangria @returns {string} */
const meta = (clave, valor, sangria) => `${sangria}<metadata key="${clave}" value="${valor}"/>\n`;

/**
 * @param {string} nombre
 * @returns {string} Metadata/model_settings.config (una placa y un objeto con ese nombre)
 */
export function armarModelSettings(nombre) {
    return (
        `${CABECERA}<config>\n  <object id="1">\n` +
        meta('name', escaparXml(nombre), '    ') +
        meta('extruder', '1', '    ') +
        '  </object>\n  <plate>\n' +
        meta('plater_id', '1', '    ') +
        meta('plater_name', '', '    ') +
        meta('locked', 'false', '    ') +
        '    <model_instance>\n' +
        meta('object_id', '1', '      ') +
        meta('instance_id', '0', '      ') +
        '    </model_instance>\n  </plate>\n</config>\n'
    );
}

/**
 * Metros de filamento estimados a partir de los gramos: longitud = masa / (densidad × área de la sección).
 * Con densidad 1,24 g/cm³ y filamento de 1,75 mm, 1 g son unos 0,335 m.
 * @param {number} gramos
 * @returns {number} metros
 */
function metrosDeGramos(gramos) {
    return gramos / (DENSIDAD_G_CM3 * AREA_FILAMENTO_CM2) / 100;
}

/**
 * @param {InfoBambu} info
 * @returns {string} Metadata/slice_info.config
 */
export function armarSliceInfo(info) {
    const gramos = info.gramos.toFixed(2);
    const metros = (info.metros ?? metrosDeGramos(info.gramos)).toFixed(2);
    const fil = info.filamento;
    const atributosFilamento =
        `id="1" tray_info_idx="${escaparXml(fil.trayInfoIdx)}" type="${escaparXml(fil.tipo)}" ` +
        `color="${escaparXml(fil.color)}" used_m="${metros}" used_g="${gramos}"`;
    return (
        `${CABECERA}<config>\n  <header>\n` +
        '    <header_item key="X-BBL-Client-Type" value="slicer"/>\n' +
        '    <header_item key="X-BBL-Client-Version" value="laminar-movil"/>\n' +
        '  </header>\n  <plate>\n' +
        meta('index', '1', '    ') +
        meta('printer_model_id', escaparXml(info.modelo.id), '    ') +
        meta('nozzle_diameters', String(info.boquilla ?? 0.4), '    ') +
        meta('timelapse_type', '0', '    ') +
        meta('prediction', String(Math.round(info.tiempo)), '    ') +
        meta('weight', gramos, '    ') +
        meta('outside', 'false', '    ') +
        meta('support_used', String(Boolean(info.soportes)), '    ') +
        meta('label_object_enabled', 'false', '    ') +
        `    <object identify_id="1" name="${escaparXml(info.nombre)}" skipped="false"/>\n` +
        `    <filament ${atributosFilamento}/>\n  </plate>\n</config>\n`
    );
}
