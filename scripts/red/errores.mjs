// Pruebas de src/red/errores.js (ADR 0007, 6.3 y tabla de la sección 4): cada código con su mensaje.
import { CENTINELA } from './lib/impresora-falsa.mjs';

const OCTO_V = '{"api":"0.1","server":"1.10.0","text":"OctoPrint 1.10.0"}';
const MOON_V = '{"result":{"klippy_state":"ready","klippy_connected":true,"moonraker_version":"v0.9.3"}}';
const OCTO_E = '{"state":"Operational","job":{},"progress":{}}';
const MOON_E = '{"result":{"status":{"print_stats":{"state":"standby"}}}}';
const forma = e =>
    e &&
    typeof e.codigo === 'string' &&
    typeof e.mensaje === 'string' &&
    e.mensaje.length > 0 &&
    typeof e.pista === 'string';

function exitos(m, revisar) {
    console.log('\nerrorDeRespuesta: éxito → null');
    const r = (estado, texto) => ({ estado, texto });
    revisar(
        'OctoPrint versión 200 válida',
        m.errorDeRespuesta('octoprint', 'version', r(200, OCTO_V), { tieneClave: true }) === null,
    );
    revisar(
        'OctoPrint estado 200 válido',
        m.errorDeRespuesta('octoprint', 'estado', r(200, OCTO_E), { tieneClave: true }) === null,
    );
    revisar(
        'Moonraker versión 200 válida',
        m.errorDeRespuesta('moonraker', 'version', r(200, MOON_V), { tieneClave: false }) === null,
    );
    revisar(
        'Moonraker estado 200 válido',
        m.errorDeRespuesta('moonraker', 'estado', r(200, MOON_E), { tieneClave: false }) === null,
    );
    for (const estado of [200, 201]) {
        for (const tipo of ['octoprint', 'moonraker']) {
            revisar(
                `${tipo} subida ${estado}`,
                m.errorDeRespuesta(tipo, 'subida', r(estado, '{}'), { tieneClave: false }) === null,
            );
        }
    }
}

function porEstado(m, revisar) {
    console.log('\nerrorDeRespuesta: tabla de códigos');
    const casos = [
        ['octoprint', 'version', 401, true, 'clave', /no sirve/],
        ['octoprint', 'estado', 403, true, 'clave', /no sirve/],
        ['moonraker', 'version', 401, true, 'clave', /no sirve/],
        ['moonraker', 'subida', 403, true, 'clave', /no sirve/],
        ['octoprint', 'version', 403, false, 'clave', /pide una API key/],
        ['moonraker', 'estado', 401, false, 'clave', /pide una API key/],
        ['octoprint', 'subida', 409, false, 'ocupada', /imprimiendo/],
        ['moonraker', 'subida', 409, true, 'ocupada', /imprimiendo/],
        ['octoprint', 'subida', 400, false, 'rechazado', /no aceptó el archivo \(código 400\)/],
        ['octoprint', 'subida', 413, false, 'rechazado', /\(código 413\)/],
        ['octoprint', 'subida', 415, false, 'rechazado', /\(código 415\)/],
        ['moonraker', 'subida', 422, false, 'rechazado', /\(código 422\)/],
        ['moonraker', 'subida', 500, false, 'rechazado', /\(código 500\)/],
        ['moonraker', 'subida', 503, false, 'rechazado', /\(código 503\)/],
        ['octoprint', 'version', 404, false, 'respuesta', /no parece ser/],
        ['moonraker', 'estado', 404, false, 'respuesta', /no parece ser/],
        ['moonraker', 'subida', 404, false, 'respuesta', /no parece ser/],
    ];
    for (const [tipo, fase, estado, tieneClave, codigo, patron] of casos) {
        const e = m.errorDeRespuesta(tipo, fase, { estado, texto: '' }, { tieneClave });
        const nombre = `${tipo} ${fase} ${estado} ${tieneClave ? 'con' : 'sin'} clave → ${codigo}`;
        revisar(
            nombre,
            forma(e) && e.codigo === codigo && patron.test(e.mensaje) && e.estadoHttp === estado,
            JSON.stringify(e),
        );
    }
}

function cuerpoAjeno(m, revisar) {
    console.log('\nerrorDeRespuesta: 200 con algo que no es lo esperado → respuesta');
    for (const tipo of ['octoprint', 'moonraker']) {
        for (const fase of ['version', 'estado']) {
            for (const texto of ['<html><body>Hola</body></html>', '{"x":', '{}']) {
                const e = m.errorDeRespuesta(tipo, fase, { estado: 200, texto }, { tieneClave: false });
                revisar(
                    `${tipo} ${fase} 200 ${JSON.stringify(texto)}`,
                    forma(e) && e.codigo === 'respuesta',
                    JSON.stringify(e),
                );
            }
        }
    }
    const cruzado = m.errorDeRespuesta('moonraker', 'version', { estado: 200, texto: OCTO_V }, { tieneClave: false });
    revisar('versión de OctoPrint donde se esperaba Moonraker', cruzado?.codigo === 'respuesta');
}

function sinCuerpo(m, revisar) {
    console.log('\nerrorDeRespuesta: no muestra el cuerpo de la respuesta');
    const hostil = `<script>alert(1)</script> ${CENTINELA} detalle-interno`;
    for (const estado of [400, 401, 404, 409, 422, 500]) {
        const e = m.errorDeRespuesta('moonraker', 'subida', { estado, texto: hostil }, { tieneClave: true });
        const todo = JSON.stringify(e);
        revisar(
            `HTTP ${estado}: ni el cuerpo ni la clave en el error`,
            !todo.includes('detalle-interno') && !todo.includes(CENTINELA) && !todo.includes('<script>'),
            todo,
        );
    }
}

const contexto = (extra = {}) => ({
    alcanzable: false,
    tipo: 'octoprint',
    origenApp: 'https://laminar.ejemplo.app',
    http: true,
    imprimiendo: false,
    ...extra,
});

function transporte(m, revisar) {
    console.log('\nerrorDeTransporte');
    const ctx = contexto;
    const texto = e => `${e.mensaje} ${e.pista}`;
    const sin = m.errorDeTransporte('red', ctx());
    revisar(
        'red + no alcanzable → sin-llegada',
        forma(sin) && sin.codigo === 'sin-llegada' && /No se pudo llegar a la impresora/.test(sin.mensaje),
        JSON.stringify(sin),
    );
    revisar('sin-llegada con http: menciona el bloqueo del navegador', /bloque/i.test(texto(sin)), texto(sin));
    const sinHttps = m.errorDeTransporte('red', ctx({ http: false }));
    revisar(
        'sin-llegada con https: no menciona bloqueo ni contenido mixto',
        sinHttps.codigo === 'sin-llegada' && !/bloque|mixto/i.test(texto(sinHttps)),
        texto(sinHttps),
    );
    bloqueado(m, revisar, contexto);
    otros(m, revisar, contexto);
}

function bloqueado(m, revisar, ctx) {
    const texto = e => `${e.mensaje} ${e.pista}`;
    for (const tipo of ['octoprint', 'moonraker']) {
        const e = m.errorDeTransporte('red', ctx({ alcanzable: true, tipo }));
        const fragmento = tipo === 'octoprint' ? /Cross Origin/i : /cors_domains/;
        revisar(`red + alcanzable (${tipo}) → bloqueado`, forma(e) && e.codigo === 'bloqueado', JSON.stringify(e));
        revisar(
            `bloqueado (${tipo}): el origen de la app y el fragmento de su tipo`,
            texto(e).includes('https://laminar.ejemplo.app') && fragmento.test(texto(e)),
            texto(e),
        );
    }
}

function otros(m, revisar, ctx) {
    const t = m.errorDeTransporte('tiempo', ctx());
    revisar(
        'tiempo → "no respondió a tiempo"',
        forma(t) && t.codigo === 'tiempo' && /no respondió a tiempo/.test(t.mensaje),
        JSON.stringify(t),
    );
    const c = m.errorDeTransporte('cancelado', ctx());
    revisar(
        'cancelado → "Envío cancelado."',
        forma(c) && c.codigo === 'cancelado' && /Envío cancelado/.test(c.mensaje),
        JSON.stringify(c),
    );
}

function advertenciaR2(m, revisar) {
    console.log('\nerrorDeTransporte: advertencia de R2 con imprimir');
    const ctx = imprimiendo => ({
        alcanzable: true,
        tipo: 'moonraker',
        origenApp: 'https://laminar.ejemplo.app',
        http: true,
        imprimiendo,
    });
    const con = m.errorDeTransporte('red', ctx(true));
    const sin = m.errorDeTransporte('red', ctx(false));
    const aviso = /puede que el archivo haya llegado/;
    revisar(
        'bloqueado con imprimir: "puede que el archivo haya llegado"',
        con.codigo === 'bloqueado' && aviso.test(`${con.mensaje} ${con.pista}`),
        JSON.stringify(con),
    );
    revisar(
        'bloqueado con imprimir: "mirá la impresora antes de reintentar"',
        /mirá la impresora antes de reintentar/.test(`${con.mensaje} ${con.pista}`),
    );
    revisar(
        'bloqueado sin imprimir: sin la advertencia',
        sin.codigo === 'bloqueado' && !/haya llegado|reintentar/.test(`${sin.mensaje} ${sin.pista}`),
        JSON.stringify(sin),
    );
}

function direccion(m, revisar) {
    console.log('\nerrorDeDireccion');
    const e = m.errorDeDireccion('tiene usuario y contraseña');
    revisar(
        'código direccion con la pista de ejemplo',
        forma(e) && e.codigo === 'direccion' && /La dirección no es válida/.test(e.mensaje),
        JSON.stringify(e),
    );
    revisar('el mensaje da un ejemplo http://192.168.1.50', `${e.mensaje} ${e.pista}`.includes('http://192.168.1.50'));
}

export default async function ({ revisar, cargar }) {
    const m = await cargar('errores');
    if (!m) return;
    exitos(m, revisar);
    porEstado(m, revisar);
    cuerpoAjeno(m, revisar);
    sinCuerpo(m, revisar);
    transporte(m, revisar);
    advertenciaR2(m, revisar);
    direccion(m, revisar);
}
