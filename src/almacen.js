// Guarda ajustes y modelos recientes en IndexedDB (queda en el celu, no se sube a ningún lado).
//
// Stores:
//   ajustes  -> clave/valor (ej. 'preferencias' -> { impresoraId, calidad, material, soportes })
//               (`soportes`: 'no' | 'normal' | 'arbol'; las versiones viejas guardaban true/false y
//               `cargarPreferencias` los migra con `normalizarSoportes`, ADR 0004)
//   modelos  -> datos de cada modelo reciente { id, nombre, bytes, fecha, rotacion?, escala? }
//               (rotacion: matriz 3×3 de 9 números; los registros viejos no los tienen)
//   archivos -> el STL de cada modelo (id -> ArrayBuffer), aparte para no
//               cargar todos los archivos sólo para mostrar la lista.

import { identidad, determinante } from './motor/transformar.js';

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
        // Se relee dentro de la transacción: así no pisa una transformación guardada en el medio.
        await transaccion(['modelos'], 'readwrite', async s => {
            const actual = (await pedir(s.modelos.get(repetido.id))) ?? repetido;
            s.modelos.put({ ...actual, fecha: Date.now() });
        });
        return;
    }
    await transaccion(['modelos', 'archivos'], 'readwrite', async s => {
        const id = await pedir(s.modelos.add({ nombre, bytes: stl.byteLength, fecha: Date.now() }));
        s.archivos.put(stl, id);
    });
    for (const viejo of lista.slice(MAX_RECIENTES - 1)) await borrarModelo(viejo.id);
}

/**
 * Rotación y escala de un registro de reciente. Los recientes viejos no tienen esos campos (o
 * están dañados o no son una rotación, det ≈ ±1): abren con la identidad y escala 1. La escala se acota a [0,01; 20].
 * @param {{rotacion?: number[], escala?: number}} [registro]
 * @returns {{rotacion: number[], escala: number}}
 */
export function normalizarTransformacion(registro) {
    const { rotacion, escala } = registro ?? {};
    const valida =
        Array.isArray(rotacion) &&
        rotacion.length === 9 &&
        rotacion.every(Number.isFinite) &&
        Math.abs(Math.abs(determinante(rotacion)) - 1) < 1e-3;
    return {
        rotacion: valida ? [...rotacion] : identidad(),
        escala: Number.isFinite(escala) && escala > 0 ? Math.min(20, Math.max(0.01, escala)) : 1,
    };
}

/**
 * Guarda la transformación del reciente que coincide por nombre y tamaño. Si no está (todavía no
 * se guardó o se borró) no hace nada.
 * @param {string} nombre
 * @param {number} bytes tamaño del STL guardado
 * @param {{rotacion: number[], escala: number}} transformacion
 * @returns {Promise<void>}
 */
export async function guardarTransformacion(nombre, bytes, { rotacion, escala }) {
    // Lee y escribe en una sola transacción, para no pisar otro cambio del mismo registro (ej. la fecha).
    await transaccion(['modelos'], 'readwrite', async s => {
        const modelo = (await pedir(s.modelos.getAll())).find(m => m.nombre === nombre && m.bytes === bytes);
        if (modelo) s.modelos.put({ ...modelo, rotacion: [...rotacion], escala });
    });
}

// Pide al navegador que no borre estos datos si falta espacio (no siempre lo concede).
export function pedirAlmacenamientoPersistente() {
    navigator.storage?.persist?.().catch(() => {});
}
