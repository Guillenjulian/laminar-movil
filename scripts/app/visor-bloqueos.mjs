// Toque con punto sobre la pieza (`alTocarPunto` de visor-cara.js) y marcas de zonas sin soporte (visor-bloqueos.js)
// con eventos de puntero reales (ADR 0004, T3).
//
// Flujo: como visor.js todavía no expone ni las marcas ni `alTocarPunto` (los conecta T6), la prueba arma en la página
// un visor mínimo con los módulos reales (los empaqueta esbuild): un canvas encima de la app, la pieza de
// `scripts/visor/arnes.mjs` (caja girada y centrada, con copias en dos posiciones), una cámara cenital y un
// selector de caras. Se toca con el dedo cada copia, se compara el punto recibido con el esperado en el marco de la
// pieza (el de `centrar()`), se comprueba que `alTocarPieza` sigue avisando el id y que un toque fuera de la pieza no
// avisa nada; después se ponen las marcas y se cuentan las esferas de la escena.
//
// Precondición: la app cargada en cualquier paso (no se usa su estado; el canvas de prueba se agrega y se quita).
// Deja: la app como estaba (se saca el canvas y el arnés de la página).

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LADO = 300;

// Visor mínimo: lo que visor.js hará con estos módulos, sin el resto del visor.
const ARNES = `
import * as THREE from 'three';
import { crearSelectorCara } from '${RAIZ}/src/ui/visor-cara.js';
import { crearMarcasBloqueo } from '${RAIZ}/src/ui/visor-bloqueos.js';
import { armarPieza, POSICIONES } from '${RAIZ}/scripts/visor/arnes.mjs';

const dom = document.createElement('canvas');
dom.width = dom.height = ${LADO};
dom.style.cssText = 'position:fixed;left:0;top:0;width:${LADO}px;height:${LADO}px;z-index:99999;touch-action:none';
document.body.appendChild(dom);
const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(40, 1, 1, 1000);
camara.position.set(0, 0, 220);
camara.updateMatrixWorld(true);
camara.updateProjectionMatrix();
const { copias, enGeometria } = armarPieza();
copias.forEach((c, k) => { c.userData.idPieza = 7; escena.add(c); });
const toques = [];
const piezas = [];
const selector = crearSelectorCara({ escena, camara, dom, redibujar() {}, mallas: () => copias });
selector.alTocarPunto(t => toques.push(t));
selector.alTocarPieza(id => piezas.push(id));
const marcas = crearMarcasBloqueo({ escena, redibujar() {} });
const pantalla = v => { const p = v.clone().project(camara); return { x: (p.x + 1) / 2 * ${LADO}, y: (1 - p.y) / 2 * ${LADO} }; };
window.__arnes = {
    toques, piezas, marcas, POSICIONES,
    // Pixel de pantalla del punto (1.5, -1, 20) de la geometría (cara de arriba) en la copia k, y su valor en el marco de la pieza.
    objetivo(k) {
        const g = enGeometria.clone().set(1.5, -1, 20);
        return { ...pantalla(g.clone().applyMatrix4(copias[k].matrixWorld)), local: { x: 1, y: 1.5, z: 20 } };
    },
    esferas: () => escena.children.filter(o => o.isGroup).flatMap(g => g.children).length,
    quitar() { marcas.quitar(); dom.remove(); },
};
`;

async function empaquetar() {
    const r = await build({
        stdin: { contents: ARNES, resolveDir: RAIZ, loader: 'js' },
        bundle: true,
        write: false,
        format: 'iife',
        logLevel: 'silent',
    });
    return r.outputFiles[0].text;
}

const casi = (a, b) => Math.abs(a - b) < 1e-3;

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarVisorBloqueos(ctx) {
    const { page: pagina, ok: revisar } = ctx;
    await pagina.addScriptTag({ content: await empaquetar() });
    for (const k of [0, 1]) {
        const o = await pagina.evaluate(i => window.__arnes.objetivo(i), k);
        await pagina.touchscreen.tap(o.x, o.y);
        const toque = await pagina.evaluate(() => window.__arnes.toques.at(-1));
        const t = toque?.punto;
        revisar(
            `copia ${k + 1}: el punto tocado vuelve al marco de la pieza`,
            !!t && casi(t.x, o.local.x) && casi(t.y, o.local.y) && casi(t.z, o.local.z),
            JSON.stringify({ recibido: t, esperado: o.local }),
        );
        revisar(`copia ${k + 1}: avisa el id de la pieza`, toque?.id === 7);
    }
    const avisos = await pagina.evaluate(() => window.__arnes.piezas.join());
    revisar('alTocarPieza sigue avisando el id en cada toque', avisos === '7,7', avisos);
    await pagina.touchscreen.tap(LADO - 5, LADO - 5); // fondo: ninguna pieza
    const cantidad = await pagina.evaluate(() => window.__arnes.toques.length);
    revisar('un toque fuera de la pieza no avisa', cantidad === 2, String(cantidad));

    const zonas = [{ id: 1, forma: 'esfera', centro: { x: 1, y: 1, z: 10 }, radio: 5 }];
    const esferas = await pagina.evaluate(z => {
        const a = window.__arnes;
        a.marcas.poner(z, a.POSICIONES);
        return a.esferas();
    }, zonas);
    revisar('una esfera por copia en la escena', esferas === 2, String(esferas));
    const quedan = await pagina.evaluate(() => {
        window.__arnes.quitar();
        return window.__arnes.esferas();
    });
    revisar('quitar las marcas deja la escena sin esferas', quedan === 0, String(quedan));
    await pagina.evaluate(() => delete window.__arnes);
}
