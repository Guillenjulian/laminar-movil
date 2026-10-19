// Accesibilidad, tarea A3 (ADR 0008): regiones vivas, nombres y encabezados. Se re-exporta desde accesibilidad.mjs.

// Se evalúa en la página: estado de las regiones, nombres y encabezados que audita A3.
function leerRegiones() {
    const nombre = el => {
        const ids = el.getAttribute('aria-labelledby');
        if (ids)
            return ids
                .split(/\s+/)
                .map(i => document.getElementById(i)?.textContent.trim() ?? '')
                .join(' ')
                .trim();
        return el.getAttribute('aria-label') ?? '';
    };
    const contadores = [...document.querySelectorAll('.contador')].map(c => ({
        clave: c.dataset.clave ?? c.dataset.av,
        rol: c.getAttribute('role'),
        nombre: nombre(c),
        botones: [...c.querySelectorAll('button')].map(b => b.getAttribute('aria-label') ?? ''),
    }));
    const h2 = document.querySelector('section[data-paso="4"] h2');
    const sueltos = [...h2.childNodes].filter(
        n => n.nodeType === 3 && /\p{Extended_Pictographic}/u.test(n.textContent),
    );
    const glifos = [
        {
            sel: 'el h2 del paso 4',
            sueltos: sueltos.length,
            marcados: h2.querySelectorAll('[aria-hidden="true"]').length,
        },
    ];
    return {
        errores: ['errorLaminado', 'errorImpresora', 'errorLitofania', 'errorTorre'].map(id => ({
            id,
            rol: document.getElementById(id)?.getAttribute('role') ?? null,
        })),
        contadores,
        glifos,
    };
}

// Con el paso 3 en marcha: #progreso tiene nombre y aria-valuetext con el porcentaje.
async function revisarProgreso({ page, ok }) {
    const p = await page.evaluate(() => {
        const el = document.getElementById('progreso');
        const ids = el.getAttribute('aria-labelledby');
        return {
            nombre: ids ? document.getElementById(ids)?.textContent.trim() : el.getAttribute('aria-label'),
            texto: el.getAttribute('aria-valuetext'),
            valor: el.getAttribute('aria-valuenow'),
        };
    });
    ok('#progreso tiene nombre accesible', !!p.nombre, p.nombre);
    ok(
        '#progreso tiene aria-valuenow y aria-valuetext con el %',
        /^\d+ %, \S/.test(p.texto ?? '') && !!p.valor,
        `${p.valor} / ${p.texto}`,
    );
}

// Los avisos que cambian solos son regiones vivas (role="status").
async function revisarEstados({ page, ok }) {
    for (const id of ['avisoModelo', 'avisoTorre', 'cargando']) {
        const rol = await page.getAttribute('#' + id, 'role');
        ok(`#${id} es role="status"`, rol === 'status', String(rol));
    }
}

// Con un aviso activo, tocar la escala no reescribe el nodo: el lector no lo repite. Cuenta mutaciones del nodo.
async function revisarSinReanuncio({ page, ok }) {
    const observar = () => {
        window.__mutaciones = 0;
        window.__obs?.disconnect();
        window.__obs = new MutationObserver(m => (window.__mutaciones += m.length));
        window.__obs.observe(document.getElementById('avisoModelo'), {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
        });
    };
    const tocar = async () => {
        await page.tap('#escalaMas');
        await page.tap('#escalaMenos');
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        return page.evaluate(() => window.__mutaciones);
    };
    const texto = () => page.textContent('#avisoModelo');
    await page.goBack(); // la escala está en el paso 1
    await page.waitForSelector('section[data-paso="1"]:not([hidden])');
    await page.waitForFunction(() => /Modelo pesado/.test(document.getElementById('avisoModelo').textContent));
    await page.evaluate(observar);
    ok('"Modelo pesado" activo: tocar la escala no reescribe #avisoModelo', (await tocar()) === 0, await texto());

    await page.fill('#escala', '2000');
    await page.locator('#escala').blur();
    await page.waitForFunction(() => /No entra/.test(document.getElementById('avisoModelo').textContent));
    ok('una pieza que no entra: sólo #avisoModelo lo dice', await page.isHidden('#avisoEntran'));
    await page.evaluate(observar);
    ok('"No entra" activo: tocar la escala no reescribe #avisoModelo', (await tocar()) === 0, await texto());
    await page.tap('#restablecerModelo');
    await page.evaluate(() => window.__obs.disconnect());
    await page.goForward();
    await page.waitForSelector('section[data-paso="2"]:not([hidden])');
}

const PAYLOAD = '<img src=x onerror=window.__xss=1>';

// "No entra" con el nombre de una impresora propia con HTML: se ve literal y no se ejecuta (escapar). Además, con
// una pieza y una copia lo dice sólo #avisoModelo; con una copia más, sólo #avisoEntran.
async function revisarNoEntra({ page, ok }) {
    const texto = () => page.textContent('#avisoModelo');
    const modeloDice = () => page.evaluate(() => /No entra/.test(document.getElementById('avisoModelo').textContent));
    await page.tap('#cambiarImpresora');
    await page.tap('#nuevaImpresora');
    await page.fill('[name=nombre]', PAYLOAD);
    await page.tap('#formImpresora [type=submit]');
    await page.waitForSelector('#hojaMiImpresora', { state: 'hidden' });
    await page.goBack();
    await page.waitForSelector('section[data-paso="1"]:not([hidden])');
    await page.fill('#escala', '2000');
    await page.locator('#escala').blur();
    await page.waitForFunction(() => /No entra/.test(document.getElementById('avisoModelo').textContent));
    const xss = await page.evaluate(() => ({
        ejecutado: window.__xss === 1,
        imgs: document.querySelectorAll('#avisoModelo img').length,
    }));
    ok(
        'nombre de impresora con HTML: no se ejecuta ni crea nodos',
        !xss.ejecutado && xss.imgs === 0,
        JSON.stringify(xss),
    );
    ok('nombre de impresora con HTML: se ve literal', (await texto()).includes(PAYLOAD));
    await page.tap('#copiasMas');
    await page.waitForFunction(() => !/No entra/.test(document.getElementById('avisoModelo').textContent));
    ok('una copia más: sólo #avisoEntran', (await page.isVisible('#avisoEntran')) && !(await modeloDice()));
    await page.tap('#copiasMenos');
    await page.waitForFunction(() => /No entra/.test(document.getElementById('avisoModelo').textContent));
    ok('una copia menos: sólo #avisoModelo', (await page.isHidden('#avisoEntran')) && (await modeloDice()));
    await page.tap('#restablecerModelo');
    await page.goForward();
    await page.waitForSelector('section[data-paso="2"]:not([hidden])');
    await borrarPropia(page);
}

// Borra la impresora propia elegida (vuelve la inicial) para dejar el estado como estaba.
async function borrarPropia(page) {
    await page.tap('#editarImpresora');
    await page.tap('#borrarImpresora');
    await page.waitForSelector('#hojaMiImpresora', { state: 'hidden' });
}

// La hoja de impresoras: sus encabezados no saltan de nivel.
async function revisarHojaImpresoras({ page, ok, visible }) {
    await page.tap('#cambiarImpresora');
    ok('hoja de impresoras abierta', await visible('#hojaImpresoras'));
    const niveles = await page.$$eval('#hojaImpresoras :is(h1,h2,h3,h4)', hs => hs.map(h => +h.tagName[1]));
    const salta = niveles.some((n, i) => i > 0 && n - niveles[i - 1] > 1) || niveles[0] !== 1;
    ok('encabezados de la hoja de impresoras sin saltos', !salta && niveles.length > 2, niveles.join(' '));
    await page.goBack();
    ok(
        'la hoja de impresoras se cierra',
        !(await visible('#hojaImpresoras')) && (await visible('section[data-paso="2"]')),
    );
}

/**
 * Regiones vivas, nombres y encabezados (ADR 0008, A3; H7, H10, H11, H12).
 *
 * Flujo: toca Laminar (esfera pesada) y mira `#progreso`; cancela. En el paso 2 lee los `role=alert`, los
 * `.contador`, el 🎉 con `aria-hidden` (▶ y ⏸ los reescribe vista-capas.js: los cubre A4), los `status`, que tocar
 * la escala con un aviso activo no reescriba `#avisoModelo`, el nombre de una impresora propia con HTML en "No entra" (escapado), "No entra" sólo en uno de los dos avisos, y los encabezados de la hoja de impresoras.
 *
 * Precondición: paso 2 visible (con la esfera pesada de probarCancelar).
 * Deja: paso 2 visible, ninguna hoja abierta (igual que antes de llamarla).
 *
 * @param {import('../lib/app.mjs').Ctx} ctx
 */
export async function probarAccesibilidadRegiones(ctx) {
    const { page, ok } = ctx;
    await page.tap('#laminar');
    await page.waitForFunction(() => parseInt(document.getElementById('porcentaje').textContent) >= 2, null, {
        timeout: 60000,
    });
    await revisarProgreso(ctx);
    await page.tap('#cancelar');
    await page.waitForSelector('section[data-paso="2"]:not([hidden])');

    const r = await page.evaluate(leerRegiones);
    for (const e of r.errores) ok(`${e.id} es role="alert"`, e.rol === 'alert', String(e.rol));
    ok('hay 11 .contador', r.contadores.length === 11, String(r.contadores.length));
    for (const c of r.contadores) {
        const distintos = c.botones.length === 2 && c.botones.every(Boolean) && c.botones[0] !== c.botones[1];
        ok(`.contador ${c.clave}: role="group" con nombre`, c.rol === 'group' && !!c.nombre, c.nombre);
        ok(`.contador ${c.clave}: botones con aria-label distintos`, distintos, c.botones.join(' | '));
    }
    for (const g of r.glifos)
        ok(`glifo de ${g.sel} en aria-hidden`, g.sueltos === 0 && g.marcados > 0, `${g.sueltos} sueltos`);

    await revisarEstados(ctx);
    await revisarSinReanuncio(ctx);
    await revisarNoEntra(ctx);
    await revisarHojaImpresoras(ctx);
}
