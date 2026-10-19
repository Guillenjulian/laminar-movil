// Panel "Zona sin soporte" del paso 1 (ADR 0004, T5): el modo "marcar" (aria-pressed), un toque sobre la pieza agrega
// una zona con el radio elegido, el stepper de radio (2 a 40 mm), la chip con su `aria-label`, quitar, y el aviso
// "Se quitaron las zonas sin soporte porque cambió la pieza" al cambiar la escala.
//
// Escrito contra el contrato de `src/ui/bloqueos-ui.js`; se registra en probar-app.mjs en T6, cuando index.html
// tenga el panel (#bloqueosPanel, #bloqueoMarcar, #bloqueoRadioMenos, #bloqueoRadioNum, #bloqueoRadioMas,
// #bloqueoLista, #bloqueoAyuda, #bloqueoNota).
//
// Precondición: paso 1 con el cubo de ejemplo cargado (una sola pieza), escala 100 %, sin zonas.
// Deja: paso 1 con el cubo de ejemplo cargado, escala 100 %, sin zonas y fuera del modo "marcar".

import { tocarLienzo } from '../lib/visor.mjs';

const AVISO = 'Se quitaron las zonas sin soporte porque cambió la pieza';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarBloqueos(ctx) {
    const { page: pagina, ok: revisar, visible } = ctx;
    const chips = pagina.locator('#bloqueoLista .chip');
    const pulsado = () => pagina.getAttribute('#bloqueoMarcar', 'aria-pressed');

    revisar('zonas: el panel se ve con un modelo', await visible('#bloqueosPanel'));
    revisar(
        'zonas: la nota del voladizo se ve',
        (await pagina.textContent('#bloqueoNota')).includes('puede dejarlo sin ningún soporte'),
    );
    revisar('zonas: radio inicial 8 mm', (await pagina.textContent('#bloqueoRadioNum')).trim() === '8');
    await pagina.tap('#bloqueoMarcar');
    revisar('zonas: el modo "marcar" queda con aria-pressed', (await pulsado()) === 'true');
    await pagina.tap('#bloqueoRadioMas');
    await tocarLienzo(pagina);
    const textos = await chips.allTextContents();
    revisar(
        'zonas: un toque sobre la pieza agrega la chip "Zona 1 · 9 mm"',
        textos.length === 1 && textos[0].includes('Zona 1 · 9'),
        textos,
    );
    const idChip = await chips.first().getAttribute('data-zona');
    revisar(
        'zonas: la chip se quita con un botón rotulado cuyo id es el de la chip',
        (await pagina.getAttribute('#bloqueoLista .chip-quitar', 'aria-label')) === 'Quitar zona 1, cubo-20mm.stl' &&
            (await pagina.getAttribute('#bloqueoLista .chip-quitar', 'data-quitar')) === idChip,
    );

    await radioYEscala(ctx, chips, pulsado);
    await quitarUna(pagina);
    const foco = await pagina.evaluate(() => document.activeElement?.id);
    revisar(
        'zonas: quitar deja la lista vacía y el foco en "marcar"',
        (await chips.count()) === 0 && foco === 'bloqueoMarcar',
    );
    await pagina.tap('#bloqueoMarcar');
}

/** Marca una zona y la quita con su botón. */
async function quitarUna(pagina) {
    await pagina.tap('#bloqueoMarcar');
    await tocarLienzo(pagina);
    await pagina.tap('#bloqueoLista .chip-quitar');
}

/** Elige la zona, le cambia el radio, sale del modo y comprueba que cambiar la escala vacía las zonas. */
async function radioYEscala(ctx, chips, pulsado) {
    const { page: pagina, ok: revisar } = ctx;
    await chips.first().tap();
    await pagina.tap('#bloqueoRadioMas');
    revisar(
        'zonas: con la zona elegida el stepper le cambia el radio',
        (await chips.first().textContent()).includes('10'),
    );

    await pagina.tap('#bloqueoMarcar'); // fuera del modo
    revisar('zonas: salir del modo suelta aria-pressed', (await pulsado()) === 'false');
    await pagina.tap('#escalaMas');
    revisar(
        'zonas: cambiar la escala las vacía y lo avisa',
        (await chips.count()) === 0 && (await pagina.getByText(AVISO).count()) > 0,
    );
    await pagina.tap('#escalaMenos'); // otro reacomodar: el aviso no se borra con el redibujado
    revisar('zonas: el aviso dura tras otro cambio de la pieza', (await pagina.getByText(AVISO).count()) > 0);
}
