// Huecos de prueba del motor (deuda de pruebas): cama centrada con varias piezas, y progreso y cancelación del
// laminado con más de un widget. Lo llama scripts/probar-motor.mjs dentro de su `try`.

const IMPRESORA_CENTRADA = 'kiri-atom-v2'; // originCenter: true, cama de 210 × 210 mm
const COPIAS = [
    { x: -30, y: 20 },
    { x: 40, y: -15 },
    { x: 0, y: -50 },
];

// Extrusiones { x, y } de la capa de Kiri `;LAYER:n`, tal cual salen en el G-code.
function puntosDeCapa(lineas, n) {
    const salida = [];
    let dentro = false;
    let x = 0;
    let y = 0;
    for (const l of lineas) {
        const capa = l.match(/^;LAYER:(\d+)/);
        if (capa) dentro = +capa[1] === n;
        if (!/^G[01] /.test(l)) continue;
        x = +(l.match(/ X(-?[\d.]+)/)?.[1] ?? x);
        y = +(l.match(/ Y(-?[\d.]+)/)?.[1] ?? y);
        if (dentro && /^G1 .*[XY].* E\d/.test(l)) salida.push({ x, y });
    }
    return salida;
}

const rango = valores => [Math.min(...valores), Math.max(...valores)];

// Caso (b): 2 cubos en una impresora con el origen en el centro de la cama: sus coordenadas son las de `pos`,
// sin sumarles la mitad de la cama.
async function probarCamaCentrada({ laminar, revisar, pagina }) {
    const d = await pagina.evaluate(id => window.buscarImpresora(id).dispositivo, IMPRESORA_CENTRADA);
    revisar('la impresora de prueba tiene originCenter', d.originCenter === true, `(${IMPRESORA_CENTRADA})`);
    const copias = COPIAS.slice(0, 2);
    const r = await laminar({
        impresoraId: IMPRESORA_CENTRADA,
        piezas: [{ caso: 'cubo', posiciones: copias }],
        personal: { adhesion: 'nada' },
    });
    const puntos = puntosDeCapa(r.g.lineas, 2);
    const dist = (p, c) => Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y));
    const grupos = copias.map(c => puntos.filter(p => dist(p, c) < 15));
    revisar(
        'cama centrada: la capa 2 es de 2 grupos, uno por copia',
        grupos[0].length + grupos[1].length === puntos.length,
    );
    const medidas = grupos.map((g, i) => {
        const [x0, x1] = rango(g.map(p => p.x));
        const [y0, y1] = rango(g.map(p => p.y));
        return { x0, x1, y0, y1, c: copias[i] };
    });
    const dentro = medidas.every(
        ({ x0, x1, y0, y1, c }) => x0 >= c.x - 10.5 && x1 <= c.x + 10.5 && y0 >= c.y - 10.5 && y1 <= c.y + 10.5,
    );
    const llena = medidas.every(({ x0, x1, y0, y1 }) => x1 - x0 > 15 && y1 - y0 > 15);
    const texto = medidas.map(m => `X ${m.x0}..${m.x1} Y ${m.y0}..${m.y1} (pos ${m.c.x}, ${m.c.y})`).join(' | ');
    revisar('cama centrada: el bbox de cada copia queda en pos ± 10,5 respecto del centro (0, 0)', dentro, texto);
    revisar('cama centrada: cada copia ocupa su cubo (más de 15 mm por lado)', llena);
}

// Caso (c), progreso: 3 copias = 3 widgets en un worker; el avance de "laminando" es (k + update) / 3.
async function probarProgreso({ laminar, revisar, pagina }) {
    await laminar({ piezas: [{ caso: 'cubo', posiciones: COPIAS }], personal: { adhesion: 'nada' } });
    const avisos = await pagina.evaluate(() => window.progreso);
    const lam = avisos.filter(([etapa]) => etapa === 'laminando').map(([, v]) => v);
    const crece = lam.every((v, i) => i === 0 || v >= lam[i - 1]) && lam.at(-1) > lam[0];
    const resumen = `(${lam.length} avisos: ${lam[0].toFixed(3)} … ${lam.at(-1)})`;
    revisar('3 copias: el progreso de "laminando" crece sin bajar', lam.length >= 3 && crece, resumen);
    // Reproduce un bug de src/motor/laminador.worker.js (laminarWidgets): "laminando" no llega a 1 porque el último
    // tramo del último widget no se avisa. Esta prueba falla hasta que se arregle (hoy el máximo es < 1).
    const fin = avisos.at(-1);
    revisar(
        '3 copias: el último aviso de "laminando" es exactamente 1 y ninguno pasa de 1',
        lam.at(-1) === 1 && Math.max(...lam) === 1,
        `(último ${lam.at(-1)}, máx ${Math.max(...lam)}; último aviso de todos ${JSON.stringify(fin)})`,
    );
    const terceros = [0, 1, 2].map(k => lam.some(v => v > k / 3 && v <= (k + 1) / 3));
    revisar('3 copias: hay avisos en cada tercio (un widget cada uno)', terceros.every(Boolean), `(${terceros})`);
    const todos = avisos.map(a => a[1]);
    revisar(
        '3 copias: ningún progreso (de ninguna etapa) sale de 0..1',
        todos.every(v => v >= 0 && v <= 1),
    );
}

// Envuelve `Worker` en la página para contar los creados y los vivos (terminate = muerto).
const contarWorkers = pagina =>
    pagina.evaluate(() => {
        const Original = window.Worker;
        window.__workers = { creados: 0, vivos: 0, Original };
        window.Worker = class extends Original {
            constructor(...args) {
                super(...args);
                window.__workers.creados++;
                window.__workers.vivos++;
                const terminar = this.terminate.bind(this);
                let ya = false;
                this.terminate = () => {
                    if (!ya) window.__workers.vivos--;
                    ya = true;
                    terminar();
                };
            }
        };
    });

// Caso (c), cancelación: se cuentan los workers vivos.
async function probarCancelar({ revisar, pagina }) {
    await contarWorkers(pagina);
    const opciones = {
        piezas: [{ caso: 'cubo', posiciones: COPIAS }],
        personal: { adhesion: 'nada' },
        cancelarEn: 0.5,
    };
    const r = await pagina.evaluate(async o => {
        try {
            await window.probar(o);
            return { error: 'laminó igual' };
        } catch (err) {
            return { error: err.name, ultimo: window.progreso.at(-1) };
        }
    }, opciones);
    const w = await pagina.evaluate(() => {
        const { creados, vivos, Original } = window.__workers;
        window.Worker = Original;
        return { creados, vivos };
    });
    revisar('cancelar a mitad del laminado de 3 copias da AbortError', r.error === 'AbortError', `(${r.error})`);
    const ultimo = r.ultimo ?? [];
    revisar(
        'se canceló a mitad: el último aviso es "laminando" entre 0,5 y 1',
        ultimo[0] === 'laminando' && ultimo[1] >= 0.5 && ultimo[1] < 1,
        JSON.stringify(ultimo),
    );
    revisar(
        'cancelar no deja un worker vivo',
        w.creados === 1 && w.vivos === 0,
        `(creados ${w.creados}, vivos ${w.vivos})`,
    );
}

/**
 * Cama centrada (2 cubos con `originCenter`), y progreso y cancelación con 3 copias.
 * @param {{ laminar: Function, revisar: Function, pagina: object }} ctx
 * @returns {Promise<void>}
 */
export async function probarPiezasExtra(ctx) {
    console.log('\n▶ Varias piezas: cama centrada, progreso y cancelación');
    await probarCamaCentrada(ctx);
    await probarProgreso(ctx);
    await probarCancelar(ctx);
}
