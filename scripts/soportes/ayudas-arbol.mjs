// Ayudas de las pruebas del soporte árbol (ADR 0004, T1): capas sintéticas y lectura de los círculos de la salida.
// No es una prueba (no exporta `default`): `scripts/probar-soportes.mjs` salta los archivos `ayudas-*.mjs`.

export const H = 0.2;
export const OP = { ancho: 0.4, altoCapa: H, angulo: 50 };
export const DERIVA = H * Math.tan((50 * Math.PI) / 180);
export const EPS = 1e-9;
export const CAMA = { x0: 0, y0: 0, x1: 220, y1: 220 };

export const rect = (x0, y0, x1, y1) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
];

// Pila de abajo hacia arriba: `n` capas libres (con `pilar` de cuerpo si se da) y arriba de todo la tapa.
// La sombra está en la capa n - 1 (justo bajo la tapa). Con `pilar`, la sombra lo lleva como agujero (par-impar).
export function pila({ n, tapas, pilar }) {
    const capas = [];
    for (let i = 0; i < n; i++) {
        capas.push({ z: (i + 0.5) * H, voladizos: [], cuerpo: pilar ? [pilar] : [] });
    }
    capas[n - 1].voladizos = pilar ? [...tapas, pilar] : tapas;
    capas.push({ z: (n + 0.5) * H, voladizos: [], cuerpo: tapas });
    return capas;
}

// Un polígono de `circulo` tiene todos los vértices a distancia r del centro.
function info(poli) {
    const x = poli.reduce((s, p) => s + p.x, 0) / poli.length;
    const y = poli.reduce((s, p) => s + p.y, 0) / poli.length;
    return { x, y, r: Math.hypot(poli[0].x - x, poli[0].y - y) };
}
export const circulos = capa => capa.map(info);
