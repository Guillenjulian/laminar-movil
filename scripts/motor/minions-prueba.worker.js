// Worker de prueba (sólo lo usa prueba-motor.html): compara los minions locales con las funciones de polígonos de
// Kiri, con los mismos polígonos de una capa con muchas islas. Responde { subtract, union, fill, clip }.
import '../../vendor/kiri/src/kiri/run/worker.js';
import { polygons as POLY } from '../../vendor/kiri/src/geo/polygons.js';
import { newPolygon } from '../../vendor/kiri/src/geo/polygon.js';
import { usarMinionsLocales } from '../../src/motor/minions-locales.js';

const minions = {};
usarMinionsLocales(minions);

// 12 islas circulares (A) y 12 círculos corridos que las muerden por un lado (B).
const circulos = corrimiento =>
    Array.from({ length: 12 }, (_, i) =>
        newPolygon().centerCircle({ x: (i % 4) * 10 + corrimiento, y: Math.floor(i / 4) * 10, z: 0 }, 3, 16),
    );
const huella = polys => polys.map(p => p.points.map(q => `${q.x.toFixed(4)},${q.y.toFixed(4)}`).join(' ')).join('|');

self.onmessage = async () => {
    const directo = { a: [], b: [] };
    POLY.subtract(circulos(0), circulos(2), directo.a, directo.b, 0, 0, { wasm: false });
    const local = { a: [], b: [] };
    await minions.subtract({
        a: circulos(0),
        b: circulos(2),
        outA: local.a,
        outB: local.b,
        z: 0,
        area: 0,
        wasm: false,
    });
    const unionLocal = await minions.union(circulos(0).concat(circulos(2)), 0);
    const unionDirecta = POLY.union(circulos(0).concat(circulos(2)), 0, true);
    const salida = [];
    const lineas = await minions.fill(circulos(0), 45, 1, salida, 0, 100);
    const clip = await minions.clip().then(
        () => 'resolvió',
        e => e.message,
    );
    self.postMessage({
        subtract: {
            nA: directo.a.length,
            nB: directo.b.length,
            localA: local.a.length,
            localB: local.b.length,
            igual: huella(directo.a) === huella(local.a) && huella(directo.b) === huella(local.b),
        },
        union: { n: unionDirecta.length, igual: huella(unionDirecta) === huella(unionLocal) },
        fill: { lineas: lineas.length, salida: salida.length },
        clip,
    });
};
