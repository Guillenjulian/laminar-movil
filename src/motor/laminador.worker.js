// Web Worker de laminado. Todo lo pesado pasa acá adentro para no congelar la UI:
// leer el STL, centrarlo en la cama y correr el motor de Kiri:Moto.
//
// Importamos el worker original de Kiri (que registra sus funciones en
// self.kiri_worker.dispatch) y lo llamamos directamente, sin su cliente de UI.
//
// Mensajes que recibe:
//   { tipo: 'laminar', stl: ArrayBuffer, dispositivo: {...}, proceso: {...}, maxTriangulos,
//     transformacion?: matriz 3×3 de 9 números (ver transformar.js) }
// Mensajes que manda:
//   { tipo: 'progreso', etapa: 'leyendo'|'reduciendo'|'laminando'|'preparando'|'exportando', valor: 0..1 }
//   { tipo: 'listo', gcode: string, info: { tiempo, filamento, capas, triangulos, tamano, decimado } }
//   { tipo: 'error', mensaje: string }

import '../../vendor/kiri/src/kiri/run/worker.js';
import { conf } from '../../vendor/kiri/src/kiri/app/conf/defaults.js';
import { leerSTL } from './stl.js';
import { decimar } from './decimar.js';
import { aplicar, esIdentidad } from './transformar.js';
import { usarMinionsLocales } from './minions-locales.js';
import { espiralar } from './espiral.js';

const { dispatch, minions } = self.kiri_worker;
usarMinionsLocales(minions);

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

// Centra la malla en X/Y y la apoya en Z=0. Kiri ubica el modelo en el
// centro de la cama cuando la posición es (0,0,0).
function centrar(v) {
    let min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            if (v[i + k] < min[k]) min[k] = v[i + k];
            if (v[i + k] > max[k]) max[k] = v[i + k];
        }
    }
    const dx = (min[0] + max[0]) / 2,
        dy = (min[1] + max[1]) / 2,
        dz = min[2];
    for (let i = 0; i < v.length; i += 3) {
        v[i] -= dx;
        v[i + 1] -= dy;
        v[i + 2] -= dz;
    }
    return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
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

// Avisa si el modelo no entra en la cama (mejor un error claro que un G-code inútil).
function validarTamano(t, d) {
    const mm = n => n.toFixed(1).replace('.', ',');
    if (t.x > d.bedWidth || t.y > d.bedDepth || t.z > d.maxHeight) {
        throw new Error(
            `El modelo mide ${mm(t.x)} × ${mm(t.y)} × ${mm(t.z)} mm y no entra en la cama ` +
                `(${d.bedWidth} × ${d.bedDepth} × ${d.maxHeight} mm).`,
        );
    }
}

function progreso(etapa, valor) {
    self.postMessage({ tipo: 'progreso', etapa, valor });
}

async function laminar(msg) {
    const { dispositivo, proceso, maxTriangulos = Infinity, transformacion } = msg;
    progreso('leyendo', 0);
    let vertices = leerSTL(msg.stl);
    msg.stl = null; // soltar el archivo original lo antes posible

    // Escala y rotaciones que eligió el usuario. Van antes de decimar y de
    // centrar: así la validación de tamaño ya mide el modelo transformado.
    if (transformacion && !esIdentidad(transformacion)) {
        aplicar(transformacion, vertices);
    }

    // Si la malla es muy pesada para el equipo, la simplificamos antes de laminar.
    let decimado = null;
    const r = decimar(vertices, maxTriangulos, v => progreso('reduciendo', v));
    if (r) {
        vertices = r.vertices;
        decimado = { original: r.original, final: r.final, precisionMm: r.celda };
    }

    const tamano = centrar(vertices);
    const triangulos = vertices.length / 9;
    validarTamano(tamano, dispositivo);

    const settings = armarSettings(dispositivo, proceso);
    const id = 'modelo';
    settings.widget[id] = {};

    await kiri('clear', {});
    await kiri('sync', {
        id,
        group: id,
        vertices,
        meta: {},
        anno: {},
        track: {
            box: { w: tamano.x, h: tamano.y, d: tamano.z },
            pos: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rot: { x: 0, y: 0, z: 0 },
            top: tamano.z,
        },
    });
    await kiri('rotate', { settings });
    await kiri('slicePre', { settings });

    let capas = 0;
    await kiri('slice', { id, settings }, d => {
        if (d.update) progreso('laminando', d.update);
        if (d.slices) capas = d.slices;
    });
    await kiri('slicePost', { settings });

    await kiri('prepare', { settings }, d => {
        if (d.progress) progreso('preparando', d.progress);
    });

    const lineas = [];
    const fin = await kiri('export', { settings }, d => {
        if (d.line) lineas.push(d.line);
    });
    progreso('exportando', 1);

    const salida = fin.output || {};
    // Modo jarrón: Kiri deja cada vuelta plana; la convertimos en espiral.
    const gcode = proceso.sliceFillType === 'vase' ? espiralar(lineas.join('\n')) : lineas.join('\n');
    return {
        gcode,
        info: {
            tiempo: salida.time, // segundos estimados
            filamento: salida.distance, // mm de filamento
            capas,
            triangulos,
            tamano,
            decimado,
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
