// Web Worker de laminado. Todo lo pesado pasa acá adentro para no congelar la UI:
// leer el STL, centrarlo en la cama y correr el motor de Kiri:Moto.
//
// Importamos el worker original de Kiri (que registra sus funciones en
// self.kiri_worker.dispatch) y lo llamamos directamente, sin su cliente de UI.
//
// Mensajes que recibe:
//   { tipo: 'laminar', stl: ArrayBuffer, dispositivo: {...}, proceso: {...}, maxTriangulos,
//     transformacion?: matriz 3×3 de 9 números (ver transformar.js) }
//   o, con varias piezas (ADR 0003; se ignoran `stl` y `transformacion`):
//   { tipo: 'laminar', dispositivo, proceso, maxTriangulos,
//     piezas: [{ stl, transformacion?, posiciones: [{x, y}], bloqueos?: [...] }] }   (una posición por copia, relativa al
//   centro; `bloqueos` = zonas sin soporte en el marco de la pieza, ADR 0004: van a `widget.anno.bloqueos` de cada copia)
// Mensajes que manda:
//   { tipo: 'progreso', etapa: 'leyendo'|'reduciendo'|'laminando'|'preparando'|'exportando', valor: 0..1 }
//   { tipo: 'listo', gcode: string, info: { tiempo, filamento, capas, triangulos, tamano, decimado, copias, ganchos } }
//   (`ganchos`: lo que registraron los ganchos de soportes, ver soportes-kiri.js)
//   { tipo: 'error', mensaje: string }

import '../../vendor/kiri/src/kiri/run/worker.js';
import { conf } from '../../vendor/kiri/src/kiri/app/conf/defaults.js';
import { prepararPiezas } from './preparar-piezas.js';
import { usarMinionsLocales } from './minions-locales.js';
import { espiralar } from './espiral.js';
import { instalarGanchosSoportes, reiniciarGanchos, resumenGanchos } from './soportes-kiri.js';

const { dispatch, minions } = self.kiri_worker;
usarMinionsLocales(minions);
instalarGanchosSoportes();

// Llama a una función del dispatch de Kiri y devuelve una promesa.
// Kiri responde por callbacks: send.data() para avances, send.done() al terminar.
function kiri(tarea, datos, alAvanzar = () => {}) {
    return new Promise((resolver, rechazar) => {
        const send = {
            data: d => (d && d.error ? rechazar(new Error(d.error)) : alAvanzar(d)),
            done: d => (d && d.error ? rechazar(new Error(d.error)) : resolver(d)),
        };
        try {
            const r = dispatch[tarea](datos, send);
            if (r && r.then) r.catch(rechazar);
        } catch (err) {
            rechazar(err);
        }
    });
}

// Arma la configuración completa de Kiri: parte de sus valores por defecto
// para FDM y pisa con los de nuestro perfil.
function armarSettings(dispositivo, proceso) {
    const base = conf.template;
    return {
        mode: 'FDM',
        // threaded: false -> todo corre en este worker, sin el pool de
        // sub-workers de Kiri. Es más lento en PCs, pero usa mucha menos RAM.
        controller: Object.assign(Object.clone(base.controller), { threaded: false }),
        render: false,
        filter: { FDM: 'internal' },
        device: Object.assign(Object.clone(conf.defaults.fdm.d), dispositivo),
        process: Object.assign(Object.clone(conf.defaults.fdm.p), proceso),
        widget: {},
        time: Date.now(),
    };
}

function progreso(etapa, valor) {
    self.postMessage({ tipo: 'progreso', etapa, valor });
}

// Las piezas del mensaje: `piezas` si viene; si no, la pieza única del formato viejo en el centro.
function piezasDe(msg) {
    if (msg.piezas) return msg.piezas;
    return [{ stl: msg.stl, transformacion: msg.transformacion, posiciones: [{ x: 0, y: 0 }] }];
}

// Pone en cada widget las zonas sin soporte de su pieza (copia propia por widget; mismo marco local para todas las
// copias: la posición en la cama es `track.pos`). Los widgets salen de prepararPiezas en el orden pieza × copia.
function conBloqueos(piezas, widgets) {
    let k = 0;
    for (const p of piezas) {
        for (let c = 0; c < p.posiciones.length; c++) widgets[k++].bloqueos = structuredClone(p.bloqueos ?? []);
    }
}

// Un widget de Kiri por copia, cada uno en su grupo y con su posición en la cama.
async function subirWidgets(widgets, settings) {
    await kiri('clear', {});
    for (const [i, w] of widgets.entries()) {
        const id = 'p' + i;
        settings.widget[id] = {};
        const { x, y, z } = w.tamano;
        await kiri('sync', {
            id,
            group: id,
            vertices: w.vertices,
            meta: {},
            anno: { bloqueos: w.bloqueos ?? [] },
            track: {
                box: { w: x, h: y, d: z },
                pos: w.pos,
                scale: { x: 1, y: 1, z: 1 },
                rot: { x: 0, y: 0, z: 0 },
                top: z,
            },
        });
    }
}

// Lamina cada widget en serie; el avance es (k + update) / N. Devuelve la cantidad de capas (la de la más alta).
async function laminarWidgets(n, settings) {
    await kiri('rotate', { settings });
    await kiri('slicePre', { settings });
    let capas = 0;
    for (let k = 0; k < n; k++) {
        await kiri('slice', { id: 'p' + k, settings }, d => {
            if (d.update) progreso('laminando', (k + d.update) / n);
            if (d.slices) capas = Math.max(capas, d.slices);
        });
        progreso('laminando', (k + 1) / n); // Kiri no siempre avisa el último tramo de cada widget
    }
    await kiri('slicePost', { settings });
    return capas;
}

// Prepara y exporta el G-code. Devuelve las líneas y el resumen que da Kiri.
async function exportar(settings) {
    await kiri('prepare', { settings }, d => {
        if (d.progress) progreso('preparando', d.progress);
    });
    const lineas = [];
    const fin = await kiri('export', { settings }, d => {
        if (d.line) lineas.push(d.line);
    });
    progreso('exportando', 1);
    return { lineas, salida: fin.output || {} };
}

async function laminar(msg) {
    const { dispositivo, proceso, maxTriangulos = Infinity } = msg;
    progreso('leyendo', 0);
    const piezas = piezasDe(msg);
    const r = prepararPiezas(piezas, dispositivo, maxTriangulos, v => progreso('reduciendo', v));
    msg.stl = null; // prepararPiezas ya soltó el `stl` de cada pieza
    conBloqueos(piezas, r.widgets);
    reiniciarGanchos();
    const settings = armarSettings(dispositivo, proceso);
    await subirWidgets(r.widgets, settings);
    const capas = await laminarWidgets(r.widgets.length, settings);
    const { lineas, salida } = await exportar(settings);
    // Modo jarrón: Kiri deja cada vuelta plana; la convertimos en espiral.
    const gcode = proceso.sliceFillType === 'vase' ? espiralar(lineas.join('\n')) : lineas.join('\n');
    const info = { tiempo: salida.time, filamento: salida.distance, capas };
    return {
        gcode,
        info: {
            ...info,
            triangulos: r.triangulos,
            tamano: r.tamano,
            decimado: r.decimado,
            copias: r.widgets.length,
            ganchos: resumenGanchos(),
        },
    };
}

self.onmessage = async e => {
    const msg = e.data;
    try {
        if (msg.tipo === 'laminar') {
            const r = await laminar(msg);
            self.postMessage({ tipo: 'listo', ...r });
        }
    } catch (err) {
        console.error(err);
        self.postMessage({ tipo: 'error', mensaje: err.message || String(err) });
    }
};
