// Varias piezas contra el Kiri real (ADR 0003, tarea T6): el worker lamina un widget por copia, cada uno en su
// `track.pos`. Se lamina con cajas propias (STL en base64) y se revisan sobre el G-code las posiciones, las capas,
// los cambios por altura y los errores. Lo llama scripts/probar-motor.mjs dentro de su `try`.

import { acomodar } from '../../src/motor/piezas.js';
import { SEPARACION_PIEZAS_MM } from '../../src/config.js';

const EPS = 1e-6;
const CAMA = 220; // Ender 3 V3 SE (la impresora por defecto de la página de pruebas)
const MITAD = 10.5; // 10 mm de media pieza + 0,5 mm de holgura de extrusión
const ERROR_CAMA = 'Las piezas no entran en la cama. Probá con menos copias o más chicas.';

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

// Líneas de movimiento (G0 y G1): lo único que tiene que coincidir entre dos corridas iguales.
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

// Caso (b) y (f): 4 copias de un cubo de 20 mm acomodadas por `acomodar`.
async function probarCuatroCopias({ laminar, revisar }) {
    const huellas = Array(4).fill({ x: 20, y: 20 });
    const { posiciones, entra } = acomodar(huellas, { x: CAMA, y: CAMA }, SEPARACION_PIEZAS_MM);
    const r = await laminar({ piezas: [{ stlBase64: CUBO, posiciones }], personal: SIN_ADHESION });
    const centros = acamar(posiciones);
    const grupos = agrupar(
        extrusiones(r.g.lineas, n => n === 2),
        centros,
    );
    revisar('acomodar: 4 cubos de 20 mm entran en la cama de 220 mm', entra);
    revisar(
        'capa 2: 4 grupos de extrusión, uno por pieza',
        grupos.length === 4 && new Set(grupos.map(g => g.k)).size === 4,
        `(${grupos.length} grupos)`,
    );
    const dentro = grupos.every(g => {
        const c = centros[g.k];
        return (
            Math.min(...g.xs) >= c.x - MITAD &&
            Math.max(...g.xs) <= c.x + MITAD &&
            Math.min(...g.ys) >= c.y - MITAD &&
            Math.max(...g.ys) <= c.y + MITAD
        );
    });
    revisar('capa 2: el bbox de cada grupo queda dentro de pos ± 10,5 mm', dentro);
    revisar('info.copias = 4', r.info.copias === 4, `(${r.info.copias})`);
    revisar('info.triangulos = 4 × 12 = 48', r.info.triangulos === 48, `(${r.info.triangulos})`);
    revisar('info.capas = 101 como con una sola pieza', r.info.capas === 101, `(${r.info.capas})`);
}

// Caso (a): el formato viejo y `piezas` con una pieza en {0,0} dan el mismo G-code.
async function probarEquivalencia({ laminar, revisar }) {
    const viejo = await laminar({ stlBase64: CUBO, personal: SIN_ADHESION });
    const nuevo = await laminar({
        piezas: [{ stlBase64: CUBO, posiciones: [{ x: 0, y: 0 }] }],
        personal: SIN_ADHESION,
    });
    const a = movimientos(viejo.gcode);
    const b = movimientos(nuevo.gcode);
    revisar(
        'formato viejo y piezas con {0,0}: mismas líneas de movimiento',
        a.length > 1000 && a.length === b.length && a.every((l, i) => l === b[i]),
        `(${a.length} líneas)`,
    );
    const iguales = [viejo, nuevo].every(r => r.info.copias === 1 && r.info.triangulos === 12);
    revisar('info.copias = 1 y triángulos = 12 en ambos', iguales);
}

// Casos (c) y (d): dos piezas de distinta altura, y un cambio por altura que aparece una sola vez.
async function probarAlturas({ laminar, revisar }) {
    const piezas = [
        { stlBase64: CUBO, posiciones: [{ x: -30, y: 0 }] },
        { stlBase64: BAJO, posiciones: [{ x: 30, y: 0 }] },
    ];
    const r = await laminar({ piezas, personal: SIN_ADHESION });
    const sola = await laminar({ stlBase64: CUBO, personal: SIN_ADHESION });
    revisar(
        'dos piezas (20 y 10 mm): las capas salen de la más alta',
        r.info.capas === sola.info.capas && r.g.capas === sola.g.capas,
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

// Caso (e): posiciones fuera de la cama dan el error de prepararPiezas.
async function probarFuera({ laminar, revisar }) {
    try {
        await laminar({ piezas: [{ stlBase64: CUBO, posiciones: [{ x: 120, y: 0 }] }] });
        revisar('posición fuera de la cama: error', false, '(laminó igual)');
    } catch (err) {
        const ok = err.message.includes(ERROR_CAMA);
        revisar('posición fuera de la cama: error de prepararPiezas', ok, `(${err.message.slice(0, 120)})`);
    }
}

/**
 * Varias piezas contra el Kiri real (ADR 0003, T6): equivalencia con el formato viejo, 4 copias en posiciones de
 * `acomodar`, dos piezas de distinta altura, cambio por altura y posiciones fuera de la cama.
 * @param {{ laminar: Function, revisar: Function }} ctx `laminar(opciones)` devuelve `{ gcode, g, info }`;
 *   `revisar(nombre, condicion, detalle)` registra el resultado
 * @returns {Promise<void>}
 */
export async function probarPiezas(ctx) {
    console.log('\n▶ Varias piezas contra Kiri (ADR 0003, T6)');
    await probarEquivalencia(ctx);
    await probarCuatroCopias(ctx);
    await probarAlturas(ctx);
    await probarFuera(ctx);
}
