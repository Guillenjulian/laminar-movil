// Worker liviano (sin Kiri) para la vista previa: lee el STL, cuenta los
// triángulos, mide el modelo y, si es muy pesado para dibujarlo, lo simplifica
// sólo para mostrarlo. La malla que se lamina es otra (ver laminador.worker.js).
//
// Recibe: { stl: ArrayBuffer, maxTriangulosVista }
// Manda:  { tipo: 'listo', vertices: Float32Array, triangulos, tamano }
//         { tipo: 'error', mensaje }

import { leerSTL } from './stl.js';
import { decimar } from './decimar.js';

self.onmessage = e => {
    try {
        let vertices = leerSTL(e.data.stl);
        const triangulos = vertices.length / 9;
        const tamano = medir(vertices);
        const r = decimar(vertices, e.data.maxTriangulosVista);
        if (r) vertices = r.vertices;
        self.postMessage({ tipo: 'listo', vertices, triangulos, tamano }, [vertices.buffer]);
    } catch (err) {
        self.postMessage({ tipo: 'error', mensaje: err.message || String(err) });
    }
};

function medir(v) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            if (v[i + k] < min[k]) min[k] = v[i + k];
            if (v[i + k] > max[k]) max[k] = v[i + k];
        }
    }
    return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}
