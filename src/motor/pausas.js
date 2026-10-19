// Inserta pausas (cambio de filamento) en el G-code, al principio de las capas
// elegidas. Las posiciones salen de la vista previa (recorridos-lector.js, `pausaCapa`).

// pausas: [{ capa (desde 0), offset (posición en el texto), z }]
// lineas: G-code de pausa de la impresora (ej. ['M600'])
export function insertarPausas(gcode, pausas, lineas) {
    if (!pausas.length) return gcode;
    const partes = [];
    let desde = 0;
    for (const p of [...pausas].sort((a, b) => a.offset - b.offset)) {
        partes.push(gcode.slice(desde, p.offset));
        partes.push(
            `; --- PAUSA: cambio de filamento antes de la capa ${p.capa + 1} (Z ${p.z.toFixed(2)} mm) ---\n` +
                lineas.join('\n') +
                '\n',
        );
        desde = p.offset;
    }
    partes.push(gcode.slice(desde));
    return partes.join('');
}
