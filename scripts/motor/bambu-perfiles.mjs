// Perfiles de Bambu Lab (A1, A1 mini, P1S y X1C) contra el Kiri real (ADR 0005, T3).
// Responsabilidad: por cada perfil, comparar la tabla fija de datos de fábrica con la lista de la app, laminar el cubo
// (PLA y PETG, tres calidades) y revisar el G-code: llaves sin reemplazar, X/Y dentro de la cama, temperaturas
// pedidas por el material (recortadas al límite) y pausas con `M400 U1`. Además prueba `salidaDe` con los JSON del disco.
// Lo llama scripts/probar-motor.mjs dentro de su `try`, con su propio `laminar()` y `revisar()`.

import fs from 'node:fs';
import { build } from 'esbuild';
import { insertarPausas } from '../../src/motor/pausas.js';
import { leerRecorridos } from './ayudas.mjs';

const CARPETA = new URL('../../src/perfiles/impresoras/', import.meta.url);
const EPS = 1e-6;

// Datos de fábrica escritos a mano (no se leen del JSON): nombre, modelo Bambu, volumen X×Y×Z y límites.
const TABLA = {
    'bambu-lab-a1': { nombre: 'Bambu Lab A1', modelo: 'N2S', vol: [256, 256, 256], hotendMax: 300, camaMax: 100 },
    'bambu-lab-a1-mini': {
        nombre: 'Bambu Lab A1 mini',
        modelo: 'N1',
        vol: [180, 180, 180],
        hotendMax: 300,
        camaMax: 80,
    },
    'bambu-lab-p1s': { nombre: 'Bambu Lab P1S', modelo: 'C12', vol: [256, 256, 256], hotendMax: 300, camaMax: 100 },
    'bambu-lab-x1c': { nombre: 'Bambu Lab X1C', modelo: 'BL-P001', vol: [256, 256, 256], hotendMax: 300, camaMax: 120 },
};
const AVISO = 'Perfil sin validar con la impresora: probalo con un cubo antes de una pieza grande.';

const leerJson = ruta => JSON.parse(fs.readFileSync(new URL(ruta, CARPETA), 'utf8'));
const materiales = JSON.parse(fs.readFileSync(new URL('../../src/perfiles/materiales.json', import.meta.url), 'utf8'));

// `valores.js` empaquetado en memoria (sin el catálogo, que sólo existe dentro de Vite) para llamar a salidaDe y
// lineasPausa desde Node con los JSON del disco.
async function cargarValores() {
    const sinCatalogo = {
        name: 'sin-catalogo',
        setup(b) {
            b.onResolve({ filter: /catalogo\.js$/ }, () => ({ path: 'catalogo', namespace: 'falso' }));
            b.onLoad({ filter: /.*/, namespace: 'falso' }, () => ({
                contents: 'export const buscarImpresora = () => null;',
            }));
        },
    };
    const r = await build({
        entryPoints: [new URL('../../src/perfiles/valores.js', import.meta.url).pathname],
        bundle: true,
        write: false,
        format: 'esm',
        loader: { '.json': 'json' },
        plugins: [sinCatalogo],
    });
    const codigo = 'data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64');
    return import(codigo);
}

function lineasDe(gcode) {
    return gcode.split('\n');
}

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

// Valores de una temperatura (M104/M109, o M140/M190) en el G-code, ignorando los apagados (S0).
const temps = (lineas, re) => lineas.filter(l => re.test(l)).map(l => +l.match(/S(\d+)/)[1]);

// El JSON del disco coincide con la tabla fija.
function revisarTabla(revisar, nombre, esperado, json) {
    const d = json.dispositivo;
    revisar(
        `${nombre}: JSON = tabla de fábrica (nombre, volumen, límites, boquilla, salida, modelo, aviso, pausa)`,
        json.nombre === esperado.nombre &&
            json.marca === 'Bambu Lab' &&
            json.estado === 'revisado' &&
            [d.bedWidth, d.bedDepth, d.maxHeight] + '' === esperado.vol + '' &&
            d.originCenter === false &&
            d.fwRetract === false &&
            d.extruders[0].extNozzle === 0.4 &&
            json.limites.hotendMax === esperado.hotendMax &&
            json.limites.camaMax === esperado.camaMax &&
            json.salida === 'gcode.3mf' &&
            json.modeloBambu?.id === esperado.modelo &&
            json.modeloBambu?.nombre === esperado.nombre &&
            json.aviso === AVISO &&
            json.pausa + '' === 'M400 U1',
    );
}

async function probarLaminado({ laminar, revisar }, id, esperado, material, calidad) {
    const nombre = `Bambu ${id} ${material} ${calidad}`;
    const r = await laminar({ caso: 'cubo', impresoraId: id, calidad, material });
    const lineas = r.g.lineas;
    const llave = r.gcode.match(/\{[^}\n]*\}/)?.[0];
    revisar(`${nombre}: sin llaves sin reemplazar`, !llave, llave ? `(quedó ${llave})` : '');
    const e = extremos(lineas);
    const [ancho, fondo] = esperado.vol;
    revisar(
        `${nombre}: X/Y dentro de la cama ${ancho}x${fondo}`,
        e.x[0] >= -EPS && e.x[1] <= ancho + EPS && e.y[0] >= -EPS && e.y[1] <= fondo + EPS && e.x[1] > e.x[0],
        `(X ${e.x}, Y ${e.y})`,
    );
    const pedida = materiales[material].proceso;
    const boquilla = Math.min(pedida.outputTemp, esperado.hotendMax);
    const cama = Math.min(pedida.outputBedTemp, esperado.camaMax);
    const m109 = temps(lineas, /^M109 S/);
    const m104 = temps(lineas, /^M104 S/);
    const m190 = temps(lineas, /^M190 S/);
    const m140 = temps(lineas, /^M140 S/);
    revisar(
        `${nombre}: boquilla ${boquilla} (M109 ${m109}, M104 ${m104}) y cama ${cama} (M190 ${m190}, M140 ${m140})`,
        m109.length > 0 &&
            m109.every(x => x === boquilla) &&
            m104.includes(boquilla) &&
            m190.length > 0 &&
            m190.every(x => x === cama) &&
            m140.includes(cama) &&
            [...m104, ...m109].every(x => x <= esperado.hotendMax) &&
            [...m140, ...m190].every(x => x <= esperado.camaMax),
    );
    revisar(
        `${nombre}: trae "; total layer number: ${r.g.capas}" y el ventilador`,
        lineas.some(l => l === `; total layer number: ${r.g.capas}`) && lineas.some(l => /^M106 S\d+/.test(l)),
        `(capas ${r.g.capas})`,
    );
    return r;
}

// Dos pausas en el G-code del cubo: cada una sale con `M400 U1` (y nada de M600).
function probarPausas(revisar, id, json, r) {
    const rec = leerRecorridos(r.gcode, Infinity);
    const capas = [5, r.g.capas - 1];
    const pausas = capas.map(c => ({ capa: c, offset: rec.pausaCapa[c], z: rec.zCapa[c] }));
    const lineas = lineasDe(insertarPausas(r.gcode, pausas, json.pausa));
    revisar(
        `Bambu ${id}: dos pausas salen con M400 U1 (sin M600)`,
        lineas.filter(l => l === 'M400 U1').length === 2 && !lineas.some(l => /^M600\b/.test(l)),
    );
}

async function probarPerfil(ctx, id, esperado) {
    const { revisar } = ctx;
    const json = leerJson(`${id}.json`);
    revisarTabla(revisar, `Bambu ${id}`, esperado, json);
    let cubo;
    for (const calidad of ['rapido', 'normal', 'detalle'])
        cubo = await probarLaminado(ctx, id, esperado, 'pla', calidad);
    // PETG pide más temperatura de cama y de boquilla: debe llegar al G-code (recortada al límite del perfil).
    await probarLaminado(ctx, id, esperado, 'petg', 'normal');
    probarPausas(revisar, id, json, cubo);
}

// salidaDe y lineasPausa con los JSON del disco.
async function probarSalida(revisar) {
    const { salidaDe, lineasPausa } = await cargarValores();
    for (const id of Object.keys(TABLA)) {
        const json = leerJson(`${id}.json`);
        revisar(
            `salidaDe(${id}) = gcode.3mf y lineasPausa = M400 U1`,
            salidaDe(json) === 'gcode.3mf' && lineasPausa(json) + '' === 'M400 U1',
        );
    }
    revisar('salidaDe(Ender 3 V3 SE) = gcode', salidaDe(leerJson('creality-ender-3-v3-se.json')) === 'gcode');
    revisar(
        "salidaDe: 'gcode' sin la clave, con un valor desconocido, vacío o sin perfil",
        salidaDe({}) === 'gcode' &&
            salidaDe({ salida: 'zip' }) === 'gcode' &&
            salidaDe({ salida: 'gcode' }) === 'gcode' &&
            salidaDe({ salida: undefined }) === 'gcode' &&
            salidaDe(undefined) === 'gcode',
    );
}

export async function probarBambuPerfiles(ctx) {
    const lista = await ctx.pagina.evaluate(() => window.impresoras);
    const ids = Object.keys(TABLA);
    for (const id of ids) {
        const enLista = lista.find(i => i.id === id);
        ctx.revisar(
            `Bambu ${id}: aparece en la lista como "${TABLA[id].nombre}" (revisado)`,
            enLista?.nombre === TABLA[id].nombre && enLista?.estado === 'revisado',
        );
        if (enLista) await probarPerfil(ctx, id, TABLA[id]);
    }
    const repetidos = lista.filter((i, n) => lista.findIndex(o => o.id === i.id) !== n);
    ctx.revisar('Bambu: los ids de la lista no se repiten', repetidos.length === 0);
    const bambu = await ctx.pagina.evaluate(() => window.impresoras.filter(i => /^bambu-lab-/.test(i.id)).length);
    ctx.revisar('Bambu: hay exactamente 4 perfiles bambu-lab-* (P1P fuera de v1)', bambu === ids.length);
    await probarSalida(ctx.revisar);
}
