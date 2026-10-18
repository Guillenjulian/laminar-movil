// Pruebas de src/ui/visor-carga.js (ADR 0006, T1): corren en Node, con un cargador falso (sin three ni DOM).
//
// Uso: node scripts/probar-visor-carga.mjs

import { readFileSync } from 'node:fs';
import { armarVisorCarga } from '../src/ui/visor-carga.js';
import * as ayudas from './visor-carga/ayudas.mjs';
import { probarFallo, probarExcepciones, probarConcurrencia } from './visor-carga/errores.mjs';

const { revisar, json, contenedorFalso, cargadorManual, esperar } = ayudas;

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
    await esperar(5);
    revisar('una sola vez si se registró antes de cargar', veces === 1, `veces=${veces}`);
    revisar('se llama después de reproducir la cola', colaAlAvisar === 1);
    let tarde = 0;
    crear(contenedorFalso(), { alListo: () => tarde++ });
    await esperar(5);
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
        await esperar(5);
    } finally {
        console.error = consola;
    }
    revisar('alListo que tira no marca error', cont.dataset.visor === 'listo', `visor=${cont.dataset.visor}`);
    revisar('la excepción se informa', informados.length === 1 && /alListo roto/.test(informados[0]?.message));
}

async function probarAlListoQueTiraYaCargado() {
    console.log('alListo que tira (módulo ya cargado)');
    const c2 = cargadorManual();
    const consola = console.error;
    // Mismo trato con el módulo ya cargado (microtask): no queda como promesa rechazada.
    const rechazos = [];
    const alRechazo = e => rechazos.push(e);
    process.on('unhandledRejection', alRechazo);
    const otros = [];
    console.error = e => otros.push(e);
    try {
        const crear = armarVisorCarga(c2.cargar);
        const cont2 = contenedorFalso();
        const tira = () => {
            throw new Error('alListo roto 2');
        };
        crear(cont2, { alListo: tira });
        await c2.llegar();
        const cont3 = contenedorFalso();
        crear(cont3, { alListo: tira });
        await esperar(5);
        revisar(
            'ya cargado: alListo que tira se informa (diferido y ya cargado)',
            otros.length === 2,
            String(otros.length),
        );
        revisar('ya cargado: el visor sigue listo', cont3.dataset.visor === 'listo');
    } finally {
        console.error = consola;
        process.off('unhandledRejection', alRechazo);
    }
    revisar('ya cargado: sin promesa rechazada', rechazos.length === 0);
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
await probarAlListoQueTiraYaCargado();
await probarFallo();
await probarYaCargado();
await probarExcepciones();
await probarConcurrencia();
probarNombres();

if (ayudas.fallas) {
    console.log(`\n${ayudas.fallas} PRUEBAS FALLARON`);
    process.exit(1);
}
console.log('\nTODAS LAS PRUEBAS OK');
