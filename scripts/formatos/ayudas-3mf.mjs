// Constructores de 3MF de prueba compartidos por `3mf.mjs` y `errores.mjs`: la malla de un cubo de 1 × 1 × 1, el XML
// del modelo y el ZIP que lo envuelve. No prueban nada por sí solos.

import JSZip from 'jszip';

// Cubo de 1 × 1 × 1 (pulgadas) como malla con índices desde 0.
const verticesCubo = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
];
const triangulosCubo = [
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
export const malla = `<mesh>
        <vertices>${verticesCubo.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}" />`).join('')}</vertices>
        <triangles>${triangulosCubo.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="0"/>`).join('')}</triangles>
    </mesh>`;
export const modelo3MF = (unidad, objetos, build) => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unidad}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
    <metadata name="Title">Prueba</metadata>
    <resources>
        <basematerials id="9"><base name="Rojo" displaycolor="#FF0000" /></basematerials>
        ${objetos}
    </resources>
    <build>${build}</build>
</model>`;

export async function zip3MF(xml, { rels = true } = {}) {
    const zip = new JSZip();
    zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    );
    if (rels) {
        zip.file(
            '_rels/.rels',
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
        );
    }
    zip.file('3D/3dmodel.model', xml);
    return zip.generateAsync({ type: 'arraybuffer' });
}
