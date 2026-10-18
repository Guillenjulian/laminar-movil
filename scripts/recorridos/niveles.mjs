// Pruebas de los niveles de simplificación del lector (ADR 0006, T4): reducción monótona, error máximo punto a punto,
// capas/Z/pausas/caja/tipos sin cambios, `simplificado`, `leidoHasta` y `siguienteNivel`.
import { leer, armar } from './ayuda.mjs';
import { generarGcode } from '../lib/gcode-sintetico.mjs';
import { NIVELES, REDUCCION, siguienteNivel } from '../../src/motor/recorridos-niveles.js';
import { distanciaASegmento } from '../../src/motor/recorridos-tramos.js';
import { tipoDe } from '../../src/motor/recorridos-lista.js';

// Cuantizado: cada coordenada se redondea a 0,02 mm (error <= 0,01 por eje, 0,0142 en diagonal) y el tramo
// simplificado usa extremos cuantizados: se tolera 0,015 mm más que `desvio`.
const CUANTIZACION = 0.015;
const mm = v => v / 50 - 600;

/** Segmentos que extruyen del G-code (formato del generador sintético: coordenadas absolutas, E absoluto). */
function segmentosOriginales(gcode) {
    const seg = [];
    let x = 0,
        y = 0,
        e = 0,
        capa = -1,
        tipo = -1;
    for (const l of gcode.split('\n')) {
        if (l.startsWith('; feature ')) tipo = tipoDe(l.slice(10));
        else if (l.startsWith(';LAYER:')) capa++;
        else if (l.startsWith('G92 E')) e = parseFloat(l.slice(5));
        else if (l.startsWith('G0 ') || l.startsWith('G1 ')) {
            const vx = /X(-?[\d.]+)/.exec(l),
                vy = /Y(-?[\d.]+)/.exec(l),
                ve = /E(-?[\d.]+)/.exec(l);
            const nx = vx ? +vx[1] : x,
                ny = vy ? +vy[1] : y,
                ne = ve ? +ve[1] : e;
            if (tipo >= 0 && ne > e + 1e-6 && (nx !== x || ny !== y))
                seg.push({ x0: x, y0: y, x1: nx, y1: ny, capa, tipo });
            x = nx;
            y = ny;
            e = ne;
        }
    }
    return seg;
}

/**
 * Recorre los tramos del resultado junto con los segmentos originales y mide, por cada tramo, la distancia máxima
 * de los puntos originales que reemplaza. También revisa que cada tramo no cruce capa ni tipo.
 * @returns {{ error: number, cruces: number, huerfanos: number }}
 */
function medirError(gcode, r) {
    const seg = segmentosOriginales(gcode);
    let j = 0,
        error = 0,
        cruces = 0,
        huerfanos = 0;
    for (let capa = 0; capa < r.zCapa.length; capa++) {
        for (let k = r.inicioCapa[capa]; k < r.inicioCapa[capa + 1]; k++) {
            const [ax, ay, bx, by] = [0, 1, 3, 4].map(i => mm(r.posiciones[6 * k + i]));
            const pts = [];
            let llego = false;
            while (j < seg.length && !llego) {
                const s = seg[j++];
                if (s.capa !== capa || s.tipo !== r.tipos[k]) cruces++;
                pts.push([s.x0, s.y0], [s.x1, s.y1]);
                llego = Math.abs(s.x1 - bx) < 0.0105 && Math.abs(s.y1 - by) < 0.0105;
            }
            if (!llego) huerfanos++;
            for (const [px, py] of pts) error = Math.max(error, distanciaASegmento(px, py, ax, ay, bx, by));
        }
    }
    return { error, cruces, huerfanos: huerfanos + (seg.length - j) };
}

const colapsar = a => a.filter((t, i) => t !== a[i - 1]);
const tiposPorCapa = r =>
    Array.from(r.zCapa, (_, c) => colapsar(Array.from(r.tipos.subarray(r.inicioCapa[c], r.inicioCapa[c + 1]))));

function reduccion({ revisar }, gcode) {
    console.log('\n▶ niveles: reducción');
    const rs = [0, 1, 2, 3].map(nivel => leer(gcode, Infinity, { nivel }));
    const n = rs.map(r => r.tipos.length);
    revisar('menos tramos a cada nivel (monótona estricta)', n[0] > n[1] && n[1] > n[2] && n[2] > n[3], n.join(' > '));
    revisar(
        'nivel y simplificado: 0/false, luego n/true',
        rs.every((r, i) => r.nivel === i && r.simplificado === i > 0),
    );
    revisar(
        'la reducción medida no es mejor que REDUCCION (que es prudente)',
        n.every((t, i) => t / n[0] <= REDUCCION[i] + 0.02),
        n.map(t => (t / n[0]).toFixed(2)).join(' '),
    );
    revisar(
        'NIVELES crece en desvio y largoCurva',
        NIVELES.every((v, i) => !i || (v.desvio > NIVELES[i - 1].desvio && v.largoCurva > NIVELES[i - 1].largoCurva)),
    );
    return rs;
}

function exactitud({ revisar, igual }, gcode, rs) {
    console.log('\n▶ niveles: error máximo y estructura');
    rs.forEach((r, nivel) => {
        const { error, cruces, huerfanos } = medirError(gcode, r);
        // El nivel 0 es el de siempre: compara cada punto sólo con el tramo anterior y el error se puede acumular
        // (acá 0,06 mm). Los niveles 1 a 3 comprueban todos los puntos que sacan y respetan su desvio.
        if (nivel > 0) {
            revisar(
                `nivel ${nivel}: error máximo ${error.toFixed(4)} mm <= desvio ${NIVELES[nivel].desvio} (+ cuantizado)`,
                error <= NIVELES[nivel].desvio + CUANTIZACION,
            );
        }
        revisar(
            `nivel ${nivel}: ningún tramo cruza capa ni tipo, y todos los segmentos quedan cubiertos`,
            cruces === 0 && huerfanos === 0,
            `${cruces} cruces, ${huerfanos} sin cubrir`,
        );
    });
    const [r0, ...otros] = rs;
    const iguales = otros.every(
        r =>
            igual(r.zCapa, r0.zCapa) &&
            igual(r.pausaCapa, r0.pausaCapa) &&
            igual(r.caja, r0.caja) &&
            r.inicioCapa.length === r0.inicioCapa.length &&
            r.inicioCapa[r.inicioCapa.length - 1] === r.tipos.length &&
            igual(tiposPorCapa(r), tiposPorCapa(r0)) &&
            r.incompleta === false &&
            r.leidoHasta === gcode.length,
    );
    revisar('capas, Z, pausas, caja y tipos por capa iguales al nivel 0', iguales);
}

function sinCambios({ revisar, igual }, gcode) {
    console.log('\n▶ niveles: nivel 0 y opciones inválidas');
    const r0 = leer(gcode, Infinity);
    revisar('sin opciones: nivel 0, simplificado false', r0.nivel === 0 && r0.simplificado === false);
    const campos = ['posiciones', 'colores', 'tipos', 'inicioCapa', 'pausaCapa', 'zCapa', 'caja'];
    for (const op of [{ nivel: 0 }, {}, { nivel: 7 }, { nivel: -1 }, { nivel: 1.5 }, null]) {
        const r = leer(gcode, Infinity, op);
        revisar(
            `opciones ${JSON.stringify(op)} -> igual al nivel 0`,
            campos.every(c => igual(r[c], r0[c])) && r.nivel === 0,
        );
    }
}

/** Lee `lineas` (todas extruyen, tipo shells) con `nivel`. */
function tramos(lineas, nivel) {
    return leer(armar(['; feature shells', ...lineas.map((t, i) => `G1 ${t} E${i + 1}`)]), Infinity, { nivel });
}

function simplificado({ revisar }) {
    console.log('\n▶ niveles: simplificado y uniones');
    const colineal = ['X0.5 Y0', 'X1 Y0', 'X1.5 Y0'];
    revisar(
        'colineales: el nivel 3 no marca simplificado (el 0 también los une)',
        tramos(colineal, 3).tipos.length === 1 && !tramos(colineal, 3).simplificado,
    );
    const curva = ['X1 Y0.05', 'X2 Y0'];
    revisar(
        'desvío 0,05: el nivel 0 no une; el 1 sí y marca simplificado',
        tramos(curva, 0).tipos.length === 2 && tramos(curva, 1).tipos.length === 1 && tramos(curva, 1).simplificado,
    );
    revisar('desvío 0,05: nivel 0 no marca simplificado', !tramos(curva, 0).simplificado);
    const esquina = ['X5 Y0', 'X5 Y5', 'X0 Y5'];
    revisar(
        'esquinas de 90°: no se une nada, simplificado false',
        tramos(esquina, 3).tipos.length === 3 && !tramos(esquina, 3).simplificado,
    );
    const largo = ['X8 Y0.05', 'X16 Y0'];
    revisar(
        'el desvío 0,05 con tramos de 16 mm no se une en el nivel 1 (largoCurva 10) pero sí en el 3',
        tramos(largo, 1).tipos.length === 2 && tramos(largo, 3).tipos.length === 1,
    );
    const tipos = leer(armar(['; feature shells', 'G1 X1 Y0 E1', '; feature support', 'G1 X2 Y0 E2']), Infinity, {
        nivel: 3,
    });
    revisar('colineales de distinto tipo no se unen en el nivel 3', tipos.tipos.length === 2);
    const capas = leer(armar(['; feature shells', 'G1 Z0.2', 'G1 X1 Y0 E1', 'G1 Z0.4', 'G1 X2 Y0 E2']), Infinity, {
        nivel: 3,
    });
    revisar('colineales en dos capas no se unen en el nivel 3', capas.tipos.length === 2 && capas.zCapa.length === 2);
}

function lectura({ revisar, igual }, gcode) {
    console.log('\n▶ niveles: leidoHasta');
    const completo = leer(gcode, Infinity, { nivel: 2 });
    revisar('leidoHasta = largo del texto cuando se lee todo', completo.leidoHasta === gcode.length);
    for (const nivel of [0, 2]) {
        const tope = Math.floor(leer(gcode, Infinity, { nivel }).tipos.length / 2);
        const corto = leer(gcode, tope, { nivel });
        const h = corto.leidoHasta;
        revisar(
            `nivel ${nivel}, con tope: incompleta y leidoHasta en un salto de línea`,
            corto.incompleta && h > 0 && h < gcode.length && gcode[h - 1] === '\n',
        );
        const hasta = leer(gcode.slice(0, h), Infinity, { nivel });
        revisar(
            `nivel ${nivel}: leer el texto hasta leidoHasta da los mismos tramos`,
            ['posiciones', 'tipos', 'zCapa'].every(c => igual(hasta[c], corto[c])) && hasta.tipos.length === tope,
        );
    }
}

function curvas({ revisar }) {
    console.log('\n▶ niveles: círculo de 20 mm y zigzag');
    const L = ['; feature shells'];
    for (let i = 0; i <= 600; i++) {
        const a = (2 * Math.PI * i) / 600;
        L.push(`G1 X${(100 + 20 * Math.cos(a)).toFixed(3)} Y${(100 + 20 * Math.sin(a)).toFixed(3)} E${i + 1}`);
    }
    for (let i = 0; i < 40; i++) L.push(`G1 X${i % 2 ? 100 : 130} Y${100 + i * 0.4} E${700 + i}`);
    const g = armar(['G1 X120 Y100 E0.5', ...L.slice(0, 1), 'G1 Z0.2', ...L.slice(1)]);
    // el generador de la prueba espera ;LAYER: para contar capas
    const gcode = g.replace('G1 Z0.2', ';LAYER:0\nG1 Z0.2');
    const base = leer(gcode, Infinity).tipos.length;
    for (let nivel = 1; nivel <= 3; nivel++) {
        const r = leer(gcode, Infinity, { nivel });
        const { error } = medirError(gcode, r);
        revisar(
            `nivel ${nivel}: círculo (r 20) y zigzag no se apartan más de ${NIVELES[nivel].desvio} mm (${r.tipos.length}/${base} tramos)`,
            error <= NIVELES[nivel].desvio + CUANTIZACION && r.tipos.length < base,
            error.toFixed(4),
        );
    }
}

function siguientes({ revisar }) {
    console.log('\n▶ niveles: siguienteNivel');
    revisar('si con el nivel 1 ya entra, es el 1', siguienteNivel(1000, 2000, 0) === 1);
    revisar('si hace falta más reducción, sube', siguienteNivel(2000 / REDUCCION[1], 1700, 0) >= 2);
    revisar('desde el 1 sólo mira el 2 y el 3', siguienteNivel(1, 2000, 1) === 2);
    revisar('si ninguno alcanza, el 3', siguienteNivel(1e9, 1000, 0) === 3 && siguienteNivel(1e9, 1000, 2) === 3);
}

export function probarNiveles(ctx) {
    const gcode = generarGcode(60000, 3);
    const rs = reduccion(ctx, gcode);
    exactitud(ctx, gcode, rs);
    sinCambios(ctx, gcode);
    simplificado(ctx);
    lectura(ctx, gcode);
    curvas(ctx);
    siguientes(ctx);
}
