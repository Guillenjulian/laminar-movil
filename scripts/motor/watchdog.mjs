// Pruebas en Node (sin navegador) de lo que evita que un laminado trabado quede en silencio:
//   - el watchdog de motor.laminar: un Worker falso que nunca contesta (o contesta y se calla) se cancela con un error;
//   - la cola que cede el hilo (cola-cediendo.js) para que el progreso de las sombras salga mientras se calcula.
import { crearColaCediendo } from '../../src/motor/cola-cediendo.js';

const TEXTO = 'El laminado se trabó y lo cancelamos';

// Worker que no responde a nada, o que manda los mensajes de `guion` (con su demora en ms) y se calla.
class WorkerFalso {
    static creados = [];
    static guion = [];
    terminado = false;
    constructor() {
        WorkerFalso.creados.push(this);
    }
    postMessage() {
        for (const [demora, data] of WorkerFalso.guion) {
            const entregar = () =>
                data.tipo === 'EXPLOTA' ? this.onerror({ message: 'boom' }) : this.onmessage({ data });
            setTimeout(() => !this.terminado && entregar(), demora);
        }
    }
    terminate() {
        this.terminado = true;
    }
}

const pedido = extra => ({ stl: new ArrayBuffer(8), dispositivo: {}, proceso: {}, ...extra });
// Espera la promesa (máx. 3 s: si el watchdog no actúa, la prueba falla en vez de colgarse).
const resultado = promesa =>
    Promise.race([
        promesa.then(
            () => 'resolvió',
            e => e,
        ),
        new Promise(r => setTimeout(() => r('sin respuesta en 3 s'), 3000)),
    ]);

export async function probarWatchdog(ctx) {
    console.log('\nWatchdog del laminado y cola que cede el hilo (Node)');
    await probarPlazo(ctx);
    await probarCola(ctx);
}

async function probarPlazo(ctx) {
    const WorkerOriginal = globalThis.Worker;
    globalThis.Worker = WorkerFalso;
    try {
        const { laminar } = await import('../../src/motor/motor.js');
        await probarTrabado(ctx, laminar);
        await probarConAvisos(ctx, laminar);
        await probarLimpieza(ctx, laminar);
    } finally {
        globalThis.Worker = WorkerOriginal;
    }
}

async function probarTrabado({ revisar }, laminar) {
    WorkerFalso.creados.length = 0;
    WorkerFalso.guion = [];
    const t0 = Date.now();
    const r = await resultado(laminar(pedido({ plazoSinNoticiasMs: 150 })));
    revisar(
        'worker que nunca contesta: se rechaza con el aviso en castellano',
        r instanceof Error && r.message.startsWith(TEXTO),
        String(r?.message ?? r),
    );
    revisar(
        'rechaza recién al vencer el plazo, no antes',
        Date.now() - t0 >= 140 && Date.now() - t0 < 1000,
        `${Date.now() - t0} ms`,
    );
    revisar('mata al worker trabado', WorkerFalso.creados[0].terminado);
}

async function probarConAvisos({ revisar }, laminar) {
    // Contesta con progreso y se calla: el plazo corre desde el último mensaje.
    WorkerFalso.creados.length = 0;
    const avances = [];
    WorkerFalso.guion = [
        [60, { tipo: 'progreso', etapa: 'laminando', valor: 0.1 }],
        [120, { tipo: 'progreso', etapa: 'laminando', valor: 0.2 }],
        [180, { tipo: 'progreso', etapa: 'laminando', valor: 0.3 }],
    ];
    const t0 = Date.now();
    let r = await resultado(laminar(pedido({ plazoSinNoticiasMs: 100, alProgresar: (e, v) => avances.push(v) })));
    revisar(
        'cada aviso reinicia el plazo: se cancela 100 ms después del último',
        r instanceof Error && avances.length === 3 && Date.now() - t0 >= 270,
        `${avances.length} avisos, ${Date.now() - t0} ms`,
    );

    // Un worker lento pero que avisa y termina no se cancela.
    WorkerFalso.creados.length = 0;
    WorkerFalso.guion = [
        [60, { tipo: 'progreso', etapa: 'laminando', valor: 0.5 }],
        [120, { tipo: 'listo', gcode: 'G1', info: {} }],
    ];
    r = await resultado(laminar(pedido({ plazoSinNoticiasMs: 100 })));
    revisar('un laminado que avisa a tiempo termina bien', r === 'resolvió', String(r?.message ?? r));

    // Un error del worker sigue llegando tal cual.
    WorkerFalso.creados.length = 0;
    WorkerFalso.guion = [[10, { tipo: 'error', mensaje: 'malla rota' }]];
    r = await resultado(laminar(pedido({ plazoSinNoticiasMs: 100 })));
    revisar('el error del worker pasa tal cual', r instanceof Error && r.message === 'malla rota');
}

// Cuenta los temporizadores del watchdog (los de 60 s) que siguen vivos: tras cualquier final no debe quedar ninguno.
async function probarLimpieza({ revisar }, laminar) {
    const PLAZO = 60_000;
    const vivos = new Set();
    const { setTimeout: poner, clearTimeout: sacar } = globalThis;
    globalThis.setTimeout = (fn, ms, ...resto) => {
        const id = poner(fn, ms, ...resto);
        if (ms === PLAZO) vivos.add(id);
        return id;
    };
    globalThis.clearTimeout = id => (vivos.delete(id), sacar(id));
    const casos = {
        listo: [[10, { tipo: 'listo', gcode: 'G1', info: {} }]],
        error: [[10, { tipo: 'error', mensaje: 'malla rota' }]],
        'el worker se cae (onerror)': [[10, { tipo: 'EXPLOTA' }]],
        'se cancela (abort)': [[10, { tipo: 'progreso', etapa: 'laminando', valor: 0.1 }]],
    };
    try {
        for (const [nombre, guion] of Object.entries(casos)) {
            WorkerFalso.creados.length = 0;
            WorkerFalso.guion = guion;
            const control = new AbortController();
            if (nombre.startsWith('se cancela')) setTimeout(() => control.abort(), 30);
            const r = await resultado(laminar(pedido({ plazoSinNoticiasMs: PLAZO, signal: control.signal })));
            revisar(
                `sin temporizador vivo tras: ${nombre}`,
                vivos.size === 0 && WorkerFalso.creados[0].terminado,
                `${vivos.size} vivos; ${r?.name ?? r}`,
            );
        }
        await probarYaAbortado({ revisar }, laminar, vivos, PLAZO);
    } finally {
        globalThis.setTimeout = poner;
        globalThis.clearTimeout = sacar;
    }
}

async function probarYaAbortado({ revisar }, laminar, vivos, PLAZO) {
    // Ya cancelado de antemano: AbortError al instante y ni se crea el worker.
    WorkerFalso.creados.length = 0;
    const abortado = new AbortController();
    abortado.abort();
    const r = await resultado(laminar(pedido({ plazoSinNoticiasMs: PLAZO, signal: abortado.signal })));
    revisar(
        'con el signal ya abortado rechaza con AbortError sin crear el worker',
        r?.name === 'AbortError' && WorkerFalso.creados.length === 0 && vivos.size === 0,
        String(r?.name ?? r),
    );
}

async function probarCola({ revisar }) {
    // Cola que cede el hilo: un temporizador pedido antes de encolar tiene que correr antes de la primera tarea.
    const orden = [];
    setTimeout(() => orden.push('temporizador'), 0);
    const encolar = crearColaCediendo(100);
    const tareas = [1, 2, 3].map(n => encolar(() => orden.push(`tarea ${n}`)));
    await Promise.all(tareas);
    revisar(
        'la cola cede el hilo antes de calcular (el progreso puede salir) y respeta el orden',
        orden.join() === 'temporizador,tarea 1,tarea 2,tarea 3',
        orden.join(),
    );
    let reloj = 0;
    const encolar2 = crearColaCediendo(100, () => reloj);
    const marcas = [];
    setTimeout(() => marcas.push('t'), 0);
    await encolar2(() => marcas.push('a'));
    reloj = 50;
    const p = encolar2(() => marcas.push('b')); // menos de 100 ms desde la última cesión: no cede
    setTimeout(() => marcas.push('t2'), 0);
    await p;
    reloj = 200;
    const q = encolar2(() => marcas.push('c')); // pasaron 100 ms: cede
    setTimeout(() => marcas.push('t3'), 0);
    await q;
    revisar('cede por tiempo, no en cada tarea', marcas.join() === 't,a,b,t2,t3,c', marcas.join());
    const fallida = encolar2(() => {
        throw new Error('x');
    });
    const siguiente = encolar2(() => 7);
    revisar(
        'una tarea que falla no frena a las siguientes',
        (await resultado(fallida)) instanceof Error && (await siguiente) === 7,
    );
    await probarColaAsincrona({ revisar });
}

async function probarColaAsincrona({ revisar }) {
    // Tareas asíncronas de duraciones distintas: se corren de a una, en orden de llegada, sin superponerse.
    const eventos = [];
    const tarea = (n, ms) => async () => {
        eventos.push(`ini ${n}`);
        await new Promise(r => setTimeout(r, ms));
        eventos.push(`fin ${n}`);
        return n;
    };
    const cola3 = crearColaCediendo(100);
    const res = await Promise.all([cola3(tarea(1, 40)), cola3(tarea(2, 5)), cola3(tarea(3, 20))]);
    revisar(
        'tareas asíncronas de distinta duración: una por vez y en orden',
        eventos.join() === 'ini 1,fin 1,ini 2,fin 2,ini 3,fin 3' && res.join() === '1,2,3',
        eventos.join(),
    );
}
