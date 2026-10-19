// Modelo en la cama: escala, rotar y apoyar cara.
//
// Flujo: con el cubo, escala +10 %, escrita a mano, restablecer, y un modelo que no entra
// ("Achicar para que entre"). Con la T: 4 rotaciones, apoyar la cara del frente, escala 50 %
// y laminar; el G-code descargado tiene que respetar el tamaño transformado (5 mm de alto).
//
// Precondición: paso 1 con la esfera ya borrada de recientes (tras recientes.mjs, un "atrás" antes).
// Deja: paso 2 (tras dos "atrás" desde el resultado), con la T acostada al 50 % cargada.

import fs from 'node:fs';
import { esperarVisor, tocarLienzo } from '../lib/visor.mjs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarTransformar(ctx) {
    const { page: pagina, elegirArchivo } = ctx;
    await pagina.goBack();
    await elegirArchivo('public/ejemplos/cubo-20mm.stl');
    await probarEscala(ctx);
    await probarRotar(ctx);
    await probarApoyarCara(ctx);
    await laminarTransformada(ctx);
}

const medidasDe = pagina => () => pagina.textContent('#datosModelo').then(t => t.split(' · ')[0]);

async function probarEscala({ page: pagina, ok: revisar }) {
    const medidas = medidasDe(pagina);
    await pagina.tap('#escalaMas');
    revisar(
        'escala +10 %',
        (await medidas()) === '22,0 × 22,0 × 22,0 mm' && (await pagina.inputValue('#escala')) === '110',
        await medidas(),
    );
    await pagina.tap('#escalaMenos');
    revisar('escala -10 % (desde 110 %)', (await pagina.inputValue('#escala')) === '100', await medidas());
    await pagina.fill('#escala', '200');
    await pagina.press('#escala', 'Enter');
    await pagina.locator('#escala').blur();
    revisar('escala escrita a mano (200 %)', (await medidas()) === '40,0 × 40,0 × 40,0 mm', await medidas());
    await pagina.tap('#restablecerModelo');
    revisar(
        'restablecer',
        (await medidas()) === '20,0 × 20,0 × 20,0 mm' && (await pagina.isHidden('#restablecerModelo')),
    );

    await pagina.fill('#escala', '2000');
    await pagina.locator('#escala').blur();
    // `anunciar` pone el texto en el siguiente frame.
    await pagina.waitForFunction(() => /No entra/.test(document.getElementById('avisoModelo').textContent));
    revisar(
        'modelo que no entra: aviso y botón',
        /No entra/.test(await pagina.textContent('#avisoModelo')) && (await pagina.isVisible('#ajustarCama')),
    );
    await pagina.tap('#ajustarCama');
    const ajustada = parseFloat((await medidas()).replace(',', '.'));
    revisar(
        '"Achicar para que entre" lo ajusta',
        ajustada <= 220 && ajustada > 200 && (await pagina.isHidden('#avisoModelo')),
        await medidas(),
    );
    await pagina.tap('#restablecerModelo');
}

async function probarRotar({ page: pagina, ok: revisar, elegirArchivo, stlTe }) {
    const medidas = medidasDe(pagina);
    await elegirArchivo(stlTe);
    revisar('la T original', (await medidas()) === '50,0 × 10,0 × 23,0 mm', await medidas());
    await pagina.tap('[data-rotar="x"]');
    revisar('rotar 90° en X', (await medidas()) === '50,0 × 23,0 × 10,0 mm', await medidas());
    await pagina.tap('[data-rotar="x"]');
    await pagina.tap('[data-rotar="x"]');
    await pagina.tap('[data-rotar="x"]');
    revisar('4 rotaciones vuelven al original', (await medidas()) === '50,0 × 10,0 × 23,0 mm', await medidas());
}

// Apoyar cara: tocando el centro del visor el rayo pega en el frente de la columna.
async function probarApoyarCara({ page: pagina, ok: revisar, captura }) {
    const medidas = medidasDe(pagina);
    await pagina.tap('#apoyarCara');
    revisar(
        'modo apoyar cara',
        (await pagina.isVisible('#ayudaCara')) && (await pagina.textContent('#apoyarCara')) === 'Cancelar',
    );
    await esperarVisor(pagina, '#visor');
    await tocarLienzo(pagina);
    await pagina.waitForFunction(() => document.getElementById('ayudaCara').hidden, null, { timeout: 5000 });
    revisar('apoyar la cara del frente acuesta la T', (await medidas()) === '50,0 × 23,0 × 10,0 mm', await medidas());
    await captura('1-apoyar-cara');
}

// Laminar la T acostada y a mitad de tamaño: el G-code tiene que respetarlo.
async function laminarTransformada({ page: pagina, ok: revisar, esperarResultado }) {
    await pagina.fill('#escala', '50');
    await pagina.locator('#escala').blur();
    await pagina.tap('#siguiente');
    await pagina.tap('#laminar');
    await esperarResultado();
    revisar(
        'el resumen usa el tamaño transformado',
        (await pagina.textContent('#resumen')).includes('25,0 × 11,5 × 5,0 mm'),
    );
    const [desc3] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const gT = fs.readFileSync(await desc3.path(), 'utf8').split('\n');
    const fin = gT.findIndex(l => l.startsWith('; --- Fin')); // el G-code de fin sube Z en relativo
    const zT = gT
        .slice(0, fin)
        .map(l => l.match(/^G1 Z([\d.]+)/))
        .filter(Boolean)
        .map(m => +m[1]);
    const zPieza = Math.max(...zT);
    revisar('G-code de la T acostada al 50 %: 5 mm de alto', Math.abs(zPieza - 5) < 0.3, `Z máx ${zPieza}`);
    await pagina.goBack();
    await pagina.goBack();
}
