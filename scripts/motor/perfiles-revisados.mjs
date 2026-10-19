// Perfiles revisados de impresoras populares contra el Kiri real.
// Responsabilidad: por cada perfil, comparar el JSON con una tabla fija de datos de fábrica, laminar una pieza con
// varias retracciones (dos pilares) con PLA y revisar sobre el G-code: macros sin reemplazar, temperaturas, X/Y dentro de
// la cama, orden de arranque, G29 sólo donde corresponde y retracción esperada (escrita a mano en la tabla).
// También revisa las claves `reemplaza` (que un importado tapado se redirija a su revisado).
// Lo llama scripts/probar-motor.mjs dentro de su `try`, con su propio `laminar()` y `revisar()`.

import fs from 'node:fs';
import { porCapa } from './gcode-capas.mjs';

const CARPETA = new URL('../../src/perfiles/impresoras/', import.meta.url);
const EPS = 1e-6;

// Datos de fábrica escritos a mano (no se leen del JSON): volumen X×Y×Z, límites, retracción (mm) y si el inicio
// manda la temperatura por la macro START_PRINT (`macro`) o hace G29 (`g29`).
const TABLA = {
    'creality-ender-3-v2': { vol: [220, 220, 250], hotendMax: 250, camaMax: 100, retract: 5 },
    'creality-ender-3-v3-ke': { vol: [220, 220, 240], hotendMax: 300, camaMax: 100, retract: 0.5, macro: true },
    'creality-k1': { vol: [220, 220, 250], hotendMax: 300, camaMax: 100, retract: 0.5, macro: true },
    'elegoo-neptune-4': { vol: [225, 225, 265], hotendMax: 300, camaMax: 100, retract: 0.8 },
    'anycubic-kobra-2': { vol: [220, 220, 250], hotendMax: 260, camaMax: 100, retract: 0.8, g29: true },
    'anycubic-kobra-3': { vol: [250, 250, 260], hotendMax: 260, camaMax: 90, retract: 0.8, g29: true },
    'prusa-mk4': { vol: [250, 210, 220], hotendMax: 290, camaMax: 120, retract: 0.7, g29: true },
    'sovol-sv06': { vol: [220, 220, 250], hotendMax: 300, camaMax: 100, retract: 0.8, g29: true },
};
const BOWDEN = ['creality-ender-3-v2'];
// Marcadores de macro sin reemplazar con otros delimitadores: {x}, %x%, [x], $X y <x>.
const MACRO_SUELTA = /\{[^}\n]*\}|%[A-Za-z_]+%|\[[A-Za-z_]+\]|\$[A-Za-z_]\w*|<[A-Za-z_]+>/;

// STL binario (base64) de dos pilares de 5 x 5 x 20 mm con 25 mm de hueco: Kiri retrae al viajar de uno al otro.
function dosPilares() {
    const tris = [];
    for (const x0 of [-17.5, 12.5]) {
        const v = i => [x0 + 5 * (i & 1), 5 * ((i >> 1) & 1), 20 * (i >> 2)];
        for (const t of '021 123 456 576 014 154 263 367 042 246 135 375'.split(' ')) tris.push([...t].map(n => v(+n)));
    }
    const b = Buffer.alloc(84 + tris.length * 50);
    b.writeUInt32LE(tris.length, 80);
    tris.forEach((t, i) => t.flat().forEach((n, j) => b.writeFloatLE(n, 84 + i * 50 + 12 + j * 4)));
    return b.toString('base64');
}

const leerJson = ruta => JSON.parse(fs.readFileSync(new URL(ruta, CARPETA), 'utf8'));
const num = (l, re) => +l.match(re)[1];

// Mayor y menor X/Y de los movimientos en coordenadas absolutas (G91 los desactiva hasta el próximo G90).
function extremos(lineas) {
    const r = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] };
    let absoluto = true;
    for (const l of lineas) {
        if (/^G90\b/.test(l)) absoluto = true;
        else if (/^G91\b/.test(l)) absoluto = false;
        if (!absoluto || !/^G[01] /.test(l)) continue;
        for (const eje of ['x', 'y']) {
            const m = l.match(new RegExp(`[ ]${eje.toUpperCase()}(-?[\\d.]+)`));
            if (m) {
                r[eje][0] = Math.min(r[eje][0], +m[1]);
                r[eje][1] = Math.max(r[eje][1], +m[1]);
            }
        }
    }
    return r;
}

// Temperaturas del G-code. Con macro (START_PRINT) van como parámetros, no como M109/M190.
function temperaturas(lineas) {
    const lee = (re, valor) => lineas.filter(l => re.test(l)).map(l => num(l, valor));
    const pla = lee(/^M109 S/, /S(\d+)/);
    const cama = lee(/^M1[49]0 S/, /S(\d+)/);
    return {
        pla: pla.length ? pla : lee(/EXTRUDER_TEMP=/, /EXTRUDER_TEMP=(\d+)/),
        cama: [...cama, ...lee(/BED_TEMP=/, /BED_TEMP=(\d+)/)],
        todas: lee(/^M10[49] S/, /S(\d+)/),
    };
}

// El JSON del disco coincide con la tabla fija (volumen, límites y retracción).
function revisarTabla(revisar, nombre, esperado, json) {
    const d = json.dispositivo;
    revisar(
        `${nombre}: JSON = tabla de fábrica (volumen, hotendMax, camaMax, retracción)`,
        [d.bedWidth, d.bedDepth, d.maxHeight] + '' === esperado.vol + '' &&
            json.limites.hotendMax === esperado.hotendMax &&
            json.limites.camaMax === esperado.camaMax &&
            json.proceso.outputRetractDist === esperado.retract &&
            d.extruders[0].extNozzle === 0.4,
    );
}

function revisarMacros(revisar, nombre, gcode, lineas, esperado) {
    const suelta = gcode.match(MACRO_SUELTA)?.[0];
    revisar(
        `${nombre}: sin macros sin reemplazar ({x}, %x%, [x], $X, <x>)`,
        !suelta,
        suelta ? `(quedó ${suelta})` : '',
    );
    if (!esperado.macro) return;
    revisar(
        `${nombre}: START_PRINT con EXTRUDER_TEMP=<n> BED_TEMP=<n>`,
        lineas.some(l => /^START_PRINT .*EXTRUDER_TEMP=\d+ BED_TEMP=\d+/.test(l)),
    );
}

function revisarTemperaturas(revisar, nombre, lineas, esperado) {
    const t = temperaturas(lineas);
    const { hotendMax, camaMax } = esperado;
    revisar(
        `${nombre}: temperatura de PLA (${t.pla}) = 200 y dentro de hotendMax ${hotendMax}`,
        t.pla.length > 0 && t.pla.every(x => x === 200 && x <= hotendMax) && t.todas.every(x => x <= hotendMax),
    );
    revisar(
        `${nombre}: cama (${t.cama}) dentro de camaMax ${camaMax}`,
        t.cama.length > 0 && t.cama.every(x => x <= camaMax),
    );
}

function revisarCama(revisar, nombre, lineas, [ancho, fondo]) {
    const e = extremos(lineas);
    const dentro = e.x[0] >= -EPS && e.x[1] <= ancho + EPS && e.y[0] >= -EPS && e.y[1] <= fondo + EPS;
    revisar(`${nombre}: X/Y dentro de la cama ${ancho}x${fondo}`, dentro && e.x[1] > e.x[0], `(X ${e.x}, Y ${e.y})`);
}

// La primera extrusión positiva viene después de M109 (o de START_PRINT); G29 sólo donde corresponde.
function revisarArranque(revisar, nombre, lineas, esperado) {
    const espera = lineas.findIndex(l => /^M109 S|^START_PRINT/.test(l));
    const extrusion = lineas.findIndex(l => /^G1 .*\bE\d/.test(l) && num(l, /\bE([\d.]+)/) > 0);
    revisar(
        `${nombre}: la primera extrusión (línea ${extrusion}) viene después de M109/START_PRINT (línea ${espera})`,
        espera >= 0 && extrusion > espera,
    );
    const g29 = lineas.some(l => /^G29\b/.test(l));
    revisar(`${nombre}: G29 ${esperado.g29 ? 'presente' : 'ausente'}`, g29 === !!esperado.g29);
}

function revisarRetraccion(revisar, nombre, lineas, esperado) {
    const retracciones = porCapa(lineas).capas.flatMap(c => c.retracciones);
    revisar(
        `${nombre}: ${retracciones.length} retracciones, todas de ${esperado.retract} mm (esperado fijo)`,
        retracciones.length >= 2 && retracciones.every(x => Math.abs(x - esperado.retract) < EPS),
        `(valores: ${[...new Set(retracciones)]})`,
    );
}

// Todas las verificaciones de un perfil.
async function probarPerfil({ laminar, revisar }, id) {
    const nombre = `perfil revisado ${id}`;
    const esperado = TABLA[id];
    revisarTabla(revisar, nombre, esperado, leerJson(`${id}.json`));
    const r = await laminar({
        caso: 'pilares', // sólo nombra el archivo de GUARDAR_GCODE
        stlBase64: dosPilares(),
        impresoraId: id,
        calidad: 'normal',
        material: 'pla',
        personal: { adhesion: 'nada' },
    });
    revisarMacros(revisar, nombre, r.gcode, r.g.lineas, esperado);
    revisarTemperaturas(revisar, nombre, r.g.lineas, esperado);
    revisarCama(revisar, nombre, r.g.lineas, esperado.vol);
    revisarArranque(revisar, nombre, r.g.lineas, esperado);
    revisarRetraccion(revisar, nombre, r.g.lineas, esperado);
}

// Bowden vs. directos, con los valores fijos de la tabla.
function revisarBowden(revisar) {
    const directos = Object.keys(TABLA).filter(i => !BOWDEN.includes(i));
    const maxDirecto = Math.max(...directos.map(i => TABLA[i].retract));
    for (const id of BOWDEN) {
        revisar(
            `Bowden ${id}: retracción ${TABLA[id].retract} mm > la mayor de los directos (${maxDirecto} mm)`,
            TABLA[id].retract > maxDirecto,
        );
    }
}

// Ids de importados en kiri/ (los JSON son generados: sólo se leen).
const idsImportados = () => fs.readdirSync(new URL('kiri/', CARPETA)).map(f => leerJson(`kiri/${f}`).id);

// Cada clave `reemplaza` de los JSON: el id tapado existía, no se lista y se redirige a su revisado.
async function probarReemplazos({ revisar, pagina }, lista) {
    const revisados = fs
        .readdirSync(CARPETA)
        .filter(f => f.endsWith('.json'))
        .map(f => leerJson(f))
        .filter(j => j.reemplaza?.length);
    const importados = idsImportados();
    revisar('hay perfiles con `reemplaza`', revisados.length > 0);
    for (const rev of revisados) {
        for (const viejo of rev.reemplaza) {
            const nombre = `reemplaza ${viejo} -> ${rev.id}`;
            const r = await pagina.evaluate(
                ([v, n]) => ({
                    vigente: window.idVigente(v),
                    existe: window.existeImpresora(v),
                    busca: window.buscarImpresora(v).id,
                    mismo: window.idVigente(n),
                }),
                [viejo, rev.id],
            );
            revisar(`${nombre}: el id tapado existía como importado`, importados.includes(viejo));
            revisar(`${nombre}: no se lista`, !lista.some(i => i.id === viejo));
            revisar(
                `${nombre}: idVigente / existeImpresora / buscarImpresora lo redirigen`,
                r.vigente === rev.id && r.existe && r.busca === rev.id && r.mismo === rev.id,
                JSON.stringify(r),
            );
        }
    }
    const ajeno = await pagina.evaluate(() => [window.idVigente('kiri-prusa-mini'), window.idVigente('no-existe')]);
    revisar('idVigente deja igual cualquier otro id', ajeno + '' === 'kiri-prusa-mini,no-existe');
}

export async function probarPerfilesRevisados(ctx) {
    const lista = await ctx.pagina.evaluate(() => window.impresoras);
    for (const id of Object.keys(TABLA)) {
        const enLista = lista.find(i => i.id === id);
        ctx.revisar(`perfil revisado ${id}: aparece en la lista como revisado`, enLista?.estado === 'revisado');
        if (enLista) await probarPerfil(ctx, id);
    }
    revisarBowden(ctx.revisar);
    await probarReemplazos(ctx, lista);
}
