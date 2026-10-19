// Idioma inglés opcional (ADR 0008, parte B): esqueletos vacíos; cada tarea siguiente llena sólo la suya.
// Convención de scripts/app/: cada función recibe `ctx` y usa `ctx.ok`; la precondición y el estado final están
// en la cabecera de cada una. Todas parten de un contexto propio (como vista-liviana.mjs) y no tocan la página del
// recorrido. I2 sólo crea los esqueletos y NO los registra en scripts/probar-app.mjs: los registra I3
// (`probarIdiomaArranque` y `probarIdiomaSelector` antes de `probarOffline`, junto con la tarea que los llena).

/**
 * Arranque en el idioma del navegador (I3).
 *
 * Flujo: con `navigator.languages = ['en-US']` (`addInitScript`): `<html lang="en-US">`, título y `#sinModelo h2` en
 * inglés y ninguna clave sin traducir visible (regex `^[a-z]+\.[A-Za-z0-9.]+$`); con `['es-AR']` y con `['fr']`, español.
 *
 * Precondición: cualquiera (usa su propio contexto).
 * Deja: la página del recorrido sin cambios.
 * @param {import('../lib/app.mjs').Ctx} _ctx
 */
export async function probarIdiomaArranque(_ctx) {}

/**
 * Selector `#idioma` y su preferencia (I3).
 *
 * Flujo: el botón dice "English" en español y "Español" en inglés, con su `lang`; al tocarlo cambia sin recargar y el
 * modelo cargado sigue; la preferencia sobrevive a `reload()` aun con `navigator.languages = ['es']`; `#estadoIdioma`
 * anuncia; el botón mide >= 44 px y no se superpone en 360 px de ancho.
 *
 * Precondición: cualquiera (usa su propio contexto; el botón nace `hidden` y se destapa con `page.evaluate`).
 * Deja: la página del recorrido sin cambios.
 * @param {import('../lib/app.mjs').Ctx} _ctx
 */
export async function probarIdiomaSelector(_ctx) {}

/**
 * Paso 2 en inglés (I10).
 *
 * Flujo: calidad, material, soportes y desplegables en inglés; `1.234,5` pasa a `1,234.5` en una medida; un nombre de
 * archivo con acentos no se rompe.
 *
 * Precondición: cualquiera (usa su propio contexto).
 * Deja: la página del recorrido sin cambios.
 * @param {import('../lib/app.mjs').Ctx} _ctx
 */
export async function probarIdiomaPaso2(_ctx) {}

/**
 * Recorrido completo en inglés (I14).
 *
 * Flujo: cubo -> paso 2 -> laminar -> paso 4 en inglés: ningún texto visible en español salvo los de "fuera de v1"
 * (con `lang="es-AR"`), cada hoja abierta, `alert()` sin claves; una vez con red y una sin red (`context.setOffline`)
 * para el chunk `en`. Es la única que no bloquea los service workers.
 *
 * Precondición: cualquiera (usa su propio contexto).
 * Deja: la página del recorrido sin cambios.
 * @param {import('../lib/app.mjs').Ctx} _ctx
 */
export async function probarIdiomaCompleto(_ctx) {}
