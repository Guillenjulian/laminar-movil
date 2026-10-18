// Pruebas de src/ui/visor-carga.js (ADR 0006, T1): corren en Node, con un cargador falso (sin three ni DOM).
//
// Uso: node scripts/probar-visor-carga.mjs

import { readFileSync } from 'node:fs';
import { armarVisorCarga } from '../src/ui/visor-carga.js';

let fallas = 0;
function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${condicion ? '' : detalle}`);
    if (!condicion) fallas++;
}
const json = x => JSON.stringify(x);

// Contenedor de mentira: lo justo para el aviso y `data-visor`.
function contenedorFalso() {
    const aviso = { hidden: false, textContent: '', parentNode: null, clics: [] };
    aviso.setAttribute = () => {};
    aviso.addEventListener = (_tipo, fn) => aviso.clics.push(fn);
    aviso.remove = () => (aviso.parentNode = null);
    const c = { dataset: {}, aviso, ownerDocument: { createElement: () => aviso } };
    c.appendChild = hijo => (hijo.parentNode = c);
    return c;
}

// Visor real de mentira: anota cada llamada y contesta tamanoModelo con una medida fija.
function visorFalso(registro, tira = new Set()) {
    return new Proxy(
        {},
        {
            get: (_, nombre) =>
                nombre === 'tamanoModelo'
                    ? () => ({ x: 1, y: 2, z: 3 })
                    : (...a) => {
                          if (tira.has(nombre)) throw new Error('orden rota');
                          registro.push([nombre, ...a]);
                      },
        },
    );
}

// Cargador que se resuelve o falla cuando la prueba lo decide.
function cargadorManual() {
    const registro = [];
    const c = { registro, creados: 0, pedidos: 0, esperando: [], tira: new Set(), noCrea: false };
    c.cargar = () => {
        c.pedidos++;
        return new Promise((resolver, rechazar) => c.esperando.push({ resolver, rechazar }));
    };
    const modulo = {
        crearVisor: () => {
            c.creados++;
            if (c.noCrea) throw new Error('sin WebGL');
            return visorFalso(registro, c.tira);
        },
    };
    c.llegar = async () => {
        await new Promise(r => setTimeout(r, 0));
        c.esperando.shift().resolver(modulo);
        await new Promise(r => setTimeout(r, 0));
    };
    c.fallar = async () => {
        await new Promise(r => setTimeout(r, 0));
        c.esperando.shift().rechazar(new Error('sin red'));
        await new Promise(r => setTimeout(r, 0));
    };
    return c;
}

async function probarCola() {
    console.log('Cola de órdenes');
    const c = cargadorManual();
    const visor = armarVisorCarga(c.cargar)(contenedorFalso());
    const v1 = new Float32Array(9);
    visor.ponerModelo(v1, 0);
    visor.quitarModelo(0);
    visor.ponerModelo(v1, 0);
    visor.ponerTransformacion([1, 0, 0, 0, 1, 0, 0, 0, 1], 0);
    await c.llegar();
    const esperado = [
        ['ponerModelo', v1, 0],
        ['quitarModelo', 0],
        ['ponerModelo', v1, 0],
        ['ponerTransformacion', [1, 0, 0, 0, 1, 0, 0, 0, 1], 0],
    ];
    revisar('se reproduce en orden, con sus argumentos', json(c.registro) === json(esperado), json(c.registro));
    revisar('los argumentos van por referencia', c.registro[0][1] === v1);
}

async function probarUltimaOrden() {
    console.log('Órdenes de estado: sólo cuenta la última');
    const c = cargadorManual();
    const visor = armarVisorCarga(c.cargar)(contenedorFalso());
    visor.ponerCama({ x: 100 });
    visor.pausar(true);
    visor.ponerModelo(new Float32Array(9), 0);
    visor.ponerCama({ x: 200 });
    visor.pausar(false);
    visor.mostrarCapa(3);
    visor.mostrarCapa(7, true);
    visor.atenuarAbajo(false);
    visor.atenuarAbajo(true);
    visor.vistaInicial();
    visor.vistaInicial();
    await c.llegar();
    const finales = c.registro.filter(([n]) => n !== 'ponerModelo');
    const esperado = [
        ['ponerCama', { x: 200 }],
        ['pausar', false],
        ['mostrarCapa', 7, true],
        ['atenuarAbajo', true],
        ['vistaInicial'],
    ];
    revisar('queda una sola de cada, la última', json(finales) === json(esperado), json(finales));
    const antes = c.registro.length;
    revisar('ponerModelo no se descarta', antes === 6 && c.registro.some(([n]) => n === 'ponerModelo'));
}

async function probarConsulta() {
    console.log('tamanoModelo');
    const c = cargadorManual();
    const visor = armarVisorCarga(c.cargar)(contenedorFalso());
    revisar('da null antes de cargar', visor.tamanoModelo(0) === null);
    await c.llegar();
    revisar('da el valor real después', json(visor.tamanoModelo(0)) === json({ x: 1, y: 2, z: 3 }));
}

async function probarAlListo() {
    console.log('alListo');
    const c = cargadorManual();
    const crear = armarVisorCarga(c.cargar);
    let veces = 0;
    let colaAlAvisar = null;
    const visor = crear(contenedorFalso(), {
        alListo: () => {
            veces++;
            colaAlAvisar = c.registro.length;
        },
    });
    visor.ponerCama({ x: 1 });
    await c.llegar();
    visor.ponerCama({ x: 2 });
    await new Promise(r => setTimeout(r, 5));
    revisar('una sola vez si se registró antes de cargar', veces === 1, `veces=${veces}`);
    revisar('se llama después de reproducir la cola', colaAlAvisar === 1);
    let tarde = 0;
    crear(contenedorFalso(), { alListo: () => tarde++ });
    await new Promise(r => setTimeout(r, 5));
    revisar('una sola vez si se crea después de cargar', tarde === 1, `veces=${tarde}`);
    revisar('el módulo se pidió una sola vez', c.pedidos === 1);
}

// Si alListo tira, el visor ya está listo: no pasa a 'error' y la excepción se informa en la consola.
async function probarAlListoQueTira() {
    console.log('alListo que tira');
    const c2 = cargadorManual();
    const cont = contenedorFalso();
    const consola = console.error;
    const informados = [];
    console.error = e => informados.push(e);
    try {
        const v = armarVisorCarga(c2.cargar)(cont, {
            alListo: () => {
                throw new Error('alListo roto');
            },
        });
        v.ponerCama({ x: 3 });
        await c2.llegar();
        await new Promise(r => setTimeout(r, 5));
    } finally {
        console.error = consola;
    }
    revisar('alListo que tira no marca error', cont.dataset.visor === 'listo', `visor=${cont.dataset.visor}`);
    revisar('la excepción se informa', informados.length === 1 && /alListo roto/.test(informados[0]?.message));
}

async function probarFallo() {
    console.log('Fallo del cargador');
    const c = cargadorManual();
    const cont = contenedorFalso();
    let veces = 0;
    const visor = armarVisorCarga(c.cargar)(cont, { alListo: () => veces++ });
    visor.ponerCama({ x: 5 });
    await c.fallar();
    revisar('data-visor pasa a error', cont.dataset.visor === 'error');
    revisar('el aviso invita a reintentar', /reintentar/.test(cont.aviso.textContent) && !cont.aviso.hidden);
    revisar('no se llamó a alListo', veces === 0);
    cont.aviso.clics.forEach(fn => fn());
    await new Promise(r => setTimeout(r, 0));
    revisar('el toque vuelve a pedir el módulo', c.pedidos === 2 && cont.dataset.visor === 'cargando');
    await c.llegar();
    revisar('el reintento anda: listo y alListo una vez', cont.dataset.visor === 'listo' && veces === 1);
    revisar('la cola se conservó', json(c.registro) === json([['ponerCama', { x: 5 }]]), json(c.registro));
    revisar('se sacó el aviso', cont.aviso.parentNode === null);
}

async function probarYaCargado() {
    console.log('Módulo ya cargado');
    const c = cargadorManual();
    const crear = armarVisorCarga(c.cargar);
    crear(contenedorFalso());
    await c.llegar();
    const visor = crear(contenedorFalso());
    revisar('crea el visor real enseguida', c.creados === 2);
    const antes = c.registro.length;
    visor.ponerModelo(new Float32Array(9), 4);
    revisar(
        'las llamadas van directo, sin cola (sincrónico)',
        c.registro.length === antes + 1 && c.registro.at(-1)[0] === 'ponerModelo' && c.registro.at(-1)[2] === 4,
    );
    revisar('tamanoModelo ya da el valor real', visor.tamanoModelo(4)?.z === 3);
    revisar('no volvió a pedir el módulo', c.pedidos === 1);
}

async function probarExcepciones() {
    console.log('Excepciones al quedar listo');
    const rechazos = [];
    const alRechazo = e => rechazos.push(e);
    process.on('unhandledRejection', alRechazo);
    const c1 = cargadorManual();
    c1.noCrea = true;
    const cont1 = contenedorFalso();
    let listos = 0;
    armarVisorCarga(c1.cargar)(cont1, { alListo: () => listos++ });
    await c1.llegar();
    revisar(
        'si crearVisor real tira: data-visor error y aviso',
        cont1.dataset.visor === 'error' && /reintentar/.test(cont1.aviso.textContent),
    );
    const c2 = cargadorManual();
    c2.tira.add('ponerCama');
    const cont2 = contenedorFalso();
    const visor = armarVisorCarga(c2.cargar)(cont2, { alListo: () => listos++ });
    visor.ponerCama({ x: 1 });
    visor.ponerModelo(new Float32Array(9), 0);
    await c2.llegar();
    revisar('si una orden encolada tira: error y aviso', cont2.dataset.visor === 'error' && !cont2.aviso.hidden);
    revisar('no se llamó a alListo', listos === 0);
    c2.tira.clear();
    cont2.aviso.clics.forEach(fn => fn());
    await new Promise(r => setTimeout(r, 0));
    revisar(
        'el reintento sigue con el resto de la cola',
        cont2.dataset.visor === 'listo' && c2.registro.length === 1 && c2.registro[0][0] === 'ponerModelo',
        json(c2.registro),
    );
    revisar('el reintento no creó otro visor real', c2.creados === 1);
    await new Promise(r => setTimeout(r, 5));
    process.off('unhandledRejection', alRechazo);
    revisar('sin unhandledrejection', rechazos.length === 0, String(rechazos[0]));
}

async function probarConcurrencia() {
    console.log('Dos crearVisor antes de que llegue el módulo');
    const c = cargadorManual();
    const crear = armarVisorCarga(c.cargar);
    const cont1 = contenedorFalso();
    const cont2 = contenedorFalso();
    const v1 = crear(cont1);
    const v2 = crear(cont2);
    v1.ponerCama({ x: 1 });
    v2.ponerCama({ x: 2 });
    await c.llegar();
    revisar('el cargador se llamó una sola vez', c.pedidos === 1, `pedidos=${c.pedidos}`);
    revisar('las dos instancias quedaron listo', cont1.dataset.visor === 'listo' && cont2.dataset.visor === 'listo');
    const camas = c.registro
        .filter(([n]) => n === 'ponerCama')
        .map(([, m]) => m.x)
        .sort();
    revisar('cada cola se reprodujo', json(camas) === json([1, 2]), json(c.registro));
}

// Los nombres de `armarApi` (visor.js) más los de visor-recorridos (menos `esfera`), leídos del fuente.
function nombresDelVisor() {
    const visor = readFileSync(new URL('../src/ui/visor.js', import.meta.url), 'utf8');
    const api = visor.slice(visor.indexOf('function armarApi'));
    const cuerpo = api.slice(0, api.indexOf('\n}\n'));
    const propios = [...cuerpo.matchAll(/^ {8}(\w+)\s*(?::|\()/gm)].map(m => m[1]);
    const rec = readFileSync(new URL('../src/ui/visor-recorridos.js', import.meta.url), 'utf8');
    const ret = rec.slice(rec.indexOf('return {', rec.indexOf('export function crearRecorridos')));
    const deRec = [...ret.slice(0, ret.indexOf('\n    };')).matchAll(/^ {8}(\w+):/gm)].map(m => m[1]);
    return [...propios, ...deRec.filter(n => n !== 'esfera')];
}

function probarNombres() {
    console.log('Nombres de métodos');
    const esperados = nombresDelVisor().sort();
    const fachada = Object.keys(armarVisorCarga(cargadorManual().cargar)(contenedorFalso())).sort();
    revisar('se leyeron los de visor.js', esperados.length >= 16, json(esperados));
    revisar(
        'la fachada tiene exactamente los de armarApi',
        json(fachada) === json(esperados),
        `${json(fachada)} vs ${json(esperados)}`,
    );
}

await probarCola();
await probarUltimaOrden();
await probarConsulta();
await probarAlListo();
await probarAlListoQueTira();
await probarFallo();
await probarYaCargado();
await probarExcepciones();
await probarConcurrencia();
probarNombres();

if (fallas) {
    console.log(`\n${fallas} PRUEBAS FALLARON`);
    process.exit(1);
}
console.log('\nTODAS LAS PRUEBAS OK');
