// Puente entre Kiri y nuestro código de soportes (ADR 0004). T0: puente "de mentira".
//
// Los parches de scripts/vendor-kiri.mjs (`PARCHE laminar-movil` en processSupports) llaman a
// `globalThis.laminarMovil?.arbol(...)` y `globalThis.laminarMovil?.sinBloqueos(...)`. Acá se instalan esos dos
// ganchos. En T0 no hacen nada (el G-code sale igual que sin ellos) pero cuentan y registran cada llamada, para
// comprobar que disparan donde esperamos. T4 los reemplaza por el árbol y la resta de zonas reales.
//
//   instalarGanchosSoportes  instala los ganchos (el worker lo llama una vez, al arrancar)
//   reiniciarGanchos         vuelve los contadores a cero (al empezar cada laminado)
//   resumenGanchos           copia simple de lo registrado, lista para mandar en `info.ganchos`

const TOPE_REGISTRO = 5000; // llamadas que se guardan por gancho (memoria acotada)

const nuevoRegistro = () => ({
    arbol: { llamadas: 0, registro: [] },
    sinBloqueos: { llamadas: 0, registro: [] },
});
let datos = nuevoRegistro();

function anotar(gancho, entrada) {
    gancho.llamadas++;
    if (gancho.registro.length < TOPE_REGISTRO) gancho.registro.push(entrada);
}

/**
 * Gancho `arbol(stack, bloqueos, opciones)`: en T0 no genera nada y devuelve `false`, así Kiri sigue con 'automatic'.
 * @param {{z:number}[]} stack slices de Kiri, de abajo hacia arriba
 * @param {object[]|undefined} bloqueos zonas sin soporte de la pieza (`widget.anno.bloqueos`)
 * @param {object} opciones ancho de línea, alto de capa y ángulo
 * @returns {boolean}
 */
function arbol(stack, bloqueos, opciones) {
    anotar(datos.arbol, { capas: stack.length, n: bloqueos?.length ?? 0, opciones });
    return false;
}

/**
 * Gancho `sinBloqueos(shadow, z, bloqueos)`: en T0 devuelve el `shadow` sin cambios.
 * @param {object[]} shadow polígonos de Kiri de la capa
 * @param {number} z altura de la capa (mm, marco local del widget)
 * @param {object[]|undefined} bloqueos zonas sin soporte de la pieza
 * @returns {object[]}
 */
function sinBloqueos(shadow, z, bloqueos) {
    anotar(datos.sinBloqueos, { z, n: bloqueos?.length ?? 0, bloqueos: JSON.stringify(bloqueos ?? null) });
    return shadow;
}

/**
 * Instala los ganchos en `globalThis.laminarMovil`.
 * @returns {void}
 */
export function instalarGanchosSoportes() {
    globalThis.laminarMovil = { ...globalThis.laminarMovil, arbol, sinBloqueos };
}

/** Pone en cero los contadores y los registros. */
export function reiniciarGanchos() {
    datos = nuevoRegistro();
}

/**
 * Lo que registraron los ganchos desde el último `reiniciarGanchos`.
 * @returns {{arbol: {llamadas:number, registro:object[]}, sinBloqueos: {llamadas:number, registro:object[]}}}
 */
export function resumenGanchos() {
    return structuredClone(datos);
}
