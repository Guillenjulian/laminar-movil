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
    const glifos = ['#reproducir', '#pausarCapa', 'section[data-paso="4"] h2'].map(sel => {
        const el = document.querySelector(sel);
        const sueltos = el
            ? [...el.childNodes].filter(
                  n => n.nodeType === 3 && /\p{Extended_Pictographic}|[\u23f8\u25b6]/u.test(n.textContent),
              )
            : [];
        const marcados = el ? [...el.querySelectorAll('[aria-hidden="true"]')] : [];
        return { sel, sueltos: sueltos.length, marcados: marcados.length };
    });
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

/**
 * Regiones vivas, nombres y encabezados (ADR 0008, A3; H7, H10, H11, H12).
 *
 * Flujo: toca Laminar con la esfera pesada del paso 2 (como probarCancelar) y en el paso 3 mira que `#progreso`
 * tenga nombre y `aria-valuetext`; cancela y vuelve al paso 2. Ahí lee del DOM que los cuatro errores tengan
 * `role="alert"`, que cada `.contador` sea un `role="group"` con nombre y botones con `aria-label` distintos, y
 * que los glifos (🎉, ▶, ⏸) estén en un `aria-hidden`. Abre la hoja de impresoras y comprueba que los
 * encabezados no saltan de nivel; la cierra con "atrás".
 *
 * Precondición: paso 2 visible (con la esfera pesada de probarCancelar).
 * Deja: paso 2 visible, ninguna hoja abierta (igual que antes de llamarla).
 *
 * @param {import('../lib/app.mjs').Ctx} ctx
 */
export async function probarAccesibilidadRegiones(ctx) {
    const { page, ok, visible } = ctx;
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

/** Visor y deslizador de capas (A4): vive en accesibilidad-visor.mjs. */
export { probarAccesibilidadVisor, probarAccesibilidadDescripcion } from './accesibilidad-visor.mjs';
