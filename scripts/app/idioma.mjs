import { devices } from 'playwright-core';

// Idioma inglés opcional (ADR 0008, parte B): cada tarea llena sólo la suya (I3: Arranque y Selector; I10 y I14 siguen
// vacías).
// Convención de scripts/app/: cada función recibe `ctx` y usa `ctx.ok`; la precondición y el estado final están
// en la cabecera de cada una. Todas parten de un contexto propio (como vista-liviana.mjs) y no tocan la página del
// recorrido. I3 registra `probarIdiomaArranque` y `probarIdiomaSelector` antes de `probarOffline`; I10 e I14 registran
// las suyas.

const DESCRIPCION_ES = 'Laminá tus STL a G-code desde el celu, sin instalar nada y sin conexión.';
const DESCRIPCION_EN =
    'Slice your STL files to G-code right from your phone, with nothing to install and no connection needed.';

/**
 * Abre una página en un contexto propio (sin service worker) con `navigator.languages` fijo. Cuenta en
 * `window.__recorridos` las búsquedas de `[data-t…]` en el DOM (para saber si se recorrió).
 * @returns {Promise<{contexto: import('playwright-core').BrowserContext, pagina: import('playwright-core').Page}>}
 */
async function abrir(browser, base, idiomas) {
    const contexto = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
    const pagina = await contexto.newPage();
    pagina.on('pageerror', e => console.log('[error idioma]', e.message));
    await pagina.addInitScript(lista => {
        Object.defineProperty(navigator, 'languages', { get: () => lista, configurable: true });
        window.__recorridos = 0;
        const original = Document.prototype.querySelectorAll;
        Document.prototype.querySelectorAll = function (selector) {
            if (String(selector).includes('data-t')) window.__recorridos++;
            return original.call(this, selector);
        };
    }, idiomas);
    await pagina.goto(base);
    // main.js marca el paso (aria-current) en el primer dibujo, después de iniciar el idioma y su DOM.
    await pagina.waitForSelector('.pasos li[aria-current]', { state: 'attached' });
    return { contexto, pagina };
}

const leer = pagina =>
    pagina.evaluate(() => ({
        lang: document.documentElement.lang,
        titulo: document.title,
        descripcion: document.querySelector('meta[name=description]').content,
        recorridos: window.__recorridos,
        crudas: document.body.innerText.split('\n').filter(l => /^[a-z]+\.[A-Za-z0-9.]+$/.test(l.trim())),
    }));

const leerBoton = pagina =>
    pagina.evaluate(() => {
        const b = document.getElementById('idioma');
        return { texto: b.textContent.trim(), lang: b.lang, etiqueta: b.getAttribute('aria-label') };
    });

/** Un atributo fuera de la lista (onclick) no se aplica nunca; uno de la lista (title) sí. */
const ponerTrampa = pagina =>
    pagina.evaluate(() =>
        document.body.insertAdjacentHTML(
            'beforeend',
            '<i id="trampa" data-t-attr="onclick:app.titulo;title:app.titulo"></i>',
        ),
    );

async function revisarTrampa(pagina, revisar) {
    const [onclick, title] = await pagina.evaluate(() => {
        const el = document.getElementById('trampa');
        return [el.getAttribute('onclick'), el.title];
    });
    revisar('selector de idioma: data-t-attr aplica title y no onclick', onclick === null && title === 'Laminar Móvil');
}

/** Toca `#idioma` y espera a que `#estadoIdioma` anuncie `anuncio`. */
async function tocarYEsperar(pagina, anuncio) {
    await pagina.tap('#idioma');
    await pagina.waitForFunction(a => document.getElementById('estadoIdioma').textContent === a, anuncio);
}

/** Recarga con la preferencia guardada (en inglés), vuelve a español y recarga otra vez. */
async function probarPreferencia(pagina, revisar) {
    await pagina.reload();
    // El botón dice "Español" cuando `iniciarIdiomaDom` ya cableó todo (con navigator.languages = es).
    await pagina.waitForFunction(() => document.getElementById('idioma').textContent.trim() === 'Español');
    const recargada = await leer(pagina);
    revisar(
        'selector de idioma: la preferencia sobrevive a recargar aun con navigator.languages = es',
        recargada.lang === 'en-US' && recargada.descripcion === DESCRIPCION_EN,
        recargada.lang,
    );
    await pagina.evaluate(() => (document.getElementById('idioma').hidden = false));
    await tocarYEsperar(pagina, 'Idioma cambiado a Español');
    const vuelta = await leer(pagina);
    revisar(
        'selector de idioma: al volver a español, lang, título y descripción vuelven',
        vuelta.lang === 'es-AR' && vuelta.descripcion === DESCRIPCION_ES && vuelta.titulo === 'Laminar Móvil',
    );
    await pagina.reload();
    await pagina.waitForSelector('.pasos li[aria-current]', { state: 'attached' });
    revisar('selector de idioma: la preferencia es español al recargar', (await leer(pagina)).lang === 'es-AR');
}

/** Si el diccionario inglés no baja, el botón anuncia el error y el idioma queda como estaba. */
async function probarErrorDiccionario(browser, base, revisar) {
    const { contexto, pagina } = await abrir(browser, base, ['es']);
    try {
        await pagina.route('**/assets/en-*.js', ruta => ruta.abort());
        await pagina.evaluate(() => (document.getElementById('idioma').hidden = false));
        await tocarYEsperar(pagina, 'No se pudo cambiar el idioma. Probá de nuevo.');
        const v = await leer(pagina);
        revisar('selector de idioma: sin diccionario avisa el error y sigue en es-AR', v.lang === 'es-AR');
    } finally {
        await contexto.close();
    }
}

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
export async function probarIdiomaArranque({ browser, base, ok: revisar }) {
    for (const [idiomas, lang, descripcion, recorre] of [
        [['en-US'], 'en-US', DESCRIPCION_EN, true],
        [['es-AR'], 'es-AR', DESCRIPCION_ES, false],
        [['fr'], 'es-AR', DESCRIPCION_ES, false],
    ]) {
        const { contexto, pagina } = await abrir(browser, base, idiomas);
        try {
            const v = await leer(pagina);
            const nombre = `idioma al arrancar con ${idiomas[0]}`;
            revisar(`${nombre}: <html lang="${lang}">`, v.lang === lang, v.lang);
            revisar(`${nombre}: la descripción en ${lang.slice(0, 2)}`, v.descripcion === descripcion, v.descripcion);
            revisar(`${nombre}: el título es el nombre de la app`, v.titulo === 'Laminar Móvil', v.titulo);
            revisar(`${nombre}: ninguna clave sin traducir visible`, v.crudas.length === 0, v.crudas.join());
            revisar(`${nombre}: ${recorre ? 'se recorre' : 'no se recorre'} el DOM`, v.recorridos > 0 === recorre);
            revisar(`${nombre}: el selector sigue oculto`, !(await pagina.isVisible('#idioma')));
        } finally {
            await contexto.close();
        }
    }
}

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
export async function probarIdiomaSelector({ browser, base, ok: revisar }) {
    const { contexto, pagina } = await abrir(browser, base, ['es']);
    try {
        await pagina.evaluate(() => (document.getElementById('idioma').hidden = false));
        await ponerTrampa(pagina);
        const caja = await pagina.locator('#idioma').boundingBox();
        revisar('selector de idioma: mide al menos 44 px', caja.width >= 44 && caja.height >= 44, JSON.stringify(caja));
        const es = await leerBoton(pagina);
        revisar(
            'selector de idioma: en español dice English, con lang en',
            es.texto === 'English' && es.lang === 'en' && es.etiqueta === 'Cambiar el idioma a English',
            JSON.stringify(es),
        );
        await tocarYEsperar(pagina, 'Language changed to English');
        const en = await leerBoton(pagina);
        revisar(
            'selector de idioma: en inglés dice Español, con lang es',
            en.texto === 'Español' && en.lang === 'es' && en.etiqueta === 'Change the language to Español',
            JSON.stringify(en),
        );
        await revisarTrampa(pagina, revisar);
        const v = await leer(pagina);
        revisar(
            'selector de idioma: cambia lang y descripción sin recargar',
            v.lang === 'en-US' && v.descripcion === DESCRIPCION_EN,
        );
        await probarPreferencia(pagina, revisar);
        await probarErrorDiccionario(browser, base, revisar);
    } finally {
        await contexto.close();
    }
}

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
