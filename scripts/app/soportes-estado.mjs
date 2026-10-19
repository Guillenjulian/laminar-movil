// Tipo de soporte y zonas de punta a punta en la app (ADR 0004, T6).
//
// 1. Migración: las preferencias guardadas por la versión vieja (`soportes: true` / `false`) vuelven como 'normal' / 'no'
//    en el selector, y al guardar de nuevo se escribe el TEXTO (no el boolean).
// 2. Laminar con 'arbol' y una zona marcada con un toque: el mensaje al worker lleva la zona (`piezasParaMotor`), el
//    G-code tiene soporte y NINGUNA extrusión de soporte cae dentro de la esfera. Control: sin la zona, ese mismo
//    G-code sí tiene soporte ahí adentro (si no, la prueba no probaría nada). Y el paso 4 avisa "1 zona sin soporte".
//
// Precondición: cualquier paso de la app ya cargada (recarga la página).
// Deja: paso 2 con la T cargada y soportes en 'no'.

import fs from 'node:fs';
import { altoDe, dentroDeZonas, esSoporte, extrusionesDe } from '../motor/soportes-kiri.mjs';
import { tocarLienzo } from '../lib/visor.mjs';

const PREFERENCIAS = {
    impresoraId: 'creality-ender-3-v3-se',
    calidad: 'rapido',
    material: 'pla',
    personal: {},
    avanzado: {},
};
const RADIO_MM = 20; // grande: la zona tiene que cubrir soporte bajo la tapa sea cual sea el punto tocado

/** Escribe `valor` como preferencias en IndexedDB y recarga. */
async function guardarYRecargar(pagina, valor) {
    await pagina.evaluate(
        v =>
            new Promise((listo, falla) => {
                const abrir = indexedDB.open('laminar-movil');
                abrir.onerror = () => falla(abrir.error);
                abrir.onsuccess = () => {
                    const db = abrir.result;
                    const tx = db.transaction('ajustes', 'readwrite');
                    tx.objectStore('ajustes').put(v, 'preferencias');
                    tx.oncomplete = () => {
                        db.close();
                        listo();
                    };
                };
            }),
        valor,
    );
    await pagina.reload();
    await pagina.waitForSelector('#ejemplo');
}

/** Lo que hay guardado como `soportes` (esperando hasta `esperado`, hasta 5 s: el guardado no se espera). */
async function soportesGuardado(pagina, esperado) {
    const leer = () =>
        pagina.evaluate(
            () =>
                new Promise(listo => {
                    const abrir = indexedDB.open('laminar-movil');
                    abrir.onsuccess = () => {
                        const db = abrir.result;
                        const pedido = db.transaction('ajustes').objectStore('ajustes').get('preferencias');
                        pedido.onsuccess = () => {
                            db.close();
                            listo(pedido.result?.soportes);
                        };
                    };
                }),
        );
    let valor = await leer();
    for (let i = 0; i < 25 && valor !== esperado; i++) {
        await pagina.waitForTimeout(200);
        valor = await leer();
    }
    return valor;
}

/** Vuelve del paso 2 a cargar el cubo, va al paso 2 y toca una calidad (eso guarda las preferencias). */
async function cargarCuboYGuardar(pagina) {
    await pagina.tap('#ejemplo');
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'cubo-20mm.stl');
    await pagina.tap('#siguiente');
}

async function probarMigracion({ page: pagina, ok: revisar }) {
    for (const [viejo, esperado] of [
        [true, 'normal'],
        [false, 'no'],
    ]) {
        await guardarYRecargar(pagina, { ...PREFERENCIAS, soportes: viejo });
        await cargarCuboYGuardar(pagina);
        const marcado = await pagina.locator('#tipoSoportes input:checked').getAttribute('value');
        revisar(
            `migración: preferencias con soportes ${viejo} vuelven como '${esperado}'`,
            marcado === esperado,
            marcado,
        );
        await pagina.tap('label.opcion:has(input[value="normal"])'); // cambia la calidad a "Normal": guarda
        const guardado = await soportesGuardado(pagina, esperado);
        revisar(
            `migración: al guardar de nuevo se escribe el texto '${esperado}'`,
            guardado === esperado,
            String(guardado),
        );
    }
}

/** Cuántas muestras de soporte caen dentro de las zonas que viajaron al worker. */
async function dentroDeLaZona(gcode, zonas) {
    const extr = extrusionesDe(gcode);
    return { extr, adentro: dentroDeZonas(extr, zonas, [{ x: 0, y: 0 }], altoDe(extr)) };
}

async function laminarYDescargar({ page: pagina, esperarResultado }) {
    await pagina.tap('#laminar');
    await esperarResultado();
    const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    return fs.readFileSync(await descarga.path(), 'utf8');
}

/** Lo último que la app le mandó al laminador (lo anota el script de inicio). */
const ultimoMensaje = pagina => pagina.evaluate(() => window.__laminar);

/** Carga la T en el paso 1 y marca una zona grande con un toque en el centro del visor. */
async function marcarZonaEnLaT({ page: pagina, ok: revisar, stlTe, elegirArchivo }) {
    await guardarYRecargar(pagina, { ...PREFERENCIAS, soportes: 'no' });
    await pagina.tap('#ejemplo'); // el paso 1 necesita un modelo para el visor; después se cambia por la T
    await pagina.waitForFunction(() => document.getElementById('nombreModelo').textContent === 'cubo-20mm.stl');
    await elegirArchivo(stlTe);
    await pagina.tap('#bloqueoMarcar');
    for (let r = 8; r < RADIO_MM; r++) await pagina.tap('#bloqueoRadioMas');
    await tocarLienzo(pagina);
    await pagina.tap('#bloqueoMarcar');
    revisar('árbol con zona: hay una zona marcada', (await pagina.locator('#bloqueoLista .chip').count()) === 1);
}

async function probarArbolConZona(ctx) {
    const { page: pagina, ok: revisar, esperarResultado } = ctx;
    await marcarZonaEnLaT(ctx);
    await pagina.tap('#siguiente');
    await pagina.tap('#tipoSoportes input[value="arbol"]');
    revisar(
        'árbol con zona: el paso 2 avisa "1 zona sin soporte"',
        (await pagina.textContent('#tipoSoportesZonas')).trim() === '1 zona sin soporte',
    );
    const gcode = await laminarYDescargar(ctx);
    const zonas = (await ultimoMensaje(pagina))?.piezas?.[0]?.bloqueos ?? [];
    revisar(
        'árbol con zona: el mensaje al laminador lleva la zona (esfera de 20 mm de radio)',
        zonas.length === 1 && zonas[0].forma === 'esfera' && zonas[0].radio === RADIO_MM,
        JSON.stringify(zonas),
    );
    revisar(
        'árbol con zona: el proceso pide el árbol',
        (await ultimoMensaje(pagina))?.proceso?.sliceSupportTree === true,
    );
    const { extr, adentro } = await dentroDeLaZona(gcode, zonas);
    revisar('árbol con zona: el G-code tiene soporte', extr.some(esSoporte));
    revisar('árbol con zona: ningún soporte dentro de la esfera', adentro === 0, `${adentro} muestras`);
    revisar(
        'árbol con zona: el paso 4 avisa "1 zona sin soporte"',
        (await pagina.textContent('#avisoResultado')).includes('1 zona sin soporte'),
    );
    revisar(
        'árbol con zona: el resumen dice "soportes árbol"',
        (await pagina.textContent('#resumen')).includes('soportes árbol'),
    );
    await control(ctx, zonas, esperarResultado);
}

/** Control: sin la zona, el mismo laminado sí deja soporte dentro de la esfera (si no, la prueba no probaría nada). */
async function control(ctx, zonas, esperarResultado) {
    const { page: pagina, ok: revisar } = ctx;
    await pagina.goBack(); // paso 2
    await pagina.goBack(); // paso 1
    await pagina.tap('#bloqueoLista .chip-quitar');
    await pagina.tap('#siguiente');
    const gcode = await laminarYDescargar({ page: pagina, esperarResultado });
    const { adentro } = await dentroDeLaZona(gcode, zonas);
    revisar('árbol sin zona (control): sí hay soporte dentro de esa esfera', adentro > 20, `${adentro} muestras`);
    await pagina.goBack();
    await pagina.tap('#tipoSoportes input[value="no"]');
}

/** Con 'no' la T se lamina sin una sola extrusión de soporte; con 'normal', con soporte (estamos en el paso 2). */
async function probarTipos(ctx) {
    const { page: pagina, ok: revisar } = ctx;
    for (const [tipo, hay] of [
        ['no', false],
        ['normal', true],
    ]) {
        await pagina.tap(`#tipoSoportes input[value="${tipo}"]`);
        const extr = extrusionesDe(await laminarYDescargar(ctx)).filter(esSoporte);
        revisar(
            `tipo '${tipo}': ${hay ? 'hay' : 'cero'} extrusiones de soporte`,
            hay ? extr.length > 0 : extr.length === 0,
            `${extr.length}`,
        );
        await pagina.goBack();
    }
    await pagina.tap('#tipoSoportes input[value="no"]');
}

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarSoportesEstado(ctx) {
    // Anota el mensaje de cada laminado (zonas y proceso) para poder leerlo desde la prueba.
    await ctx.page.addInitScript(() => {
        const original = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (mensaje, ...resto) {
            if (mensaje?.tipo === 'laminar') {
                window.__laminar = structuredClone({
                    proceso: mensaje.proceso,
                    piezas: mensaje.piezas.map(p => ({ bloqueos: p.bloqueos, posiciones: p.posiciones })),
                });
            }
            return original.call(this, mensaje, ...resto);
        };
    });
    await probarMigracion(ctx);
    await probarArbolConZona(ctx);
    await probarTipos(ctx);
}
