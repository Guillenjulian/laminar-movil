// API del motor para el hilo principal. Crea un worker por cada laminado y lo
// cierra al terminar: así se libera toda la memoria (importante en celus
// de gama baja).

export function laminar({ stl, dispositivo, proceso, alProgresar = () => {} }) {
    return new Promise((resolver, rechazar) => {
        const worker = new Worker(new URL('./laminador.worker.js', import.meta.url), { type: 'module' });

        worker.onmessage = e => {
            const msg = e.data;
            if (msg.tipo === 'progreso') {
                alProgresar(msg.etapa, msg.valor);
            } else if (msg.tipo === 'listo') {
                worker.terminate();
                resolver({ gcode: msg.gcode, info: msg.info });
            } else if (msg.tipo === 'error') {
                worker.terminate();
                rechazar(new Error(msg.mensaje));
            }
        };
        worker.onerror = e => {
            worker.terminate();
            rechazar(new Error(e.message || 'Falló el worker de laminado'));
        };

        // El STL se pasa "transferido" (sin copiar) para no duplicar memoria.
        // Ojo: después de esto, `stl` queda vacío en el hilo principal.
        worker.postMessage({ tipo: 'laminar', stl, dispositivo, proceso }, [stl]);
    });
}
