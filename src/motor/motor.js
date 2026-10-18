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
// `transformacion` (opcional): matriz 3×3 de 9 números, fila por fila, con la
// escala y rotación del modelo (ver transformar.js). El worker la aplica antes
// de centrar el modelo en la cama.
export async function laminar({ stl, dispositivo, proceso, maxTriangulos, transformacion, alProgresar, signal }) {
    const worker = new Worker(new URL('./laminador.worker.js', import.meta.url), { type: 'module' });
    const r = await correr(
        worker,
        { tipo: 'laminar', stl, dispositivo, proceso, maxTriangulos, transformacion },
        [stl],
        { alProgresar, signal },
    );
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

// Convierte un OBJ o un 3MF a STL binario (en un worker). Devuelve { stl: ArrayBuffer }.
// Si el archivo está roto, la promesa se rechaza con un mensaje en castellano.
// También transfiere `buffer`.
export async function convertirAStl(nombre, buffer) {
    const worker = new Worker(new URL('./convertir.worker.js', import.meta.url), { type: 'module' });
    const r = await correr(worker, { tipo: 'convertir', nombre, buffer }, [buffer]);
    return { stl: r.stl };
}

// Arma una litofanía (o relieve) a partir de una imagen en escala de grises
// (ver litofania.js). Devuelve { stl: ArrayBuffer }. Transfiere `grises`.
export async function litofaniaAStl({ grises, ancho, alto, anchoMm, minMm, maxMm, tipo, marco }) {
    const worker = new Worker(new URL('./convertir.worker.js', import.meta.url), { type: 'module' });
    const r = await correr(
        worker,
        {
            tipo: 'litofania',
            grises,
            ancho,
            alto,
            anchoMm,
            minMm,
            maxMm,
            tipoLitofania: tipo,
            marco,
        },
        [grises.buffer],
    );
    return { stl: r.stl };
}

// Arma una torre de calibración (ver torres.js). `tipo` es 'temperatura' o 'retraccion'; el resto son las
// opciones de la torre (bloques, altoBloqueMm, ...). Devuelve { stl: ArrayBuffer }; se puede cancelar con `signal`.
export async function torreAStl({ tipo, ...opciones }, { signal } = {}) {
    const worker = new Worker(new URL('./convertir.worker.js', import.meta.url), { type: 'module' });
    const r = await correr(worker, { tipo: 'torre', tipoTorre: tipo, ...opciones }, [], { signal });
    return { stl: r.stl };
}
