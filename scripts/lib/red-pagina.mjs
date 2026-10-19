// Ayudas de página para las áreas scripts/app/red*.mjs (ADR 0007, T8): la hoja de red, el envío y la clave centinela.

import fs from 'node:fs';
import { CLAVE, CLAVE_B } from './red-simulada.mjs';

/** Lo que la prueba descubre al empezar: ¿el navegador muestra Compartir? (depende de Web Share) */
export const guia = { compartirVisible: false };

export const campo = nombre => `#formRed [name=${nombre}]`;
export const atributo = (pagina, sel, a) => pagina.getAttribute(sel, a);
export const enfocado = pagina =>
    pagina.evaluate(() => document.activeElement?.getAttribute('name') || document.activeElement?.id);

export async function asegurarPausa({ page: pagina }) {
    if ((await pagina.locator('#listaPausas .quitar').count()) === 0) {
        await pagina.locator('#capa').fill('10');
        await pagina.tap('#pausarCapa');
    }
}

export async function abrirHoja({ page: pagina }) {
    await pagina.tap('#configurarRed');
    await pagina.waitForSelector('#hojaRed:not([hidden])');
}

export async function cerrarHoja({ page: pagina }) {
    if (await pagina.isVisible('#hojaRed')) await pagina.tap('#hojaRed [data-cerrar]');
    await pagina.waitForSelector('#hojaRed', { state: 'hidden' });
}

/** Completa la hoja abierta. */
export async function llenar({ page: pagina }, { tipo, direccion, clave, imprimir }) {
    if (tipo) await pagina.selectOption(campo('tipo'), tipo);
    if (direccion !== undefined) await pagina.fill(campo('direccion'), direccion);
    if (clave !== undefined) await pagina.fill(campo('claveApi'), clave);
    if (imprimir !== undefined) await pagina.setChecked(campo('imprimir'), imprimir);
}

export async function guardar({ page: pagina }) {
    await pagina.tap('#formRed [type=submit]');
    await pagina.waitForSelector('#hojaRed', { state: 'hidden' });
}

/** Toca Probar conexión y devuelve el texto de #estadoRed cuando termina. */
export async function probar({ page: pagina }) {
    await pagina.tap('#probarRed');
    await pagina.waitForFunction(() => {
        const t = document.getElementById('estadoRed').textContent;
        return t !== '' && t !== 'Probando…';
    });
    return pagina.textContent('#estadoRed');
}

/** Espera a que el envío termine (sin "Enviando…") y devuelve #estadoEntrega. */
export async function esperarEnvio({ page: pagina }) {
    await pagina.waitForFunction(
        () =>
            document.getElementById('estadoEntrega').textContent !== '' &&
            !document.getElementById('progresoEnvioRed').textContent,
        null,
        { timeout: 15000 },
    );
    return pagina.textContent('#estadoEntrega');
}

/** Baja el G-code con Descargar: nombre y texto. */
export async function descargar({ page: pagina }) {
    const [d] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    return { nombre: d.suggestedFilename(), texto: fs.readFileSync(await d.path(), 'utf8') };
}

/** Descargar (y Compartir, si la prueba lo muestra) siguen visibles y habilitados. */
export async function entregaIntacta({ page: pagina }) {
    for (const b of guia.compartirVisible ? ['#descargar', '#compartir'] : ['#descargar']) {
        if (!(await pagina.isVisible(b)) || (await pagina.isDisabled(b))) return false;
    }
    return true;
}

// ¿Alguna clave centinela en el HTML, los textos, el value de los campos o los storages?
const hayClaveEnDom = secretos => {
    const html = document.documentElement.outerHTML;
    const valores = [...document.querySelectorAll('input,textarea,select')].map(e => e.value);
    const almacenes = JSON.stringify([{ ...localStorage }, { ...sessionStorage }]);
    const texto = document.body.textContent;
    return secretos.some(
        s => html.includes(s) || texto.includes(s) || valores.some(v => v.includes(s)) || almacenes.includes(s),
    );
};

/** La clave centinela no está en el DOM ni en los storages, ni en lo que juntó la consola (`salida.consola`). */
export async function revisarSecreto({ page: pagina, ok: revisar }, salida, cuando) {
    const enDom = await pagina.evaluate(hayClaveEnDom, [CLAVE, CLAVE_B]);
    revisar(`red: la clave no aparece en el DOM ni en los storages (${cuando})`, !enDom);
    const enConsola = salida.consola.filter(t => t.includes(CLAVE) || t.includes(CLAVE_B));
    revisar(`red: la clave no aparece en la consola (${cuando})`, enConsola.length === 0, enConsola.join(' | '));
}

/** Desde el paso 4: vuelve al 2, elige la impresora, lamina y espera el paso 4. */
export async function laminarCon({ page: pagina, esperarResultado }, id) {
    await pagina.goBack();
    await pagina.tap('#cambiarImpresora');
    await pagina.tap(`[data-id="${id}"]`);
    await pagina.tap('#laminar');
    await esperarResultado();
}
