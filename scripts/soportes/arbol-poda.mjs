// Pruebas del soporte árbol, vuelta 2 (ADR 0004, T1): poda de troncos colgados, cama, radio mínimo y altura de
// capa variable. Reusa las ayudas de ayudas-arbol.mjs.
import { planificarArbol } from '../../src/motor/soportes-arbol.js';
import { distanciaAPoligono } from '../../src/motor/geometria-2d.js';
import { seccionBloqueos, radioSeccion } from '../../src/motor/bloqueos.js';
import { marcarViables } from '../../src/motor/soportes-poda.js';
import { holgura } from '../../src/motor/soportes-paso.js';
import { H, OP, EPS, DERIVA, rect, pila, circulos } from './ayudas-arbol.mjs';

const TAN = Math.tan((50 * Math.PI) / 180);

// Cuántos círculos de la salida no tienen nada debajo: ni la cama (capa 0), ni la pieza (su centro adentro de la
// pieza de la capa de abajo), ni un círculo de la capa de abajo a TOL de tocarlo. TOL sale de cómo baja un tronco
// sano: una deriva por capa, y si se funde con otro, el círculo fusionado queda a lo sumo a 2 derivas más (la
// posición fusionada se acota al disco de deriva del nodo mayor), más lo que crece el radio en esa capa. Se mide con
// el peor caso real: en un voladizo de 20×20 a 3 mm de grilla, 2,04 derivas. Un colgado de verdad no tiene NADA
// debajo. Lo que esta medida geométrica no distingue (un colgado a menos de TOL de un tronco sano) lo cubre
// `marcarViables` con linaje exacto, abajo.
const TOL = 3 * DERIVA + 0.25 * H;
function flotantes(s, capas) {
    let n = 0;
    for (let i = 1; i < s.length; i++) {
        const abajo = circulos(s[i - 1]);
        for (const c of circulos(s[i])) {
            const sobreLaPieza = distanciaAPoligono(c, capas[i - 1].cuerpo) < 0;
            const tocan = abajo.some(b => Math.hypot(b.x - c.x, b.y - c.y) <= b.r + c.r + TOL);
            if (!sobreLaPieza && !tocan) n++;
        }
    }
    return n;
}

// Invariante: ningún círculo de la salida cae dentro de la sección de un bloqueo en su misma capa (la sección es el
// polígono circunscripto que resta `sinBloqueos`: se mide contra él, no contra el círculo ideal).
function dentroDeSeccion(s, capas, bloqueos) {
    let n = 0;
    s.forEach((capa, i) => {
        const secciones = seccionBloqueos(bloqueos, capas[i].z);
        if (!secciones.length) return;
        for (const c of circulos(capa)) if (distanciaAPoligono(c, secciones) < c.r - EPS) n++;
    });
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
        revisar(`...ni ningún círculo dentro de la sección de la esfera`, dentroDeSeccion(s, capas, [bloqueo]) === 0);
        const sobre = s.slice(Math.ceil((5 + radio) / H) + 1).flat().length; // capas por encima de la esfera (0,2 mm cada una)
        revisar(`...y el tramo de arriba se podó entero, no queda soporte en el aire`, sobre === 0, `${sobre}`);
    }
}

function podaParcial({ revisar, igual }) {
    console.log('\n▶ poda parcial: sólo se poda el tronco bloqueado');
    const tapas = [rect(10, 10, 16, 16), rect(60, 10, 66, 16)];
    const capas = pila({ n: 100, tapas });
    const ref = planificarArbol(capas, OP);
    const lado = (sal, f) => sal.map(c => c.filter(p => f(p[0].x)));
    for (const radio of [4, 6]) {
        const bloqueo = { id: 1, forma: 'esfera', centro: { x: 13, y: 13, z: 5 }, radio };
        const s = planificarArbol(capas, { ...OP, bloqueos: [bloqueo] });
        revisar(`R=${radio}: nada flota`, flotantes(s, capas) === 0);
        revisar(`R=${radio}: ningún círculo de la salida toca su sección`, dentroDeSeccion(s, capas, [bloqueo]) === 0);
        revisar(
            `R=${radio}: el tronco de la derecha queda idéntico`,
            igual(
                lado(s, x => x > 40),
                lado(ref, x => x > 40),
            ),
        );
        const izq = s.flatMap(c => c).filter(p => p[0].x < 40).length;
        const izqRef = ref.flatMap(c => c).filter(p => p[0].x < 40).length;
        revisar(`R=${radio}: el de la izquierda se poda (${izq} de ${izqRef} círculos)`, izq < izqRef);
        revisar(
            `R=${radio}: el de la derecha llega a la cama`,
            s[0].some(p => p[0].x > 40),
        );
    }
}

// Consistencia con `seccionBloqueos`: en cada dirección, el círculo más pegado a la esfera que acepta el árbol
// (`holgura` != -Infinity) no se mete en el polígono circunscripto que `sinBloqueos` resta de la sombra. Se barre
// el radio de a 0,1 % desde justo antes de la sección hasta pasarla, a varias alturas (también cerca del polo).
function consistencia({ revisar }) {
    console.log('\n▶ el árbol y la resta de zonas hablan de la misma sección');
    const b = { id: 1, forma: 'esfera', centro: { x: 5, y: -3, z: 10 }, radio: 12 };
    let peor = Infinity;
    let probados = 0;
    for (const z of [10, 14, 18, 21, 21.9]) {
        const seccion = seccionBloqueos([b], z);
        const rs = radioSeccion(b, z);
        const ctx = { op: { bloqueos: [b] }, capa: { z, cuerpo: [] } };
        for (const r of [0.48, 1.5]) {
            for (let grados = 0; grados < 360; grados += 3) {
                const [cx, cy] = [Math.cos((grados * Math.PI) / 180), Math.sin((grados * Math.PI) / 180)];
                for (let d = 0.9 * rs; d <= 1.1 * rs + r; d += 0.001 * rs) {
                    const p = { x: b.centro.x + d * cx, y: b.centro.y + d * cy };
                    if (holgura(ctx, p.x, p.y, r) === -Infinity) continue;
                    peor = Math.min(peor, distanciaAPoligono(p, seccion) - r);
                    probados++;
                    break;
                }
            }
        }
    }
    revisar(
        `ningún círculo aceptado cae dentro de la sección (${probados} pruebas, margen mínimo ${peor.toFixed(4)} mm)`,
        probados > 0 && peor >= -EPS,
    );
}

// Linaje exacto de `marcarViables` con registros armados a mano: no depende de ninguna tolerancia geométrica.
function linaje({ revisar }) {
    console.log('\n▶ marcarViables (linaje exacto)');
    const nodo = (campos = {}) => ({ ...campos });
    // Dos troncos contiguos de 4 capas: el de la izquierda queda colgado en la capa 1, el de la derecha llega a la cama.
    const izq = [nodo(), nodo(), nodo(), nodo()];
    const der = [nodo(), nodo(), nodo(), nodo()];
    for (let i = 1; i < 4; i++) {
        izq[i].hijo = izq[i - 1];
        der[i].hijo = der[i - 1];
    }
    izq[0].fin = 'colgado'; // la capa 0 es la cama, pero este nodo dice que lo frenó un bloqueo
    const registro = [0, 1, 2, 3].map(i => [izq[i], der[i]]);
    registro[0] = [der[0]]; // del tronco izquierdo no hay nodo en la capa 0: cortó antes
    izq[1].fin = 'colgado';
    delete izq[1].hijo;
    marcarViables(registro);
    revisar(
        'el colgado y todo lo que cuelga de él no son viables; el vecino sano sí',
        izq.slice(1).every(n => n.viable === false) && der.every(n => n.viable === true),
    );
    // Fusión: p y q bajan a p1 y q1, que se funden en m (viable); p1 y q1 apuntan a m con `destino`.
    const m = nodo();
    const p1 = nodo({ destino: m });
    const q1 = nodo({ destino: m });
    const p = nodo({ hijo: p1 });
    const q = nodo({ hijo: q1 });
    const c = nodo({ fin: 'colgado' });
    const apoyado = nodo({ fin: 'pieza' });
    marcarViables([[m], [p, q, c, apoyado]]);
    revisar(
        'fusionados en un tronco viable lo son; colgado no; apoyado en la pieza sí',
        p.viable && q.viable && !c.viable && apoyado.viable,
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
    consistencia(ctx);
    linaje(ctx);
    cama(ctx);
    radioMinimo(ctx);
    alturaVariable(ctx);
}
