// Laminado con soportes automáticos: tiene que terminar (o fallar con un error) y avisar el progreso (QA, bug del 41 %).
// Reproduce el laminado "trabado" que reportó el usuario en el link de prueba del PR #4 (el avance se queda quieto para
// siempre y la UI no se entera). Antes del arreglo esta prueba fallaba: ver "Causa" abajo. Está registrada en
// scripts/probar-motor.mjs; para correrla sola:
//
//   npm run build && node scripts/motor/soportes-progreso.mjs
//
// Causa (confirmada, A = cuelgue real): `kiri_worker.minions.subtract` (vendor/kiri/src/kiri/run/worker.js:189) manda el
// trabajo al pool de sub-workers cuando la capa tiene 8 o más polígonos y 200 o más puntos (concurrent >= 4 siempre). Con
// `threaded: false` el pool nunca se arranca: minwork.queue() encola y nadie lo atiende, la promesa de layerDiff
// (slice.js:1484) no se resuelve y `processLayerDiffs` espera para siempre. No hay excepción ni mensaje 'error': el worker
// queda vivo y ocioso (0 % de CPU), la barra se queda en ~44 % ("laminando" ≈ 0,67). Pasa con y sin soportes, y también en
// origin/main. `src/motor/minions-locales.js` sólo reemplaza `broadcast` y `queueAsync`, no `subtract` (ni `union`/`fill`).
//
// Qué exige la app (cada caso, con soportes y en PC sin frenar la CPU):
//   1. el laminado termina o falla con un error en el plazo (nunca queda en silencio);
//   2. la barra de progreso avanza al menos cada 3 s;
//   3. si termina, el G-code tiene capas.
// Casos: (a) una placa chata de 2 mm con 36 islotes (muchos polígonos por capa, como las letras de un llavero) y
// (b) una esfera rugosa de ~40 mil triángulos (≈ 2 MB de STL: pesada, con voladizos por todos lados).

import { fileURLToPath } from 'node:url';

const MAX_SIN_AVISO_S = 3;
const PLAZOS_S = { islotes: 20, rugosa: 90 };

function aSTL(tris) {
    const n = tris.length / 9;
    const buf = Buffer.alloc(84 + n * 50);
    buf.writeUInt32LE(n, 80);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) buf.writeFloatLE(tris[t * 9 + k], 84 + t * 50 + 12 + k * 4);
    return buf;
}

// 6 × 6 cilindros de 4,4 mm de diámetro y 2,2 mm de alto, separados: cada capa tiene 36 polígonos.
function placaDeIslotes() {
    const t = [];
    const SEG = 16;
    const tri = (a, b, c) => t.push(...a, ...b, ...c);
    for (let i = 0; i < 36; i++) {
        const cx = (i % 6) * 8 - 20;
        const cy = Math.floor(i / 6) * 8 - 20;
        const p = (k, z) => [
            cx + 2.2 * Math.cos((k / SEG) * 2 * Math.PI),
            cy + 2.2 * Math.sin((k / SEG) * 2 * Math.PI),
            z,
        ];
        for (let k = 0; k < SEG; k++) {
            tri(p(k, 0), p(k + 1, 0), p(k, 2.2));
            tri(p(k + 1, 0), p(k + 1, 2.2), p(k, 2.2));
            tri([cx, cy, 0], p(k + 1, 0), p(k, 0));
            tri([cx, cy, 2.2], p(k, 2.2), p(k + 1, 2.2));
        }
    }
    return aSTL(Float32Array.from(t));
}

// Esfera de radio 30 con ondulaciones y ruido (como un escaneo): 4·L² triángulos.
function esferaRugosa(L = 100) {
    let s = 7;
    const azar = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const fases = Array.from({ length: 6 }, () => [azar() * 6.28, azar() * 6.28, 2 + Math.floor(azar() * 9)]);
    const ruido = Float32Array.from({ length: (L + 1) * (2 * L + 1) }, () => (azar() - 0.5) * 0.5);
    const pt = (a, b) => {
        const th = (a / L) * Math.PI;
        const ph = (b / (2 * L)) * 2 * Math.PI;
        let d = 0;
        for (const [f1, f2, k] of fases) d += Math.sin(k * th + f1) * Math.cos(k * ph + f2);
        const r = 30 + (d / 6) * 2.4 + ruido[a * (2 * L + 1) + (b % (2 * L))];
        return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th) + 39];
    };
    const t = [];
    for (let a = 0; a < L; a++)
        for (let b = 0; b < 2 * L; b++) {
            const [p1, p2, p3, p4] = [pt(a, b), pt(a + 1, b), pt(a + 1, b + 1), pt(a, b + 1)];
            t.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
        }
    return aSTL(Float32Array.from(t));
}

// Lamina con soportes y vigila el avance desde afuera (cada 100 ms mira window.progreso). Devuelve qué pasó.
async function laminarVigilado(pagina, stl, plazoS) {
    const inicio = Date.now();
    const avisos = []; // [segundos, etapa, valor]
    let vistos = 0;
    const vigilar = setInterval(async () => {
        try {
            const p = await pagina.evaluate(() => window.progreso || []);
            if (p.length < vistos) vistos = 0; // otra corrida: la lista empezó de nuevo
            for (const [etapa, valor] of p.slice(vistos)) avisos.push([(Date.now() - inicio) / 1000, etapa, valor]);
            vistos = p.length;
        } catch {
            /* la página está ocupada o recargándose */
        }
    }, 100);
    const corrida = pagina.evaluate(
        o =>
            window.probar(o).then(
                r => ({ termino: true, capas: r.info.capas, lineas: r.gcode.split('\n').length }),
                e => ({ termino: true, error: e.message }),
            ),
        { caso: 'cubo', stlBase64: stl.toString('base64'), soportes: true, limite: 250000 },
    );
    const plazo = new Promise(r => setTimeout(() => r({ termino: false }), plazoS * 1000));
    const res = await Promise.race([corrida, plazo]);
    clearInterval(vigilar);
    res.segundos = (Date.now() - inicio) / 1000;
    res.avisos = avisos;
    if (!res.termino) {
        // El worker colgado sigue vivo: se recarga la página para soltarlo y dejarla usable.
        const url = pagina.url();
        await pagina.goto(url);
        await pagina.waitForFunction(() => window.probar);
    }
    return res;
}

// Barra de la UI (src/ui/paso3-laminar.js) donde quedó el último aviso.
const TRAMOS = {
    leyendo: [0, 2],
    reduciendo: [2, 10],
    laminando: [10, 60],
    preparando: [60, 92],
    exportando: [92, 100],
};
const barra = a => (a ? Math.round(TRAMOS[a[1]][0] + (TRAMOS[a[1]][1] - TRAMOS[a[1]][0]) * Math.min(1, a[2])) : 0);

async function probarCaso({ pagina, revisar }, nombre, stl, plazoS) {
    const r = await laminarVigilado(pagina, stl, plazoS);
    const ultimo = r.avisos.at(-1);
    const donde = `último aviso ${ultimo ? `${ultimo[1]} ${ultimo[2].toFixed(3)} = barra ${barra(ultimo)} % a los ${ultimo[0].toFixed(1)} s` : 'ninguno'}`;
    revisar(
        `${nombre}: con soportes el laminado termina o falla con un error en ${plazoS} s (nunca queda en silencio)`,
        r.termino,
        r.termino
            ? `(${r.error ? 'error: ' + r.error : 'terminó'} en ${r.segundos.toFixed(1)} s)`
            : `(${donde}; sin respuesta ni error)`,
    );
    const lam = r.avisos; // de cualquier etapa: la barra no puede quedar quieta más de N s
    const finLam = r.termino ? r.segundos : plazoS;
    let hueco = 0;
    let desde = null;
    for (let i = 0; i <= lam.length; i++) {
        const t0 = i ? lam[i - 1][0] : 0;
        const t1 = i < lam.length ? lam[i][0] : finLam;
        if (lam.length && t1 - t0 > hueco) {
            hueco = t1 - t0;
            desde = i ? lam[i - 1] : null;
        }
    }
    revisar(
        `${nombre}: la barra de progreso avanza al menos cada ${MAX_SIN_AVISO_S} s`,
        lam.length > 0 && hueco <= MAX_SIN_AVISO_S,
        `(mayor silencio ${hueco.toFixed(1)} s${desde ? ` tras ${desde[1]} ${desde[2].toFixed(3)} = barra ${barra(desde)} %` : ''})`,
    );
    revisar(
        `${nombre}: si termina, el G-code tiene capas`,
        !r.termino || !!r.error || r.capas > 0,
        `(${r.capas ?? '-'} capas)`,
    );
}

export async function probarSoportesProgreso(ctx) {
    await probarCaso(ctx, 'placa de 36 islotes (2,2 mm de alto)', placaDeIslotes(), PLAZOS_S.islotes);
    await probarCaso(ctx, 'esfera rugosa pesada (~40 mil triángulos)', esferaRugosa(), PLAZOS_S.rugosa);
}

// Solo: levanta la app construida (dist/), abre Chromium y corre la prueba.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const { chromium } = await import('playwright-core');
    const { preview } = await import('vite');
    const { buscarChromium } = await import('../lib/chromium.mjs');
    const servidor = await preview({ preview: { port: 4174 } });
    const navegador = await chromium.launch({ executablePath: buscarChromium() });
    const pagina = await navegador.newPage();
    await pagina.goto(servidor.resolvedUrls.local[0] + 'prueba-motor.html');
    await pagina.waitForFunction(() => window.probar);
    let fallas = 0;
    const revisar = (nombre, ok, detalle = '') => {
        console.log(`${ok ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
        if (!ok) fallas++;
    };
    try {
        await probarSoportesProgreso({ pagina, revisar });
    } finally {
        await navegador.close();
        await servidor.httpServer.close();
    }
    console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
    process.exit(fallas ? 1 : 0);
}
