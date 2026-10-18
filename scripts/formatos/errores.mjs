// Pruebas de mensajes claros ante archivos rotos (Node, sin navegador): OBJ sin caras o con índice fuera de rango,
// 3MF que no es ZIP, sin modelo, con triángulo roto, con unidad desconocida o con un item a un objeto inexistente, y
// formato desconocido en `leerModelo`.

import JSZip from 'jszip';
import { leerOBJ, leer3MF, leerModelo } from '../../src/motor/formatos.js';
import { error } from './ayudas.mjs';
import { malla, modelo3MF, zip3MF } from './ayudas-3mf.mjs';

const triRoto =
    '<object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>';

async function erroresDe3MF(revisar) {
    const e3 = await error(() => leer3MF(new TextEncoder().encode('esto no es un zip').buffer));
    revisar('3MF que no es ZIP', /no parece un 3MF/.test(e3), `"${e3}"`);
    const vacio = new JSZip();
    vacio.file('hola.txt', 'nada');
    const e4 = await error(async () => leer3MF(await vacio.generateAsync({ type: 'arraybuffer' })));
    revisar('3MF sin modelo', /no tiene un modelo 3D/.test(e4), `"${e4}"`);
    const e5 = await error(async () => leer3MF(await zip3MF(modelo3MF('millimeter', triRoto, '<item objectid="1"/>'))));
    revisar('3MF con triángulo roto', /vértice que no existe/.test(e5), `"${e5}"`);
    const e6 = await error(async () =>
        leer3MF(await zip3MF(modelo3MF('parsec', `<object id="1">${malla}</object>`, '<item objectid="1"/>'))),
    );
    revisar('3MF con unidad desconocida', /unidad que no conocemos/.test(e6), `"${e6}"`);
    const e7 = await error(async () =>
        leer3MF(await zip3MF(modelo3MF('millimeter', `<object id="1">${malla}</object>`, '<item objectid="3"/>'))),
    );
    revisar('3MF con item a un objeto que no existe', /objeto que no existe/.test(e7), `"${e7}"`);
}

export async function probarErrores({ revisar }) {
    console.log('\n▶ Errores con archivos rotos');
    const e1 = await error(() => leerOBJ('hola mundo\nesto no es un obj\n'));
    revisar('OBJ sin caras', /no tiene caras/.test(e1), `"${e1}"`);
    const e2 = await error(() => leerOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n'));
    revisar('OBJ con índice fuera de rango', /vértice que no existe.*línea 4/.test(e2), `"${e2}"`);
    await erroresDe3MF(revisar);
    const e8 = await error(() => leerModelo('pieza.step', new ArrayBuffer(10)));
    revisar('formato desconocido', /No sabemos leer archivos \.step/.test(e8), `"${e8}"`);
}
