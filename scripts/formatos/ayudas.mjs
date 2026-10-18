// Ayudas de geometría compartidas por las pruebas de formatos (scripts/formatos/*.mjs): caja, volumen con signo,
// chequeo de malla cerrada y captura de errores. No prueban nada por sí solas.

export const casi = (a, b, tol = 1e-4) => Math.abs(a - b) < tol;

export function caja(v) {
    const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], v[i + k]);
            max[k] = Math.max(max[k], v[i + k]);
        }
    }
    return { min, max, x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}
export const texto = c => `${+c.x.toFixed(3)} × ${+c.y.toFixed(3)} × ${+c.z.toFixed(3)}`;

// Volumen con signo (teorema de la divergencia): positivo si las normales miran hacia afuera.
export function volumen(v) {
    let s = 0;
    for (let i = 0; i < v.length; i += 9) {
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = v.subarray(i, i + 9);
        s += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return s / 6;
}

// Malla cerrada: cada arista aparece en exactamente 2 triángulos, una vez en
// cada sentido (eso además dice que las caras están orientadas parejo).
export function revisarCerrada(v) {
    const clave = i => `${v[i]},${v[i + 1]},${v[i + 2]}`;
    const dirigidas = new Map();
    for (let i = 0; i < v.length; i += 9) {
        const p = [clave(i), clave(i + 3), clave(i + 6)];
        for (let k = 0; k < 3; k++) {
            const a = `${p[k]}|${p[(k + 1) % 3]}`;
            dirigidas.set(a, (dirigidas.get(a) || 0) + 1);
        }
    }
    let aristas = 0,
        malas = 0;
    for (const [a, n] of dirigidas) {
        const [p, q] = a.split('|');
        const vuelta = dirigidas.get(`${q}|${p}`) || 0;
        if (n !== 1 || vuelta !== 1) malas++;
        aristas++;
    }
    return { aristas: aristas / 2, malas };
}

export async function error(fn) {
    try {
        await fn();
        return '';
    } catch (err) {
        return err.message;
    }
}
