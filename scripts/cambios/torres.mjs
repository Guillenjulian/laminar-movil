// Pruebas de src/perfiles/torres.js (T6 del ADR 0002), parte de `npm run test:cambios`.
//
// Flujo: probarConfiguracionTorres(ok) levanta Vite en modo SSR (perfiles.js usa import.meta.glob y no
// corre en Node plano; sin puertos) -> carga torres.js y perfiles.js -> valoresSugeridos, armarTorre y
// configuracionDeTorre. `ok(nombre, condicion, detalle)` es el registrador de probar-cambios.mjs.

import { createServer } from 'vite';
import { validarCambios, cambiosARangos } from '../../src/perfiles/cambios.js';
import { bloquesDeTorre } from '../../src/motor/torres.js';

const J = JSON.stringify;
const ENDER = 'creality-ender-3-v3-se';
const BOWDEN = 'kiri-dagoma-disco-ult-v2';
const ctxTorre = (impresoraId, material = 'pla') => ({ impresoraId, material });
const falla = f => {
    try {
        f();
        return false;
    } catch (e) {
        return /\S/.test(e.message);
    }
};

// Impresora propia con hotendMax 240 y ABS (250): la escalera baja entera, sin repetir valores.
function pruebaHotendMax(T, P, ok) {
    P.ponerImpresorasPropias([{ id: 'baja', nombre: 'Baja', hotendMax: 240, camaMax: 100, firmware: 'marlin' }]);
    const abs = T.valoresSugeridos('temperatura', ctxTorre('baja', 'abs')).valores;
    ok(
        'hotendMax 240 con ABS (250): ningún valor lo pasa y no se repiten',
        Math.max(...abs) <= 240 && new Set(abs).size === 5,
        J(abs),
    );
}

function pruebasValoresSugeridos(T, P, ok) {
    const ender = ENDER;
    const bowden = BOWDEN;
    const tope = P.buscarImpresora(ender).limites.hotendMax;
    {
        console.log('\n▶ T6: valoresSugeridos');
        const sugeridas = Object.keys(P.materiales)
            .filter(m => !m.startsWith('_'))
            .map(m => [m, T.valoresSugeridos('temperatura', ctxTorre(ender, m))]);
        ok(
            'temperatura: 5 valores descendentes de a 5, dentro de hotendMax y 150..300',
            sugeridas.every(
                ([, s]) =>
                    s.valores.length === 5 &&
                    s.valores.every((v, i) => v <= tope && v >= 150 && (!i || s.valores[i - 1] - v === 5)),
            ),
        );
        const pla = T.valoresSugeridos('temperatura', ctxTorre(ender)).valores;
        const t = P.valoresDeAvanzado(ender, 'normal', 'pla').tempBoquilla;
        ok('PLA: [t+10, t+5, t, t-5, t-10] con t del material', J(pla) === J([t + 10, t + 5, t, t - 5, t - 10]));
        pruebaHotendMax(T, P, ok);
        const directa = T.valoresSugeridos('retraccion', ctxTorre(ender)).valores;
        const larga = T.valoresSugeridos('retraccion', ctxTorre(bowden)).valores;
        ok('retracción directa: 0,5..4,5 de a 1', J(directa) === J([0.5, 1.5, 2.5, 3.5, 4.5]));
        ok(
            'retracción Bowden (> 2 mm): 2..6 y distinta de la directa',
            P.valoresDeAvanzado(bowden, 'normal', 'pla').retraccion > 2 && J(larga) === J([2, 3, 4, 5, 6]),
        );
        ok(
            'tipo desconocido lanza error',
            falla(() => T.valoresSugeridos('x', ctxTorre(ender))),
        );
    }
}

function pruebasArmarTorre(T, ok) {
    {
        console.log('\n▶ T6: armarTorre');
        const torre = T.armarTorre({ tipo: 'temperatura', valores: [230, 225, 220, 215, 210] });
        ok(
            'bloques con desde/hasta de bloquesDeTorre y su valor',
            J(torre.bloques.map(b => ({ desdeMm: b.desdeMm, hastaMm: b.hastaMm }))) ===
                J(bloquesDeTorre({ bloques: 5, altoBloqueMm: 10 })) && torre.bloques[3].valor === 215,
        );
        ok(
            'altoBloqueMm propio',
            T.armarTorre({ tipo: 'retraccion', valores: [1, 2, 3], altoBloqueMm: 8 }).bloques[2].hastaMm === 24,
        );
        ok(
            'menos de 3 y más de 8 valores lanzan error',
            falla(() => T.armarTorre({ tipo: 'temperatura', valores: [200, 210] })) &&
                falla(() => T.armarTorre({ tipo: 'temperatura', valores: Array(9).fill(200) })),
        );
        ok(
            'valores fuera de rango o no numéricos lanzan error',
            falla(() => T.armarTorre({ tipo: 'temperatura', valores: [200, 210, 400] })) &&
                falla(() => T.armarTorre({ tipo: 'retraccion', valores: [1, 2, 11] })) &&
                falla(() => T.armarTorre({ tipo: 'retraccion', valores: [1, 2, NaN] })),
        );
        ok(
            'tipo y alto inválidos lanzan error',
            falla(() => T.armarTorre({ tipo: 'x', valores: [1, 2, 3] })) &&
                falla(() => T.armarTorre({ tipo: 'temperatura', valores: [200, 205, 210], altoBloqueMm: 3 })),
        );
    }
}

function pruebasConfiguracionDeTorre(T, ok) {
    {
        console.log('\n▶ T6: configuracionDeTorre');
        for (const [tipo, campo, valores] of [
            ['temperatura', 'tempBoquilla', [230, 225, 220, 215, 210]],
            ['retraccion', 'retraccion', [0.5, 1.5, 2.5, 3.5, 4.5]],
        ]) {
            const cfg = T.configuracionDeTorre(T.armarTorre({ tipo, valores }));
            const val = validarCambios(cfg.cambios);
            ok(
                `${tipo}: bloque 0 en avanzado, sin altura variable ni jarrón, soportes off`,
                cfg.avanzado[campo] === valores[0] &&
                    cfg.avanzado.alturaVariable === false &&
                    cfg.avanzado.jarron === false &&
                    cfg.soportes === false,
            );
            ok(
                `${tipo}: bloques 1..4 como cambios válidos y el bloque 0 no está en cambios`,
                cfg.cambios.length === 4 &&
                    val.errores.length === 0 &&
                    J(val.cambios) === J(cfg.cambios) &&
                    cfg.cambios.every((c, i) => c[campo] === valores[i + 1]),
            );
            const rangos = cambiosARangos(cfg.cambios, { sliceHeight: 0.2, firstSliceHeight: 0.2 });
            const esperado = bloquesDeTorre({ bloques: 5, altoBloqueMm: 10 }).slice(1);
            ok(
                `${tipo}: cada cambio cae en el rango de capas de su bloque (h=0,2)`,
                rangos.length === 4 &&
                    rangos.every(
                        (r, i) =>
                            r.lo === Math.round(esperado[i].desdeMm / 0.2) &&
                            r.hi === Math.round(esperado[i].hastaMm / 0.2) - 1,
                    ),
            );
        }
    }
}

export async function probarConfiguracionTorres(ok) {
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    try {
        const T = await vite.ssrLoadModule('/src/perfiles/torres.js');
        const P = await vite.ssrLoadModule('/src/perfiles/perfiles.js');
        pruebasValoresSugeridos(T, P, ok);
        pruebasArmarTorre(T, ok);
        pruebasConfiguracionDeTorre(T, ok);
    } finally {
        await vite.close();
    }
}
