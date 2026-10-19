// Pruebas de src/red/cliente.js (ADR 0007, 6.4) contra la impresora falsa de scripts/red/lib: probarConexion y
// enviarGcode, para OctoPrint y Moonraker. Nunca lanza, nunca reintenta solo, nunca deja ver la clave.
import {
    COLGADO,
    CENTINELA,
    ORIGEN_APP,
    GCODE,
    armar,
    cfg,
    enviar,
    espiarConsola,
    intentar,
    probar,
    transporteQueRompe,
} from './lib/impresora-falsa.mjs';

const TIPOS = ['octoprint', 'moonraker'];
const codigo = r => r.valor?.error?.codigo;

async function pruebaFeliz(c, revisar) {
    for (const tipo of TIPOS) {
        console.log(`\nprobarConexion (${tipo}): éxito`);
        const r = await probar(c, tipo, { clave: CENTINELA, config: { claveApi: CENTINELA } });
        revisar(
            'resuelve ok con nombre y ocupada=false',
            r.valor?.ok === true &&
                typeof r.valor.resumen?.nombre === 'string' &&
                r.valor.resumen.nombre.length > 0 &&
                r.valor.resumen.ocupada === false,
            JSON.stringify(r.valor),
        );
        revisar(
            'hace dos pedidos en orden: versión y luego estado',
            r.f.pedidos.map(p => p.fase).join() === 'version,estado',
            r.f.pedidos.map(p => p.fase).join(),
        );
        revisar(
            'los dos llevan X-Api-Key',
            r.f.pedidos.every(p => p.headers['X-Api-Key'] === CENTINELA),
        );
        revisar('no usa la sonda si hubo respuesta', r.f.sondeadas.length === 0);
        const sinClave = await probar(c, tipo, {});
        revisar(
            'sin clave configurada no manda X-Api-Key',
            sinClave.valor?.ok === true && sinClave.f.pedidos.every(p => !('X-Api-Key' in p.headers)),
        );
    }
}

async function pruebaOcupada(c, revisar) {
    for (const tipo of TIPOS) {
        console.log(`\nimpresora ocupada (${tipo})`);
        const r = await probar(c, tipo, { ocupada: true });
        revisar(
            'probarConexion: ok con ocupada=true (no es un error)',
            r.valor?.ok === true && r.valor.resumen.ocupada === true,
            JSON.stringify(r.valor),
        );
        const e = await enviar(c, tipo, { ocupada: true, config: { imprimir: true } });
        revisar(
            'enviar con imprimir: código ocupada (409)',
            codigo(e) === 'ocupada' && e.valor.error.estadoHttp === 409,
            JSON.stringify(e.valor),
        );
        revisar('y no reintenta: un solo POST', e.f.pedidos.filter(p => p.metodo === 'POST').length === 1);
        const solo = await enviar(c, tipo, { ocupada: true });
        revisar(
            'enviar sin imprimir con la impresora ocupada sube igual',
            solo.valor?.ok === true && solo.valor.imprimiendo === false,
            JSON.stringify(solo.valor),
        );
    }
}

async function pruebaErrores(c, revisar) {
    console.log('\nprobarConexion: errores');
    for (const tipo of TIPOS) {
        const mala = await probar(c, tipo, { clave: 'la-buena', config: { claveApi: 'la-mala' } });
        revisar(
            `${tipo}: clave mala → clave, y no pide el estado`,
            codigo(mala) === 'clave' && mala.f.pedidos.length === 1,
            JSON.stringify(mala.valor),
        );
        const falta = await probar(c, tipo, { clave: 'la-buena' });
        revisar(`${tipo}: sin clave donde se pide → clave`, codigo(falta) === 'clave');
        revisar(`${tipo}: 404 en todo → respuesta`, codigo(await probar(c, tipo, { modo: '404' })) === 'respuesta');
        const ajena = await probar(c, tipo, { modo: 'ajena' });
        revisar(
            `${tipo}: 200 con HTML → respuesta, sin colgarse`,
            ajena.valor !== COLGADO && codigo(ajena) === 'respuesta',
            JSON.stringify(ajena.valor),
        );
        const rota = await probar(c, tipo, { modo: 'json-roto' });
        revisar(
            `${tipo}: 200 con JSON roto → respuesta, sin colgarse`,
            rota.valor !== COLGADO && codigo(rota) === 'respuesta',
            JSON.stringify(rota.valor),
        );
        revisar(`${tipo}: tiempo → tiempo`, codigo(await probar(c, tipo, { modo: 'tiempo' })) === 'tiempo');
    }
}

async function pruebaSonda(c, revisar) {
    for (const tipo of TIPOS) {
        console.log(`\nsin red contra CORS (${tipo})`);
        const sin = await probar(c, tipo, { modo: 'sin-red' });
        revisar('red caída y sonda false → sin-llegada', codigo(sin) === 'sin-llegada', JSON.stringify(sin.valor));
        const cors = await probar(c, tipo, { modo: 'cors' });
        const e = cors.valor?.error;
        revisar(
            'red caída y sonda true → bloqueado, con el origen de la app',
            e?.codigo === 'bloqueado' && `${e.mensaje} ${e.pista}`.includes(ORIGEN_APP),
            JSON.stringify(e),
        );
        revisar(
            'probar no agrega la advertencia de "puede que haya llegado"',
            !/haya llegado/.test(`${e?.mensaje} ${e?.pista}`),
        );
        revisar(
            'sondea la dirección de la impresora, una sola vez',
            cors.f.sondeadas.length === 1 && new URL(cors.f.sondeadas[0]).origin === 'http://192.168.1.50',
            cors.f.sondeadas.join(),
        );
        const tiempo = await probar(c, tipo, { modo: 'tiempo' });
        revisar('el tiempo no consulta la sonda', tiempo.f.sondeadas.length === 0);
        revisar(
            'en un fallo de red no hace más de un pedido (no reintenta)',
            sin.f.pedidos.length === 1,
            String(sin.f.pedidos.length),
        );
    }
}

async function pruebaEnvio(c, revisar, igual) {
    for (const tipo of TIPOS) {
        console.log(`\nenviarGcode (${tipo}): éxito`);
        const r = await enviar(c, tipo, { clave: CENTINELA, config: { claveApi: CENTINELA } });
        revisar(
            'ok, sin imprimir, con el nombre',
            igual(r.valor, { ok: true, imprimiendo: false, nombre: 'cubo-20mm.gcode' }),
            JSON.stringify(r.valor),
        );
        const s = r.f.subidas[0];
        revisar(
            'subió el archivo con su nombre y contenido',
            r.f.subidas.length === 1 && s.nombre === 'cubo-20mm.gcode' && s.contenido === GCODE,
        );
        revisar('sin imprimir no manda print ni select', s.partes.print === undefined && s.partes.select === undefined);
        revisar(
            'el POST lleva X-Api-Key',
            r.f.pedidos.at(-1).metodo === 'POST' && r.f.pedidos.at(-1).headers['X-Api-Key'] === CENTINELA,
        );
        const p = await enviar(c, tipo, { config: { imprimir: true } });
        revisar(
            'con imprimir: ok e imprimiendo=true',
            p.valor?.ok === true && p.valor.imprimiendo === true,
            JSON.stringify(p.valor),
        );
        revisar('con imprimir: print=true en el multipart', p.f.subidas[0].partes.print === 'true');
        const raro = await enviar(c, tipo, {}, 'a/b:c.gcode');
        revisar(
            'un nombre con caracteres prohibidos sube saneado (el nombre devuelto puede ser el pedido o el saneado)',
            raro.f.subidas[0].nombre === 'a_b_c.gcode' && typeof raro.valor?.nombre === 'string',
            JSON.stringify(raro.valor),
        );
    }
}

async function pruebaFallosDeEnvio(c, revisar) {
    for (const tipo of TIPOS) {
        console.log(`\nenviarGcode (${tipo}): errores y nunca reintenta`);
        const casos = [
            ['clave', { clave: 'la-buena' }, 'clave'],
            ['404', { modo: '404' }, 'respuesta'],
            ['rechazado 422', { respuestas: { subida: { estado: 422, texto: 'x' } } }, 'rechazado'],
            ['sin red', { modo: 'sin-red' }, 'sin-llegada'],
            ['CORS', { modo: 'cors' }, 'bloqueado'],
            ['tiempo', { modo: 'tiempo' }, 'tiempo'],
        ];
        for (const imprimir of [false, true]) {
            for (const [nombre, opciones, esperado] of casos) {
                const r = await enviar(c, tipo, { ...opciones, config: { imprimir } });
                const posts = r.f.pedidos.filter(p => p.metodo === 'POST').length;
                revisar(
                    `${nombre} (imprimir=${imprimir}) → ${esperado}, un solo POST`,
                    codigo(r) === esperado && posts === 1 && r.f.sondeadas.length <= 1,
                    `${JSON.stringify(r.valor)} posts=${posts}`,
                );
            }
        }
        const cors = await enviar(c, tipo, { modo: 'cors', config: { imprimir: true } });
        revisar(
            'CORS con imprimir: avisa que puede que el archivo haya llegado',
            /puede que el archivo haya llegado/.test(`${cors.valor?.error?.mensaje} ${cors.valor?.error?.pista}`),
        );
        const sinImp = await enviar(c, tipo, { modo: 'cors' });
        revisar(
            'CORS sin imprimir: sin esa advertencia',
            !/haya llegado/.test(`${sinImp.valor?.error?.mensaje} ${sinImp.valor?.error?.pista}`),
        );
        const ajena = await enviar(c, tipo, { modo: 'ajena' });
        revisar(
            '200 con HTML al subir no se cuelga',
            ajena.valor !== COLGADO && ajena.valor?.ok !== undefined,
            JSON.stringify(ajena.valor),
        );
    }
}

async function pruebaCancelar(c, revisar) {
    for (const tipo of TIPOS) {
        console.log(`\ncancelar a mitad del envío (${tipo})`);
        const { f, deps } = armar({ modo: 'colgada-subida' }, tipo);
        const control = new AbortController();
        const envio = intentar(
            () => c.enviarGcode(cfg(tipo), new Blob([GCODE]), 'a.gcode', deps, { senal: control.signal }),
            3000,
        );
        await Promise.race([f.enSubida, new Promise(r => setTimeout(r, 1000))]);
        control.abort();
        const r = await envio;
        revisar(
            'queda cancelado, sin colgarse ni lanzar',
            r.valor !== COLGADO && !r.lanzo && r.valor.ok === false && r.valor.error.codigo === 'cancelado',
            JSON.stringify(r.valor),
        );
        revisar(
            'cancelar no consulta la sonda ni reintenta',
            f.sondeadas.length === 0 && f.pedidos.filter(p => p.metodo === 'POST').length === 1,
        );
    }
}

async function pruebaNuncaLanza(c, revisar) {
    console.log('\nnunca lanza');
    const rompe = transporteQueRompe();
    for (const [nombre, fn] of [
        [
            'probarConexion con un transporte que rompe',
            () => c.probarConexion(cfg('octoprint', { claveApi: CENTINELA }), rompe),
        ],
        [
            'enviarGcode con un transporte que rompe',
            () => c.enviarGcode(cfg('moonraker', { claveApi: CENTINELA }), new Blob([GCODE]), 'a.gcode', rompe),
        ],
    ]) {
        const r = await intentar(fn);
        revisar(
            `${nombre}: resuelve ok:false con un error`,
            !r.lanzo && r.valor?.ok === false && typeof r.valor.error?.codigo === 'string',
            String(r.error?.message ?? JSON.stringify(r.valor)),
        );
        revisar(`${nombre}: no filtra el texto de la excepción`, !JSON.stringify(r.valor).includes(CENTINELA));
    }
}

async function pruebaSecreto(c, revisar) {
    console.log('\nR3: la clave centinela no aparece en console, resultados ni urls');
    const espia = espiarConsola();
    const resultados = [];
    const pedidos = [];
    const modos = [
        {},
        { ocupada: true },
        { modo: 'sin-red' },
        { modo: 'cors' },
        { modo: 'tiempo' },
        { modo: 'ajena' },
        { modo: '404' },
        { modo: 'json-roto' },
        { clave: 'otra' },
    ];
    for (const tipo of TIPOS) {
        for (const modo of modos) {
            for (const imprimir of [false, true]) {
                const opciones = { ...modo, clave: modo.clave ?? CENTINELA, config: { claveApi: CENTINELA, imprimir } };
                const p = await probar(c, tipo, opciones);
                const e = await enviar(c, tipo, opciones);
                resultados.push(p.valor, e.valor, p.error?.message, e.error?.message);
                pedidos.push(...p.f.pedidos, ...e.f.pedidos);
            }
        }
    }
    const llamadas = espia.restaurar();
    revisar('console.* no recibió nada', llamadas.length === 0, JSON.stringify(llamadas).slice(0, 200));
    revisar('ningún resultado ni mensaje contiene la clave', !JSON.stringify(resultados).includes(CENTINELA));
    revisar(
        'ninguna url contiene la clave',
        pedidos.every(p => !p.url.includes(CENTINELA) && !decodeURIComponent(p.url).includes(CENTINELA)),
    );
    revisar(
        'control: sí viaja en la cabecera X-Api-Key',
        pedidos.some(p => p.headers['X-Api-Key'] === CENTINELA),
    );
}

export default async function ({ revisar, igual, cargar }) {
    const c = await cargar('cliente');
    if (!c) return;
    await pruebaFeliz(c, revisar);
    await pruebaOcupada(c, revisar);
    await pruebaErrores(c, revisar);
    await pruebaSonda(c, revisar);
    await pruebaEnvio(c, revisar, igual);
    await pruebaFallosDeEnvio(c, revisar);
    await pruebaCancelar(c, revisar);
    await pruebaNuncaLanza(c, revisar);
    await pruebaSecreto(c, revisar);
}
