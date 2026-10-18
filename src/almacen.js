// Guarda ajustes y modelos recientes en IndexedDB (queda en el celu, no se sube a ningún lado).
//
// Stores:
//   ajustes  -> clave/valor (ej. 'preferencias' -> { impresoraId, calidad, material, soportes })
//   modelos  -> datos de cada modelo reciente { id, nombre, bytes, fecha }
//   archivos -> el STL de cada modelo (id -> ArrayBuffer), aparte para no
//               cargar todos los archivos sólo para mostrar la lista.

const MAX_RECIENTES = 6;
let conexion;

function abrir() {
    conexion ??= new Promise((resolver, rechazar) => {
        const pedido = indexedDB.open('laminar-movil', 1);
        pedido.onupgradeneeded = () => {
            const db = pedido.result;
            db.createObjectStore('ajustes');
            db.createObjectStore('modelos', { keyPath: 'id', autoIncrement: true });
            db.createObjectStore('archivos');
        };
        pedido.onsuccess = () => resolver(pedido.result);
        pedido.onerror = () => rechazar(pedido.error);
    });
    return conexion;
}

// Corre `fn(stores)` dentro de una transacción y espera a que termine.
async function transaccion(nombres, modo, fn) {
    const db = await abrir();
    return new Promise((resolver, rechazar) => {
        const tx = db.transaction(nombres, modo);
        const stores = Object.fromEntries(nombres.map(n => [n, tx.objectStore(n)]));
        let resultado;
        Promise.resolve(fn(stores)).then(r => {
            resultado = r;
        }, rechazar);
        tx.oncomplete = () => resolver(resultado);
        tx.onerror = tx.onabort = () => rechazar(tx.error);
    });
}

const pedir = req =>
    new Promise((ok, mal) => {
        req.onsuccess = () => ok(req.result);
        req.onerror = () => mal(req.error);
    });

// --- Ajustes -----------------------------------------------------------------

export async function leerAjuste(clave) {
    return transaccion(['ajustes'], 'readonly', s => pedir(s.ajustes.get(clave)));
}

export async function guardarAjuste(clave, valor) {
    return transaccion(['ajustes'], 'readwrite', s => {
        s.ajustes.put(valor, clave);
    });
}

// --- Modelos recientes -------------------------------------------------------

// Lista de modelos recientes, del más nuevo al más viejo (sin los archivos).
export async function listarModelos() {
    const todos = await transaccion(['modelos'], 'readonly', s => pedir(s.modelos.getAll()));
    return todos.sort((a, b) => b.fecha - a.fecha);
}

export async function leerModelo(id) {
    return transaccion(['archivos'], 'readonly', s => pedir(s.archivos.get(id)));
}

export async function borrarModelo(id) {
    return transaccion(['modelos', 'archivos'], 'readwrite', s => {
        s.modelos.delete(id);
        s.archivos.delete(id);
    });
}

// Guarda un modelo. Si ya estaba (mismo nombre y tamaño) lo pone primero;
// si hay más de MAX_RECIENTES, borra los más viejos.
export async function guardarModelo(nombre, stl) {
    const lista = await listarModelos();
    const repetido = lista.find(m => m.nombre === nombre && m.bytes === stl.byteLength);
    if (repetido) {
        await transaccion(['modelos'], 'readwrite', s => {
            s.modelos.put({ ...repetido, fecha: Date.now() });
        });
        return;
    }
    await transaccion(['modelos', 'archivos'], 'readwrite', async s => {
        const id = await pedir(s.modelos.add({ nombre, bytes: stl.byteLength, fecha: Date.now() }));
        s.archivos.put(stl, id);
    });
    for (const viejo of lista.slice(MAX_RECIENTES - 1)) await borrarModelo(viejo.id);
}

// Pide al navegador que no borre estos datos si falta espacio (no siempre lo concede).
export function pedirAlmacenamientoPersistente() {
    navigator.storage?.persist?.().catch(() => {});
}
