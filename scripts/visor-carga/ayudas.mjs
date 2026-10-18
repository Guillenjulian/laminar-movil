// Ayudas de las pruebas de src/ui/visor-carga.js: contenedor, visor y cargador de mentira.

export let fallas = 0;
export function revisar(nombre, condicion, detalle = '') {
    console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${condicion ? '' : detalle}`);
    if (!condicion) fallas++;
}
export const json = x => JSON.stringify(x);
export const esperar = ms => new Promise(r => setTimeout(r, ms));

// Contenedor de mentira: lo justo para el aviso, su botón y `data-visor`.
function elementoFalso() {
    const e = { hijos: [], parentNode: null, clics: [], _texto: '' };
    e.setAttribute = () => {};
    e.addEventListener = (_tipo, fn) => e.clics.push(fn);
    e.appendChild = h => {
        h.parentNode = e;
        e.hijos.push(h);
    };
    Object.defineProperty(e, 'textContent', {
        get: () => e._texto,
        set: v => {
            e._texto = v;
            e.hijos = [];
        },
    });
    return e;
}

/** El contenedor: `aviso` es el aria-live; `boton()` el botón de reintento (o undefined). */
export function contenedorFalso() {
    const c = { dataset: {}, ownerDocument: { createElement: elementoFalso }, hijos: [] };
    c.appendChild = h => {
        c.hijos.push(h);
        c.aviso = h;
    };
    c.boton = () => c.aviso.hijos[0];
    c.textoAviso = () => c.boton()?.textContent ?? c.aviso.textContent;
    return c;
}

// Visor real de mentira: anota cada llamada y contesta tamanoModelo con una medida fija.
export function visorFalso(registro, tira = new Set()) {
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
export function cargadorManual() {
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
