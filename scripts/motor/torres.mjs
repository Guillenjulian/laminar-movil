// Torres de calibración contra el Kiri real (ADR 0002, sección 7, casos 10-11; tarea T7).
// Responsabilidad: generar la torre con `torreAStl` (en el worker, desde la página de pruebas), laminarla con la
// configuración de `configuracionDeTorre` y revisar sobre el G-code que cada bloque tiene su temperatura / retracción.
// Lo llama scripts/probar-motor.mjs dentro de su `try`. Regla de capas (ADR 0002, sección 3): una capa pertenece a
// un bloque si su PISO (la Z de la capa anterior; 0 para la capa 0) cae en [desde, hasta).
// Los helpers vienen de cambios.mjs (el dev de T3 los mueve a gcode-capas.mjs; ajustar este import al integrar).

import { porCapa } from './cambios.mjs';

const EPS = 1e-6;
const ALTO = 10;

// Piso de cada capa de Kiri.
const piso = (capas, n) => (n === 0 ? 0 : capas[n - 1].z);
const bloqueDe = (torre, p) => torre.bloques.findIndex(b => p >= b.desdeMm - EPS && p < b.hastaMm - EPS);

// Genera la torre en el worker y la lamina con la configuración que le impone.
async function laminarTorre({ laminar, pagina, revisar }, tipo, valores, calidad) {
    const { torre, config: t } = await pagina.evaluate(op => window.configTorre(op), {
        tipo,
        valores,
        altoBloqueMm: ALTO,
    });
    const stl = await pagina.evaluate(op => window.torreStl(op), { tipo, bloques: valores.length, altoBloqueMm: ALTO });
    revisar(
        `torre de ${tipo}: torreAStl devuelve triángulos × 50 + 84 bytes`,
        stl.bytes === stl.triangulos * 50 + 84 && stl.triangulos > 0,
        `(${stl.triangulos} triángulos, ${stl.bytes} bytes)`,
    );
    const r = await laminar({
        stlBase64: stl.base64,
        calidad,
        soportes: false,
        personal: { adhesion: 'nada', ...t.personal, avanzado: t.avanzado },
        cambios: t.cambios,
    });
    return { torre, g: r.g, C: porCapa(r.g.lineas).capas };
}

// Caso 10: el M104 de cada bloque cae en la primera capa con piso >= desde; ninguna capa tiene la del vecino.
async function probarTemperatura(ctx, calidad, h) {
    const valores = [230, 225, 220, 215, 210];
    const { torre, g, C } = await laminarTorre(ctx, 'temperatura', valores, calidad);
    const { revisar } = ctx;
    revisar(
        `caso 10 temperatura (capas de ${h}): arranca con M104 S230`,
        g.lineas.some(l => l.startsWith('M104 S230')),
    );
    torre.bloques.slice(1).forEach((b, k) => {
        const esperada = C.find(c => c.n >= 1 && piso(C, c.n) >= b.desdeMm - EPS)?.n;
        const donde = C.filter(c => c.m104.some(m => m.temp === b.valor)).map(c => c.n);
        revisar(
            `caso 10 temperatura (capas de ${h}): M104 S${b.valor} en la primera capa con piso >= ${b.desdeMm} mm`,
            donde + '' === esperada + '',
            `capa ${donde} (esperada ${esperada}, piso ${piso(C, esperada)}, bloque ${k + 2})`,
        );
    });
    // Temperatura vigente en cada capa (último M104 hasta ella; la S0 del final no cuenta).
    let vigente = valores[0];
    const mal = C.filter(c => {
        for (const m of c.m104) if (m.temp > 0) vigente = m.temp;
        return c.n >= 1 && vigente !== valores[bloqueDe(torre, piso(C, c.n))];
    });
    revisar(
        `caso 10 temperatura (capas de ${h}): ninguna capa corre con la temperatura del bloque vecino`,
        mal.length === 0,
        `(${C.length} capas${mal.length ? `, primera mala: ${mal[0].n}` : ''})`,
    );
}

// Caso 11: la retracción más frecuente de cada bloque es la de su valor (±0,05 mm).
async function probarRetraccion(ctx) {
    const valores = [0.5, 1.5, 2.5, 3.5, 4.5];
    const { torre, C } = await laminarTorre(ctx, 'retraccion', valores, 'normal');
    torre.bloques.forEach((b, k) => {
        const cuenta = new Map();
        for (const c of C.filter(c => c.n >= 1 && bloqueDe(torre, piso(C, c.n)) === k)) {
            for (const d of c.retracciones) cuenta.set(d, (cuenta.get(d) || 0) + 1);
        }
        const [moda, veces] = [...cuenta].sort((a, b) => b[1] - a[1])[0] ?? [NaN, 0];
        ctx.revisar(
            `caso 11 retracción: bloque ${k + 1} retrae ${b.valor} mm`,
            Math.abs(moda - b.valor) <= 0.05,
            `(más frecuente ${moda} mm, ${veces} veces)`,
        );
    });
}

/**
 * Casos 10-11 de la sección 7 del ADR 0002, más tamaño y cancelación de `torreAStl`.
 * @param {{ laminar: Function, revisar: Function, pagina: object }} ctx `pagina` es la de Playwright con
 *   `window.torreStl` (prueba-motor.html)
 * @returns {Promise<void>}
 */
export async function probarTorres(ctx) {
    console.log('\n▶ Torres de calibración contra Kiri (ADR 0002, casos 10-11)');
    const cancelada = await ctx.pagina.evaluate(() => window.torreStl({ tipo: 'temperatura' }, true));
    ctx.revisar(
        'torreAStl se puede cancelar (AbortError)',
        cancelada.error === 'AbortError',
        JSON.stringify(cancelada),
    );
    await probarTemperatura(ctx, 'normal', '0,2 mm');
    await probarTemperatura(ctx, 'detalle', '0,12 mm');
    await probarRetraccion(ctx);
}
