// Punto de entrada: cablea los módulos de src/ui/ (ver docs/decisiones/0001-dividir-main.md).

import * as almacen from './almacen.js';
import * as materialesUI from './ui/materiales.js';
import { $ } from './ui/util-dom.js';
import { cargarPreferencias } from './ui/estado.js';
import { iniciarNavegacion, mostrar } from './ui/navegacion.js';
import { iniciarImpresoras } from './ui/impresoras.js';
import { iniciarPaso2, dibujarOpciones } from './ui/paso2-config.js';
import { iniciarPaso1, alCambiarImpresora, elegirOtroModelo, mostrarRecientes } from './ui/paso1-modelo.js';
import { iniciarPaso3 } from './ui/paso3-laminar.js';
import { iniciarPaso4, mostrarResultado } from './ui/paso4-resultado.js';
import { iniciarVistaCapas } from './ui/vista-capas.js';

iniciarNavegacion();
iniciarPaso1();
materialesUI.iniciarMateriales();
iniciarImpresoras({
    alElegir: () => {
        dibujarOpciones();
        alCambiarImpresora();
    },
});
iniciarPaso2();
iniciarPaso3({ alTerminar: mostrarResultado });
iniciarPaso4({ alOtroModelo: elegirOtroModelo });
iniciarVistaCapas();

// ---------------------------------------------------------------------------
// App instalable y offline: registrar el service worker (sólo en el build;
// en `npm run dev` molestaría porque guarda versiones viejas).

function registrarServiceWorker() {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
    navigator.serviceWorker
        .register('./sw.js')
        .then(registro => {
            // Si hay una versión nueva esperando, ofrecemos actualizar (no lo hacemos
            // solos para no cortar un laminado a la mitad).
            const ofrecer = sw => {
                if (!sw || !navigator.serviceWorker.controller) return;
                $('actualizacion').hidden = false;
                $('actualizar').onclick = () => sw.postMessage('actualizar');
            };
            ofrecer(registro.waiting);
            registro.addEventListener('updatefound', () => {
                const nuevo = registro.installing;
                nuevo.addEventListener('statechange', () => nuevo.state === 'installed' && ofrecer(nuevo));
            });
        })
        .catch(err => console.warn('No se pudo registrar el service worker', err));

    let recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!recargando && !$('actualizacion').hidden) {
            recargando = true;
            location.reload();
        }
    });
}

// ---------------------------------------------------------------------------
await cargarPreferencias();
dibujarOpciones();
mostrar(1);
mostrarRecientes();
almacen.pedirAlmacenamientoPersistente();
registrarServiceWorker();
