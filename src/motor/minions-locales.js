// Kiri reparte algunos cálculos en un pool de sub-workers ("minions"). Como
// nosotros corremos todo en un solo worker (para ahorrar RAM), esos pedidos se
// quedarían esperando para siempre en una cola que nadie atiende. Acá
// reemplazamos las funciones del pool que FDM usa por versiones que calculan en
// el mismo worker:
// - cam_shadow_stack/_z (sombras de los soportes automáticos), como minion.js;
// - subtract y union, que Kiri manda al pool cuando una capa tiene 8 o más
//   polígonos (por ejemplo, un texto en relieve): sin esto, el laminado se
//   colgaba en ~41 %, al comparar capas.
// Cualquier otro pedido al pool falla con un error en vez de colgarse.

import { newWidget } from '../../vendor/kiri/src/kiri/core/widget.js';
import { codec } from '../../vendor/kiri/src/kiri/core/codec.js';
import { polygons as POLY } from '../../vendor/kiri/src/geo/polygons.js';

export function usarMinionsLocales(minions) {
    let sombras; // equivalente a cache.shadow_stack del minion
    // Los trabajos se encadenan: cada uno arranca después de que corrió el `.then` del anterior (donde Kiri
    // avisa el progreso). Si se calcularan todos en la llamada, los avisos llegarían juntos al final.
    let cola = Promise.resolve();

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
        const hecho = cola.then(() => ({
            data: codec.encode(newWidget().computeShadowAtZ(trabajo.z, trabajo.t, sombras)),
        }));
        cola = hecho.catch(() => {});
        return hecho;
    };

    // Lo mismo que hacen minwork.subtract/union de Kiri cuando no hay pool (rama `concurrent < 2`).
    minions.subtract = async ({ a, b, outA, outB, z, area, wasm }) => {
        POLY.subtract(a, b, outA, outB, z, area, { wasm });
    };
    minions.union = async (polys, minarea) => POLY.union(polys, minarea, true);

    // Red de seguridad: lo que todavía llegue a la cola del pool corta el laminado con un error (se lanza adentro
    // de la promesa que lo pidió) en lugar de esperar para siempre.
    minions.queue = trabajo => {
        throw new Error(`Operación en paralelo no soportada: ${trabajo.cmd}`);
    };
}
