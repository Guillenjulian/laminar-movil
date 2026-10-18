// Pruebas del soporte árbol, vuelta 2 (ADR 0004, T1): poda de troncos colgados, cama, radio mínimo y altura de
// capa variable. Reusa los helpers de arbol.mjs.
import { planificarArbol } from '../../src/motor/soportes-arbol.js';
import { distanciaAPoligono } from '../../src/motor/geometria-2d.js';
import { H, OP, EPS, DERIVA, rect, pila, circulos } from './arbol.mjs';

const TAN = Math.tan((50 * Math.PI) / 180);

// Cuántos círculos de la salida no tienen nada debajo: ni la cama (capa 0), ni la pieza (su centro adentro de la
// pieza de la capa de abajo), ni un círculo de la capa de abajo a menos de 4 derivas de tocarlo. El margen cubre
// la fusión: el tronco más liviano queda a lo sumo a 2 derivas del círculo fusionado; un tronco colgado de verdad
// no tiene NADA debajo.
function flotantes(s, capas) {
    let n = 0;
    for (let i = 1; i < s.length; i++) {
        const abajo = circulos(s[i - 1]);
        for (const c of circulos(s[i])) {
            const sobreLaPieza = distanciaAPoligono(c, capas[i - 1].cuerpo) < 0;
            const tocan = abajo.some(b => Math.hypot(b.x - c.x, b.y - c.y) <= b.r + c.r + 4 * DERIVA);
            if (!sobreLaPieza && !tocan) n++;
        }
    }
    return n;
}

function poda({ revisar }) {
    console.log('\n▶ poda de troncos colgados (bloqueo en el camino)');
    const capas = pila({ n: 100, tapas: [rect(10, 10, 30, 30)] });
    const libre = planificarArbol(capas, OP);
    revisar('control: sin bloqueo hay soporte y nada flota', libre.flat().length > 0 && flotantes(libre, capas) === 0);
    for (const radio of [4, 8]) {
        const bloqueo = { id: 1, forma: 'esfera', centro: { x: 20, y: 20, z: 5 }, radio };
        const s = planificarArbol(capas, { ...OP, bloqueos: [bloqueo] });
        const n = flotantes(s, capas);
        revisar(`esfera R=${radio} bajo la tapa: ningún círculo flotante (${n})`, n === 0);
        const sobre = s.slice(Math.ceil((5 + radio) / H) + 1).flat().length; // capas por encima de la esfera (0,2 mm cada una)
        revisar(`...y el tramo de arriba se podó entero, no queda soporte en el aire`, sobre === 0, `${sobre}`);
    }
}

function podaParcial({ revisar, igual }) {
    console.log('\n▶ poda parcial: sólo se poda el tronco bloqueado');
    const tapas = [rect(10, 10, 16, 16), rect(60, 10, 66, 16)];
    const capas = pila({ n: 100, tapas });
    const ref = planificarArbol(capas, OP);
    const bloqueo = { id: 1, forma: 'esfera', centro: { x: 13, y: 13, z: 5 }, radio: 4 };
    const s = planificarArbol(capas, { ...OP, bloqueos: [bloqueo] });
    const lado = (sal, f) => sal.map(c => c.filter(p => f(p[0].x)));
    revisar('nada flota', flotantes(s, capas) === 0);
    revisar(
        'el tronco de la derecha queda idéntico',
        igual(
            lado(s, x => x > 40),
            lado(ref, x => x > 40),
        ),
    );
    const izq = s.flatMap(c => c).filter(p => p[0].x < 40).length;
    const izqRef = ref.flatMap(c => c).filter(p => p[0].x < 40).length;
    revisar(`el de la izquierda se poda (${izq} de ${izqRef} círculos)`, izq < izqRef);
    revisar(
        'el de la derecha llega a la cama',
        s[0].some(p => p[0].x > 40),
    );
}

function cama({ revisar }) {
    console.log('\n▶ cama');
    const capas = pila({ n: 100, tapas: [rect(0, 10, 20, 30)] });
    const lim = { x0: 3.5, y0: 0, x1: 220, y1: 220 };
    const afuera = sal => sal.flatMap(circulos).filter(c => c.x - c.r < lim.x0 - EPS).length;
    const sin = afuera(planificarArbol(capas, OP));
    revisar(`control: sin cama hay ${sin} círculos que pasan de x = 3,5`, sin > 0);
    const con = planificarArbol(capas, { ...OP, cama: lim });
    revisar('con la cama pegada al borde ningún círculo sale', afuera(con) === 0 && con.flat().length > 0);
    revisar('...y nada flota', flotantes(con, capas) === 0);
}

function radioMinimo({ revisar }) {
    console.log('\n▶ radio mínimo');
    const capas = pila({ n: 50, tapas: [rect(10, 10, 30, 30)] });
    const cumple = (op, rMin) => {
        const polis = planificarArbol(capas, op).flat();
        const rs = polis.flatMap(p => circulos([p])).map(c => c.r);
        // Ancho entre lados del octágono: 2·r·cos(π/8).
        return rs.length > 0 && rs.every(r => r >= rMin - EPS && 2 * r * Math.cos(Math.PI / 8) >= 0.8 - EPS);
    };
    revisar('por defecto todo r ≥ 1,2 × ancho y ancho ≥ 2 anchos de línea', cumple(OP, 0.48));
    revisar(
        'radioPunta absurdo (0,05) se acota: r ≥ ancho / cos(π/8) y ancho ≥ 2 anchos',
        cumple({ ...OP, radioPunta: 0.05 }, 0.4 / Math.cos(Math.PI / 8)),
    );
}

// Pila con alturas mezcladas 0,1 / 0,3; la tapa vive en la última capa real, que mide `ultimo`.
function pilaVariable(ultimo) {
    const capas = [];
    let z = 0;
    for (let i = 0; i < 60; i++) {
        z += i % 2 ? 0.3 : 0.1;
        capas.push({ z, voladizos: [], cuerpo: [] });
    }
    capas.push({ z: z + ultimo, voladizos: [rect(10, 10, 20, 20)], cuerpo: [] });
    return capas;
}

function alturaVariable({ revisar }) {
    console.log('\n▶ altura de capa variable (0,1 / 0,3)');
    const capas = pilaVariable(0.3);
    const s = planificarArbol(capas, { ...OP, altoCapa: 0.3 }); // altoCapa grande: una deriva escalar se pasaría
    let peor = 0;
    for (let i = capas.length - 2; i >= 0; i--) {
        const dz = capas[i + 1].z - capas[i].z;
        const arriba = circulos(s[i + 1]);
        for (const c of circulos(s[i])) {
            peor = Math.max(peor, Math.min(...arriba.map(a => Math.hypot(a.x - c.x, a.y - c.y))) / (dz * TAN));
        }
    }
    revisar(
        `la deriva de cada transición ≤ (z[i+1]-z[i])·tan(50°) (peor ${peor.toFixed(3)} de lo permitido)`,
        peor <= 1 + 1e-6,
    );
    revisar(
        'hay soporte hasta la cama',
        s.slice(0, 60).every(c => c.length > 0),
    );
    const alta = pilaVariable(0.5); // última capa real de 0,5 mm: no es una capa inyectada
    const t = planificarArbol([...alta, { z: 62, voladizos: [], cuerpo: [] }], { ...OP, altoCapa: 0.1 });
    revisar('una última capa real alta (0,5 mm) se procesa', t[60].length > 0);
    revisar('...y la inyectada que viene después (z = 62) se ignora', t[61].length === 0);
}

export default async function (ctx) {
    poda(ctx);
    podaParcial(ctx);
    cama(ctx);
    radioMinimo(ctx);
    alturaVariable(ctx);
}
