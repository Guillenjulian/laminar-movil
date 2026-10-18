// Fachada sincrónica del visor 3D (ADR 0006, sección 1).
//
// `visor.js` importa three de forma estática, así que arrastra ~500 kB al chunk principal. Este módulo es el
// único que lo importa, y lo hace con `import('./visor.js')`: Vite lo saca a un chunk aparte. Mientras el chunk
// no llegó, el visor que devolvemos encola las órdenes (ponerModelo, ponerCama, ...) y las reproduce en orden
// cuando llega; así los llamadores siguen igual que antes, sin promesas.
//
// No toca el DOM al importarse: todo pasa dentro de `crearVisor`.

/** Órdenes: no devuelven nada, se pueden encolar. Los nombres son los de `armarApi` (visor.js) y visor-recorridos. */
const ORDENES = [
    'ponerCama',
    'ponerModelo',
    'ponerTransformacion',
    'ponerCopias',
    'quitarModelo',
    'resaltarPieza',
    'elegirCara',
    'alTocarPieza',
    'ponerRecorridos',
    'mostrarCapa',
    'pintarRecorridos',
    'atenuarAbajo',
    'quitarRecorridos',
    'vistaInicial',
    'pausar',
];

/** Consultas: devuelven un valor, así que antes de estar listo contestan `null`. */
const CONSULTAS = ['tamanoModelo'];

/** De estas sólo cuenta la última orden: las anteriores no cambian el resultado final. */
const SOLO_LA_ULTIMA = new Set(['ponerCama', 'pausar', 'mostrarCapa', 'atenuarAbajo', 'vistaInicial']);

const DEMORA_AVISO_MS = 200;
const TEXTO_CARGANDO = 'Cargando el visor 3D…';
const TEXTO_ERROR = 'No se pudo cargar el visor 3D. Tocá acá para reintentar.';

// Cola de órdenes pendientes. Una orden "de estado" reemplaza a las anteriores del mismo nombre
// (y pasa al final, que es donde estaba la última).
function crearCola() {
    let ordenes = [];
    return {
        agregar(nombre, args) {
            if (SOLO_LA_ULTIMA.has(nombre)) ordenes = ordenes.filter(([n]) => n !== nombre);
            ordenes.push([nombre, args]);
        },
        reproducir(visor) {
            // Una por vez: si una tira, las que siguen quedan para el reintento (la que tiró se descarta).
            while (ordenes.length) {
                const [nombre, args] = ordenes.shift();
                visor[nombre](...args);
            }
        },
    };
}

// El aviso dentro del contenedor ("Cargando…" a los 200 ms, o el error con un botón para reintentar) y `data-visor`.
// El contenedor aria-live está siempre en el DOM (vacío se oculta con :empty), así los lectores de pantalla
// anuncian el texto cuando aparece.
function crearAviso(contenedor, reintentar) {
    const doc = contenedor.ownerDocument;
    const aviso = doc.createElement('div');
    aviso.className = 'visor-estado';
    aviso.setAttribute('role', 'status');
    aviso.setAttribute('aria-live', 'polite');
    contenedor.appendChild(aviso);
    let demora = null;
    const poner = (estado, texto, boton) => {
        clearTimeout(demora);
        contenedor.dataset.visor = estado;
        aviso.textContent = '';
        if (boton) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'visor-estado-boton';
            b.textContent = texto;
            b.addEventListener('click', reintentar);
            aviso.appendChild(b);
        } else if (texto) demora = setTimeout(() => (aviso.textContent = texto), DEMORA_AVISO_MS);
    };
    return {
        cargando: () => poner('cargando', TEXTO_CARGANDO, false),
        error: () => poner('error', TEXTO_ERROR, true),
        listo: () => poner('listo', '', false),
    };
}

// El módulo del visor, pedido una sola vez: la promesa se descarta si falla, para poder reintentar.
function crearPedido(cargar) {
    const estado = { modulo: null, promesa: null };
    const pedir = () => {
        estado.promesa ??= Promise.resolve()
            .then(cargar)
            .then(m => (estado.modulo = m))
            .catch(error => {
                estado.promesa = null;
                throw error;
            });
        return estado.promesa;
    };
    return { estado, pedir };
}

// El visor que ve el llamador: las órdenes van a la cola hasta que `real()` devuelve el visor de verdad.
function armarFachada(real, cola) {
    const visor = {};
    for (const nombre of ORDENES) {
        visor[nombre] = (...args) => (real() ? real()[nombre](...args) : cola.agregar(nombre, args));
    }
    for (const nombre of CONSULTAS) visor[nombre] = (...args) => (real() ? real()[nombre](...args) : null);
    return visor;
}

// alListo no puede marcar 'error' ni tirar la promesa: si falla, se informa en la consola.
function avisarListo(alListo) {
    try {
        alListo?.();
    } catch (error) {
        console.error(error);
    }
}

// Un visor para `contenedor`: real en el mismo turno si el módulo ya estaba, o con cola hasta que llegue.
function crearInstancia({ estado, pedir }, contenedor, opciones) {
    const cola = crearCola();
    let visorReal = null;
    let creado = null;
    // Cualquier excepción (sin WebGL, una orden que tira) deja el visor en 'error' con el aviso.
    const quedarListo = modulo => {
        try {
            creado ??= modulo.crearVisor(contenedor);
            cola.reproducir(creado);
            visorReal = creado;
            aviso.listo();
        } catch {
            return aviso.error();
        }
        avisarListo(opciones.alListo);
    };
    const empezar = () => {
        aviso.cargando();
        pedir().then(quedarListo, aviso.error);
    };
    const aviso = crearAviso(contenedor, empezar);
    if (estado.modulo) {
        // Ya estaba cargado: visor real en el mismo turno, sin cola. alListo va en un microtask
        // para que el llamador alcance a guardar el visor antes de que se lo avisemos.
        visorReal = estado.modulo.crearVisor(contenedor);
        aviso.listo();
        queueMicrotask(() => avisarListo(opciones.alListo));
    } else empezar();
    return armarFachada(() => visorReal, cola);
}

/**
 * Implementación con el cargador inyectado. Devuelve `crearVisor` y `precargar`, que comparten el mismo pedido.
 * @param {() => Promise<{ crearVisor: (contenedor: HTMLElement) => Record<string, Function> }>} cargar
 */
function armar(cargar) {
    const pedido = crearPedido(cargar);
    return {
        crearVisor: (contenedor, opciones = {}) => crearInstancia(pedido, contenedor, opciones),
        precargar: () => void pedido.pedir().catch(() => {}),
    };
}

/**
 * Igual que `crearVisor`, pero con el cargador del módulo del visor inyectado (para las pruebas).
 * @param {() => Promise<{ crearVisor: (contenedor: HTMLElement) => Record<string, Function> }>} cargar
 * @returns {(contenedor: HTMLElement, opciones?: { alListo?: () => void }) => Record<string, Function>}
 */
export function armarVisorCarga(cargar) {
    return armar(cargar).crearVisor;
}

const compartido = armar(() => import('./visor.js'));

/**
 * Visor con la misma API que `crearVisor` de visor.js, pero que se puede usar enseguida: las órdenes se encolan hasta
 * que three.js llega (import dinámico). Ver ADR 0006, sección 1.
 * @param {HTMLElement} contenedor
 * @param {{ alListo?: () => void }} [opciones] alListo: se llama una vez, después de reproducir la cola
 * @returns {Record<string, Function>} el visor (mismos métodos que visor.js; `tamanoModelo` da null hasta estar listo)
 */
export function crearVisor(contenedor, opciones) {
    return compartido.crearVisor(contenedor, opciones);
}

/**
 * Empieza a bajar el chunk del visor (si no se pidió ya). Nunca lanza; si falla, se reintenta al crear un visor.
 * @returns {void}
 */
export function precargarVisor() {
    compartido.precargar();
}
