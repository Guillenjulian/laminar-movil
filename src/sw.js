// Service worker: guarda toda la app en el celu para que funcione sin conexión.
// Al hacer `npm run build`, el plugin de vite.config.js reemplaza ARCHIVOS y
// VERSION por la lista real de archivos de dist/ y un hash de su contenido.

const ARCHIVOS = self.__ARCHIVOS__;
const CACHE = 'laminar-movil-' + self.__VERSION__;

// Instalar: bajar todo de una. Si falta algo, la instalación falla y se
// reintenta en la próxima visita (mejor eso que quedar a medias offline).
self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)));
});

// Activar: borrar las versiones viejas.
self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        for (const nombre of await caches.keys()) {
            if (nombre.startsWith('laminar-movil-') && nombre !== CACHE) await caches.delete(nombre);
        }
        await self.clients.claim();
    })());
});

// La página avisa cuando el usuario acepta actualizar.
self.addEventListener('message', e => {
    if (e.data === 'actualizar') self.skipWaiting();
});

// Pedidos: primero la copia guardada; si no está, la red.
self.addEventListener('fetch', e => {
    const { request } = e;
    if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
    e.respondWith((async () => {
        const cache = await caches.open(CACHE);
        // Navegación (abrir la app): siempre el index guardado.
        if (request.mode === 'navigate') {
            return (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./')) || fetch(request);
        }
        return (await cache.match(request, { ignoreSearch: true })) || fetch(request);
    })());
});
