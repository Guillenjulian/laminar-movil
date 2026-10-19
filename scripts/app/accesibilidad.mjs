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

// Dónde está el foco: el id y a qué zona pertenece (dentro de `selector`, el cuerpo o fuera).
const foco = (page, selector) =>
    page.evaluate(
        sel => ({
            id: document.activeElement?.id || '',
            etiqueta: document.activeElement?.tagName,
            dentro: !!document.activeElement?.closest(sel),
        }),
        selector,
    );

const actuales = page => page.$$eval('.pasos li[aria-current]', lis => lis.map(li => li.dataset.paso).join(','));

// 14 pulsaciones hacia adelante y 14 hacia atrás: el foco siempre dentro de la hoja (o en body, fuera del documento).
async function recorrerConTab(page, hoja) {
    const salidas = [];
    for (const tecla of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 14; i++) {
            await page.keyboard.press(tecla);
            const f = await foco(page, hoja);
            if (!f.dentro && f.etiqueta !== 'BODY') salidas.push(`${tecla} ${i + 1}: ${f.etiqueta}#${f.id}`);
        }
    }
    return salidas;
}

// Escape y espera a que la hoja se cierre; si no se cierra devuelve false y la cierra con atrás (para seguir).
async function cerrarConEscape(page, hoja) {
    await page.keyboard.press('Escape');
    const cerro = await page.waitForSelector(hoja, { state: 'hidden', timeout: 2000 }).then(
        () => true,
        () => false,
    );
    if (!cerro) await page.goBack();
    return cerro;
}

async function probarPasoActual({ page, ok }) {
    ok('aria-current="step" sólo en el paso 2', (await actuales(page)) === '2', await actuales(page));
    const texto = await page.textContent('.pasos li[data-paso="2"]');
    ok('el paso dice "Paso 2 de 4" para lectores', texto.replace(/\s+/g, ' ').trim() === 'Paso 2 de 4', texto);
    await page.goBack();
    await page.waitForSelector('section[data-paso="1"]:not([hidden])');
    ok('aria-current pasa al paso 1', (await actuales(page)) === '1', await actuales(page));
    const f1 = await foco(page, 'section[data-paso="1"]');
    ok('al volver al paso 1 el foco está en el paso 1', f1.dentro, `${f1.etiqueta}#${f1.id}`);
    await page.tap('#siguiente');
    await page.waitForSelector('section[data-paso="2"]:not([hidden])');
    ok('aria-current vuelve al paso 2', (await actuales(page)) === '2', await actuales(page));
    const f2 = await foco(page, 'section[data-paso="2"]');
    ok(
        'tras "Siguiente" el foco está en el encabezado del paso 2',
        f2.dentro && f2.etiqueta === 'H2',
        `${f2.etiqueta}#${f2.id}`,
    );
}

async function estadoHoja(page, hoja) {
    return page.evaluate(id => {
        const h = document.getElementById(id);
        const inerte = sel => document.querySelector(sel)?.inert === true;
        return {
            dialogo: h.getAttribute('role') === 'dialog' && h.getAttribute('aria-modal') === 'true',
            nombre: document.getElementById(h.getAttribute('aria-labelledby'))?.tagName === 'H1',
            fondo: inerte('body > header.barra') && inerte('#main') && inerte('footer.acciones'),
            libre: !inerte('body > header.barra') && !inerte('#main') && !inerte('footer.acciones'),
        };
    }, hoja);
}

async function probarHojaImpresoras({ page, ok, visible }) {
    await page.tap('#cambiarImpresora');
    const e = await estadoHoja(page, 'hojaImpresoras');
    ok('la hoja es un diálogo modal con nombre', e.dialogo && e.nombre);
    ok('con la hoja abierta el fondo está inert', e.fondo);
    ok('al abrir la hoja el foco va a la búsqueda', (await foco(page, '#hojaImpresoras')).id === 'buscarImpresora');
    // Sin resultados la hoja sólo tiene tres controles: 14 Tab dan varias vueltas y, sin inert, llegan al fondo.
    await page.fill('#buscarImpresora', 'zzzz');
    const salidas = await recorrerConTab(page, '#hojaImpresoras');
    ok('14 Tab y 14 Shift+Tab no sacan el foco de la hoja', salidas.length === 0, salidas.join('; '));
    await page.focus('#buscarImpresora');
    const cerro = await cerrarConEscape(page, '#hojaImpresoras');
    ok('Escape cierra la hoja y deja el paso 2', cerro && (await visible('section[data-paso="2"]')));
    ok('al cerrar se saca el inert', (await estadoHoja(page, 'hojaImpresoras')).libre);
    ok('el foco vuelve a "Cambiar impresora"', (await foco(page, 'body')).id === 'cambiarImpresora');
}

async function probarHojasApiladas({ page, ok }) {
    await page.tap('#cambiarImpresora');
    await page.tap('#nuevaImpresora');
    await page.waitForSelector('#hojaMiImpresora:not([hidden])');
    const dentro = await foco(page, '#hojaMiImpresora');
    ok('"Mi impresora" desde la hoja de impresoras: foco dentro de la hoja nueva', dentro.dentro, dentro.etiqueta);
    ok('con hojas apiladas el fondo sigue inert', (await estadoHoja(page, 'hojaMiImpresora')).fondo);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#hojaImpresoras:not([hidden])');
    ok(
        'Escape en la de arriba vuelve a la hoja de abajo, al botón que la abrió',
        (await foco(page, 'body')).id === 'nuevaImpresora',
    );
    ok('con la hoja de abajo el fondo sigue inert', (await estadoHoja(page, 'hojaImpresoras')).fondo);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#hojaImpresoras', { state: 'hidden' });
    ok(
        'al cerrar la última el foco vuelve a "Cambiar impresora"',
        (await foco(page, 'body')).id === 'cambiarImpresora',
    );
    ok('y el fondo queda libre', (await estadoHoja(page, 'hojaImpresoras')).libre);
}

/**
 * Paso actual, foco al cambiar de paso y hojas modales (H1, H2, H3; ADR 0008, A.2).
 *
 * Flujo: mira `aria-current` y el texto "Paso N de 4"; vuelve al paso 1 con atrás y avanza con "Siguiente"
 * midiendo `document.activeElement`; abre la hoja de impresoras (diálogo modal, fondo inert, foco en la búsqueda,
 * 14 Tab y 14 Shift+Tab sin salir, Escape cierra y devuelve el foco a #cambiarImpresora) y apila "Mi impresora"
 * (foco dentro, Escape vuelve a la hoja de abajo y luego al botón).
 *
 * Precondición: paso 2 visible.
 * Deja: paso 2 visible, ninguna hoja abierta, `main` sin `inert`.
 *
 * @param {import('../lib/app.mjs').Ctx} ctx
 */
export async function probarAccesibilidadPasos(ctx) {
    await probarPasoActual(ctx);
    await probarHojaImpresoras(ctx);
    await probarHojasApiladas(ctx);
}

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
 * Visor y deslizador de capas (A4). Esqueleto: lo llena la tarea A4.
 *
 * Precondición: paso 4 con resultado.
 * Deja: igual.
 *
 * @param {import('../lib/app.mjs').Ctx} _ctx
 */
export async function probarAccesibilidadVisor(_ctx) {}
