// Selector del tipo de soporte del paso 2 (ADR 0004, T5): tres opciones (No / Normal / Árbol) con su ayuda y, con
// zonas marcadas y un tipo distinto de 'no', se lee "N zonas sin soporte".
//
// Escrito contra el contrato de `src/ui/soportes-tipo-ui.js`; se registra en probar-app.mjs en T6, cuando index.html
// tenga #tipoSoportes (el grupo de radios) y #tipoSoportesZonas (región viva del aviso) y el panel de zonas.
//
// Precondición: paso 1 con el cubo de ejemplo cargado (una sola pieza), sin zonas; soportes en 'no'.
// Deja: paso 2 con el cubo cargado, una zona marcada y soportes en 'no'.

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarSoportesTipo(ctx) {
    const { page: pagina, ok: revisar } = ctx;
    const radio = valor => pagina.locator(`#tipoSoportes input[value="${valor}"]`);
    const zonas = async () => (await pagina.textContent('#tipoSoportesZonas')).trim();

    await pagina.tap('#bloqueoMarcar');
    const caja = await pagina.locator('#visor canvas').boundingBox();
    await pagina.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await pagina.tap('#bloqueoMarcar');
    await pagina.tap('#siguiente');

    const cuantas = await pagina.locator('#tipoSoportes input').count();
    revisar('soportes: tres opciones y "No" marcada', cuantas === 3 && (await radio('no').isChecked()));
    revisar('soportes: con "No" no se avisa de zonas', !(await pagina.isVisible('#tipoSoportesZonas')));
    await radio('arbol').check();
    revisar('soportes: Árbol queda marcado', await radio('arbol').isChecked());
    revisar('soportes: con Árbol y una zona dice "1 zona sin soporte"', (await zonas()) === '1 zona sin soporte');
    await radio('normal').check();
    revisar('soportes: con Normal también', (await zonas()) === '1 zona sin soporte');
    await radio('no').check();
    revisar('soportes: de vuelta a "No" desaparece el aviso', !(await pagina.isVisible('#tipoSoportesZonas')));
}
