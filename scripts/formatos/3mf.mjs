// Pruebas del lector de 3MF (Node, sin navegador): dos objetos en pulgadas con transform (24 triángulos, caja, traslado
// y volumen), rotación de 90° en Z con unidades en mm y sin _rels, y componentes anidados con la escala del item.

import { leer3MF } from '../../src/motor/formatos.js';
import { casi, caja, texto, volumen } from './ayudas.mjs';
import { malla, modelo3MF, zip3MF } from './ayudas-3mf.mjs';

// Dos objetos (el segundo un cubo estirado al doble en Z), en pulgadas, movidos con transform.
async function dosObjetosEnPulgadas(revisar) {
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
}

// Rotación de 90° en Z en el transform y unidades en milímetros (sin _rels: lo busca en 3D/3dmodel.model).
async function rotacion(revisar) {
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
}

// Componentes: un objeto armado con otros dos (y la escala del item).
async function componentes(revisar) {
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
}

export async function probar3mf({ revisar }) {
    console.log('\n▶ 3MF');
    await dosObjetosEnPulgadas(revisar);
    await rotacion(revisar);
    await componentes(revisar);
}
