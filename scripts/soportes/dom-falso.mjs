// DOM falso y carga de los módulos reales de UI para scripts/soportes/ui-soportes.mjs (Node, sin navegador).
// `estado.js` importa JSON, que Node no carga solo: se empaquetan con esbuild (como hace vendor-kiri) y se importan
// desde memoria.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../..', import.meta.url));
const entrada = `
export * from './src/ui/bloqueos-ui.js';
export * from './src/ui/soportes-tipo-ui.js';
export { estado, crearPieza } from './src/ui/estado.js';`;

/** Carga los módulos reales empaquetados. */
export async function cargar() {
    const r = await build({
        stdin: { contents: entrada, resolveDir: raiz, sourcefile: 'entrada.js' },
        bundle: true,
        format: 'esm',
        platform: 'node',
        write: false,
        logLevel: 'silent',
        banner: { js: 'var __glob = () => ({});' },
        define: { 'import.meta.glob': '__glob' }, // Vite lo resuelve en la app; acá no hay impresoras
    });
    const codigo = r.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`);
}

/** DOM falso: elementos por id; las listas de chips se leen del HTML que escribió el módulo. */
export function crearDom() {
    const elementos = new Map();
    const dom = { enfocado: null };
    const elemento = id => elementoFalso(id, dom);
    dom.$ = id => {
        if (!elementos.has(id)) elementos.set(id, elemento(id));
        return elementos.get(id);
    };
    globalThis.document = { getElementById: dom.$ };
    return dom;
}

/** Evento de clic falso sobre un botón con ese atributo de datos. */
export const clic = (atributo, valor) => ({
    target: { closest: sel => (sel === `[${atributo}]` ? { dataset: { [atributo.slice(5)]: String(valor) } } : null) },
});

/** Visor falso que recuerda la función de toque y las marcas. */
export function crearVisor() {
    const v = { fn: null, marcas: [], quitadas: 0 };
    v.alTocarPunto = fn => (v.fn = fn);
    v.marcasBloqueo = {
        poner: (z, pos) => v.marcas.push({ zonas: z.map(b => ({ ...b })), pos }),
        quitar: () => v.quitadas++,
    };
    return v;
}

/** Elemento falso con lo mínimo que usan los módulos. */
function elementoFalso(id, dom) {
    const e = {
        id,
        hidden: false,
        disabled: false,
        textContent: '',
        innerHTML: '',
        attrs: {},
        oyentes: {},
        setAttribute: (k, v) => (e.attrs[k] = v),
        getAttribute: k => e.attrs[k],
        addEventListener: (tipo, fn) => ((e.nAdd = (e.nAdd ?? 0) + 1), (e.oyentes[tipo] = fn)),
        focus() {
            dom.enfocado = id;
        },
        querySelectorAll(sel) {
            if (sel === 'input') return this.radios();
            const atributo = sel.match(/\[(data-[a-z]+)\]/)?.[1];
            if (!atributo) return [];
            const ids = [...this.innerHTML.matchAll(new RegExp(`${atributo}="(\\d+)"`, 'g'))].map(m => m[1]);
            return ids.map(v => ({ focus: () => (dom.enfocado = `${atributo}:${v}`) }));
        },
        radios() {
            const html = this.innerHTML;
            if (this.htmlRadios !== html) {
                this.htmlRadios = html;
                this.cacheRadios = [...html.matchAll(/value="(\w+)"([^>]*)>/g)].map(m => ({
                    value: m[1],
                    checked: /checked/.test(m[2]),
                }));
            }
            return this.cacheRadios;
        },
        querySelector(sel) {
            return sel === 'input:checked' ? { focus: () => (dom.enfocado = 'radio-marcado') } : null;
        },
    };
    return e;
}
