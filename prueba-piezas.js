/* global Worker, URL, atob, performance */
// SOLO PARA test:motor (lo importa prueba-motor.html; no es parte de la app). ADR 0003, T0.
// Varios widgets con `track.pos` distintos en el Kiri real, con el mismo flujo de laminador.worker.js:
// clear, sync por widget, rotate, slicePre, slice por id, slicePost, prepare, export. Usa el worker original de Kiri
// (prueba-piezas.worker.js) con su protocolo ({ task, data, seq }).
// Imports estáticos a propósito: así estos módulos quedan dentro del chunk de la página de pruebas y no en el precache.
import './vendor/kiri/src/add/array.js';
import './vendor/kiri/src/add/class.js';
import { conf } from './vendor/kiri/src/kiri/app/conf/defaults.js';
import { leerSTL } from './src/motor/stl.js';

const copiar = o => JSON.parse(JSON.stringify(o));

// Llama a una tarea del worker de Kiri; `alAvanzar` recibe los mensajes parciales (ej. las líneas del export).
function llamar(worker, estado, task, data, alAvanzar = () => {}) {
    return new Promise((ok, mal) => {
        const seq = ++estado.seq;
        worker.onerror = e => mal(new Error(e.message));
        worker.onmessage = e => {
            const m = e.data;
            if (m.seq !== seq) return;
            if (m.data && m.data.error) return mal(new Error(m.data.error));
            if (m.done) ok(m.data);
            else alAvanzar(m.data);
        };
        worker.postMessage({ task, data, seq, time: performance.now() });
    });
}

// Configuración de Kiri: sus valores por defecto de FDM pisados con el perfil.
function armarSettings(dispositivo, proceso) {
    return {
        mode: 'FDM',
        controller: { ...copiar(conf.template.controller), threaded: false },
        render: false,
        filter: { FDM: 'internal' },
        device: { ...copiar(conf.defaults.fdm.d), ...dispositivo },
        process: { ...copiar(conf.defaults.fdm.p), ...proceso },
        widget: {},
        time: Date.now(),
    };
}

// Igual que centrar() del worker: centro de la caja en X/Y = 0, base en Z = 0. Devuelve el tamaño.
function centrar(v) {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < v.length; k += 3) {
        for (let a = 0; a < 3; a++) {
            mn[a] = Math.min(mn[a], v[k + a]);
            mx[a] = Math.max(mx[a], v[k + a]);
        }
    }
    const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]];
    for (let k = 0; k < v.length; k += 3) for (let a = 0; a < 3; a++) v[k + a] -= c[a];
    return { x: mx[0] - mn[0], y: mx[1] - mn[1], z: mx[2] - mn[2] };
}

// Mensaje `sync` de un widget con su posición en la cama.
function mensajeSync(id, vertices, t, pos) {
    return {
        id,
        group: id,
        vertices,
        meta: {},
        anno: {},
        track: {
            box: { w: t.x, h: t.y, d: t.z },
            pos: { x: pos.x, y: pos.y, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rot: { x: 0, y: 0, z: 0 },
            top: t.z,
        },
    };
}

/**
 * Lamina varias piezas, cada una con su `track.pos`.
 * @param {{ piezas: {caso?: string, stlBase64?: string, pos: {x:number,y:number}}[], dispositivo: object,
 *   proceso: object, obtenerSTL: (caso: string) => Promise<ArrayBuffer> }} o
 * @returns {Promise<{gcode: string, dispositivo: object}>}
 */
export async function laminarPiezas({ piezas, dispositivo, proceso, obtenerSTL }) {
    const worker = new Worker(new URL('./prueba-piezas.worker.js', import.meta.url), { type: 'module' });
    const estado = { seq: 0 };
    const call = (task, data, alAvanzar) => llamar(worker, estado, task, data, alAvanzar);
    const settings = armarSettings(dispositivo, proceso);
    try {
        await call('clear', {});
        const ids = [];
        for (const [i, p] of piezas.entries()) {
            const buf = p.stlBase64
                ? Uint8Array.from(atob(p.stlBase64), c => c.charCodeAt(0)).buffer
                : await obtenerSTL(p.caso);
            const v = leerSTL(buf);
            const t = centrar(v);
            const id = 'pieza' + (i + 1);
            ids.push(id);
            settings.widget[id] = {};
            await call('sync', mensajeSync(id, v, t, p.pos));
        }
        await call('rotate', { settings });
        await call('slicePre', { settings });
        for (const id of ids) await call('slice', { id, settings });
        await call('slicePost', { settings });
        await call('prepare', { settings });
        const lineas = [];
        await call('export', { settings }, d => d && d.line && lineas.push(d.line));
        return { gcode: lineas.join('\n'), dispositivo };
    } finally {
        worker.terminate();
    }
}
