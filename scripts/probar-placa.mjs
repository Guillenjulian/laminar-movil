// Pruebas de la placa QR (corren en Node, sin navegador): contornos de máscaras, análisis de una lámina
// sintética (QR, marco, renglones y color) y la malla de la placa (cerrada, medidas, alturas y QR legible).
//
// Uso: npm run test:placa

import jsQR from 'jsqr';
import { trazarBordes, agrupar, area, grosorMedio, engordar } from '../src/motor/contornos.js';
import { generarPlaca, disenarPlaca } from '../src/motor/placa-qr.js';
import { PLACA } from '../src/motor/placa-medidas.js';
import { analizarLamina } from '../src/ui/placa-imagen.js';
import { laminaSintetica, URL_PRUEBA } from './placa/lamina.mjs';
import { cerrada, rango, vistaDeArriba } from './placa/malla.mjs';

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (!condicion) fallas++;
}

function probarContornos() {
    console.log('\n▶ Contornos');
    // Anillo de 3 × 3 con el centro vacío: un contorno y un agujero.
    const anillo = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const formas = agrupar(trazarBordes(anillo, 3, 3));
    revisar(
        'anillo: un contorno con un agujero',
        formas.length === 1 && formas[0].agujeros.length === 1,
        `(${formas.length} formas)`,
    );
    revisar(
        'anillo: áreas 9 y 1',
        formas.length === 1 && area(formas[0].afuera) === 9 && area(formas[0].agujeros[0]) === -1,
    );
    // Dos píxeles que se tocan sólo en la esquina quedan unidos (sin vértices compartidos entre lazos).
    const diagonal = Uint8Array.from([1, 0, 0, 1]);
    const lazos = trazarBordes(diagonal, 2, 2);
    revisar('diagonal: un solo lazo', lazos.length === 1, `(${lazos.length} lazos)`);
    revisar('máscara vacía: sin lazos', trazarBordes(new Uint8Array(16), 4, 4).length === 0);
    // Línea vertical de 1 px en 20 × 20: grosor ~1 y, engordada 2 px, pasa a 5 px de ancho.
    const linea = new Uint8Array(400);
    for (let y = 0; y < 20; y++) linea[y * 20 + 10] = 1;
    const g = grosorMedio(linea, 20, 20);
    revisar('grosor de una línea de 1 px ≈ 1', g > 0.9 && g < 1.01, `(${g.toFixed(2)})`);
    const gorda = engordar(linea, 20, 20, 2);
    const fila = Array.from(gorda.subarray(200, 220)).join('');
    revisar('engordar 2 px: la línea pasa a 5 px', fila === '00000000111110000000', fila);
}

function probarAnalisis() {
    console.log('\n▶ Análisis de la lámina');
    const a = analizarLamina(laminaSintetica());
    revisar('lee el QR', a?.texto === URL_PRUEBA, a?.texto);
    revisar('encuentra el marco', a?.marco === true);
    const arriba = a?.bandas.map(b => b.arriba).join(',');
    revisar('4 renglones: 2 arriba y 2 abajo del QR', arriba === 'true,true,false,false', arriba);
    const destacados = a?.bandas.map(b => b.destacado).join(',');
    revisar('sólo el primer renglón (rojizo) es destacado', destacados === 'true,false,false,false', destacados);
    const blanca = laminaSintetica({ sinQr: true });
    revisar('sin QR: devuelve null', analizarLamina(blanca) === null);
    return a;
}

function probarMalla(a) {
    console.log('\n▶ Malla de la placa');
    const v = generarPlaca(a);
    const [x, y, z] = [0, 1, 2].map(k => rango(v, k));
    revisar(
        'mide 100 × 150 mm',
        x[0] === 0 && x[1] === PLACA.ancho && y[0] === 0 && y[1] === PLACA.alto,
        `(${x} × ${y})`,
    );
    revisar('arranca en 0 y llega a 2,6 mm (texto destacado)', z[0] === 0 && Math.abs(z[1] - 2.6) < 1e-6, `(${z})`);
    const abierta = cerrada(v);
    revisar('malla cerrada y orientada', abierta === 0, `(${abierta} aristas sin pareja, ${v.length / 9} triángulos)`);
    const vista = vistaDeArriba(v, 6);
    const leido = jsQR(vista.data, vista.width, vista.height);
    revisar(
        'el QR de la placa se lee y lleva el mismo link',
        leido?.data === URL_PRUEBA,
        leido?.data ?? '(no se leyó)',
    );
    const d = disenarPlaca(a.imagen, a.bandas);
    revisar('QR de 78 mm', Math.abs(d.qr.lado - 78) < 1e-9, `(${d.qr.lado.toFixed(1)} mm)`);
    const sinTexto = generarPlaca({ ...a, bandas: [] });
    revisar('sin textos: sólo base, marco y QR (hasta 2,2 mm)', Math.abs(rango(sinTexto, 2)[1] - 2.2) < 1e-6);
}

probarContornos();
const analisis = probarAnalisis();
if (analisis) probarMalla(analisis);
console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
