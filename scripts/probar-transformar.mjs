// Pruebas de src/motor/transformar.js (corren en Node, sin navegador).
//
// Uso: npm run test:transformar

import fs from 'node:fs';
import { normalizarTransformacion } from '../src/almacen.js';
import {
    identidad,
    multiplicar,
    rotacion90,
    escala,
    rotacionQueApoya,
    aplicar,
    medir,
    esIdentidad,
    determinante,
} from '../src/motor/transformar.js';
import { leerSTL } from '../src/motor/stl.js';

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (!condicion) fallas++;
}

const casi = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const igualesExacto = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]) || v === b[i]);
const iguales = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, i) => casi(v, b[i], tol));
// m·p para un punto suelto
const por = (m, p) => [0, 1, 2].map(f => m[f * 3] * p[0] + m[f * 3 + 1] * p[1] + m[f * 3 + 2] * p[2]);
const traspuesta = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const texto = v => '(' + v.map(x => +x.toFixed(6)).join(', ') + ')';

console.log('\n▶ identidad, escala y multiplicar');
revisar('identidad', igualesExacto(identidad(), [1, 0, 0, 0, 1, 0, 0, 0, 1]));
revisar('esIdentidad(identidad())', esIdentidad(identidad()));
revisar('escala(2)', igualesExacto(escala(2), [2, 0, 0, 0, 2, 0, 0, 0, 2]));
revisar('escala(2) no es identidad', !esIdentidad(escala(2)));
revisar('escala(2)·escala(3) = escala(6)', iguales(multiplicar(escala(2), escala(3)), escala(6)));
const a = [1, 2, 3, 4, 5, 6, 7, 8, 9],
    b = [9, 8, 7, 6, 5, 4, 3, 2, 1];
revisar('multiplicar(a, b) fila por fila', igualesExacto(multiplicar(a, b), [30, 24, 18, 84, 69, 54, 138, 114, 90]));
// a·b aplica primero b: rotar en Z y después escalar no es lo mismo que al revés con rotaciones distintas
const zx = multiplicar(rotacion90('x'), rotacion90('z'));
revisar(
    'multiplicar: primero b, después a',
    iguales(por(zx, [1, 0, 0]), por(rotacion90('x'), por(rotacion90('z'), [1, 0, 0]))),
    texto(por(zx, [1, 0, 0])),
);

console.log('\n▶ rotacion90');
revisar("rotacion90('z') lleva (1,0,0) a (0,1,0)", igualesExacto(por(rotacion90('z'), [1, 0, 0]), [0, 1, 0]));
revisar("rotacion90('x') lleva (0,1,0) a (0,0,1)", igualesExacto(por(rotacion90('x'), [0, 1, 0]), [0, 0, 1]));
revisar("rotacion90('y') lleva (0,0,1) a (1,0,0)", igualesExacto(por(rotacion90('y'), [0, 0, 1]), [1, 0, 0]));
for (const eje of ['x', 'y', 'z']) {
    let m = identidad();
    for (let i = 0; i < 4; i++) m = multiplicar(rotacion90(eje), m);
    revisar(`4 rotaciones en ${eje} = identidad`, igualesExacto(m, identidad()));
    revisar(`rotacion90('${eje}', 4) = identidad`, igualesExacto(rotacion90(eje, 4), identidad()));
    revisar(
        `rotacion90('${eje}', -1) = rotacion90('${eje}', 3)`,
        igualesExacto(rotacion90(eje, -1), rotacion90(eje, 3)),
    );
    revisar(
        `rotacion90('${eje}', 2) = dos de 90°`,
        igualesExacto(rotacion90(eje, 2), multiplicar(rotacion90(eje), rotacion90(eje))),
    );
    const valores = [1, 2, 3].flatMap(v => rotacion90(eje, v));
    revisar(
        `rotacion90('${eje}') sólo usa 0, 1, -1 (sin -0)`,
        valores.every(v => v === 0 || v === 1 || v === -1) && !valores.some(v => Object.is(v, -0)),
    );
}

console.log('\n▶ rotacionQueApoya');
const normales = [
    [0, 0, -1],
    [0, 0, 1],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [1, 2, 3],
    [-3, 0.5, -2],
    [0.3, -0.2, 5],
    [1e-6, 0, 1],
    [0, 0, -7],
];
for (const n of normales) {
    const R = rotacionQueApoya(n);
    const largo = Math.hypot(...n);
    const abajo = por(
        R,
        n.map(v => v / largo),
    );
    const ortonormal = iguales(multiplicar(R, traspuesta(R)), identidad(), 1e-9);
    const det = determinante(R);
    revisar(
        `normal ${texto(n)}`,
        iguales(abajo, [0, 0, -1], 1e-9) && ortonormal && casi(det, 1),
        `→ ${texto(abajo)}, det ${det.toFixed(6)}${ortonormal ? '' : ', NO ortonormal'}`,
    );
}
revisar('normal (0,0,-1) da la identidad', esIdentidad(rotacionQueApoya([0, 0, -1])));
revisar('normal (0,0,1) da 180° en X', igualesExacto(rotacionQueApoya([0, 0, 1]), rotacion90('x', 2)));

console.log('\n▶ aplicar y medir sobre el cubo de 20 mm');
const buf = fs.readFileSync(new URL('../public/ejemplos/cubo-20mm.stl', import.meta.url));
const cubo = leerSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const original = cubo.slice();
const m2 = escala(2);
const medida = medir(m2, cubo);
revisar(
    'medir con escala 2 → 40 × 40 × 40',
    casi(medida.x, 40, 1e-4) && casi(medida.y, 40, 1e-4) && casi(medida.z, 40, 1e-4),
    `${medida.x} × ${medida.y} × ${medida.z}`,
);
revisar('medir no toca los vértices', igualesExacto(cubo, original));
const devuelto = aplicar(m2, cubo);
revisar('aplicar devuelve el mismo array', devuelto === cubo);
revisar(
    'aplicar escala en el lugar',
    cubo.every((v, i) => casi(v, original[i] * 2, 1e-4)),
);
const r = medir(identidad(), cubo);
revisar('medida después de aplicar = la de medir', casi(r.x, medida.x, 1e-4) && casi(r.z, medida.z, 1e-4));

// Volumen con signo: si es positivo, las normales apuntan para afuera.
const volumen = v => {
    let s = 0;
    for (let i = 0; i < v.length; i += 9) {
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = v.subarray(i, i + 9);
        s += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return s / 6;
};
const vol0 = volumen(original);
const rotado = aplicar(multiplicar(rotacion90('x'), rotacion90('z', 3)), original.slice());
revisar(
    'rotar conserva el volumen (y el sentido de las caras)',
    casi(volumen(rotado), vol0, 1e-2),
    `${vol0.toFixed(1)} → ${volumen(rotado).toFixed(1)}`,
);
const espejo = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
const espejado = aplicar(espejo, original.slice());
revisar(
    'espejo (det < 0): las normales siguen hacia afuera',
    vol0 > 0 && casi(volumen(espejado), vol0, 1e-2),
    `${vol0.toFixed(1)} → ${volumen(espejado).toFixed(1)}`,
);

// --- Recientes: normalizarTransformacion (src/almacen.js) ---
const idN = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const girada = [1, 0, 0, 0, 0, -1, 0, 1, 0];
const viejo = normalizarTransformacion({ id: 1, nombre: 'a.stl' });
revisar('reciente viejo: identidad y escala 1', viejo.escala === 1 && viejo.rotacion.join() === idN.join());
const guardado = normalizarTransformacion({ rotacion: girada, escala: 2.5 });
revisar('reciente con transformación', guardado.escala === 2.5 && guardado.rotacion.join() === girada.join());
const roto = normalizarTransformacion({ rotacion: [1, 2], escala: -3 });
revisar('registro dañado: defaults', roto.escala === 1 && roto.rotacion.join() === idN.join());
revisar('sin registro: defaults', normalizarTransformacion().escala === 1);

console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallas ? 1 : 0);
