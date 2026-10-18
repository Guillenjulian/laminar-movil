// Espera del visor 3D en `test:app` (ADR 0006, T3b).
//
// three.js se baja en un chunk aparte, así que el canvas del visor aparece cuando `visor-carga.js` termina de
// cargar (`data-visor="cargando"` → `"listo"`). Toda área que lea el canvas lo espera con esto, nunca con un sleep.

/**
 * Espera a que el visor del selector esté listo (`data-visor="listo"`) y tenga su canvas.
 * @param {import('playwright-core').Page} pagina
 * @param {'#visor' | '#visorCapas'} selector contenedor del visor
 * @param {number} [timeout] ms (por defecto 30 s: sólo falla si el chunk no llega)
 * @returns {Promise<void>}
 */
export async function esperarVisor(pagina, selector, timeout = 30000) {
    await pagina.waitForFunction(
        s => {
            const c = document.querySelector(s);
            return c?.dataset.visor === 'listo' && !!c.querySelector('canvas');
        },
        selector,
        { timeout },
    );
}
