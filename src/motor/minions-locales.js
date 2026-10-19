// Kiri reparte algunos cálculos en un pool de sub-workers ("minions"). Como
// nosotros corremos todo en un solo worker (para ahorrar RAM), el cálculo de
// sombras de los soportes automáticos se quedaría esperando para siempre.
// Acá reemplazamos esas dos funciones del pool por una versión que calcula
// en el mismo worker (es lo mismo que hace minion.js: cam_shadow_stack/_z).

import { newWidget } from '../../vendor/kiri/src/kiri/core/widget.js';
import { codec } from '../../vendor/kiri/src/kiri/core/codec.js';

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
}
