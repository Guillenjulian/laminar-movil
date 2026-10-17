// Formatos de números y textos para mostrar (en castellano de Argentina).

const num = (n, decimales = 0) =>
    n.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

export const numero = num;

export function milimetros(t) {
    return `${num(t.x, 1)} × ${num(t.y, 1)} × ${num(t.z, 1)} mm`;
}

export function triangulos(n) {
    if (n >= 1e6) return `${num(n / 1e6, 1)} millones de triángulos`;
    if (n >= 1e4) return `${num(Math.round(n / 1000))} mil triángulos`;
    return `${num(n)} triángulos`;
}

export function duracion(segundos) {
    const min = Math.round(segundos / 60);
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${min % 60} min`;
}

// Filamento: largo en metros y peso aproximado en gramos.
export function filamento(mm, diametro = 1.75, densidad = 1.24 /* PLA, g/cm³ */) {
    const volumenCm3 = (Math.PI * (diametro / 2) ** 2 * mm) / 1000;
    return `${num(mm / 1000, 2)} m (≈ ${num(volumenCm3 * densidad)} g)`;
}

export function bytes(n) {
    if (n >= 1e6) return `${num(n / 1e6, 1)} MB`;
    return `${num(Math.max(1, Math.round(n / 1000)))} KB`;
}
