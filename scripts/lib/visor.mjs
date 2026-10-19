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

/**
 * Toca el lienzo del visor del paso 1 en la fracción (`fx`, `fy`) de su caja. Antes lo trae a la vista: tocar un botón
 * de más abajo (el panel de zonas, "Agregar pieza") desplaza la página y el lienzo queda fuera de la pantalla.
 * @param {import('playwright-core').Page} pagina
 * @param {number} [fx] 0 a 1, de izquierda a derecha
 * @param {number} [fy] 0 a 1, de arriba hacia abajo
 * @returns {Promise<void>}
 */
export async function tocarLienzo(pagina, fx = 0.5, fy = 0.5) {
    await pagina.locator('#visor').scrollIntoViewIfNeeded();
    const l = await pagina.locator('#visor canvas').boundingBox();
    await pagina.touchscreen.tap(l.x + l.width * fx, l.y + l.height * fy);
}
