// Pruebas del cableado de `auto` (ADR 0006, T6): motor.leerRecorridos -> mensaje -> recorridos.worker.js.
// Corre en Node con un `Worker` falso que entrega el mensaje al `self.onmessage` del worker real (cargado con
// `self` simulado) y devuelve su `postMessage` a `worker.onmessage`, así se prueban motor.js y el worker juntos.
import { leer } from './ayuda.mjs'; // simula `self` y carga recorridos.worker.js
import { generarGcode } from '../lib/gcode-sintetico.mjs';

class WorkerFalso {
    postMessage(mensaje) {
        globalThis.self.postMessage = respuesta => queueMicrotask(() => this.onmessage({ data: respuesta }));
        globalThis.self.onmessage({ data: mensaje });
    }
    terminate() {}
}

export async function probarWorker({ revisar }) {
    console.log('\nrecorridos.worker.js y motor.leerRecorridos (auto)');
    globalThis.Worker = WorkerFalso;
    const { leerRecorridos } = await import('../../src/motor/motor.js');

    const g = generarGcode(30000, 3);
    const n0 = leer(g, Infinity).tipos.length;
    const max = Math.floor(n0 * 0.95); // no entra en el nivel 0

    const sin = await leerRecorridos(g, max);
    revisar('sin auto: nivel 0 e incompleta (como antes)', sin.nivel === 0 && sin.incompleta && !sin.simplificado);
    const sinOpciones = await leerRecorridos(g, max, {});
    revisar('opciones vacías: igual que sin auto', sinOpciones.nivel === 0 && sinOpciones.incompleta);

    const con = await leerRecorridos(g, max, { auto: true });
    revisar(
        'con auto: nivel mayor que 0, completa y simplificada',
        con.nivel > 0 && !con.incompleta && con.simplificado,
        `nivel ${con.nivel}`,
    );
    revisar(
        'con auto: mismas capas que sin auto hasta donde llegó el nivel 0',
        con.inicioCapa.length >= sin.inicioCapa.length && con.zCapa[0] === sin.zCapa[0],
    );
    revisar(
        'con auto: manda nivel, simplificado y leidoHasta',
        typeof con.nivel === 'number' && typeof con.simplificado === 'boolean' && con.leidoHasta === g.length,
    );

    const chico = await leerRecorridos(g, Infinity, { auto: true });
    revisar('con auto y G-code que entra: nivel 0, sin simplificar', chico.nivel === 0 && !chico.simplificado);
}
