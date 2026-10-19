// Accesibilidad (ADR 0008, Parte A). Cada función llena su tarea; las otras son esqueletos vacíos.
//
// Las cuatro siguen la convención de scripts/app/: cabecera con Flujo, Precondición y Deja, y reciben `ctx`.

import { fondoEfectivo, ratio } from '../lib/contraste.mjs';

const ESQUEMAS = ['light', 'dark'];

// Se evalúa en la página: colores calculados del elemento y de sus fondos (del elemento hacia la raíz).
// `sonda` crea un elemento temporal (`crear`) o le pone una clase a uno existente (`clase`); siempre lo deshace.
function medirEnPagina({ sel, sonda }) {
    const fondos = el => {
        const cadena = [];
        for (let n = el; n; n = n.parentElement) cadena.push(getComputedStyle(n).backgroundColor);
        return cadena;
    };
    let temporal = null;
    let clase = null;
    if (sonda?.crear) {
        temporal = document.createElement('div');
        temporal.innerHTML = sonda.crear.html;
        document.querySelector(sonda.crear.padre).append(temporal);
    }
    if (sonda?.clase) {
        clase = document.querySelector(sonda.clase.en);
        clase?.classList.add(sonda.clase.nombre);
    }
    try {
        const el = document.querySelector(sel);
        if (!el) return null;
        const e = getComputedStyle(el);
        return {
            color: e.color,
            borde: e.borderTopColor,
            bordeAncho: e.borderTopWidth,
            fondos: fondos(el),
            fondosPadre: fondos(el.parentElement),
            outlineAncho: e.outlineWidth,
            outlineEstilo: e.outlineStyle,
            outlineColor: e.outlineColor,
            enfocado: el.matches(':focus-visible') || !!el.querySelector(':focus-visible'),
            alto: e.minHeight,
            transicion: e.transitionDuration,
        };
    } finally {
        temporal?.remove();
        if (clase) clase.classList.remove(sonda.clase.nombre);
    }
}

const medir = (page, sel, sonda) => page.evaluate(medirEnPagina, { sel, sonda });

// Elementos de texto naranja o gris que dependen del color: [nombre, selector, sonda, mínimo].
const TEXTOS = [
    ['números de .pasos li', '.pasos li:not(.actual):not(.hecho)', null],
    [
        '"Poné el precio" (.enlace)',
        '#sondaPrecio .enlace',
        {
            crear: {
                padre: '#resumen',
                html: '<span id="sondaPrecio"><button class="enlace" data-poner-precio>x</button></span>',
            },
        },
    ],
    ['"Volver a los valores" (.boton.enlace)', 'section[data-paso="2"] .boton.enlace', null],
    [
        'número cambiado de Avanzado',
        '#avanzado .contador.cambiado output',
        { clase: { en: '#avanzado .contador', nombre: 'cambiado' } },
    ],
];

// Bordes que delimitan un control (WCAG 1.4.11), en el paso que corresponde.
const BORDES = {
    1: [
        ['borde de .fila-escala input', 'section[data-paso="1"] .fila-escala input'],
        ['borde de .boton', 'section[data-paso="1"] .botones-modelo .boton'],
    ],
    2: [
        ['borde de .opcion', 'section[data-paso="2"] .opcion'],
        ['borde de .contador button', 'section[data-paso="2"] .contador button'],
    ],
};

// Controles para el anillo de foco: [nombre, selector del que muestra el anillo, selector del que recibe el foco,
// HTML de una sonda temporal si el control no está siempre en la página].
const FOCO = {
    1: [
        ['.boton', 'section[data-paso="1"] .botones-modelo .boton', 'section[data-paso="1"] .botones-modelo .boton'],
        [
            '.chip',
            '#sondaChip .chip',
            '#sondaChip .chip',
            '<ul class="piezas" id="sondaChip"><li><button type="button" class="chip">x</button></li></ul>',
        ],
    ],
    2: [
        ['.opcion input', 'section[data-paso="2"] .opcion input', 'section[data-paso="2"] .opcion input'],
        [
            '.patron',
            '#sondaPatron .patron',
            '#sondaPatron input',
            '<div id="sondaPatron"><label class="patron"><input type="radio" name="sonda" />x</label></div>',
        ],
    ],
};

const fmt = n => n.toFixed(2).replace('.', ',');

async function probarPaso(ctx, paso, esquema) {
    const { page, ok } = ctx;
    const en = `paso ${paso}, ${esquema === 'dark' ? 'oscuro' : 'claro'}`;
    if (paso === 2) {
        for (const [nombre, sel, sonda] of TEXTOS) {
            const m = await medir(page, sel, sonda);
            if (!m) {
                ok(`${nombre} (${en})`, false, 'no se encontró');
                continue;
            }
            const r = ratio(m.color, fondoEfectivo(m.fondos));
            ok(`${nombre} ≥ 4,5:1 (${en})`, r >= 4.5, `${fmt(r)}:1`);
        }
    }
    for (const [nombre, sel] of BORDES[paso]) {
        const m = await medir(page, sel);
        if (!m) {
            ok(`${nombre} (${en})`, false, 'no se encontró');
            continue;
        }
        const fuera = ratio(m.borde, fondoEfectivo(m.fondosPadre));
        const dentro = ratio(m.borde, fondoEfectivo(m.fondos));
        ok(`${nombre} ≥ 3:1 (${en})`, Math.min(fuera, dentro) >= 3, `fuera ${fmt(fuera)}:1, dentro ${fmt(dentro)}:1`);
    }
    await probarFoco(ctx, paso, en);
}

async function probarFoco(ctx, paso, en) {
    const { page, ok } = ctx;
    // El anillo: se enfoca con una tecla previa para que el navegador lo trate como foco de teclado.
    for (const [nombre, selAnillo, selFoco, sonda] of FOCO[paso]) {
        await page.keyboard.press('Shift');
        if (sonda) {
            await page.evaluate(
                ([html, padre]) => {
                    const t = document.createElement('div');
                    t.id = 'sondaFoco';
                    t.innerHTML = html;
                    document.querySelector(padre).append(t);
                },
                [sonda, `section[data-paso="${paso}"]`],
            );
        }
        try {
            await page.focus(selFoco);
            const f = await medir(page, selAnillo);
            const ancho = parseFloat(f.outlineAncho);
            const rf = ratio(f.outlineColor, fondoEfectivo(f.fondosPadre));
            ok(
                `anillo de foco de ${nombre} ≥ 2 px y ≥ 3:1 (${en})`,
                f.enfocado && f.outlineEstilo !== 'none' && ancho >= 2 && rf >= 3,
                `${ancho} px ${f.outlineEstilo}, ${fmt(rf)}:1${f.enfocado ? '' : ', sin :focus-visible'}`,
            );
        } finally {
            await page.evaluate(() => {
                document.activeElement?.blur();
                document.getElementById('sondaFoco')?.remove();
            });
        }
    }
}

/**
 * Contraste de los colores del ADR 0008 (H4, H5, H6, H14, H15) en claro y oscuro, medido con `getComputedStyle`
 * y `scripts/lib/contraste.mjs`: texto naranja y números de los pasos ≥ 4,5:1, bordes de controles ≥ 3:1, anillo
 * de foco ≥ 2 px y ≥ 3:1, `prefers-reduced-motion` sin transiciones y alto de toque de `#capa` y `.tilde-capa`.
 *
 * Flujo: con el paso 2 visible mide ese paso; vuelve con "atrás" al paso 1, mide y avanza de nuevo (como hace
 * probarConfig). Los elementos que no existen en el paso 2 (el botón "Poné el precio" del resumen y el número
 * cambiado de Avanzado) se miden con una sonda temporal que se quita al terminar (igual el chip y el patrón del anillo de foco).
 *
 * Precondición: paso 2 visible con el cubo cargado.
 * Deja: igual (mismo paso, calidad y modelo; sin foco ni emulación de medios).
 *
 * Dónde se registra: en AREAS de probar-app.mjs justo después de `probarConfig` y antes de `volverAlPaso1`, que
 * es el único punto con el paso 2 visible y el cubo cargado sin repetir el recorrido; no cambia nada que lea
 * la siguiente área.
 *
 * @param {import('../lib/app.mjs').Ctx} ctx
 */
export async function probarContraste(ctx) {
    const { page, ok } = ctx;
    try {
        for (const esquema of ESQUEMAS) {
            await page.emulateMedia({ colorScheme: esquema });
            await probarPaso(ctx, 2, esquema);
            await page.goBack();
            await page.waitForSelector('section[data-paso="1"]:not([hidden])');
            await probarPaso(ctx, 1, esquema);
            await page.goForward();
            await page.waitForSelector('section[data-paso="2"]:not([hidden])');
        }
        await page.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' });
        const t = await medir(page, '.interruptor input');
        ok(
            'prefers-reduced-motion anula las transiciones',
            t && parseFloat(t.transicion) === 0,
            `duración ${t?.transicion}`,
        );
        await page.emulateMedia({ reducedMotion: null });
        for (const sel of ['#capa', '.tilde-capa']) {
            const m = await medir(page, sel);
            ok(`alto de toque de ${sel} ≥ 44 px`, m && parseFloat(m.alto) >= 44, `min-height ${m?.alto}`);
        }
    } finally {
        await page.emulateMedia({ colorScheme: null, reducedMotion: null });
    }
}

export { probarAccesibilidadPasos } from './accesibilidad-pasos.mjs';

/**
 * Regiones vivas, nombres y encabezados (A3). Esqueleto: lo llena la tarea A3.
 *
 * Precondición: paso 2 visible.
 * Deja: paso 2 visible.
 *
 * @param {import('../lib/app.mjs').Ctx} _ctx
 */
export async function probarAccesibilidadRegiones(_ctx) {}

/**
 * Visor y deslizador de capas (ADR 0008, A4; H8 y H9).
 *
 * Flujo: lee `#descripcionVisor` (en el paso 1, oculto pero en el DOM) y comprueba que hable de 20 mm; revisa que
 * `#visor` y `#visorCapas` sean `role="group"` con un nombre y una descripción vinculada que existe, y que los
 * canvas de los dos visores tengan `aria-hidden="true"`; mueve `#capa` con el teclado (ArrowLeft) y compara
 * `aria-valuetext` con el texto de la capa ("Capa N de M, Z mm") antes y después; vuelve a la capa de partida.
 *
 * Precondición: paso 4 con resultado (cubo de 20 mm, vista de capas armada).
 * Deja: igual (mismo paso y misma capa; el foco queda en `#capa`).
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
    await probarDeslizador(ctx);
    await probarGlifos(ctx);
}

// aria-valuetext de #capa contra el texto visible de #textoCapa, antes y después de moverse con el teclado.
async function probarDeslizador({ page, ok }) {
    const valuetext = () => page.getAttribute('#capa', 'aria-valuetext');
    // "Capa 71/72 · Z 19,88 mm" -> "Capa 71 de 72, 19,88 mm"
    const esperado = async () => {
        const m = (await page.textContent('#textoCapa')).match(/Capa (\d+)\/(\d+) · Z ([\d.,]+) mm/);
        return m && `Capa ${m[1]} de ${m[2]}, ${m[3]} mm`;
    };
    const antes = await esperado();
    ok('#capa: aria-valuetext "Capa N de M, Z mm"', !!antes && (await valuetext()) === antes, await valuetext());
    await page.focus('#capa');
    await page.keyboard.press('ArrowLeft');
    const despues = await esperado();
    ok(
        '#capa: al moverse con el teclado cambia aria-valuetext',
        despues !== antes && (await valuetext()) === despues,
        `${await valuetext()} (esperado ${despues})`,
    );
    await page.keyboard.press('ArrowRight');
    ok('#capa: al volver recupera el aria-valuetext', (await valuetext()) === antes, await valuetext());
}

// Los glifos (▶ ❚❚ ⏸ ✕) van en `<span aria-hidden="true">`: el nombre accesible no los lleva, aunque el JS cambie el texto.
async function probarGlifos({ page, ok }) {
    const sinGlifos = sel =>
        page.evaluate(s => {
            const texto = n =>
                n.nodeType === 3
                    ? n.textContent
                    : n.getAttribute?.('aria-hidden') === 'true'
                      ? ''
                      : [...n.childNodes].map(texto).join('');
            const el = document.querySelector(s);
            return { visible: el.textContent, nombre: (el.getAttribute('aria-label') ?? texto(el)).trim() };
        }, sel);
    const GLIFO = /[▶❚⏸✕]/u;
    const capa = await page.inputValue('#capa');
    const pausar = await sinGlifos('#pausarCapa');
    ok(
        '#pausarCapa: el nombre no lleva el glifo',
        GLIFO.test(pausar.visible) && !GLIFO.test(pausar.nombre),
        pausar.nombre,
    );
    await page.tap('#reproducir');
    const tocando = await sinGlifos('#reproducir');
    ok(
        '#reproducir: tocando, el nombre es "Pausar" sin glifo',
        /^Pausar$/.test(tocando.nombre) && GLIFO.test(tocando.visible),
        tocando.nombre,
    );
    // La reproducción puede haber terminado sola (unos 2 s): sólo se toca para parar si sigue sonando.
    await page.evaluate(() => {
        const b = document.getElementById('reproducir');
        if (b.getAttribute('aria-label') === 'Pausar') b.click();
    });
    const parado = await sinGlifos('#reproducir');
    ok('#reproducir: parado, el nombre es "Reproducir" sin glifo', /^Reproducir$/.test(parado.nombre), parado.nombre);
    await page.locator('#capa').fill(capa);
    const otra = await sinGlifos('#pausarCapa');
    ok('#pausarCapa: tras volver a la capa sigue sin glifo en el nombre', !GLIFO.test(otra.nombre), otra.nombre);
}
