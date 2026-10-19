// Pruebas de visor-carga: fallos del cargador, excepciones al quedar listo y concurrencia.

import { armarVisorCarga } from '../../src/ui/visor-carga.js';
import { revisar, json, contenedorFalso, cargadorManual } from './ayudas.mjs';

export async function probarFallo() {
    console.log('Fallo del cargador');
    const c = cargadorManual();
    const cont = contenedorFalso();
    let veces = 0;
    const visor = armarVisorCarga(c.cargar)(cont, { alListo: () => veces++ });
    visor.ponerCama({ x: 5 });
    await c.fallar();
    revisar('data-visor pasa a error', cont.dataset.visor === 'error');
    revisar('el aviso invita a reintentar', /reintentar/.test(cont.textoAviso()) && !!cont.boton());
    revisar('no se llamó a alListo', veces === 0);
    cont.boton().clics.forEach(fn => fn());
    await new Promise(r => setTimeout(r, 0));
    revisar('el toque vuelve a pedir el módulo', c.pedidos === 2 && cont.dataset.visor === 'cargando');
    await c.llegar();
    revisar('el reintento anda: listo y alListo una vez', cont.dataset.visor === 'listo' && veces === 1);
    revisar('la cola se conservó', json(c.registro) === json([['ponerCama', { x: 5 }]]), json(c.registro));
    revisar('se vació el aviso (el aria-live sigue)', cont.textoAviso() === '' && !cont.boton());
}

export async function probarExcepciones() {
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
        cont1.dataset.visor === 'error' && /reintentar/.test(cont1.textoAviso()),
    );
    const c2 = cargadorManual();
    c2.tira.add('ponerCama');
    const cont2 = contenedorFalso();
    const visor = armarVisorCarga(c2.cargar)(cont2, { alListo: () => listos++ });
    visor.ponerCama({ x: 1 });
    visor.ponerModelo(new Float32Array(9), 0);
    await c2.llegar();
    revisar('si una orden encolada tira: error y aviso', cont2.dataset.visor === 'error' && !!cont2.boton());
    revisar('no se llamó a alListo', listos === 0);
    c2.tira.clear();
    cont2.boton().clics.forEach(fn => fn());
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

export async function probarConcurrencia() {
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
