// Pruebas de src/red/peticiones.js (ADR 0007, 6.2 y sección 2): pedidos exactos de OctoPrint y Moonraker.
import { CENTINELA } from './lib/impresora-falsa.mjs';

const DIR = 'http://192.168.1.50';
const cfg = (tipo, extra = {}) => ({ tipo, direccion: DIR, claveApi: '', imprimir: false, ...extra });
const CON_CLAVE = { claveApi: CENTINELA };
const RUTAS = {
    octoprint: ['/api/version', '/api/job', '/api/files/local'],
    moonraker: ['/server/info', '/printer/objects/query?print_stats', '/server/files/upload'],
};

function lecturas(p, revisar, igual) {
    for (const tipo of ['octoprint', 'moonraker']) {
        console.log(`\n${tipo}: peticionVersion y peticionEstado`);
        const [rVersion, rEstado] = RUTAS[tipo];
        const get = (ruta, headers) => ({ metodo: 'GET', url: DIR + ruta, headers, cuerpo: null, tiempoMs: 8000 });
        revisar('versión sin clave: exacta y sin cabeceras', igual(p.peticionVersion(cfg(tipo)), get(rVersion, {})));
        revisar('estado sin clave: exacta y sin cabeceras', igual(p.peticionEstado(cfg(tipo)), get(rEstado, {})));
        const conClave = { 'X-Api-Key': CENTINELA };
        revisar(
            'versión con clave: sólo X-Api-Key',
            igual(p.peticionVersion(cfg(tipo, CON_CLAVE)), get(rVersion, conClave)),
        );
        revisar(
            'estado con clave: sólo X-Api-Key',
            igual(p.peticionEstado(cfg(tipo, CON_CLAVE)), get(rEstado, conClave)),
        );
        const base = { direccion: `${DIR}/impresora` };
        revisar(
            'respeta el prefijo de ruta de la dirección',
            p.peticionVersion(cfg(tipo, base)).url === `${DIR}/impresora${rVersion}`,
        );
    }
}

async function subida(p, revisar, igual) {
    const gcode = 'G28\nG1 X10 Y10 E1\n';
    for (const tipo of ['octoprint', 'moonraker']) {
        console.log(`\n${tipo}: peticionSubida`);
        const sol = p.peticionSubida(cfg(tipo), new Blob([gcode]), 'cubo.gcode');
        revisar(
            'POST a la ruta de subida, tope de 10 minutos',
            sol.metodo === 'POST' && sol.url === DIR + RUTAS[tipo][2] && sol.tiempoMs === 600000,
        );
        revisar('sin clave: ninguna cabecera (ni Content-Type: lo pone el navegador)', igual(sol.headers, {}));
        revisar('el cuerpo es un FormData', sol.cuerpo instanceof FormData);
        const archivo = sol.cuerpo.get('file');
        revisar('parte file con el nombre pedido', archivo?.name === 'cubo.gcode', String(archivo?.name));
        revisar('parte file con el contenido del archivo', (await archivo?.text()) === gcode);
        const con = p.peticionSubida(cfg(tipo, CON_CLAVE), new Blob([gcode]), 'cubo.gcode');
        revisar('con clave: sólo X-Api-Key', igual(con.headers, { 'X-Api-Key': CENTINELA }));
        revisar(
            'la clave no está en la url',
            !con.url.includes(CENTINELA) && !decodeURIComponent(con.url).includes(CENTINELA),
        );
        const partes = [...sol.cuerpo.keys()].sort();
        const esperadas = tipo === 'octoprint' ? ['file'] : ['file', 'root'];
        revisar(
            'sin imprimir: ninguna parte print ni select',
            !partes.includes('print') && !partes.includes('select'),
            partes.join(),
        );
        revisar(`sin imprimir: sólo ${esperadas.join(' y ')}`, igual(partes, esperadas), partes.join());
    }
}

function imprimir(p, revisar, igual) {
    console.log('\npeticionSubida con imprimir');
    const blob = new Blob(['G28\n']);
    const octo = p.peticionSubida(cfg('octoprint', { imprimir: true }), blob, 'a.gcode').cuerpo;
    revisar('OctoPrint: file, select=true y print=true', igual([...octo.keys()].sort(), ['file', 'print', 'select']));
    revisar('OctoPrint: select y print valen "true"', octo.get('select') === 'true' && octo.get('print') === 'true');
    const moon = p.peticionSubida(cfg('moonraker', { imprimir: true }), blob, 'a.gcode').cuerpo;
    revisar('Moonraker: file, print=true y root=gcodes', igual([...moon.keys()].sort(), ['file', 'print', 'root']));
    revisar(
        'Moonraker: print vale "true" y root "gcodes"',
        moon.get('print') === 'true' && moon.get('root') === 'gcodes',
    );
    const sin = p.peticionSubida(cfg('moonraker'), blob, 'a.gcode').cuerpo;
    revisar('Moonraker sin imprimir: root=gcodes igual', sin.get('root') === 'gcodes');
}

function nombres(p, revisar) {
    console.log('\npeticionSubida: saneo del nombre');
    const nombre = texto => p.peticionSubida(cfg('octoprint'), new Blob(['x']), texto).cuerpo.get('file').name;
    revisar('a/b:c.gcode → a_b_c.gcode', nombre('a/b:c.gcode') === 'a_b_c.gcode', nombre('a/b:c.gcode'));
    revisar('cada carácter prohibido pasa a _', nombre('1/2\\3:4*5?6"7<8>9|0.gcode') === '1_2_3_4_5_6_7_8_9_0.gcode');
    revisar('un nombre normal queda intacto', nombre('cubo-20mm_rapido.gcode') === 'cubo-20mm_rapido.gcode');
    const largo = nombre(`${'x'.repeat(150)}.gcode`);
    revisar('máximo 100 caracteres', largo.length === 100, String(largo.length));
    revisar('al recortar conserva la extensión', largo.endsWith('.gcode') && largo.startsWith('x'.repeat(94)), largo);
}

function lectura(p, revisar) {
    console.log('\nleerVersion, estaOcupada y empezoAImprimir');
    const octoV = '{"api":"0.1","server":"1.10.0","text":"OctoPrint 1.10.0"}';
    const moonV = '{"result":{"klippy_state":"ready","klippy_connected":true,"moonraker_version":"v0.9.3"}}';
    const o = p.leerVersion('octoprint', octoV);
    const m = p.leerVersion('moonraker', moonV);
    revisar(
        'leerVersion OctoPrint: nombre con la versión',
        typeof o?.nombre === 'string' && o.nombre.includes('1.10.0'),
        JSON.stringify(o),
    );
    revisar(
        'leerVersion Moonraker: nombre con la versión',
        typeof m?.nombre === 'string' && m.nombre.includes('0.9.3'),
        JSON.stringify(m),
    );
    const ajenos = ['', 'no es json', '[]', 'null', '{}', '<html><body>Hola</body></html>', '{"state":"Printing"}'];
    for (const t of ajenos) {
        revisar(
            `leerVersion ${JSON.stringify(t)} → null (OctoPrint y Moonraker)`,
            p.leerVersion('octoprint', t) === null && p.leerVersion('moonraker', t) === null,
        );
    }
    revisar(
        'leerVersion: la respuesta de Moonraker no vale como OctoPrint',
        p.leerVersion('octoprint', moonV) === null,
    );
    revisar(
        'leerVersion: la respuesta de OctoPrint no vale como Moonraker',
        p.leerVersion('moonraker', octoV) === null,
    );

    ocupacion(p, revisar);
    imprimiendo(p, revisar);
}

function ocupacion(p, revisar) {
    const octoE = estado => `{"state":"${estado}","job":{},"progress":{}}`;
    const moonE = estado => `{"result":{"status":{"print_stats":{"state":"${estado}"}}}}`;
    for (const [e, esperado] of [
        ['Printing', true],
        ['Paused', true],
        ['Starting', true],
        ['Transferring file to SD', true],
        ['Operational', false],
    ]) {
        revisar(`estaOcupada OctoPrint ${e} → ${esperado}`, p.estaOcupada('octoprint', octoE(e)) === esperado);
    }
    for (const [e, esperado] of [
        ['printing', true],
        ['paused', true],
        ['standby', false],
        ['complete', false],
        ['cancelled', false],
        ['error', false],
    ]) {
        revisar(`estaOcupada Moonraker ${e} → ${esperado}`, p.estaOcupada('moonraker', moonE(e)) === esperado);
    }
    for (const t of ['', 'roto{', '{}', '{"foo":1}', '<html></html>']) {
        revisar(
            `estaOcupada ${JSON.stringify(t)} → null`,
            p.estaOcupada('octoprint', t) === null && p.estaOcupada('moonraker', t) === null,
        );
    }
}

function imprimiendo(p, revisar) {
    const emp = (tipo, t, imprimir = true) => p.empezoAImprimir(tipo, t, imprimir);
    revisar(
        'empezoAImprimir: con imprimir=false da false aunque la respuesta diga done / print_started',
        emp('octoprint', '{"done":true}', false) === false &&
            emp('moonraker', '{"print_started":true}', false) === false,
    );
    revisar(
        'empezoAImprimir Moonraker: print_started true',
        emp('moonraker', '{"item":{"path":"a.gcode"},"print_started":true}') === true,
    );
    revisar(
        'empezoAImprimir Moonraker: print_started false',
        emp('moonraker', '{"item":{"path":"a.gcode"},"print_started":false}') === false,
    );
    revisar(
        'empezoAImprimir OctoPrint: done true',
        emp('octoprint', '{"files":{"local":{"name":"a.gcode"}},"done":true}') === true,
    );
    revisar('empezoAImprimir OctoPrint: done false', emp('octoprint', '{"files":{},"done":false}') === false);
    for (const t of ['', 'roto{', '{}', '<html></html>']) {
        revisar(
            `empezoAImprimir ${JSON.stringify(t)} → false`,
            emp('octoprint', t) === false && emp('moonraker', t) === false,
        );
    }
}

function nombresBorde(p, revisar) {
    console.log('\npeticionSubida: nombres raros');
    const nombre = texto => p.peticionSubida(cfg('octoprint'), new Blob(['x']), texto).cuerpo.get('file').name;
    const porDefecto = 'laminar-movil.gcode';
    for (const t of ['', '   ', '.', '..', '///', '\\/ \\', '\u0000\n']) {
        revisar(`${JSON.stringify(t)} → ${porDefecto}`, nombre(t) === porDefecto, nombre(t));
    }
    revisar(
        'saca los caracteres de control',
        nombre('cu\u0000b\no\u007f.gcode') === 'cubo.gcode',
        nombre('cu\u0000b\no.gcode'),
    );
    revisar('agrega .gcode si falta', nombre('cubo') === 'cubo.gcode' && nombre('cubo.stl') === 'cubo.stl.gcode');
    revisar('acepta .GCODE sin duplicarlo', nombre('CUBO.GCODE') === 'CUBO.GCODE', nombre('CUBO.GCODE'));
    const sinExt = nombre('x'.repeat(150));
    revisar('largo sin extensión: 100 caracteres con .gcode', sinExt === `${'x'.repeat(94)}.gcode`, sinExt);
    const emojis = nombre(`${'😀'.repeat(80)}.gcode`);
    const puntos = Array.from(emojis);
    revisar('tope de 200 bytes UTF-8', new TextEncoder().encode(emojis).length <= 200, emojis);
    revisar(
        'no parte un par sustituto',
        !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(emojis),
    );
    revisar('cuenta puntos de código, no unidades UTF-16', puntos.length <= 100 && emojis.endsWith('.gcode'));
}

export default async function ({ revisar, igual, cargar }) {
    const p = await cargar('peticiones');
    if (!p) return;
    lecturas(p, revisar, igual);
    await subida(p, revisar, igual);
    imprimir(p, revisar, igual);
    nombres(p, revisar);
    lectura(p, revisar);
    nombresBorde(p, revisar);
}
