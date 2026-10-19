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
            enfocado: el.matches(':focus-visible'),
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

// Un control enfocable y visible por paso, para el anillo de foco.
const FOCO = { 1: 'section[data-paso="1"] .botones-modelo .boton', 2: 'section[data-paso="2"] .opcion input' };

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
    // El anillo: se enfoca con una tecla previa para que el navegador lo trate como foco de teclado.
    await page.keyboard.press('Shift');
    await page.focus(FOCO[paso]);
    const f = await medir(page, FOCO[paso]);
    const ancho = parseFloat(f.outlineAncho);
    const rf = ratio(f.outlineColor, fondoEfectivo(f.fondosPadre));
    ok(
        `anillo de foco ≥ 2 px y ≥ 3:1 (${en})`,
        f.enfocado && f.outlineEstilo !== 'none' && ancho >= 2 && rf >= 3,
        `${ancho} px ${f.outlineEstilo}, ${fmt(rf)}:1${f.enfocado ? '' : ', sin :focus-visible'}`,
    );
    await page.evaluate(() => document.activeElement?.blur());
}

/**
 * Contraste de los colores del ADR 0008 (H4, H5, H6, H14, H15) en claro y oscuro, medido con `getComputedStyle`
 * y `scripts/lib/contraste.mjs`: texto naranja y números de los pasos ≥ 4,5:1, bordes de controles ≥ 3:1, anillo
 * de foco ≥ 2 px y ≥ 3:1, `prefers-reduced-motion` sin transiciones y alto de toque de `#capa` y `.tilde-capa`.
 *
 * Flujo: con el paso 2 visible mide ese paso; vuelve con "atrás" al paso 1, mide y avanza de nuevo (como hace
 * probarConfig). Los elementos que no existen en el paso 2 (el botón "Poné el precio" del resumen y el número
 * cambiado de Avanzado) se miden con una sonda temporal que se quita al terminar.
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

/**
 * Paso actual, foco al cambiar de paso, hojas modales (A2). Esqueleto: lo llena la tarea A2.
 *
 * Precondición: paso 2 visible.
 * Deja: paso 2 visible, ninguna hoja abierta, `main` sin `inert`.
 *
 * @param {import('../lib/app.mjs').Ctx} _ctx
 */
export async function probarAccesibilidadPasos(_ctx) {}

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
