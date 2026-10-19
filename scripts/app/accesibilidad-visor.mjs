// Accesibilidad, tarea A4 (ADR 0008): descripción del visor, deslizador de capas y glifos. Se re-exporta desde
// accesibilidad.mjs. Convención de scripts/app/: Flujo, Precondición y Deja en cada función; reciben `ctx`.

const GLIFO = /[▶❚⏸✕]/u;

// Se evalúa en la página: el texto de `el` dentro y fuera de los `[aria-hidden="true"]` (lo que oye un lector).
function auditarGlifos(sel) {
    const el = document.querySelector(sel);
    const fuera = n =>
        n.nodeType === 3
            ? n.textContent
            : n.getAttribute?.('aria-hidden') === 'true'
              ? ''
              : [...n.childNodes].map(fuera).join('');
    const dentro = [...el.querySelectorAll('[aria-hidden="true"]')].map(s => s.textContent).join('');
    return { visible: el.textContent, fuera: fuera(el), dentro, etiqueta: el.getAttribute('aria-label') };
}

const glifoEnSpan = a => GLIFO.test(a.dentro) && !GLIFO.test(a.fuera);

/**
 * Descripción del visor en el paso 1 (A4): al cambiar las copias de la pieza, `#descripcionVisor` cambia al texto
 * exacto, y al volver a una copia recupera el de antes.
 *
 * Precondición: paso 1 con el cubo de ejemplo cargado (una pieza, una copia, 100 %).
 * Deja: igual.
 *
 * @param {import('../lib/app.mjs').Ctx} ctx
 */
export async function probarAccesibilidadDescripcion(ctx) {
    const { page, ok } = ctx;
    const texto = () => page.textContent('#descripcionVisor');
    const base = 'Vista 3D de la cama con 1 pieza: cubo-20mm.stl (20,0 × 20,0 × 20,0 mm';
    const antes = await texto();
    ok('descripción del visor: una pieza con su medida', antes === `${base}).`, antes);
    await page.tap('#copiasMas');
    ok('descripción del visor: con 2 copias lo dice', (await texto()) === `${base}, 2 copias).`, await texto());
    await page.tap('#copiasMenos');
    ok('descripción del visor: al volver a 1 copia recupera el texto', (await texto()) === antes, await texto());
}

/**
 * Visor y deslizador de capas en el paso 4 (A4; H8 y H9).
 *
 * Flujo: comprueba que `#descripcionVisor` hable de 20 mm; que `#visor` y `#visorCapas` sean `role="group"` con
 * nombre y descripción vinculada que existe, y que sus canvas tengan `aria-hidden="true"`; mueve `#capa` con el
 * teclado y compara `aria-valuetext` ("Capa N de M, Z mm") con `#textoCapa`; marca una pausa y comprueba
 * ", con pausa" y que los glifos (▶ ❚❚ ⏸ ✕) estén sólo en `span[aria-hidden]` de #reproducir, #pausarCapa,
 * #textoCapa y la lista de pausas; quita la pausa y vuelve a la capa de partida.
 *
 * Precondición: paso 4 con resultado (cubo de 20 mm, vista de capas armada, sin pausas).
 * Deja: igual (misma capa, sin pausas; el foco queda en `#capa`).
 *
 * @param {import('../lib/app.mjs').Ctx} ctx
 */
export async function probarAccesibilidadVisor(ctx) {
    const { page, ok } = ctx;
    await page.waitForSelector('#controlCapas:not([hidden])', { timeout: 30000 });
    const descripcion = await page.evaluate(() => document.getElementById('descripcionVisor')?.textContent ?? '');
    ok(
        'descripción del visor: nombra la pieza y su medida en mm',
        /cubo-20mm\.stl/.test(descripcion) && /\b20,0\b/.test(descripcion) && /mm/.test(descripcion),
        descripcion,
    );
    const grupos = await page.evaluate(() =>
        ['visor', 'visorCapas'].map(id => {
            const el = document.getElementById(id);
            const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
            return {
                id,
                rol: el.getAttribute('role'),
                nombre: el.getAttribute('aria-label'),
                existen: ids.length > 0 && ids.every(i => document.getElementById(i)),
                canvas: [...el.querySelectorAll('canvas')].map(c => c.getAttribute('aria-hidden')),
            };
        }),
    );
    for (const g of grupos) {
        ok(`#${g.id}: role="group" con nombre`, g.rol === 'group' && !!g.nombre, `${g.rol} / ${g.nombre}`);
        ok(`#${g.id}: aria-describedby apunta a nodos que existen`, g.existen);
        ok(
            `#${g.id}: el canvas tiene aria-hidden="true"`,
            g.canvas.length > 0 && g.canvas.every(v => v === 'true'),
            g.canvas.join(','),
        );
    }
    const capa = await page.inputValue('#capa');
    await probarDeslizador(ctx);
    await probarGlifosReproducir(ctx);
    await probarPausa(ctx);
    await page.locator('#capa').fill(capa);
}

// "Capa 71/72 · Z 19,88 mm" -> "Capa 71 de 72, 19,88 mm"
async function esperadoDe(page) {
    const m = (await page.textContent('#textoCapa')).match(/Capa (\d+)\/(\d+) · Z ([\d.,]+) mm/);
    return m && `Capa ${m[1]} de ${m[2]}, ${m[3]} mm`;
}

// aria-valuetext de #capa contra el texto visible de #textoCapa, antes y después de moverse con el teclado.
async function probarDeslizador({ page, ok }) {
    const valuetext = () => page.getAttribute('#capa', 'aria-valuetext');
    const antes = await esperadoDe(page);
    ok('#capa: aria-valuetext "Capa N de M, Z mm"', !!antes && (await valuetext()) === antes, await valuetext());
    ok('#capa: no repite #textoCapa como descripción', (await page.getAttribute('#capa', 'aria-describedby')) === null);
    await page.focus('#capa');
    await page.keyboard.press('ArrowLeft');
    const despues = await esperadoDe(page);
    ok(
        '#capa: al moverse con el teclado cambia aria-valuetext',
        despues !== antes && (await valuetext()) === despues,
        `${await valuetext()} (esperado ${despues})`,
    );
    await page.keyboard.press('ArrowRight');
    ok('#capa: al volver recupera el aria-valuetext', (await valuetext()) === antes, await valuetext());
}

// Reproducir y parar en el mismo evaluate: sin depender de cuánto dura la reproducción.
async function probarGlifosReproducir({ page, ok }) {
    const r = await page.evaluate(
        ([auditar]) => {
            const audit = new Function(`return (${auditar})`)();
            const b = document.getElementById('reproducir');
            const parado = audit('#reproducir');
            b.click();
            const tocando = audit('#reproducir');
            b.click(); // para (si ya terminó sola no puede: es síncrono)
            return { parado, tocando, final: audit('#reproducir') };
        },
        [auditarGlifos.toString()],
    );
    ok(
        '#reproducir parado: el glifo está en un span aria-hidden y el nombre es "Reproducir"',
        glifoEnSpan(r.parado) && r.parado.etiqueta === 'Reproducir',
        JSON.stringify(r.parado),
    );
    ok(
        '#reproducir tocando: el glifo está en un span aria-hidden y el nombre es "Pausar"',
        glifoEnSpan(r.tocando) && r.tocando.etiqueta === 'Pausar',
        JSON.stringify(r.tocando),
    );
    ok(
        '#reproducir vuelve a "Reproducir"',
        glifoEnSpan(r.final) && r.final.etiqueta === 'Reproducir',
        JSON.stringify(r.final),
    );
}

// Una pausa en la capa actual: valuetext ", con pausa", glifos fuera del nombre y la pausa se quita al final.
async function probarPausa({ page, ok }) {
    const sinPausa = await esperadoDe(page);
    const audit = sel => page.evaluate(auditarGlifos, sel);
    ok('#pausarCapa (sin pausa): el glifo está en un span aria-hidden', glifoEnSpan(await audit('#pausarCapa')));
    await page.evaluate(() => document.getElementById('pausarCapa').click());
    const valuetext = await page.getAttribute('#capa', 'aria-valuetext');
    ok('#capa con pausa: aria-valuetext termina en ", con pausa"', valuetext === `${sinPausa}, con pausa`, valuetext);
    ok('#textoCapa con pausa: el ⏸ está en un span aria-hidden', glifoEnSpan(await audit('#textoCapa')));
    ok('#pausarCapa con pausa: el ✕ está en un span aria-hidden', glifoEnSpan(await audit('#pausarCapa')));
    ok('lista de pausas: el ⏸ está en un span aria-hidden', glifoEnSpan(await audit('#listaPausas small')));
    await page.evaluate(() => document.getElementById('pausarCapa').click());
    const quitada = await page.getAttribute('#capa', 'aria-valuetext');
    ok('#capa sin pausa: aria-valuetext vuelve a "Capa N de M, Z mm"', quitada === sinPausa, quitada);
}
