// API del motor para el hilo principal. Cada tarea abre su propio worker y lo
// cierra al terminar: así se libera toda la memoria (importante en celus
// de gama baja).

// Abre un worker, le manda un mensaje y espera 'listo' o 'error'.
// Con `signal` (AbortController) se puede cancelar: se mata el worker.
function correr(worker, mensaje, transferir, { alProgresar = () => {}, signal } = {}) {
    return new Promise((resolver, rechazar) => {
        const terminar = () => {
            worker.terminate();
            signal?.removeEventListener('abort', alCancelar);
        };
        const alCancelar = () => {
            terminar();
            rechazar(new DOMException('Cancelado', 'AbortError'));
        };
        signal?.addEventListener('abort', alCancelar);

        worker.onmessage = e => {
            const msg = e.data;
            if (msg.tipo === 'progreso') {
                alProgresar(msg.etapa, msg.valor);
            } else if (msg.tipo === 'listo') {
                terminar();
                resolver(msg);
            } else if (msg.tipo === 'error') {
                terminar();
                rechazar(new Error(msg.mensaje));
            }
        };
        worker.onerror = e => {
            terminar();
            // Si el worker muere sin mensaje, lo más probable es falta de memoria.
            rechazar(new Error(e.message || 'El laminador se cerró de golpe (¿se quedó sin memoria?)'));
        };

        worker.postMessage(mensaje, transferir);
    });
}

// Lamina un STL. Devuelve { gcode, info }.
// Ojo: `stl` se transfiere al worker (sin copiarlo) y queda vacío acá.
export async function laminar({ stl, dispositivo, proceso, maxTriangulos, alProgresar, signal }) {
    const worker = new Worker(new URL('./laminador.worker.js', import.meta.url), { type: 'module' });
    const r = await correr(worker, { tipo: 'laminar', stl, dispositivo, proceso, maxTriangulos }, [stl],
        { alProgresar, signal });
    return { gcode: r.gcode, info: r.info };
}

// Lee un STL para la vista previa. Devuelve { vertices, triangulos, tamano }.
// También transfiere `stl`.
export async function leerParaVista(stl, maxTriangulosVista = 300_000) {
    const worker = new Worker(new URL('./vista.worker.js', import.meta.url), { type: 'module' });
    return correr(worker, { stl, maxTriangulosVista }, [stl]);
}

// Lee un G-code y arma los recorridos para la vista previa capa por capa
// (ver recorridos.worker.js). El G-code se copia al worker; el resultado vuelve sin copiar.
export async function leerRecorridos(gcode, maxSegmentos) {
    const worker = new Worker(new URL('./recorridos.worker.js', import.meta.url), { type: 'module' });
    return correr(worker, { gcode, maxSegmentos }, []);
}
