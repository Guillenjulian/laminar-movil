// Worker liviano (sin Kiri) que convierte otros formatos a STL binario, para
// que el resto de la app (vista previa, laminado, recientes) siga trabajando
// sólo con STL.
//
// Recibe: { tipo: 'convertir', nombre, buffer: ArrayBuffer }       (OBJ o 3MF)
//         { tipo: 'torre', tipoTorre: 'temperatura'|'retraccion', bloques, altoBloqueMm, ... }  (ver torres.js)
//         { tipo: 'litofania', grises: Uint8Array, ancho, alto, anchoMm, minMm, maxMm, tipoLitofania, marco }
// Manda:  { tipo: 'listo', stl: ArrayBuffer, triangulos }
//         { tipo: 'error', mensaje }

import { leerModelo, escribirSTL } from './formatos.js';
import { generarLitofania } from './litofania.js';
import { generarTorreTemperatura, generarTorreRetraccion } from './torres.js';

self.onmessage = async e => {
    const msg = e.data;
    try {
        let vertices;
        if (msg.tipo === 'convertir') {
            vertices = await leerModelo(msg.nombre, msg.buffer);
        } else if (msg.tipo === 'litofania') {
            vertices = generarLitofania({ ...msg, tipo: msg.tipoLitofania });
        } else if (msg.tipo === 'torre') {
            const { tipoTorre, ...opciones } = msg;
            const generar = { temperatura: generarTorreTemperatura, retraccion: generarTorreRetraccion }[tipoTorre];
            if (!generar) throw new Error('Tipo de torre desconocido: ' + tipoTorre);
            vertices = generar(opciones).vertices;
        } else {
            throw new Error('Pedido desconocido: ' + msg.tipo);
        }
        const stl = escribirSTL(vertices);
        self.postMessage({ tipo: 'listo', stl, triangulos: vertices.length / 9 }, [stl]);
    } catch (err) {
        self.postMessage({ tipo: 'error', mensaje: err.message || String(err) });
    }
};
