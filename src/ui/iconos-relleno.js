// Dibujitos de cada patrón de relleno (SVG de 48×48, usan el color del texto).

const lineas = (angulos, paso = 8) => angulos.flatMap(a => {
    // Líneas paralelas a `a` grados que cubren el cuadrado.
    const r = (a * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
    const nx = -dy, ny = dx;
    const d = [];
    for (let k = -48; k <= 48; k += paso) {
        const cx = 24 + nx * k, cy = 24 + ny * k;
        d.push(`M${(cx - dx * 40).toFixed(1)} ${(cy - dy * 40).toFixed(1)}L${(cx + dx * 40).toFixed(1)} ${(cy + dy * 40).toFixed(1)}`);
    }
    return d;
}).join('');

function panal() {
    const d = [];
    const r = 7, h = r * Math.sqrt(3);
    for (let fila = -1; fila < 9; fila++) {
        for (let col = -1; col < 5; col++) {
            const cx = col * r * 3 + (fila % 2 ? r * 1.5 : 0), cy = fila * h / 2;
            const p = [0, 1, 2, 3, 4, 5].map(i => {
                const t = (Math.PI / 3) * i;
                return `${(cx + r * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`;
            });
            d.push(`M${p.join('L')}Z`);
        }
    }
    return d.join('');
}

function giroide() {
    const d = [];
    for (let y = -4; y <= 52; y += 10) {
        let s = `M-2 ${y}`;
        for (let x = 0; x <= 50; x += 2) s += `L${x} ${(y + 4 * Math.sin(x / 4)).toFixed(1)}`;
        d.push(s);
    }
    return d.join('');
}

const CAMINOS = {
    hex: panal(),
    grid: lineas([45, 135]),
    gyroid: giroide(),
    cubic: lineas([0, 60, 120], 12),
    triangle: lineas([0, 60, 120], 9),
    linear: lineas([45]),
};

export function iconoRelleno(patron) {
    const d = CAMINOS[patron] || CAMINOS.grid;
    return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
        <defs><clipPath id="c-${patron}"><rect x="2" y="2" width="44" height="44" rx="6"/></clipPath></defs>
        <rect x="2" y="2" width="44" height="44" rx="6" fill="none" stroke="currentColor" stroke-opacity=".35"/>
        <path d="${d}" clip-path="url(#c-${patron})" fill="none" stroke="currentColor" stroke-width="1.6"/>
    </svg>`;
}
