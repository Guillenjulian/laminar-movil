// Pruebas de los lectores de OBJ y 3MF, del escritor de STL y de la litofanía
// (corren en Node, sin navegador).
//
// Uso: npm run test:formatos

import JSZip from 'jszip';
import { leerOBJ, leer3MF, leerModelo, escribirSTL } from '../src/motor/formatos.js';
import { generarLitofania, resolucionLitofania, MARCO_MM } from '../src/motor/litofania.js';
import { leerSTL } from '../src/motor/stl.js';

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (!condicion) fallas++;
}

const casi = (a, b, tol = 1e-4) => Math.abs(a - b) < tol;

function caja(v) {
    const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], v[i + k]);
            max[k] = Math.max(max[k], v[i + k]);
        }
    }
    return { min, max, x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}
const texto = c => `${+c.x.toFixed(3)} × ${+c.y.toFixed(3)} × ${+c.z.toFixed(3)}`;

// Volumen con signo (teorema de la divergencia): positivo si las normales miran hacia afuera.
function volumen(v) {
    let s = 0;
    for (let i = 0; i < v.length; i += 9) {
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = v.subarray(i, i + 9);
        s += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return s / 6;
}

// Malla cerrada: cada arista aparece en exactamente 2 triángulos, una vez en
// cada sentido (eso además dice que las caras están orientadas parejo).
function revisarCerrada(v) {
    const clave = i => `${v[i]},${v[i + 1]},${v[i + 2]}`;
    const dirigidas = new Map();
    for (let i = 0; i < v.length; i += 9) {
        const p = [clave(i), clave(i + 3), clave(i + 6)];
        for (let k = 0; k < 3; k++) {
            const a = `${p[k]}|${p[(k + 1) % 3]}`;
            dirigidas.set(a, (dirigidas.get(a) || 0) + 1);
        }
    }
    let aristas = 0,
        malas = 0;
    for (const [a, n] of dirigidas) {
        const [p, q] = a.split('|');
        const vuelta = dirigidas.get(`${q}|${p}`) || 0;
        if (n !== 1 || vuelta !== 1) malas++;
        aristas++;
    }
    return { aristas: aristas / 2, malas };
}

async function error(fn) {
    try {
        await fn();
        return '';
    } catch (err) {
        return err.message;
    }
}

// --- OBJ ---------------------------------------------------------------------
console.log('\n▶ OBJ');
// Cubo de 20 mm con caras cuadradas: unas con índices positivos y "v/vt/vn",
// otras con índices negativos.
const cuboOBJ = `# cubo de prueba
o cubo
v 0 0 0
v 20 0 0
v 20 20 0
v 0 20 0
v 0 0 20
v 20 0 20
v 20 20 20
v 0 20 20
vt 0 0
vn 0 0 1
f 1/1/1 4/1/1 3/1/1 2/1/1
f 5//1 6//1 7//1 8//1
f -8 -7 -3 -4
f 2 3 7 6
f -6 -5 -1 -2
f 4 1 5 8
`;
const obj = leerOBJ(new TextEncoder().encode(cuboOBJ).buffer);
const cObj = caja(obj);
revisar('cubo OBJ: 12 triángulos', obj.length / 9 === 12, `(${obj.length / 9})`);
revisar('cubo OBJ: caja de 20 × 20 × 20', casi(cObj.x, 20) && casi(cObj.y, 20) && casi(cObj.z, 20), texto(cObj));
const cerradoObj = revisarCerrada(obj);
revisar(
    'cubo OBJ: cerrado y con normales parejas',
    cerradoObj.malas === 0 && cerradoObj.aristas === 18,
    `${cerradoObj.aristas} aristas`,
);
revisar('cubo OBJ: volumen 8000 mm³ (normales hacia afuera)', casi(volumen(obj), 8000, 1e-3), `${volumen(obj)}`);
revisar(
    'leerModelo elige el lector por extensión',
    (await leerModelo('Cubo.OBJ', new TextEncoder().encode(cuboOBJ).buffer)).length === obj.length,
);

// Un pentágono (5 vértices) se triangula en abanico: 3 triángulos.
const penta = leerOBJ('v 0 0 0\nv 2 0 0\nv 3 1 0\nv 1 2 0\nv -1 1 0\nf 1 2 3 4 5\n');
revisar('cara de 5 vértices -> 3 triángulos', penta.length / 9 === 3);

// --- STL binario --------------------------------------------------------------
console.log('\n▶ STL binario');
const stl = escribirSTL(obj);
revisar('tamaño del STL binario', stl.byteLength === 84 + 12 * 50, `${stl.byteLength} bytes`);
const releido = leerSTL(stl);
revisar(
    'el STL escrito se vuelve a leer igual',
    releido.length === obj.length && releido.every((x, i) => x === obj[i]),
);
{
    // la normal del primer triángulo (cara de abajo) tiene que ser (0, 0, -1)
    const d = new DataView(stl);
    const n = [d.getFloat32(84, true), d.getFloat32(88, true), d.getFloat32(92, true)];
    revisar('normales calculadas', casi(n[0], 0) && casi(n[1], 0) && casi(n[2], -1), `(${n.join(', ')})`);
}

// --- 3MF ---------------------------------------------------------------------
console.log('\n▶ 3MF');
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
const malla = `<mesh>
        <vertices>${verticesCubo.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}" />`).join('')}</vertices>
        <triangles>${triangulosCubo.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="0"/>`).join('')}</triangles>
    </mesh>`;
const modelo3MF = (unidad, objetos, build) => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unidad}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
    <metadata name="Title">Prueba</metadata>
    <resources>
        <basematerials id="9"><base name="Rojo" displaycolor="#FF0000" /></basematerials>
        ${objetos}
    </resources>
    <build>${build}</build>
</model>`;

async function zip3MF(xml, { rels = true } = {}) {
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

// Dos objetos (el segundo un cubo estirado al doble en Z), en pulgadas, movidos con transform.
const dosObjetos = modelo3MF(
    'inch',
    `<object id="1" type="model" name="A">${malla}</object>
        <object id="2" type="model" name="B">${malla.replace(/z="1"/g, 'z="2"')}</object>`,
    `<item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0" />
        <item objectid="2" transform="1 0 0 0 1 0 0 0 1 2 0.5 0" />`,
);
const tmf = await leer3MF(await zip3MF(dosObjetos));
const c3 = caja(tmf);
revisar('3MF: 24 triángulos (dos cubos)', tmf.length / 9 === 24, `(${tmf.length / 9})`);
revisar(
    '3MF: en pulgadas, pasado a mm (caja 76,2 × 38,1 × 50,8)',
    casi(c3.x, 76.2) && casi(c3.y, 38.1) && casi(c3.z, 50.8) && casi(c3.min[0], 0) && casi(c3.min[1], 0),
    texto(c3),
);
revisar(
    '3MF: el segundo objeto quedó trasladado (X desde 50,8 mm)',
    casi(Math.min(...[...tmf.subarray(12 * 9)].filter((_, i) => i % 3 === 0)), 50.8),
);
revisar('3MF: volumen 3 pulgadas³', casi(volumen(tmf), 3 * 25.4 ** 3, 1e-2), `${volumen(tmf).toFixed(1)} mm³`);

// Rotación de 90° en Z en el transform y unidades en milímetros (sin _rels: lo busca en 3D/3dmodel.model).
const rotado = await leer3MF(
    await zip3MF(
        modelo3MF(
            'millimeter',
            `<object id="5">${malla.replace(/x="1"/g, 'x="10"')}</object>`,
            '<item objectid="5" transform="0 1 0 -1 0 0 0 0 1 0 0 0"/>',
        ),
        { rels: false },
    ),
);
const cr = caja(rotado);
revisar(
    '3MF: transform con rotación de 90° en Z',
    casi(cr.x, 1) && casi(cr.y, 10) && casi(cr.min[1], 0) && casi(cr.max[0], 0),
    texto(cr),
);

// Componentes: un objeto armado con otros dos (y la escala del item).
const conComponentes = await leer3MF(
    await zip3MF(
        modelo3MF(
            'millimeter',
            `<object id="1">${malla}</object>
        <object id="7"><components>
            <component objectid="1" />
            <component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 1" />
        </components></object>`,
            '<item objectid="7" transform="10 0 0 0 10 0 0 0 10 5 5 0"/>',
        ),
    ),
);
const cc = caja(conComponentes);
revisar(
    '3MF: componentes anidados',
    conComponentes.length / 9 === 24 && casi(cc.z, 20) && casi(cc.min[0], 5),
    texto(cc),
);

// --- Errores claros -------------------------------------------------------------
console.log('\n▶ Errores con archivos rotos');
const e1 = await error(() => leerOBJ('hola mundo\nesto no es un obj\n'));
revisar('OBJ sin caras', /no tiene caras/.test(e1), `"${e1}"`);
const e2 = await error(() => leerOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n'));
revisar('OBJ con índice fuera de rango', /vértice que no existe.*línea 4/.test(e2), `"${e2}"`);
const e3 = await error(() => leer3MF(new TextEncoder().encode('esto no es un zip').buffer));
revisar('3MF que no es ZIP', /no parece un 3MF/.test(e3), `"${e3}"`);
const vacio = new JSZip();
vacio.file('hola.txt', 'nada');
const e4 = await error(async () => leer3MF(await vacio.generateAsync({ type: 'arraybuffer' })));
revisar('3MF sin modelo', /no tiene un modelo 3D/.test(e4), `"${e4}"`);
const e5 = await error(async () =>
    leer3MF(
        await zip3MF(
            modelo3MF(
                'millimeter',
                `<object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`,
                '<item objectid="1"/>',
            ),
        ),
    ),
);
revisar('3MF con triángulo roto', /vértice que no existe/.test(e5), `"${e5}"`);
const e6 = await error(async () =>
    leer3MF(await zip3MF(modelo3MF('parsec', `<object id="1">${malla}</object>`, '<item objectid="1"/>'))),
);
revisar('3MF con unidad desconocida', /unidad que no conocemos/.test(e6), `"${e6}"`);
const e7 = await error(async () =>
    leer3MF(await zip3MF(modelo3MF('millimeter', `<object id="1">${malla}</object>`, '<item objectid="3"/>'))),
);
revisar('3MF con item a un objeto que no existe', /objeto que no existe/.test(e7), `"${e7}"`);
const e8 = await error(() => leerModelo('pieza.step', new ArrayBuffer(10)));
revisar('formato desconocido', /No sabemos leer archivos \.step/.test(e8), `"${e8}"`);

// --- Litofanía ------------------------------------------------------------------
console.log('\n▶ Litofanía');
// Gradiente horizontal de 60 × 40 px: negro a la izquierda, blanco a la derecha.
const W = 60,
    H = 40;
const grises = new Uint8Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) grises[j * W + i] = Math.round((255 * i) / (W - 1));
const opciones = { grises, ancho: W, alto: H, anchoMm: 59, minMm: 0.8, maxMm: 3.2 };

const lito = generarLitofania(opciones);
const cl = caja(lito);
const cerrada = revisarCerrada(lito);
revisar(
    'litofanía: malla cerrada (cada arista en 2 triángulos, sentidos opuestos)',
    cerrada.malas === 0,
    `${cerrada.aristas} aristas, ${cerrada.malas} malas, ${lito.length / 9} triángulos`,
);
// Euler para una superficie cerrada sin agujeros: V - A + C = 2
const vertices = new Set();
for (let i = 0; i < lito.length; i += 3) vertices.add(`${lito[i]},${lito[i + 1]},${lito[i + 2]}`);
revisar('litofanía: característica de Euler = 2', vertices.size - cerrada.aristas + lito.length / 9 === 2);
revisar(
    'litofanía: medidas 59 × 39 × 3,2 mm',
    casi(cl.x, 59) && casi(cl.y, 39) && casi(cl.z, 3.2) && casi(cl.min[2], 0),
    texto(cl),
);
// espesor en cada punto de arriba: el máximo a la izquierda (negro), el mínimo a la derecha (blanco)
const alturaEn = (v, x) => {
    let z = -Infinity;
    for (let i = 0; i < v.length; i += 3) if (casi(v[i], x)) z = Math.max(z, v[i + 2]);
    return z;
};
revisar(
    'litofanía: lo oscuro es grueso (3,2 mm) y lo claro fino (0,8 mm)',
    casi(alturaEn(lito, 0), 3.2) && casi(alturaEn(lito, 59), 0.8),
    `${alturaEn(lito, 0)} / ${alturaEn(lito, 59)}`,
);
const vol = volumen(lito);
const esperado = (59 * 39 * (0.8 + 3.2)) / 2;
revisar(
    'litofanía: volumen positivo (normales hacia afuera) y ≈ ancho × alto × espesor medio',
    vol > 0 && Math.abs(vol - esperado) / esperado < 0.01,
    `${vol.toFixed(1)} mm³ (esperado ${esperado.toFixed(1)})`,
);

const relieve = generarLitofania({ ...opciones, tipo: 'relieve' });
revisar('relieve: lo claro queda alto', casi(alturaEn(relieve, 0), 0.8) && casi(alturaEn(relieve, 59), 3.2));
revisar('relieve: malla cerrada y volumen positivo', revisarCerrada(relieve).malas === 0 && volumen(relieve) > 0);

const conMarco = generarLitofania({ ...opciones, marco: true });
const cm = caja(conMarco);
revisar(
    `con marco: ${MARCO_MM} mm más de cada lado, al espesor máximo`,
    casi(cm.x, 59 + 2 * MARCO_MM) &&
        casi(cm.y, 39 + 2 * MARCO_MM) &&
        casi(alturaEn(conMarco, 0), 3.2) &&
        casi(alturaEn(conMarco, cm.max[0]), 3.2),
    texto(cm),
);
revisar('con marco: malla cerrada y volumen positivo', revisarCerrada(conMarco).malas === 0 && volumen(conMarco) > 0);

const stlLito = escribirSTL(lito);
revisar('litofanía a STL binario', leerSTL(stlLito).length === lito.length);

const r1 = resolucionLitofania(4000, 3000, 100);
const r2 = resolucionLitofania(1000, 4000, 300);
revisar('resolución: ~0,25 mm por píxel', r1.ancho === 401 && r1.alto === 301, `${r1.ancho} × ${r1.alto}`);
revisar(
    'resolución: como mucho 500 px de lado',
    r2.ancho <= 500 && r2.alto <= 500 && r2.alto >= 490,
    `${r2.ancho} × ${r2.alto}`,
);

const e9 = await error(() => generarLitofania({ ...opciones, minMm: 3, maxMm: 1 }));
revisar('litofanía con espesores al revés', /máximo tiene que ser mayor/.test(e9), `"${e9}"`);
const e10 = await error(() => generarLitofania({ ...opciones, ancho: 1, alto: 1 }));
revisar('litofanía con imagen de 1 píxel', /demasiado chica/.test(e10), `"${e10}"`);

console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallas ? 1 : 0);
