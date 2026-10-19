// Pruebas de src/red/transporte.js (ADR 0007, 6.5 con la decisión 5 del CTO): `crearTransporte({ fetch })` con un
// fetch falso (no XHR) y `sondaSinCors(url, fetchFn)`. Sin porcentaje de subida.
// Lectura del contrato: la dependencia inyectable se llama `fetch` (`crearTransporte({ fetch: fetchFalso })`).
import { CASOS_LOCAL, CENTINELA, conLimite, espiarConsola, intentar } from './lib/impresora-falsa.mjs';

/** fetch falso: guarda las llamadas; `como` decide la respuesta: {status,texto} | 'rechazar' | 'colgar' (hasta el abort). */
function fetchFalso(como) {
    const llamadas = [];
    const fn = (url, init = {}) => {
        llamadas.push({ url, init });
        if (como === 'rechazar') return Promise.reject(new TypeError('Failed to fetch'));
        if (como === 'colgar') {
            return new Promise((_, rechazar) => {
                const abortar = () => rechazar(init.signal.reason ?? new DOMException('Aborted', 'AbortError'));
                if (init.signal?.aborted) abortar();
                else init.signal?.addEventListener('abort', abortar);
            });
        }
        return Promise.resolve({ ok: como.status < 400, status: como.status, text: async () => como.texto });
    };
    return { fn, llamadas };
}

const pet = (extra = {}) => ({
    metodo: 'GET',
    url: 'http://192.168.1.50/api/version',
    headers: {},
    cuerpo: null,
    tiempoMs: 8000,
    ...extra,
});
const cabeceras = init =>
    Object.fromEntries([...new Headers(init.headers ?? {})].map(([k, v]) => [k.toLowerCase(), v]));
const tiene = init => 'targetAddressSpace' in init && init.targetAddressSpace !== undefined;

async function mapeo(T, revisar, igual) {
    console.log('\ncrearTransporte: arma el fetch y mapea la respuesta');
    const f = fetchFalso({ status: 201, texto: '{"done":true}' });
    const r = await intentar(() =>
        T.crearTransporte({ fetch: f.fn })(pet({ metodo: 'GET', headers: { 'X-Api-Key': CENTINELA } })),
    );
    const { url, init } = f.llamadas[0] ?? { init: {} };
    revisar(
        'responde { estado, texto } con el estado HTTP y el cuerpo',
        igual(r.valor, { estado: 201, texto: '{"done":true}' }),
        JSON.stringify(r.valor),
    );
    revisar('pide la url exacta con el método', url === 'http://192.168.1.50/api/version' && init.method === 'GET');
    revisar(
        'cabeceras exactas: sólo X-Api-Key',
        igual(cabeceras(init), { 'x-api-key': CENTINELA }),
        JSON.stringify(cabeceras(init)),
    );
    revisar('GET sin cuerpo', init.body == null);
    revisar('lleva una señal de aborto', init.signal instanceof AbortSignal);
    revisar(
        'no manda credenciales de cookies (credentials: omit)',
        init.credentials === 'omit',
        String(init.credentials),
    );

    const g = fetchFalso({ status: 409, texto: 'ocupada' });
    const e = await intentar(() => T.crearTransporte({ fetch: g.fn })(pet()));
    revisar(
        'un 4xx/5xx no rechaza: también es { estado, texto }',
        igual(e.valor, { estado: 409, texto: 'ocupada' }),
        JSON.stringify(e.valor),
    );

    await mapeoPost(T, revisar);
}

async function mapeoPost(T, revisar) {
    const h = fetchFalso({ status: 201, texto: '{}' });
    const cuerpo = new FormData();
    cuerpo.append('file', new Blob(['G28']), 'a.gcode');
    await intentar(() =>
        T.crearTransporte({ fetch: h.fn })(pet({ metodo: 'POST', url: 'http://192.168.1.50/api/files/local', cuerpo })),
    );
    const post = h.llamadas[0] ?? { init: {} };
    revisar('POST: el FormData va como body, tal cual', post.init.method === 'POST' && post.init.body === cuerpo);
    revisar(
        'POST: no inventa Content-Type (lo pone el navegador con el boundary)',
        !('content-type' in cabeceras(post.init)),
    );
}

async function espacioLocal(T, revisar) {
    console.log('\ncrearTransporte: targetAddressSpace solo en direcciones privadas o .local');
    const casos = CASOS_LOCAL;
    for (const [url, local] of casos) {
        const f = fetchFalso({ status: 200, texto: '{}' });
        await intentar(() => T.crearTransporte({ fetch: f.fn })(pet({ url })));
        const init = f.llamadas[0]?.init ?? {};
        const bien = local ? init.targetAddressSpace === 'local' : !tiene(init);
        revisar(
            `${url} → ${local ? "targetAddressSpace: 'local'" : 'sin targetAddressSpace'}`,
            bien,
            JSON.stringify(init.targetAddressSpace),
        );
    }
}

async function errores(T, revisar) {
    console.log('\ncrearTransporte: errores');
    const red = fetchFalso('rechazar');
    const r = await intentar(() => T.crearTransporte({ fetch: red.fn })(pet({ headers: { 'X-Api-Key': CENTINELA } })));
    revisar(
        'fetch rechaza → ErrorTransporte causa red',
        r.lanzo && r.error.name === 'ErrorTransporte' && r.error.causa === 'red',
        String(r.error?.name) + String(r.error?.causa),
    );
    revisar(
        'el error no lleva la clave',
        !String(r.error?.message).includes(CENTINELA) && !String(r.error?.stack).includes(CENTINELA),
    );

    const lento = fetchFalso('colgar');
    const t0 = Date.now();
    const tiempo = await intentar(() => T.crearTransporte({ fetch: lento.fn })(pet({ tiempoMs: 40 })), 2000);
    revisar(
        'pasado tiempoMs → ErrorTransporte causa tiempo',
        tiempo.lanzo && tiempo.error.name === 'ErrorTransporte' && tiempo.error.causa === 'tiempo',
        String(tiempo.error?.causa),
    );
    revisar('y corta cerca del tope, no antes ni mucho después', Date.now() - t0 < 1500);
    revisar('la señal que le pasó al fetch quedó abortada', lento.llamadas[0]?.init.signal?.aborted === true);

    await cancelacion(T, revisar);
}

async function cancelacion(T, revisar) {
    const f = fetchFalso('colgar');
    const control = new AbortController();
    const promesa = intentar(() =>
        T.crearTransporte({ fetch: f.fn })(pet({ tiempoMs: 5000 }), { senal: control.signal }),
    );
    await new Promise(resolver => setTimeout(resolver, 20));
    control.abort();
    const c = await promesa;
    revisar(
        'senal.abort() → ErrorTransporte causa cancelado',
        c.lanzo && c.error.name === 'ErrorTransporte' && c.error.causa === 'cancelado',
        String(c.error?.causa),
    );
    revisar('el abort llegó al fetch', f.llamadas[0]?.init.signal?.aborted === true);

    const previa = new AbortController();
    previa.abort();
    const p = fetchFalso('colgar');
    const antes = await intentar(() =>
        T.crearTransporte({ fetch: p.fn })(pet({ tiempoMs: 5000 }), { senal: previa.signal }),
    );
    revisar(
        'una señal ya abortada → cancelado sin esperar',
        antes.lanzo && antes.error.causa === 'cancelado',
        String(antes.error?.causa),
    );
}

async function sinProgreso(T, revisar) {
    console.log('\ncrearTransporte: sin porcentaje y sin logs');
    const espia = espiarConsola();
    const f = fetchFalso({ status: 201, texto: '{}' });
    let avisos = 0;
    await intentar(() => T.crearTransporte({ fetch: f.fn })(pet({ metodo: 'POST' }), { alProgreso: () => avisos++ }));
    await intentar(() =>
        T.crearTransporte({ fetch: fetchFalso('rechazar').fn })(pet({ headers: { 'X-Api-Key': CENTINELA } })),
    );
    const llamadas = espia.restaurar();
    revisar('no llama a alProgreso (fetch no da porcentaje de subida)', avisos === 0, String(avisos));
    revisar('no escribe en console', llamadas.length === 0, JSON.stringify(llamadas).slice(0, 200));
}

async function sonda(T, revisar) {
    console.log('\nsondaSinCors');
    const vista = [];
    const original = AbortSignal.timeout;
    AbortSignal.timeout = ms => {
        vista.push(ms);
        return original.call(AbortSignal, ms);
    };
    const ok = fetchFalso({ status: 0, texto: '' });
    let r1;
    try {
        r1 = await conLimite(T.sondaSinCors('http://192.168.1.50', ok.fn));
    } finally {
        AbortSignal.timeout = original;
    }
    const init = ok.llamadas[0]?.init ?? {};
    revisar('si el fetch resuelve (respuesta opaca) → true', r1 === true, String(r1));
    revisar('pide la url que le pasaron', ok.llamadas[0]?.url === 'http://192.168.1.50');
    revisar(
        "mode 'no-cors' y cache 'no-store'",
        init.mode === 'no-cors' && init.cache === 'no-store',
        JSON.stringify([init.mode, init.cache]),
    );
    revisar('ninguna cabecera ni cuerpo', Object.keys(cabeceras(init)).length === 0 && init.body == null);
    revisar(
        'con señal de tope de 4000 ms (AbortSignal.timeout)',
        init.signal instanceof AbortSignal && vista.includes(4000),
        JSON.stringify(vista),
    );
    await sondaFallida(T, revisar);
    await sondaLocal(T, revisar);
}

async function sondaLocal(T, revisar) {
    console.log('\nsondaSinCors: targetAddressSpace como el transporte');
    const casos = [
        ['http://192.168.1.50', true],
        ['http://octopi.local:5000', true],
        ['https://impresora.tail1234.ts.net', false],
        ['http://8.8.8.8', false],
    ];
    for (const [url, local] of casos) {
        const f = fetchFalso({ status: 0, texto: '' });
        await intentar(() => T.sondaSinCors(url, f.fn));
        const init = f.llamadas[0]?.init ?? {};
        revisar(
            `${url} → ${local ? "targetAddressSpace: 'local'" : 'sin targetAddressSpace'}`,
            local ? init.targetAddressSpace === 'local' : !tiene(init),
            JSON.stringify(init.targetAddressSpace),
        );
    }
}

/** Espía setTimeout/clearTimeout sólo para el tope pedido (`ms`); devuelve cuántos armó y cuántos quedaron sin limpiar. */
function espiarTimers(ms) {
    const { setTimeout: st, clearTimeout: ct } = globalThis;
    const armados = new Set();
    const limpios = new Set();
    globalThis.setTimeout = (fn, t, ...resto) => {
        const id = st(fn, t, ...resto);
        if (t === ms) armados.add(id);
        return id;
    };
    globalThis.clearTimeout = id => {
        limpios.add(id);
        return ct(id);
    };
    return {
        restaurar() {
            globalThis.setTimeout = st;
            globalThis.clearTimeout = ct;
            return { armados: armados.size, pendientes: [...armados].filter(id => !limpios.has(id)).length };
        },
    };
}

/** Señal falsa que cuenta add/removeEventListener (no aborta nunca). */
function senalContada() {
    const c = { altas: 0, bajas: 0, aborted: false };
    c.addEventListener = () => c.altas++;
    c.removeEventListener = () => c.bajas++;
    return c;
}

async function limpieza(T, revisar) {
    console.log('\ncrearTransporte: limpia siempre el timer y el listener de la señal');
    const casos = [
        ['éxito', { status: 200, texto: '{}' }],
        ['fallo de red', 'rechazar'],
    ];
    for (const [nombre, como] of casos) {
        const espia = espiarTimers(7777);
        const senal = senalContada();
        const f = fetchFalso(como);
        await intentar(() => T.crearTransporte({ fetch: f.fn })(pet({ tiempoMs: 7777 }), { senal }));
        const t = espia.restaurar();
        revisar(`${nombre}: arma un timer y lo limpia`, t.armados === 1 && t.pendientes === 0, JSON.stringify(t));
        revisar(
            `${nombre}: saca el listener que puso en la señal`,
            senal.altas === 1 && senal.bajas === 1,
            JSON.stringify(senal),
        );
    }
    const espia = espiarTimers(40);
    await intentar(() => T.crearTransporte({ fetch: fetchFalso('colgar').fn })(pet({ tiempoMs: 40 })), 2000);
    const t = espia.restaurar();
    revisar('tiempo agotado: no deja timers pendientes', t.armados === 1 && t.pendientes === 0, JSON.stringify(t));
}

async function sondaFallida(T, revisar) {
    const mal = fetchFalso('rechazar');
    revisar(
        'si el fetch rechaza → false, sin lanzar',
        (await intentar(() => T.sondaSinCors('http://192.168.1.50', mal.fn))).valor === false,
    );
    const colgada = fetchFalso('colgar');
    const abortada = AbortSignal.abort();
    const origTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => abortada;
    const r3 = await intentar(() => T.sondaSinCors('http://192.168.1.50', colgada.fn));
    AbortSignal.timeout = origTimeout;
    revisar('si se pasa el tope (señal abortada) → false', r3.valor === false, JSON.stringify(r3));
}

export default async function ({ revisar, igual, cargar }) {
    const T = await cargar('transporte');
    if (!T) return;
    await mapeo(T, revisar, igual);
    await espacioLocal(T, revisar);
    await errores(T, revisar);
    await limpieza(T, revisar);
    await sinProgreso(T, revisar);
    await sonda(T, revisar);
}
