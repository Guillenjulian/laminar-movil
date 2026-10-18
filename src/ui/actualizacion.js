// Registro del service worker y aviso "Hay una versión nueva de la app".
// Responsabilidad: que la app sea instalable y funcione offline, y ofrecer "Actualizar"
// cuando el service worker nuevo está esperando.
// Flujo: registrarServiceWorker() → registra ./sw.js (sólo en el build) → si hay una versión
// nueva esperando, muestra #actualizacion; al tocar #actualizar, le pide activarse y recarga
// cuando cambia el controlador.
// No toca el DOM ni `navigator` al importarse: todo ocurre dentro de la función exportada.

import { $ } from './util-dom.js';

/**
 * Registra ./sw.js (sólo en el build, no en `npm run dev`). Cuando hay una versión nueva
 * esperando, muestra #actualizacion y, al tocar #actualizar, la activa y recarga cuando cambia
 * el controlador. @returns {void}
 */
export function registrarServiceWorker() {
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
