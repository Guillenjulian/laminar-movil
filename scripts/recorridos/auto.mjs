// Pruebas de `leerAuto` (ADR 0006, T5): elige el nivel de detalle reintentando, con como mucho 3 lecturas.
// Se cuentan las lecturas con un `leer` inyectado que anota cada llamada (nivel pedido y si salió incompleta).
import { leer, armar } from './ayuda.mjs';
import { generarGcode } from '../lib/gcode-sintetico.mjs';
import { leerAuto } from '../../src/motor/recorridos-auto.js';

/** `leer` que anota cada llamada. */
function contador() {
    const llamadas = [];
    const lector = (g, max, opciones) => {
        const r = leer(g, max, opciones);
        llamadas.push({ nivel: r.nivel, incompleta: r.incompleta });
        return r;
    };
    return { llamadas, lector };
}

const tramos = (g, nivel) => leer(g, Infinity, { nivel }).tipos.length;

export function probarAuto({ revisar, igual }) {
    console.log('\nleerAuto');

    // 1. Chico: entra en el nivel 0, una sola lectura, igual a leer.
    const chico = armar(['G1 Z0.2', 'G1 X0 Y0', 'G1 X10 Y0 E1', 'G1 X10 Y10 E2', 'G1 X0 Y10 E3']);
    let c = contador();
    let r = leerAuto(chico, 100, c.lector);
    revisar('chico: una sola lectura, nivel 0', c.llamadas.length === 1 && c.llamadas[0].nivel === 0);
    revisar('chico: igual a leer(gcode, max)', igual(r, leer(chico, 100)));
    revisar('chico: no simplificado ni incompleta', !r.simplificado && !r.incompleta);

    // 2. No entra en el nivel 0 pero sí en uno mayor.
    const g = generarGcode(30000, 3);
    const n0 = tramos(g, 0);
    const max = Math.floor(n0 * 0.95);
    c = contador();
    r = leerAuto(g, max, c.lector);
    const k = r.nivel;
    revisar('mediano: el nivel 0 no entra', n0 > max && c.llamadas[0].nivel === 0 && c.llamadas[0].incompleta);
    revisar('mediano: sube a un nivel mayor que 0 y menor que 3', k > 0 && k < 3, `nivel ${k}`);
    revisar('mediano: igual a leer con ese nivel', igual(r, leer(g, max, { nivel: k })));
    revisar('mediano: completa y simplificada', !r.incompleta && r.simplificado);
    revisar('mediano: de 2 a 3 lecturas', c.llamadas.length >= 2 && c.llamadas.length <= 3, `${c.llamadas.length}`);

    // 3. No entra ni en el nivel 3: tope de lecturas, devuelve la del nivel 3 incompleta.
    const maxChico = Math.floor(tramos(g, 3) * 0.6);
    c = contador();
    r = leerAuto(g, maxChico, c.lector);
    revisar('enorme: no más de 3 lecturas', c.llamadas.length <= 3, `${c.llamadas.length}`);
    revisar('enorme: reintenta (más de una lectura)', c.llamadas.length > 1);
    revisar('enorme: la última es del nivel 3 e incompleta', r.nivel === 3 && r.incompleta);
    revisar('enorme: igual a leer con el nivel 3', igual(r, leer(g, maxChico, { nivel: 3 })));
    revisar(
        'enorme: los niveles de las lecturas suben',
        c.llamadas.every((l, i) => i === 0 || l.nivel > c.llamadas[i - 1].nivel),
    );

    // 4. Un lector que siempre sale incompleta casi al final (el salto sería de a un nivel): el tope de lecturas
    //    manda y la tercera va directo al nivel 3.
    const niveles = [];
    const terco = (gcode, tope, opciones) => {
        niveles.push(opciones.nivel);
        return { ...leer(gcode, tope, opciones), incompleta: true, leidoHasta: Math.floor(gcode.length * 0.99) };
    };
    r = leerAuto(g, max, terco);
    revisar('lector terco: 3 lecturas, niveles 0, 1 y 3', igual(niveles, [0, 1, 3]), niveles.join(','));
    revisar('lector terco: devuelve la última (nivel 3, incompleta)', r.nivel === 3 && r.incompleta);
}
