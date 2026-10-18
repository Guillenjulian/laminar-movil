// Worker de la vista previa: lee un G-code y arma los recorridos capa por capa.
// La lectura está en recorridos-lector.js (pura, se prueba en Node); acá sólo está el mensaje.
//
// Recibe: { gcode: string, maxSegmentos }
// Manda:  { tipo: 'listo', posiciones: Uint16Array (6 por segmento, ver CUANTIZADO), colores: Uint8Array (6 por segmento),
//           tipos: Uint8Array (tipo de línea de cada segmento, índice en TIPOS),
//           inicioCapa: Uint32Array (índice del primer segmento de cada capa, + uno final),
//           pausaCapa: Float64Array (posición en el texto del G-code donde insertar una pausa
//                      antes de cada capa: justo antes de subir Z, con la capa anterior terminada),
//           zCapa: Float32Array, caja: {min, max}, incompleta: bool }
import { leer } from './recorridos-lector.js';

export { leer };

self.onmessage = e => {
    try {
        const r = leer(e.data.gcode, e.data.maxSegmentos || Infinity);
        self.postMessage({ tipo: 'listo', ...r }, [
            r.posiciones.buffer,
            r.colores.buffer,
            r.tipos.buffer,
            r.inicioCapa.buffer,
            r.zCapa.buffer,
            r.pausaCapa.buffer,
        ]);
    } catch (err) {
        self.postMessage({ tipo: 'error', mensaje: err.message || String(err) });
    }
};
