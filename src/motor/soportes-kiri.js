// Puente entre Kiri y nuestro código de soportes (ADR 0004, T4). Convierte entre los polígonos de Kiri y los `Poligono`
// puros de geometria-2d.js, y arma los dos ganchos que llaman los parches de scripts/vendor-kiri.mjs
// (`PARCHE laminar-movil` en processSupports) a través de `globalThis.laminarMovil`.
//
//   instalarGanchosSoportes  instala los ganchos (el worker lo llama una vez, al arrancar)
//   reiniciarGanchos         empieza un laminado; con `diagnostico` registra las llamadas (sólo pruebas)
//   resumenGanchos           lo registrado, para `info.ganchos` (undefined si no se pidió diagnóstico)

import { polygons as POLY } from '../../vendor/kiri/src/geo/polygons.js';
import { newPolygon } from '../../vendor/kiri/src/geo/polygon.js';
import { newPoint } from '../../vendor/kiri/src/geo/point.js';
import { planificarArbol } from './soportes-arbol.js';
import { validarBloqueos, sinBloqueos as restarSecciones } from './bloqueos.js';

const TOPE_REGISTRO = 5000; // llamadas que se guardan por gancho (memoria acotada)

// null = producción: no se guarda nada (ni se arma ningún JSON por capa). Sólo con `diagnostico` hay un registro.
let datos = null;

const nuevoRegistro = () => ({
    arbol: { llamadas: 0, registro: [] },
    sinBloqueos: { llamadas: 0, registro: [] },
});

function anotar(nombre, entrada) {
    const gancho = datos[nombre];
    gancho.llamadas++;
    if (gancho.registro.length < TOPE_REGISTRO) gancho.registro.push(entrada);
}

// Zonas saneadas (`validarBloqueos`), una vez por lista: `widget.anno.bloqueos` es el mismo array en todas las capas.
const validadas = new WeakMap();
function zonas(bloqueos) {
    if (!bloqueos?.length) return [];
    if (!validadas.has(bloqueos)) validadas.set(bloqueos, validarBloqueos(bloqueos));
    return validadas.get(bloqueos);
}

/**
 * Polígonos de Kiri → `Poligono[]` planos: cada anillo exterior y cada agujero (`inner`) pasa a ser un polígono,
 * que es como los lee el árbol (regla par-impar).
 * @param {object[]|undefined} polys polígonos de Kiri
 * @returns {import('./geometria-2d.js').Poligono[]}
 */
function aPoligonos(polys) {
    const salida = [];
    const anillo = p => salida.push(p.points.map(({ x, y }) => ({ x, y })));
    for (const p of polys ?? []) {
        anillo(p);
        (p.inner ?? []).forEach(anillo);
    }
    return salida;
}

/** `Poligono` → polígono de Kiri en la altura `z`. */
function aPolygon(poligono, z) {
    const p = newPolygon();
    for (const { x, y } of poligono) p.push(newPoint(x, y, z));
    return p;
}

/**
 * Gancho `arbol(stack, bloqueos, opciones)`: planifica el soporte árbol (soportes-arbol.js) con la sombra
 * (`slice.shadow`) y la pieza (`slice.topPolys()`) de cada capa y deja el resultado en `slice.supports`.
 * Si devuelve `true`, el bucle de acumulación de Kiri no corre y `sinBloqueos` NO se llama: el árbol respeta las
 * zonas por su cuenta (no siembra ni pasa por ellas y poda lo que queda colgado). El recorte final por
 * `sliceSupportGap` de Kiri corre igual. Si algo falla devuelve `false` y Kiri sigue con 'automatic'.
 * @param {object[]} stack slices de Kiri de abajo hacia arriba (con una capa vacía de más arriba, de `z` = índice)
 * @param {object[]|undefined} bloqueos zonas sin soporte de la pieza (`widget.anno.bloqueos`)
 * @param {{lineWidth:number, sliceHeight:number, angulo:number}} opciones ancho de línea, alto de capa y ángulo
 * @returns {boolean}
 */
function arbol(stack, bloqueos, { lineWidth, sliceHeight, angulo }) {
    if (datos)
        anotar('arbol', {
            capas: stack.length,
            n: bloqueos?.length ?? 0,
            opciones: { lineWidth, sliceHeight, angulo },
        });
    try {
        const capas = stack.map(s => ({ z: s.z, voladizos: aPoligonos(s.shadow), cuerpo: aPoligonos(s.topPolys()) }));
        const salida = planificarArbol(capas, {
            ancho: lineWidth,
            altoCapa: sliceHeight,
            angulo,
            bloqueos: zonas(bloqueos),
        });
        stack.forEach((s, i) => (s.supports = salida[i].map(p => aPolygon(p, s.z))));
        return true;
    } catch (err) {
        console.error('Soportes árbol: falló, se usan los normales.', err);
        return false;
    }
}

/**
 * Gancho `sinBloqueos(shadow, z, bloqueos, minArea)`: le resta al `shadow` de la capa la sección de cada zona a la
 * altura `z` (`POLY.subtract` con el mismo `minArea` que el bucle de Kiri). Sin zonas que crucen `z` devuelve el
 * MISMO `shadow`. Sólo corre con soportes normales (con árbol, ver `arbol`).
 * @param {object[]} shadow polígonos de Kiri de la capa
 * @param {number} z altura de la capa (mm, marco local del widget)
 * @param {object[]|undefined} bloqueos zonas sin soporte de la pieza
 * @param {number} [minArea] área mínima de los polígonos que quedan (lineWidth², como el bucle de Kiri)
 * @returns {object[]}
 */
function sinBloqueos(shadow, z, bloqueos, minArea) {
    if (datos)
        anotar('sinBloqueos', { z, n: bloqueos?.length ?? 0, minArea, bloqueos: JSON.stringify(bloqueos ?? null) });
    return restarSecciones(shadow, z, zonas(bloqueos), (sombra, secciones) => {
        const resto = [];
        POLY.subtract(
            sombra,
            secciones.map(s => aPolygon(s, z)),
            resto,
            null,
            z,
            minArea,
            { wasm: false },
        );
        return resto;
    });
}

/**
 * Instala los ganchos en `globalThis.laminarMovil`.
 * @returns {void}
 */
export function instalarGanchosSoportes() {
    globalThis.laminarMovil = { ...globalThis.laminarMovil, arbol, sinBloqueos };
}

/**
 * Empieza un laminado. Sin `diagnostico` (producción) no se registra nada; con él se cuentan y guardan las llamadas.
 * @param {boolean} [diagnostico=false]
 * @returns {void}
 */
export function reiniciarGanchos(diagnostico = false) {
    datos = diagnostico ? nuevoRegistro() : null;
}

/**
 * Lo que registraron los ganchos desde el último `reiniciarGanchos`.
 * @returns {{arbol: {llamadas:number, registro:object[]}, sinBloqueos: {llamadas:number, registro:object[]}}|undefined}
 *   `undefined` si no se pidió diagnóstico
 */
export function resumenGanchos() {
    return datos ? structuredClone(datos) : undefined;
}
