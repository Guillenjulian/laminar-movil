// Kiri reparte algunos cálculos en un pool de sub-workers ("minions"). Como
// nosotros corremos todo en un solo worker (para ahorrar RAM), el cálculo de
// sombras de los soportes automáticos se quedaría esperando para siempre.
// Acá reemplazamos las funciones del pool por una versión que calcula en el
// mismo worker: las sombras (lo mismo que hace minion.js: cam_shadow_stack/_z) y
// subtract/union/fill, que Kiri manda al pool cuando una capa tiene muchas islas
// (≥ 8 polígonos): sin esto, el laminado se queda esperando para siempre.

import { newWidget } from '../../vendor/kiri/src/kiri/core/widget.js';
import { polygons as POLY } from '../../vendor/kiri/src/geo/polygons.js';
import { codec } from '../../vendor/kiri/src/kiri/core/codec.js';

export function usarMinionsLocales(minions) {
    let sombras; // equivalente a cache.shadow_stack del minion

    minions.broadcast = (cmd, datos) => {
        if (cmd === 'cam_shadow_stack') {
            sombras = datos && datos.clear ? undefined : datos;
        }
        // El resto de los broadcasts sólo sirven con el pool activo: se ignoran.
    };

    minions.queueAsync = trabajo => {
        if (trabajo.cmd !== 'cam_shadow_z') {
            return Promise.reject(new Error(`Operación en paralelo no soportada: ${trabajo.cmd}`));
        }
        const polys = newWidget().computeShadowAtZ(trabajo.z, trabajo.t, sombras);
        return Promise.resolve({ data: codec.encode(polys) });
    };

    // Mismas cuentas que hace Kiri cuando no usa el pool (worker.js: ramas "concurrent < 2").
    minions.subtract = async ({ a, b, outA, outB, z, area, wasm }) => {
        POLY.subtract(a, b, outA, outB, z, area, { wasm });
    };
    minions.union = async (polys, minarea) => POLY.union(polys, minarea, true);
    // Igual que la versión del pool: agrega las líneas a `salida` y las devuelve.
    minions.fill = async (polys, angulo, espaciado, salida, largoMin, largoMax) => {
        const lineas = [];
        POLY.fillArea(polys, angulo, espaciado, lineas, largoMin, largoMax);
        salida.push(...lineas);
        return lineas;
    };
    // clip y sliceZ no tienen versión local: que fallen con un error claro en vez de quedarse esperando.
    for (const nombre of ['clip', 'sliceZ']) {
        minions[nombre] = () => Promise.reject(new Error(`Operación en paralelo no soportada: ${nombre}`));
    }
}
