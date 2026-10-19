// Paso 1: carga del modelo.
//
// Flujo de probarModelo: abre la app, "Siguiente" deshabilitado sin modelo, carga la esfera
// pesada (avisa que se simplifica) y después el cubo de ejemplo (sin avisos).
// Flujo de probarGestos: un toque en el visor no rompe nada.
//
// probarModelo  — precondición: página sin abrir. Deja: paso 1 con el cubo cargado.
// probarGestos  — precondición: paso 1 con un modelo cargado. Deja: igual, con captura "1-modelo".

import { esperarVisor } from '../lib/visor.mjs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarModelo(ctx) {
    const { page: pagina, base, ok: revisar, visible, captura, elegirArchivo, stlPesado } = ctx;
    await pagina.goto(base);
    await captura('1-inicio');
    revisar('paso 1 visible', await visible('section[data-paso="1"]'));
    revisar('"Siguiente" deshabilitado sin modelo', await pagina.isDisabled('#siguiente'));

    // Modelo pesado: tiene que avisar que se va a simplificar.
    await elegirArchivo(stlPesado);
    const aviso = await pagina.textContent('#avisoModelo');
    revisar('aviso de modelo pesado', /Modelo pesado/.test(aviso), `"${aviso.slice(0, 60)}…"`);
    await pagina.waitForTimeout(800);
    await captura('1-modelo-pesado');

    // Cubo de ejemplo
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    revisar('datos del cubo', /20,0 × 20,0 × 20,0 mm/.test(await pagina.textContent('#datosModelo')));
    revisar('sin avisos para el cubo', !(await visible('#avisoModelo')));
}

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarGestos(ctx) {
    const { page: pagina, captura } = ctx;
    // Gestos: un arrastre con un dedo no tiene que romper nada.
    await esperarVisor(pagina, '#visor');
    const caja = await pagina.locator('#visor canvas').boundingBox();
    await pagina.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await pagina.waitForTimeout(500);
    await captura('1-modelo');
}
