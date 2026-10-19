// Pruebas de visor-carga: el canvas queda con aria-hidden="true" (ADR 0008, A4) y eso nunca rompe el visor.

import { armarVisorCarga } from '../../src/ui/visor-carga.js';
import { revisar, contenedorFalso, cargadorManual } from './ayudas.mjs';

const oculto = cont => cont.canvas.length > 0 && cont.canvas.every(c => c.atributos['aria-hidden'] === 'true');

export async function probarAriaCanvas() {
    console.log('aria-hidden en el canvas');
    const c = cargadorManual();
    const crear = armarVisorCarga(c.cargar);

    const diferido = contenedorFalso();
    crear(diferido);
    await c.llegar();
    revisar('camino diferido: el canvas tiene aria-hidden', oculto(diferido) && diferido.dataset.visor === 'listo');

    const inmediato = contenedorFalso();
    crear(inmediato);
    revisar('camino inmediato: el canvas tiene aria-hidden', oculto(inmediato) && inmediato.dataset.visor === 'listo');

    const c2 = cargadorManual();
    c2.noCrea = true;
    const reintento = contenedorFalso();
    armarVisorCarga(c2.cargar)(reintento);
    await c2.llegar();
    revisar('sin WebGL: error y sin canvas todavía', reintento.dataset.visor === 'error' && !reintento.canvas.length);
    c2.noCrea = false;
    reintento.boton().clics.forEach(fn => fn());
    await new Promise(r => setTimeout(r, 0));
    revisar(
        'tras un reintento por error: el canvas tiene aria-hidden',
        oculto(reintento) && reintento.dataset.visor === 'listo',
    );
    await probarAriaTolerante();
}

// Un fallo al marcar el canvas no puede dejar el visor en error ni frenar la cola.
async function probarAriaTolerante() {
    const c3 = cargadorManual();
    const sin = contenedorFalso({ conCanvas: false });
    const visor = armarVisorCarga(c3.cargar)(sin);
    visor.ponerCama({ x: 1 });
    await c3.llegar();
    revisar(
        'un contenedor sin querySelectorAll no rompe el visor ni la cola',
        sin.dataset.visor === 'listo' && c3.registro.length === 1,
    );

    const c4 = cargadorManual();
    const roto = contenedorFalso();
    roto.querySelectorAll = () => {
        throw new Error('boom');
    };
    const visor4 = armarVisorCarga(c4.cargar)(roto);
    visor4.ponerCama({ x: 2 });
    const consola = console.error;
    console.error = () => {};
    await c4.llegar();
    console.error = consola;
    revisar(
        'si marcar el canvas tira, el visor queda listo y la cola corre',
        roto.dataset.visor === 'listo' && c4.registro.length === 1,
    );
}
