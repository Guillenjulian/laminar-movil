// Pruebas del soporte árbol (ADR 0004, T1) con polígonos sintéticos: voladizos rectangulares sobre cama libre.
// Cada capa mide 0,2 mm; el voladizo (la sombra) vive en la capa de justo debajo de la tapa, como en Kiri.
import { planificarArbol } from '../../src/motor/soportes-arbol.js';
import { areaPoligono, distanciaAPoligono } from '../../src/motor/geometria-2d.js';
import { H, OP, DERIVA, EPS, CAMA, rect, pila, circulos } from './ayudas-arbol.mjs';

const area = salida => salida.reduce((s, capa) => s + capa.reduce((t, p) => t + areaPoligono(p), 0), 0);

// Puntos de la grilla de 3 mm que caen estrictamente dentro de un rectángulo.
function grilla(x0, y0, x1, y1) {
    const pts = [];
    for (let x = Math.ceil(x0 / 3) * 3; x < x1; x += 3) {
        for (let y = Math.ceil(y0 / 3) * 3; y < y1; y += 3) if (x > x0 && y > y0) pts.push({ x, y });
    }
    return pts;
}

function voladizoSimple({ revisar }) {
    console.log('\n▶ voladizo rectangular a 20 mm');
    const tapa = rect(10, 10, 30, 30);
    const capas = pila({ n: 100, tapas: [tapa] });
    const s = planificarArbol(capas, { ...OP, cama: CAMA });
    revisar('una salida por capa', s.length === capas.length);
    const vacias = s.slice(0, 100).findIndex(c => c.length === 0);
    revisar('hay soporte en cada capa bajo la tapa, hasta la cama', vacias === -1, `capa vacía ${vacias}`);
    const sembradas = grilla(10, 10, 30, 30);
    const bajoTapa = circulos(s[99]);
    const sinCubrir = sembradas.filter(p => !bajoTapa.some(c => Math.hypot(c.x - p.x, c.y - p.y) <= c.r));
    revisar(
        `la capa bajo la tapa cubre los ${sembradas.length} puntos de la grilla de 3 mm`,
        sinCubrir.length === 0,
        JSON.stringify(sinCubrir[0]),
    );
    const rMin = Math.min(...s.flatMap(circulos).map(c => c.r));
    revisar(`todo círculo tiene r ≥ 1,2 × ancho = 0,48 mm (mínimo ${rMin.toFixed(3)})`, rMin >= 1.2 * 0.4 - EPS);
    revisar('nada de soporte dentro de la tapa (la capa de la tapa queda vacía)', s[100].length === 0);
    const todos = s.flatMap(circulos);
    revisar(
        'nada sale de la cama',
        todos.every(c => c.x - c.r >= -EPS && c.y - c.r >= -EPS && c.x + c.r <= 220 + EPS && c.y + c.r <= 220 + EPS),
    );
    const sombra = 100 * 400; // lo que daría 'automatic': 400 mm² en cada una de las 100 capas
    const total = area(s);
    console.log(
        `  · área de soporte árbol ${total.toFixed(0)} mm² / sombra completa ${sombra} mm² = ${((100 * total) / sombra).toFixed(1)} %`,
    );
    revisar('el área del árbol es menor que la sombra completa', total < sombra, String(total));
    revisar('...y como mucho el 60 % de ella', total < 0.6 * sombra, String(total));
}

// Cada círculo de la capa i tiene uno de la capa i + 1 a lo sumo a `DERIVA` (la deriva por capa del ADR).
function derivaMaxima(s, desde) {
    let peor = 0;
    for (let i = desde - 1; i >= 0; i--) {
        const arriba = circulos(s[i + 1]);
        for (const c of circulos(s[i])) {
            const d = Math.min(...arriba.map(a => Math.hypot(a.x - c.x, a.y - c.y)));
            peor = Math.max(peor, d);
        }
    }
    return peor;
}

function dosVoladizos({ revisar }) {
    console.log('\n▶ dos voladizos cercanos: fusión y deriva');
    const tapas = [rect(10, 10, 16, 16), rect(24, 10, 30, 16)];
    const s = planificarArbol(pila({ n: 100, tapas }), { ...OP, cama: CAMA });
    const arriba = s[99].length;
    const abajo = s[0].length;
    revisar(`menos nodos abajo (${abajo}) que arriba (${arriba})`, abajo < arriba);
    const peor = derivaMaxima(s, 99);
    revisar(
        `deriva por capa ≤ ${DERIVA.toFixed(4)} mm en las 99 transiciones (peor ${peor.toFixed(4)})`,
        peor <= DERIVA + 1e-6,
    );
    const todas = s.slice(0, 100).every(c => c.length > 0);
    revisar('hay soporte en todas las capas', todas);
}

function sinPisarse(s) {
    for (const capa of s) {
        const cs = circulos(capa);
        for (let i = 0; i < cs.length; i++) {
            for (let j = i + 1; j < cs.length; j++) {
                if (Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y) < cs[i].r + cs[j].r - 1e-6) return false;
            }
        }
    }
    return true;
}

function pieza({ revisar }) {
    console.log('\n▶ la pieza: nunca se atraviesa');
    const tapa = rect(10, 10, 30, 30);
    const pilar = rect(18, 18, 22, 22);
    const s = planificarArbol(pila({ n: 100, tapas: [tapa], pilar }), { ...OP, cama: CAMA });
    const centros = s.flatMap(circulos);
    const adentro = centros.filter(c => distanciaAPoligono(c, [pilar]) < 0);
    revisar('ningún centro cae dentro del pilar', adentro.length === 0, `${adentro.length} adentro`);
    const libre = c => distanciaAPoligono(c, [pilar]) >= c.r;
    const izq = centros.filter(c => c.x < 18 && libre(c)).length;
    const der = centros.filter(c => c.x > 22 && libre(c)).length;
    revisar(`hay troncos a ≥1 radio del pilar a ambos lados (izq ${izq}, der ${der})`, izq > 0 && der > 0);
    revisar('ningún par de círculos se pisa, en ninguna capa', sinPisarse(s));
    // Pilar sólo en las capas 0-14 y una sombra chica y centrada en la 29: el tronco baja y se apoya, no lo atraviesa.
    const encima = [];
    for (let i = 0; i < 30; i++) {
        const sombra = i === 29 ? [rect(19, 19, 21, 21)] : [];
        encima.push({ z: (i + 0.5) * H, voladizos: sombra, cuerpo: i < 15 ? [pilar] : [] });
    }
    const e = planificarArbol(encima, { ...OP, cama: CAMA });
    revisar(
        'hay tronco hasta la capa 15 y ninguno dentro del pilar',
        e[15].length > 0 && e.slice(0, 15).every(c => c.length === 0),
    );
}

function topeYBloqueo({ revisar }) {
    console.log('\n▶ tope de nodos y bloqueos');
    const enorme = planificarArbol(pila({ n: 20, tapas: [rect(10, 10, 210, 210)] }), { ...OP, cama: CAMA });
    const maximo = Math.max(...enorme.map(c => c.length));
    revisar(`voladizo de 200×200: como mucho 150 nodos activos (máx ${maximo})`, maximo <= 150 && maximo > 0);
    const tapa = rect(10, 10, 30, 30);
    const capas = pila({ n: 100, tapas: [tapa] });
    const todo = { centro: { x: 20, y: 20, z: 10 }, radio: 40 };
    const vacio = planificarArbol(capas, { ...OP, bloqueos: [todo] });
    revisar(
        'un bloqueo que cubre todo el voladizo deja la salida vacía',
        vacio.every(c => c.length === 0),
    );
}

function inyectadaYDeterminismo({ revisar, igual }) {
    console.log('\n▶ capa inyectada y determinismo');
    const base = pila({ n: 100, tapas: [rect(10, 10, 30, 30)] });
    const ref = planificarArbol(base, OP);
    const vacia = planificarArbol([...base, { z: 115, voladizos: [], cuerpo: [] }], OP);
    revisar(
        'capa vacía con z índice (115): se ignora y el resto no cambia',
        igual(vacia.slice(0, -1), ref) && vacia.at(-1).length === 0,
    );
    const falsa = { z: 115, voladizos: [rect(0, 0, 50, 50)], cuerpo: [] };
    const con = planificarArbol([...base, falsa], OP);
    revisar('...aunque traiga sombra, no siembra soportes', igual(con.slice(0, -1), ref) && con.at(-1).length === 0);
    revisar('misma entrada, misma salida', igual(planificarArbol(base, OP), ref));
}

function rendimiento({ revisar }) {
    console.log('\n▶ rendimiento');
    const capas = [];
    for (let i = 0; i < 1000; i++) capas.push({ z: (i + 0.5) * H, voladizos: [], cuerpo: [] });
    for (let k = 0; k < 20; k++) {
        const x = 5 + (k % 5) * 40;
        const y = 5 + Math.floor(k / 5) * 40;
        const i = 100 + k * 40;
        capas[i].voladizos.push(rect(x, y, x + 20, y + 20));
        for (let j = i + 1; j < 1000; j++) capas[j].cuerpo.push(rect(x, y, x + 20, y + 20));
    }
    const t0 = performance.now();
    const s = planificarArbol(capas, { ...OP, cama: CAMA });
    const ms = performance.now() - t0;
    console.log(`  · 1000 capas con 20 voladizos: ${ms.toFixed(0)} ms`);
    revisar('1000 capas con 20 voladizos en menos de 5 s', ms < 5000 && s.flat().length > 0);
}

export default async function (ctx) {
    voladizoSimple(ctx);
    dosVoladizos(ctx);
    pieza(ctx);
    topeYBloqueo(ctx);
    inyectadaYDeterminismo(ctx);
    rendimiento(ctx);
}
