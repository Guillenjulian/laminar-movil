// Varias piezas contra el Kiri real (ADR 0003, tarea T6): el worker lamina un widget por copia, cada uno en su
// `track.pos`. Se lamina con cajas propias (STL en base64) y se revisan sobre el G-code las posiciones, las capas,
// los cambios por altura y los errores. Lo llama scripts/probar-motor.mjs dentro de su `try`.

import { acomodar } from '../../src/motor/piezas.js';
import { SEPARACION_PIEZAS_MM } from '../../src/config.js';
import { sinFecha } from './gcode-capas.mjs';

const EPS = 1e-6;
const CAMA = 220; // Ender 3 V3 SE (la impresora por defecto de la página de pruebas)
const ERROR_CAMA = 'Las piezas no entran en la cama. Probá con menos copias o más chicas.';
const ERROR_SOLA = 'El modelo mide 300,0 × 20,0 × 20,0 mm y no entra en la cama (220 × 220 × 250 mm).';

// STL binario (en base64) de una caja x × y × z con 12 triángulos.
function caja(x, y, z) {
    const tris = [];
    const v = i => [x * (i & 1), y * ((i >> 1) & 1), z * (i >> 2)];
    // cada tres dígitos son los vértices de un triángulo (bit 0 = x, bit 1 = y, bit 2 = z)
    for (const t of '021 123 456 576 014 154 263 367 042 246 135 375'.split(' ')) tris.push([...t].map(n => v(+n)));
    const b = Buffer.alloc(84 + tris.length * 50);
    b.writeUInt32LE(tris.length, 80);
    tris.forEach((t, i) => t.flat().forEach((n, j) => b.writeFloatLE(n, 84 + i * 50 + 12 + j * 4)));
    return b.toString('base64');
}

const CUBO = caja(20, 20, 20);
const BAJO = caja(20, 20, 10);
const SIN_ADHESION = { adhesion: 'nada' };

// Líneas de movimiento (G0 y G1).
const movimientos = gcode => gcode.split('\n').filter(l => /^G[01] /.test(l));

// Extrusiones de las capas de Kiri (`;LAYER:n`) que cumplan `quiere(n)`: { x0, y0, x, y, z } en coordenadas de cama.
function extrusiones(lineas, quiere) {
    const salida = [];
    let x = 0;
    let y = 0;
    let z = 0;
    let dentro = false;
    for (const l of lineas) {
        const capa = l.match(/^;LAYER:(\d+)/);
        if (capa) dentro = quiere(+capa[1]);
        if (!/^G[01] /.test(l)) continue;
        const nx = +(l.match(/ X(-?[\d.]+)/)?.[1] ?? x);
        const ny = +(l.match(/ Y(-?[\d.]+)/)?.[1] ?? y);
        z = +(l.match(/ Z(-?[\d.]+)/)?.[1] ?? z);
        if (dentro && /^G1 .*[XY].* E\d/.test(l)) salida.push({ x0: x, y0: y, x: nx, y: ny, z });
        x = nx;
        y = ny;
    }
    return salida;
}

// Parte la sucesión de extrusiones en grupos seguidos de una misma pieza (la del centro más cercano).
function agrupar(lista, centros) {
    const dist = (p, c) => Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y));
    const pieza = e => centros.reduce((mejor, c, k) => (dist(e, c) < dist(e, centros[mejor]) ? k : mejor), 0);
    const grupos = [];
    for (const e of lista) {
        const k = pieza(e);
        if (grupos.at(-1)?.k !== k) grupos.push({ k, xs: [], ys: [] });
        grupos.at(-1).xs.push(e.x0, e.x);
        grupos.at(-1).ys.push(e.y0, e.y);
    }
    return grupos;
}

// Posiciones relativas al centro de la cama -> coordenadas de cama.
const acamar = posiciones => posiciones.map(p => ({ x: p.x + CAMA / 2, y: p.y + CAMA / 2 }));

// Revisa que la capa 2 tenga un grupo de extrusión por copia y que el bbox de cada uno sea el de un cubo de 20 mm
// (centro = pos ± 0,5 y ancho 20 ± 1). `copias` son las posiciones relativas al centro de la cama.
function revisarGrupos(revisar, nombre, r, copias) {
    const centros = acamar(copias);
    const grupos = agrupar(
        extrusiones(r.g.lineas, n => n === 2),
        centros,
    );
    const unoPorCopia = grupos.length === centros.length && new Set(grupos.map(g => g.k)).size === centros.length;
    revisar(`${nombre}: capa 2 con un grupo de extrusión por copia`, unoPorCopia, `(${grupos.length} grupos)`);
    const cerca = (a, b, tol) => Math.abs(a - b) <= tol;
    const mal = grupos.filter(g => {
        const c = centros[g.k];
        const [x0, x1, y0, y1] = [Math.min(...g.xs), Math.max(...g.xs), Math.min(...g.ys), Math.max(...g.ys)];
        const bien = cerca((x0 + x1) / 2, c.x, 0.5) && cerca((y0 + y1) / 2, c.y, 0.5);
        return !(bien && cerca(x1 - x0, 20, 1) && cerca(y1 - y0, 20, 1));
    });
    revisar(`${nombre}: el bbox de cada grupo es el de 20 mm centrado en su pos (± 0,5)`, mal.length === 0);
}

// Casos (b) y (f): 4 copias de un cubo de 20 mm en posiciones de `acomodar`.
async function probarCuatroCopias({ laminar, revisar }, sola) {
    const huellas = Array(4).fill({ x: 20, y: 20 });
    const { posiciones, entra } = acomodar(huellas, { x: CAMA, y: CAMA }, SEPARACION_PIEZAS_MM);
    const r = await laminar({ piezas: [{ stlBase64: CUBO, posiciones }], personal: SIN_ADHESION });
    revisar('acomodar: 4 cubos de 20 mm entran en la cama de 220 mm', entra);
    revisarGrupos(revisar, '4 copias', r, posiciones);
    const { copias, triangulos, capas, tamano } = r.info;
    revisar('info.copias = 4 y triangulos = 48', copias === 4 && triangulos === 48, `(${copias}, ${triangulos})`);
    revisar('info.capas igual que con una sola pieza', capas === sola.info.capas, `(${capas} y ${sola.info.capas})`);
    const xs = posiciones.map(p => p.x);
    const ys = posiciones.map(p => p.y);
    const ancho = Math.max(...xs) - Math.min(...xs) + 20;
    const fondo = Math.max(...ys) - Math.min(...ys) + 20;
    revisar('info.tamano abarca todas las copias', tamano.x === ancho && tamano.y === fondo && tamano.z === 20);
}

// Una pieza con 2 copias asimétricas en X e Y junto a otra con 1 copia más baja.
async function probarAsimetrico({ laminar, revisar }) {
    const copias = [
        { x: -30, y: 25 },
        { x: 40, y: -15 },
    ];
    const piezas = [
        { stlBase64: CUBO, posiciones: copias },
        { stlBase64: BAJO, posiciones: [{ x: 0, y: -60 }] },
    ];
    const r = await laminar({ piezas, personal: SIN_ADHESION });
    revisarGrupos(revisar, 'asimétrico', r, [...copias, { x: 0, y: -60 }]);
    const { copias: n, triangulos, tamano } = r.info;
    revisar('asimétrico: info.copias = 3 y triangulos = 36', n === 3 && triangulos === 36, `(${n}, ${triangulos})`);
    const medidas = `(${tamano.x} × ${tamano.y} × ${tamano.z})`;
    revisar('asimétrico: info.tamano = 90 × 105 × 20', tamano.x === 90 && tamano.y === 105 && tamano.z === 20, medidas);
}

// Dos piezas que comparten el mismo ArrayBuffer: se transfiere una sola vez (antes daba DataCloneError).
async function probarBufferCompartido({ laminar, revisar }) {
    const piezas = [
        { stlBase64: CUBO, posiciones: [{ x: -30, y: 0 }] },
        { mismoQue: 0, posiciones: [{ x: 30, y: 0 }] },
    ];
    const nombre = 'dos piezas con el mismo ArrayBuffer laminan';
    try {
        const r = await laminar({ piezas, personal: SIN_ADHESION });
        revisar(nombre, r.info.copias === 2 && r.info.triangulos === 24);
    } catch (err) {
        revisar(nombre, false, `(${err.message.slice(0, 120)})`);
    }
}

// Caso (a): el mensaje del formato VIEJO directo al worker y `piezas` con {0,0} dan lo mismo: G-code completo
// (sin la línea de fecha) e info. Devuelve la corrida con una sola pieza.
async function probarEquivalencia({ laminar, revisar, pagina }) {
    const viejo = await pagina.evaluate(o => window.probarViejo(o), { stlBase64: CUBO, personal: SIN_ADHESION });
    const nuevo = await laminar({
        piezas: [{ stlBase64: CUBO, posiciones: [{ x: 0, y: 0 }] }],
        personal: SIN_ADHESION,
    });
    const [a, b] = [viejo, nuevo].map(r => sinFecha(r.gcode));
    const movs = movimientos(viejo.gcode).length;
    revisar(
        'formato viejo (directo al worker) y piezas con {0,0}: mismo G-code',
        movs > 1000 && a === b,
        `(${movs} mov.)`,
    );
    const pick = r => JSON.stringify(['tiempo', 'filamento', 'capas', 'triangulos', 'tamano'].map(k => r.info[k]));
    revisar('mismo info (tiempo, filamento, capas, triangulos, tamano)', pick(viejo) === pick(nuevo), pick(nuevo));
    revisar('info.copias = 1 y triangulos = 12', viejo.info.copias === 1 && viejo.info.triangulos === 12);
    return nuevo;
}

// Casos (c) y (d): dos piezas de distinta altura, y un cambio por altura que aparece una sola vez.
async function probarAlturas({ laminar, revisar }, sola) {
    const piezas = [
        { stlBase64: CUBO, posiciones: [{ x: -30, y: 0 }] },
        { stlBase64: BAJO, posiciones: [{ x: 30, y: 0 }] },
    ];
    const r = await laminar({ piezas, personal: SIN_ADHESION });
    revisar(
        'dos piezas (20 y 10 mm): las capas salen de la más alta',
        r.info.capas === sola.info.capas,
        `(${r.info.capas} capas; el cubo solo, ${sola.info.capas})`,
    );
    const todas = extrusiones(r.g.lineas, () => true);
    const bajas = todas.filter(e => e.x > CAMA / 2).map(e => e.z);
    const altas = todas.filter(e => e.x < CAMA / 2 && e.z > 10 + EPS);
    revisar(
        'la pieza baja no extruye por encima de sus 10 mm y la alta sí',
        bajas.length > 0 && Math.max(...bajas) <= 10 + EPS && altas.length > 0,
        `(Z máx de la baja ${Math.max(...bajas)})`,
    );
    const { copias, triangulos, tamano } = r.info;
    revisar('info.copias = 2, triángulos = 24 y tamaño z = 20', copias === 2 && triangulos === 24 && tamano.z === 20);
    const c = await laminar({ piezas, personal: SIN_ADHESION, cambios: [{ desdeMm: 10, tempBoquilla: 215 }] });
    const n215 = c.g.lineas.filter(l => l.startsWith('M104 S215')).length;
    revisar('cambio por altura a 10 mm con varias piezas: un solo M104 S215', n215 === 1, `(${n215})`);
}

// Mensaje de un error de la página, sin el prefijo de Playwright ni el stack.
const texto = err => err.message.replace(/^page\.evaluate: (Error: )?/, '').split('\n')[0];

// Corre `accion` y revisa que falle con exactamente `esperado`.
async function revisarError(revisar, nombre, accion, esperado) {
    try {
        await accion();
        revisar(nombre, false, '(laminó igual)');
    } catch (err) {
        revisar(nombre, texto(err) === esperado, `(${texto(err)})`);
    }
}

// Caso (e): errores de cama, de pieza sola (formato viejo) y de piezas vacías.
async function probarErrores({ laminar, revisar, pagina }) {
    const cubo = posiciones => ({ stlBase64: CUBO, posiciones });
    const piezas = lista => () => laminar({ piezas: lista });
    await revisarError(revisar, 'posición fuera de la cama', piezas([cubo([{ x: 120, y: 0 }])]), ERROR_CAMA);
    const viejo = () => pagina.evaluate(o => window.probarViejo(o), { stlBase64: caja(300, 20, 20) });
    await revisarError(revisar, 'formato viejo: pieza que no entra sola', viejo, ERROR_SOLA);
    await revisarError(revisar, 'piezas vacío', piezas([]), 'No hay piezas para laminar.');
    await revisarError(revisar, 'pieza sin posiciones', piezas([cubo([])]), 'Cada pieza necesita al menos una copia.');
}

/**
 * Varias piezas contra el Kiri real (ADR 0003, T6): equivalencia con el formato viejo (directo al worker), 4 copias
 * en posiciones de `acomodar`, un caso asimétrico, dos piezas de distinta altura, buffer compartido, cambio por altura
 * y errores.
 * @param {{ laminar: Function, revisar: Function, pagina: object }} ctx `laminar(opciones)` devuelve
 *   `{ gcode, g, info }`; `revisar(nombre, condicion, detalle)` registra el resultado; `pagina` es la de Playwright
 * @returns {Promise<void>}
 */
export async function probarPiezas(ctx) {
    console.log('\n▶ Varias piezas contra Kiri (ADR 0003, T6)');
    const sola = await probarEquivalencia(ctx);
    await probarCuatroCopias(ctx, sola);
    await probarAsimetrico(ctx);
    await probarAlturas(ctx, sola);
    await probarBufferCompartido(ctx);
    await probarErrores(ctx);
}
