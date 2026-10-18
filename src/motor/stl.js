// Lector de STL (binario y ASCII). Devuelve un Float32Array con los vértices de
// cada triángulo en orden: [x1,y1,z1, x2,y2,z2, x3,y3,z3, ...].
// Lo usamos en vez del de Kiri para poder decimar antes de pasarle la malla.

export function leerSTL(buffer) {
    const datos = new DataView(buffer);
    if (esBinario(datos)) {
        return leerBinario(datos);
    }
    return leerASCII(new TextDecoder().decode(buffer));
}

// Un STL binario tiene 80 bytes de encabezado + 4 bytes con la cantidad de
// triángulos + 50 bytes por triángulo. Si el tamaño cierra, es binario
// (aunque el encabezado empiece con "solid", que pasa seguido).
function esBinario(datos) {
    if (datos.byteLength < 84) return false;
    const n = datos.getUint32(80, true);
    return 84 + n * 50 === datos.byteLength;
}

function leerBinario(datos) {
    const n = datos.getUint32(80, true);
    const vertices = new Float32Array(n * 9);
    let o = 84,
        i = 0;
    for (let t = 0; t < n; t++) {
        o += 12; // saltear la normal
        for (let k = 0; k < 9; k++) {
            vertices[i++] = datos.getFloat32(o, true);
            o += 4;
        }
        o += 2; // "attribute byte count"
    }
    return vertices;
}

function leerASCII(texto) {
    const numeros = [];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    let m;
    while ((m = re.exec(texto))) {
        numeros.push(+m[1], +m[2], +m[3]);
    }
    if (numeros.length === 0 || numeros.length % 9 !== 0) {
        throw new Error('El archivo no parece un STL válido');
    }
    return new Float32Array(numeros);
}
