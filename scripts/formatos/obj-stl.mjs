// Pruebas del lector de OBJ y del escritor de STL binario (Node, sin navegador).
// OBJ: cubo con caras cuadradas (índices positivos, "v/vt/vn" y negativos), caja, cerrado, volumen, elección del lector
// por extensión y triangulación en abanico. STL: tamaño, relectura idéntica y normales.
// `probarObj` devuelve la malla del cubo, que `probarStl` necesita.

import { leerOBJ, leerModelo, escribirSTL } from '../../src/motor/formatos.js';
import { leerSTL } from '../../src/motor/stl.js';
import { casi, caja, texto, volumen, revisarCerrada } from './ayudas.mjs';

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

export async function probarObj({ revisar }) {
    console.log('\n▶ OBJ');
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
    return obj;
}

export function probarStl({ revisar, obj }) {
    console.log('\n▶ STL binario');
    const stl = escribirSTL(obj);
    revisar('tamaño del STL binario', stl.byteLength === 84 + 12 * 50, `${stl.byteLength} bytes`);
    const releido = leerSTL(stl);
    revisar(
        'el STL escrito se vuelve a leer igual',
        releido.length === obj.length && releido.every((x, i) => x === obj[i]),
    );
    // la normal del primer triángulo (cara de abajo) tiene que ser (0, 0, -1)
    const d = new DataView(stl);
    const n = [d.getFloat32(84, true), d.getFloat32(88, true), d.getFloat32(92, true)];
    revisar('normales calculadas', casi(n[0], 0) && casi(n[1], 0) && casi(n[2], -1), `(${n.join(', ')})`);
}
