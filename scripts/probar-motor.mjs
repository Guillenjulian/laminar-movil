// Pruebas automáticas del motor: levanta la app, abre Chromium sin ventana,
// lamina mallas de prueba con el perfil real de la impresora y revisa que el
// G-code tenga sentido.
//
// Uso: npm run build && npm run test:motor
//      npm run test:motor -- --dev   (contra el servidor de desarrollo)
// Requiere Chromium (variable CHROMIUM_PATH o el de Playwright).

import { chromium } from 'playwright-core';
import { preview, createServer } from 'vite';
import fs from 'node:fs';
import { buscarChromium } from './lib/chromium.mjs';
import { insertarPausas } from '../src/motor/pausas.js';
import { probarCambios } from './motor/cambios.mjs';

// El lector de la vista previa es un worker: lo cargamos en Node simulando `self`.
globalThis.self ??= {};
const { leer: leerRecorridos } = await import('../src/motor/recorridos.worker.js');

// Inserta una pausa antes de la capa `capa` y verifica que quede justo entre la
// última extrusión de la capa anterior y la primera de esa capa.
function probarPausa(gcode, capa) {
    const r = leerRecorridos(gcode, Infinity);
    const conPausa = insertarPausas(gcode, [{ capa, offset: r.pausaCapa[capa], z: r.zCapa[capa] }], ['M600']);
    const lineas = conPausa.split('\n');
    const iPausa = lineas.indexOf('M600');
    let z = 0,
        zAntes = NaN,
        zDespues = NaN;
    for (let i = 0; i < lineas.length; i++) {
        const m = lineas[i].match(/^G[01] .*Z(-?[\d.]+)/);
        if (m) z = +m[1];
        if (/^G1 .*X.*E\d|^G1 .*Y.*E\d/.test(lineas[i])) {
            if (i < iPausa) zAntes = z;
            else if (isNaN(zDespues)) zDespues = z;
        }
    }
    const ok =
        conPausa.split('\nM600\n').length === 2 &&
        Math.abs(zAntes - r.zCapa[capa - 1]) < 0.001 &&
        Math.abs(zDespues - r.zCapa[capa]) < 0.001;
    return {
        ok,
        detalle: `capa ${capa + 1}: Z antes ${zAntes}, después ${zDespues} (esperado ${r.zCapa[capa - 1].toFixed(2)} → ${r.zCapa[capa].toFixed(2)})`,
    };
}

// Datos útiles de un G-code para comparar.
function analizar(gcode) {
    const lineas = gcode.split('\n');
    // Sólo la pieza: desde la primera línea que Kiri marca con "; feature" hasta la
    // última extrusión (así no cuentan la purga del inicio ni los movimientos del final).
    const desde = lineas.findIndex(l => l.startsWith('; feature'));
    let hasta = lineas.length - 1;
    while (hasta > desde && !/^G1 .*E\d/.test(lineas[hasta])) hasta--;
    const pieza = lineas.slice(desde, hasta + 1);
    const extrusiones = pieza.filter(l => /^G1 .*E\d/.test(l));
    const valores = eje =>
        extrusiones
            .map(l => l.match(new RegExp(eje + '(-?[\\d.]+)')))
            .filter(Boolean)
            .map(m => +m[1]);
    const zs = pieza
        .map(l => l.match(/^G[01] .*Z([\d.]+)/))
        .filter(Boolean)
        .map(m => +m[1]);
    const xs = valores('X'),
        ys = valores('Y');
    const min = v => v.reduce((a, b) => Math.min(a, b), Infinity);
    const max = v => v.reduce((a, b) => Math.max(a, b), -Infinity);
    return {
        lineas,
        extrusiones: extrusiones.length,
        capas: lineas.filter(l => l.startsWith(';LAYER:')).length,
        x: [min(xs), max(xs)],
        y: [min(ys), max(ys)],
        zMax: max(zs),
        tiene: prefijo => lineas.some(l => l.startsWith(prefijo)),
    };
}

const modoDev = process.argv.includes('--dev');
const servidor = modoDev
    ? await (await createServer({ server: { port: 5199 } })).listen()
    : await preview({ preview: { port: 4173 } });
const url = servidor.resolvedUrls.local[0];
const navegador = await chromium.launch({ executablePath: buscarChromium() });
const pagina = await navegador.newPage();
pagina.on('console', m => m.type() === 'error' && console.log('[consola]', m.text().slice(0, 300)));
pagina.on('pageerror', e => console.log('[error]', e.message));
await pagina.goto(url + 'prueba-motor.html');
await pagina.waitForFunction(() => window.probar);

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
    if (!condicion) fallas++;
}

async function laminar(opciones) {
    const r = await pagina.evaluate(o => window.probar(o), opciones);
    console.log(
        `\n▶ ${JSON.stringify(opciones, (_k, v) => (typeof v === 'string' && v.length > 80 ? `<${v.length} caracteres>` : v))} — ${r.ms} ms, ${r.info.capas} capas, ` +
            `${Math.round(r.info.tiempo / 60)} min, ${(r.info.filamento / 1000).toFixed(2)} m`,
    );
    if (process.env.GUARDAR_GCODE) {
        const nombre = [opciones.caso, opciones.calidad || 'normal', opciones.soportes && 'soportes']
            .filter(Boolean)
            .join('-');
        fs.writeFileSync(`${process.env.GUARDAR_GCODE}/${nombre}.gcode`, r.gcode);
    }
    return { ...r, g: analizar(r.gcode) };
}

try {
    // 1. Cubo con calidad Normal: perfil completo de la Ender 3 V3 SE.
    const normal = await laminar({ caso: 'cubo', calidad: 'normal' });
    revisar(
        'start G-code con temperaturas PLA',
        ['M140 S60', 'M190 S60', 'M104 S200', 'M109 S200', 'G28'].every(normal.g.tiene),
    );
    // Ventilador: apagado en la primera capa y al 100 % desde la segunda.
    const capa = n => normal.g.lineas.indexOf(`;LAYER:${n}`);
    const ventilador = normal.g.lineas.map((l, i) => [i, l.match(/^M106 S(\d+)/)]).filter(([, m]) => m);
    const prendidoAntes = n => ventilador.some(([i, m]) => i < capa(n) && +m[1] > 0);
    revisar('ventilador apagado en la capa 0', !prendidoAntes(1));
    revisar(
        'ventilador al 100 % desde la capa 1',
        ventilador.some(([i, m]) => i > capa(1) && i < capa(2) && m[1] === '255'),
    );
    revisar('retracción de 0,8 mm', normal.g.tiene('G1 E-0.8'));
    revisar(
        'cubo centrado en la cama',
        normal.g.x[0] > 95 && normal.g.x[1] < 125 && normal.g.y[0] > 95 && normal.g.y[1] < 125,
        `X ${normal.g.x} Y ${normal.g.y}`,
    );
    revisar('altura ~20 mm', normal.g.zMax >= 19.8 && normal.g.zMax <= 21, `Z máx ${normal.g.zMax}`);
    revisar('capas de 0,2 mm', Math.abs(normal.g.capas - 100) <= 1, `(${normal.g.capas} capas)`);
    revisar('end G-code', normal.g.tiene('M84 X Y E') && normal.g.tiene('G1 X0 Y220'));
    revisar('sin macros sin reemplazar', !normal.gcode.includes('{'));

    // Pausa de filamento en el G-code del cubo (capa 10 y la última).
    for (const capa of [9, normal.g.capas - 1]) {
        const p = probarPausa(normal.gcode, capa);
        revisar('pausa entre capas', p.ok, p.detalle);
    }

    // 2. Las otras calidades cambian la altura de capa.
    const rapido = await laminar({ caso: 'cubo', calidad: 'rapido' });
    revisar('Rápido: capas de 0,28 mm', Math.abs(rapido.g.capas - 20 / 0.28) <= 2, `(${rapido.g.capas} capas)`);
    const detalle = await laminar({ caso: 'cubo', calidad: 'detalle' });
    revisar(
        'Detalle: capas de 0,12 mm',
        Math.abs(detalle.g.capas - (1 + 19.8 / 0.12)) <= 2,
        `(${detalle.g.capas} capas)`,
    );

    // 2a. Materiales: temperaturas, ventilador y lo propio de cada uno (TPU lento,
    // PETG con z-hop). En Rápido, así se ve que el material pisa a la calidad.
    const MATERIALES = JSON.parse(fs.readFileSync(new URL('../src/perfiles/materiales.json', import.meta.url)));
    // F (mm/min) más alto de las extrusiones de la pieza, desde la capa 1 (la 0 va más lenta).
    const maxFExtrusion = g => {
        const desde = g.lineas.indexOf(';LAYER:1');
        return Math.max(
            ...g.lineas
                .slice(desde)
                .filter(l => /^G1 .*E\d/.test(l) && / F/.test(l))
                .map(l => +l.match(/F([\d.]+)/)[1]),
        );
    };
    // Z-hop: retracciones de la pieza seguidas de un movimiento que sube Z 0,2 mm
    // respecto del último Z (Kiri sólo levanta Z cuando retrae para viajar).
    const zHops = g => {
        let z = 0,
            n = 0;
        const desde = g.lineas.indexOf(';LAYER:0');
        g.lineas.forEach((l, i) => {
            const m = l.match(/^G[01] .*Z([\d.]+)/);
            if (m) z = +m[1];
            const sig = g.lineas[i + 1]?.match(/^G[01] Z([\d.]+)/);
            if (i > desde && /^G1 E-/.test(l) && sig && Math.abs(+sig[1] - z - 0.2) < 0.001) n++;
        });
        return n;
    };
    const fPla = maxFExtrusion(rapido.g);
    for (const [id, mat] of Object.entries(MATERIALES).filter(([id]) => !id.startsWith('_'))) {
        const r = id === 'pla' ? rapido : await laminar({ caso: 'cubo', calidad: 'rapido', material: id });
        const { outputTemp: t, outputBedTemp: b, outputFanSpeed: fan } = mat.proceso;
        revisar(
            `${mat.nombre}: boquilla ${t} °C y cama ${b} °C`,
            r.g.tiene(`M104 S${t}`) && r.g.tiene(`M109 S${t}`) && r.g.tiene(`M140 S${b}`),
        );
        const iCapa1 = r.g.lineas.indexOf(';LAYER:1');
        const fans = r.g.lineas.map((l, i) => [i, l.match(/^M106 S(\d+)/)]).filter(([, m]) => m);
        const fanPieza = fans.filter(([i]) => i > iCapa1).map(([, m]) => +m[1]);
        revisar(
            `${mat.nombre}: ventilador ${Math.round(fan / 2.55)} % (sin ventilador en la 1ª capa)`,
            !fans.some(([i, m]) => i < iCapa1 && +m[1] > 0) && Math.max(0, ...fanPieza) === fan,
            `M106 S${Math.max(0, ...fanPieza)}`,
        );
        revisar(
            `${mat.nombre}: el aviso del material`,
            (r.avisos || []).includes(mat.aviso) === !!mat.aviso,
            (r.avisos || []).join(' | '),
        );
        if (id === 'tpu') {
            const f = maxFExtrusion(r.g);
            revisar('TPU: retracción corta (0,5 mm)', r.g.tiene('G1 E-0.5') && !r.g.tiene('G1 E-0.8'));
            revisar(
                'TPU: extrusión a ≤ 25 mm/s (pisa a la calidad Rápido)',
                f <= 25 * 60 && fPla > 60 * 60,
                `F máx ${f} (PLA ${fPla})`,
            );
            revisar('TPU: sin aviso de Bowden en extrusor directo', !r.avisos.includes(mat.avisoBowden));
        }
        if (id === 'petg')
            revisar(
                'PETG: z-hop de 0,2 mm',
                zHops(r.g) > 0 && zHops(rapido.g) === 0,
                `${zHops(r.g)} z-hops (PLA ${zHops(rapido.g)})`,
            );
    }

    // Recorte de temperatura: una impresora propia que llega a 240 °C / 90 °C,
    // con extrusor Bowden (retracción de 5 mm). ASA pide 250 °C / 100 °C.
    await pagina.evaluate(() =>
        window.ponerImpresorasPropias([
            {
                id: 'propia-tibia',
                nombre: 'Tibia',
                ancho: 220,
                profundidad: 220,
                alto: 250,
                origenCentro: false,
                boquilla: 0.4,
                filamento: 1.75,
                retraccion: 5,
                hotendMax: 240,
                camaMax: 90,
                velocidad: 60,
                firmware: 'marlin',
            },
        ]),
    );
    const asa = await laminar({ caso: 'cubo', calidad: 'rapido', impresoraId: 'propia-tibia', material: 'asa' });
    revisar(
        'ASA en una impresora de 240 °C: boquilla recortada',
        asa.g.tiene('M104 S240') &&
            !asa.g.tiene('M104 S250') &&
            asa.avisos.some(a => a.includes('boquilla se limitó a 240')),
        asa.avisos.join(' | '),
    );
    revisar(
        'ASA en una cama de 90 °C: cama recortada',
        asa.g.tiene('M140 S90') && asa.avisos.some(a => a.includes('cama se limitó a 90')),
    );
    const tpuBowden = await laminar({ caso: 'cubo', calidad: 'rapido', impresoraId: 'propia-tibia', material: 'tpu' });
    revisar(
        'TPU con Bowden: aviso',
        tpuBowden.avisos.some(a => a.startsWith('TPU con extrusor Bowden suele trabarse')),
        tpuBowden.avisos.join(' | '),
    );
    revisar(
        'TPU con Bowden: igual usa la retracción corta',
        tpuBowden.g.tiene('G1 E-0.5') && !tpuBowden.g.tiene('G1 E-5'),
    );
    await pagina.evaluate(() => window.ponerImpresorasPropias([]));

    // 2b. Transformaciones del modelo (escala, rotación, apoyar cara).
    // Sin adhesión, así la falda no agranda la primera capa.
    // Matrices 3×3 fila por fila (como las arma src/motor/transformar.js).
    const T = await import('../src/motor/transformar.js');
    const sinFalda = { adhesion: 'nada' };
    // Extensión en X e Y de las extrusiones de la primera capa (cada eje por
    // separado: en los perímetros rectos Kiri escribe sólo X o sólo Y).
    const primeraCapa = r => {
        const l = r.g.lineas,
            i0 = l.indexOf(';LAYER:0'),
            i1 = l.indexOf(';LAYER:1');
        const capa0 = l.slice(i0, i1);
        const coord = eje =>
            capa0
                .filter(x => new RegExp(`^G1 .*${eje}.*E\\d`).test(x))
                .map(x => +x.match(new RegExp(`${eje}([\\d.]+)`))[1]);
        const xs = coord('X'),
            ys = coord('Y');
        return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
    };
    const mm = n => n.toFixed(1);
    const doble = await laminar({ caso: 'cubo', personal: sinFalda, transformacion: T.escala(2) });
    const pc2 = primeraCapa(doble);
    revisar('escala ×2: altura ~40 mm', doble.g.zMax >= 39.8 && doble.g.zMax <= 41, `Z máx ${doble.g.zMax}`);
    revisar(
        'escala ×2: primera capa de ~40 × 40 mm',
        Math.abs(pc2.x - 40) < 1 && Math.abs(pc2.y - 40) < 1,
        `${mm(pc2.x)} × ${mm(pc2.y)} mm`,
    );
    const acostada = await laminar({ caso: 'te', personal: sinFalda, transformacion: T.rotacion90('x') });
    revisar(
        '"T" rotada 90° en X: altura ~10 mm',
        acostada.g.zMax >= 9.8 && acostada.g.zMax <= 10.6,
        `Z máx ${acostada.g.zMax}`,
    );
    const invertida = await laminar({ caso: 'te', personal: sinFalda, transformacion: T.rotacionQueApoya([0, 0, 1]) });
    const pcT = primeraCapa(invertida);
    revisar(
        '"T" con la tapa apoyada: altura ~23 mm',
        invertida.g.zMax >= 22.8 && invertida.g.zMax <= 23.6,
        `Z máx ${invertida.g.zMax}`,
    );
    revisar(
        '"T" con la tapa apoyada: primera capa de ~50 mm en X',
        Math.abs(pcT.x - 50) < 1 && Math.abs(pcT.y - 10) < 1,
        `${mm(pcT.x)} × ${mm(pcT.y)} mm`,
    );
    let errorCama = '';
    try {
        await pagina.evaluate(o => window.probar(o), { caso: 'cubo', transformacion: T.escala(20) });
    } catch (err) {
        errorCama = err.message;
    }
    revisar(
        'escala ×20: avisa que no entra en la cama',
        errorCama.includes('no entra en la cama'),
        errorCama ? `(${errorCama.split('\n')[0].replace(/^.*?El modelo/, 'El modelo')})` : '(laminó sin error)',
    );

    // 3. Soportes automáticos (con los minions locales).
    const sinSop = await laminar({ caso: 'te' });
    const conSop = await laminar({ caso: 'te', soportes: true });
    const pSop = probarPausa(conSop.gcode, 50);
    revisar('pausa con soportes', pSop.ok, pSop.detalle);
    revisar(
        'soportes agregan material',
        conSop.info.filamento > sinSop.info.filamento * 1.1,
        `(${(sinSop.info.filamento / 1000).toFixed(2)} m → ${(conSop.info.filamento / 1000).toFixed(2)} m)`,
    );

    // 4. Personalizar: patrones, densidad, paredes y adhesión.
    const filamento = r => (r.info.filamento / 1000).toFixed(2) + ' m';
    const base = await laminar({ caso: 'cubo', personal: {} });
    const usados = {};
    for (const patron of ['hex', 'grid', 'gyroid', 'cubic', 'triangle', 'linear']) {
        const r = await laminar({ caso: 'cubo', personal: { patron } });
        usados[patron] = r.info.filamento;
        revisar(`relleno ${patron} lamina`, r.g.capas >= 99, filamento(r));
    }
    revisar('los patrones dan recorridos distintos', new Set(Object.values(usados).map(v => v.toFixed(0))).size >= 4);
    const macizo = await laminar({ caso: 'cubo', personal: { densidad: 1 } });
    const liviano = await laminar({ caso: 'cubo', personal: { densidad: 0.1 } });
    revisar(
        'densidad 100 % > 20 % > 10 %',
        macizo.info.filamento > base.info.filamento && base.info.filamento > liviano.info.filamento,
        `${filamento(liviano)} < ${filamento(base)} < ${filamento(macizo)}`,
    );
    const unaPared = await laminar({ caso: 'cubo', personal: { paredes: 1, densidad: 0 } });
    const cuatro = await laminar({ caso: 'cubo', personal: { paredes: 4, densidad: 0 } });
    revisar(
        'más paredes, más filamento',
        cuatro.info.filamento > unaPared.info.filamento * 1.5,
        `${filamento(unaPared)} → ${filamento(cuatro)}`,
    );

    // Adhesión: cuánto se extiende la primera capa alrededor del cubo (de 100 a 120 mm).
    const margen = r => {
        const l = r.g.lineas,
            i0 = l.indexOf(';LAYER:0'),
            i1 = l.indexOf(';LAYER:1');
        const xs = l
            .slice(i0, i1)
            .filter(x => /^G1 .*X.*E\d/.test(x))
            .map(x => +x.match(/X([\d.]+)/)[1]);
        return Math.max(110 - Math.min(...xs), Math.max(...xs) - 110) - 10;
    };
    const nada = await laminar({ caso: 'cubo', personal: { adhesion: 'nada' } });
    const falda = await laminar({ caso: 'cubo', personal: { adhesion: 'falda' } });
    const borde = await laminar({ caso: 'cubo', personal: { adhesion: 'borde' } });
    const balsa = await laminar({ caso: 'cubo', personal: { adhesion: 'balsa' } });
    revisar('adhesión nada: sin nada alrededor', margen(nada) < 0.5, `margen ${margen(nada).toFixed(1)} mm`);
    revisar(
        'adhesión falda: separada ~3 mm',
        margen(falda) > 3 && margen(falda) < 5,
        `margen ${margen(falda).toFixed(1)} mm`,
    );
    revisar(
        'adhesión borde: ~4 mm pegado',
        margen(borde) > 3 && margen(borde) < 5.5 && borde.info.filamento > falda.info.filamento,
        `margen ${margen(borde).toFixed(1)} mm`,
    );
    revisar(
        'adhesión balsa: capas extra debajo',
        balsa.g.zMax > nada.g.zMax + 0.3 && balsa.info.filamento > nada.info.filamento * 1.1,
        `Z máx ${nada.g.zMax} → ${balsa.g.zMax}`,
    );

    // 5. Todas las impresoras importadas de Kiri laminan bien el cubo.
    const lista = await pagina.evaluate(() => window.impresoras);
    const problemas = [];
    for (const imp of lista.filter(i => i.estado === 'importado')) {
        try {
            const r = await pagina.evaluate(o => window.probar(o), {
                caso: 'cubo',
                impresoraId: imp.id,
                calidad: 'rapido',
            });
            const g = analizar(r.gcode);
            const d = await pagina.evaluate(id => window.buscarImpresora(id).dispositivo, imp.id);
            // dónde tendría que estar el centro del cubo según el origen de la cama
            const cx = d.originCenter ? 0 : d.bedWidth / 2,
                cy = d.originCenter ? 0 : d.bedDepth / 2;
            const centrado = Math.abs((g.x[0] + g.x[1]) / 2 - cx) < 1 && Math.abs((g.y[0] + g.y[1]) / 2 - cy) < 1;
            const fallas = [
                !centrado && `no centrado (X ${g.x} Y ${g.y})`,
                !g.tiene('M106 S255') && 'sin ventilador',
                /\{[a-z_]+\}/.test(r.gcode) && 'macros sin reemplazar',
                Math.abs(g.zMax - 20) > 1.5 && `Z máx ${g.zMax}`,
            ].filter(Boolean);
            if (fallas.length) problemas.push(`${imp.nombre}: ${fallas.join(', ')}`);
        } catch (err) {
            problemas.push(`${imp.nombre}: ERROR ${err.message.slice(0, 120)}`);
        }
    }
    // Pausa en impresoras con otros marcadores de capa / extrusión absoluta.
    for (const id of ['kiri-prusa-i3-mk3s', 'kiri-creality-ender-5', 'kiri-anycubic-kobra-2']) {
        const r = await pagina.evaluate(o => window.probar(o), { caso: 'cubo', impresoraId: id, calidad: 'rapido' });
        const p = probarPausa(r.gcode, 20);
        revisar(`pausa en ${id}`, p.ok, p.detalle);
    }
    revisar(
        `las ${lista.filter(i => i.estado === 'importado').length} impresoras importadas laminan bien`,
        problemas.length === 0,
        problemas.length ? '\n      ' + problemas.join('\n      ') : '',
    );

    // 5b. Avanzado: cada opción tiene que verse en el G-code. Van en personal.avanzado
    // (como los pasa la app) y sin adhesión, para medir sólo la pieza.
    const av = (avanzado, caso = 'cubo') => laminar({ caso, personal: { adhesion: 'nada', avanzado } });
    // Movimientos con su posición (Kiri a veces escribe sólo X o sólo Y).
    const movimientos = lineas => {
        let x = 0,
            y = 0,
            z = 0,
            f = 0;
        return lineas
            .map(l => {
                if (!/^G[01] /.test(l)) return null;
                const v = letra => {
                    const m = l.match(new RegExp(` ${letra}(-?[\\d.]+)`));
                    return m ? +m[1] : NaN;
                };
                const x0 = x,
                    y0 = y;
                if (!isNaN(v('X'))) x = v('X');
                if (!isNaN(v('Y'))) y = v('Y');
                if (!isNaN(v('Z'))) z = v('Z');
                if (!isNaN(v('F'))) f = v('F');
                return { x0, y0, x, y, z, f, e: v('E'), xy: !isNaN(v('X')) || !isNaN(v('Y')), linea: l };
            })
            .filter(Boolean);
    };
    const capaDe = (r, n) => {
        const l = r.g.lineas;
        return l.slice(l.indexOf(`;LAYER:${n}`), l.indexOf(`;LAYER:${n + 1}`));
    };

    // Jarrón: una sola pared, sin relleno y la Z sube de a poco dentro de cada vuelta.
    const jarron = await av({ jarron: true });
    const capa50 = movimientos(capaDe(jarron, 50)).filter(m => m.e > 0 && m.xy);
    const zs50 = capa50.map(m => m.z);
    revisar('jarrón: una sola pared (4 tramos por vuelta del cubo)', capa50.length === 4, `${capa50.length} tramos`);
    revisar(
        'jarrón: Z sube dentro de la capa (espiral)',
        zs50.every((z, i) => i === 0 || z > zs50[i - 1]) && Math.abs(zs50.at(-1) - zs50[0] - 0.15) < 0.01,
        `Z ${zs50.join(' → ')}`,
    );
    const rellenos = jarron.g.lineas.filter(l => /^; feature (sparse|solid)/.test(l)).length;
    revisar(
        'jarrón: sin relleno (sólo el fondo)',
        rellenos <= 3 && !jarron.g.tiene('; feature sparse') && jarron.info.filamento < base.info.filamento / 3,
        `${rellenos} capas de fondo, ${filamento(jarron)}`,
    );
    const vueltas = jarron.g.lineas.filter(l => l === '; capa en espiral').length;
    const lectura = leerRecorridos(jarron.gcode, Infinity);
    revisar(
        'jarrón: la vista previa ve una capa por vuelta',
        vueltas > 90 && Math.abs(lectura.zCapa.length - jarron.g.capas) <= 1,
        `${vueltas} vueltas, ${lectura.zCapa.length} capas en la vista previa`,
    );

    // Altura de capa variable: en una esfera tiene que haber capas de distintas alturas.
    const alturas = r => {
        const zs = Array.from(leerRecorridos(r.gcode, Infinity).zCapa);
        return [...new Set(zs.slice(1).map((z, i) => +(z - zs[i]).toFixed(2)))].sort((a, b) => a - b);
    };
    const esferaFija = await av({}, 'esferaChica');
    const esferaVariable = await av({ alturaVariable: true }, 'esferaChica');
    const hv = alturas(esferaVariable);
    revisar('altura fija: todas las capas de 0,2 mm', alturas(esferaFija).length === 1, alturas(esferaFija).join(', '));
    revisar(
        'altura variable: capas de distintas alturas (máx ≈ 0,2 mm)',
        hv.length >= 3 && Math.min(...hv) < 0.19 && Math.max(...hv) <= 0.22,
        `${hv.join(', ')} mm (${esferaFija.g.capas} → ${esferaVariable.g.capas} capas)`,
    );
    const zv = leerRecorridos(esferaVariable.gcode, Infinity).zCapa;
    revisar(
        'altura variable: primera capa en 0,2 mm, una Z por capa y 20 mm de alto',
        Math.abs(zv[0] - 0.2) < 0.001 &&
            Math.abs(zv.length - esferaVariable.g.capas) <= 1 &&
            Math.abs(zv.at(-1) - 20) < 0.25,
        `Z ${zv[0].toFixed(2)} … ${zv.at(-1).toFixed(2)}, ${zv.length} capas`,
    );

    // Temperatura, ventilador, retracción, z-hop y velocidad juntos en un cubo.
    const ajustes = await av({
        tempBoquilla: 215,
        tempCama: 70,
        ventilador: 50,
        retraccion: 1.5,
        zHop: 0.4,
        velocidad: 50,
    });
    revisar(
        'temperatura manual: M104/M109 S215 y cama 70',
        ajustes.g.tiene('M104 S215') &&
            ajustes.g.tiene('M109 S215') &&
            ajustes.g.tiene('M190 S70') &&
            !ajustes.g.tiene('M104 S200'),
    );
    revisar('ventilador al 50 %: M106 S128', ajustes.g.tiene('M106 S128') && !ajustes.g.tiene('M106 S255'));
    revisar('retracción de 1,5 mm', ajustes.g.tiene('G1 E-1.5') && !ajustes.g.tiene('G1 E-0.8'));
    const hops = ajustes.g.lineas.filter(l => /^G1 Z[\d.]+ .*z-hop start/.test(l)).length;
    const subidaHop = (() => {
        const l = ajustes.g.lineas,
            i = l.findIndex(x => x.includes('z-hop start')),
            j = l.findIndex((x, k) => k > i && x.includes('z-hop end'));
        return +(+l[i].match(/Z([\d.]+)/)[1] - +l[j].match(/Z([\d.]+)/)[1]).toFixed(3);
    })();
    revisar('z-hop: sube 0,4 mm en los viajes', hops > 5 && subidaHop === 0.4, `${hops} subidas de ${subidaHop} mm`);
    const velMax = r =>
        Math.max(
            ...movimientos(r.g.lineas.slice(r.g.lineas.indexOf(';LAYER:1')))
                .filter(m => m.e > 0 && m.xy)
                .map(m => m.f),
        );
    revisar(
        'velocidad al 50 %: extrusiones más lentas',
        velMax(ajustes) <= velMax(nada) / 2 + 1,
        `F máx ${velMax(nada)} → ${velMax(ajustes)}`,
    );
    const sinHop = movimientos(nada.g.lineas).some(m => m.linea.includes('z-hop'));
    revisar('sin z-hop por defecto (la Ender no lo usa)', !sinHop);

    // Costura "Atrás": cada capa arranca en el fondo de la pieza (Y alta, el cubo va de 100 a 120).
    const inicios = r =>
        Array.from({ length: 20 }, (_, k) => movimientos(capaDe(r, 20 + k)).find(m => m.e > 0 && m.xy));
    const inicioCapas = r => inicios(r).map(m => m.y0);
    const atras = await av({ costura: 'atras' });
    revisar(
        'costura atrás: las capas empiezan en el fondo',
        inicioCapas(atras).every(y => y > 118),
        `Y ${inicioCapas(atras).join(', ')}`,
    );
    const azar = await av({ costura: 'azar' });
    const lugares = new Set(inicios(azar).map(m => `${m.x0.toFixed(0)},${m.y0.toFixed(0)}`));
    revisar('costura al azar: empiezan en lugares distintos', lugares.size >= 3, `(${[...lugares].join(') (')})`);

    // Compensación: un tubo de 20 mm con un agujero de 10 mm. Medimos la primera capa:
    // la mitad del ancho de afuera y del agujero (las extrusiones más lejanas y más cercanas al centro).
    const medidas = r => {
        const pts = movimientos(capaDe(r, 0))
            .filter(m => m.e > 0 && m.xy)
            .flatMap(m => [
                [m.x0, m.y0],
                [m.x, m.y],
            ]);
        const d = pts.map(([x, y]) => Math.max(Math.abs(x - 110), Math.abs(y - 110)));
        return { afuera: 2 * Math.max(...d), agujero: 2 * Math.min(...d) };
    };
    const tubo = medidas(await av({}, 'tubo'));
    const tuboMas = medidas(await av({ compAgujeros: 0.4, compExterior: 0.4 }, 'tubo'));
    const tuboMenos = medidas(await av({ compAgujeros: -0.4, compExterior: -0.4 }, 'tubo'));
    const ver = m => `afuera ${m.afuera.toFixed(2)}, agujero ${m.agujero.toFixed(2)}`;
    revisar(
        'compensación +0,4: agranda el agujero y el contorno 0,4 mm',
        Math.abs(tuboMas.agujero - tubo.agujero - 0.4) < 0.02 && Math.abs(tuboMas.afuera - tubo.afuera - 0.4) < 0.02,
        `${ver(tubo)} → ${ver(tuboMas)}`,
    );
    revisar(
        'compensación −0,4: achica el agujero y el contorno 0,4 mm',
        Math.abs(tubo.agujero - tuboMenos.agujero - 0.4) < 0.02 &&
            Math.abs(tubo.afuera - tuboMenos.afuera - 0.4) < 0.02,
        ver(tuboMenos),
    );

    // 6. Malla pesada: tiene que decimarse por debajo del límite y laminar igual.
    const pesada = await laminar({ caso: 'esfera', limite: 250000 });
    const d = pesada.info.decimado;
    revisar(
        'esfera decimada',
        d && d.original > 1e6 && d.final <= 250000,
        d ? `(${d.original} → ${d.final} triángulos, celda ${d.precisionMm.toFixed(3)} mm)` : '',
    );
    revisar('esfera de 80 mm de alto', pesada.g.zMax >= 79 && pesada.g.zMax <= 81, `Z máx ${pesada.g.zMax}`);

    await probarCambios({ laminar, revisar }); // cambios por altura (ADR 0002)
} finally {
    await navegador.close();
    await (modoDev ? servidor.close() : servidor.httpServer.close());
}
console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallas ? 1 : 0);
