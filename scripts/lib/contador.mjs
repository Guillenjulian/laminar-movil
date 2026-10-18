// Contador de pruebas: imprime las líneas ✔/✘ y el resumen final.

/**
 * @typedef {(nombre: string, condicion: unknown, detalle?: string) => void} Ok
 *   Registra una prueba: imprime "✔ nombre detalle" o "✘ nombre detalle" y cuenta las fallas.
 */

/**
 * @returns {{ ok: Ok, terminar: () => number }} `terminar()` imprime el resumen y devuelve el código de salida.
 */
export function crearContador() {
    let fallas = 0;
    /** @type {Ok} */
    function ok(nombre, condicion, detalle = '') {
        console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre} ${detalle}`);
        if (!condicion) fallas++;
    }
    function terminar() {
        console.log(fallas ? `\n${fallas} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
        return fallas ? 1 : 0;
    }
    return { ok, terminar };
}
