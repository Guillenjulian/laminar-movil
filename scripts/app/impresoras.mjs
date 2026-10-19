// Impresoras: buscar, elegir una importada, crear "Mi impresora" y copiar un perfil como propio.
//
// Flujo: abre la hoja, filtra por "prusa", elige la MK3S+, prueba que "atrás" cierra la hoja,
// crea una propia (Klipper + Bowden, con validación), lamina y descarga con ella, y por último
// "Copiar como mía" desde la Ender 3 V3 SE.
//
// Precondición: paso 2 visible (tras la descarga).
// Deja: paso 2 con la impresora propia "Mi Ender 3 Pro" guardada y elegida (el último "atrás"
// cierra el formulario de copia sin guardar).

import fs from 'node:fs';

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarImpresoras(ctx) {
    await buscarYElegir(ctx);
    await crearPropia(ctx);
    await laminarConPropia(ctx);
    await copiarComoMia(ctx);
}

async function buscarYElegir({ page: pagina, ok: revisar, visible, captura }) {
    await pagina.tap('#cambiarImpresora');
    revisar('hoja de impresoras abierta', await visible('#hojaImpresoras'));
    const total = await pagina.locator('#listaImpresoras [data-id]').count();
    await pagina.fill('#buscarImpresora', 'prusa');
    const prusas = await pagina.$$eval('#listaImpresoras [data-id] b', bs => bs.map(b => b.textContent));
    revisar(
        'buscar filtra la lista',
        total > 40 && prusas.join('|') === 'Prusa MK4|Prusa i3 MK2S|Prusa i3 MK3S+|Prusa mini',
        `${total} → ${prusas.join(', ')}`,
    );
    await captura('2-impresoras');
    await pagina.tap('[data-id="kiri-prusa-i3-mk3s"]');
    revisar('elegir cierra la hoja', !(await visible('#hojaImpresoras')) && (await visible('section[data-paso="2"]')));
    const tarjeta = await pagina.textContent('#impresoraElegida');
    revisar('tarjeta de importada', /Prusa i3 MK3S\+/.test(tarjeta) && /sin revisar/.test(tarjeta));

    // Atrás del celu cierra la hoja sin salir del paso 2.
    await pagina.tap('#cambiarImpresora');
    await pagina.goBack();
    revisar('atrás cierra la hoja', !(await visible('#hojaImpresoras')) && (await visible('section[data-paso="2"]')));
}

// Crear una propia con Klipper y extrusor Bowden.
async function crearPropia({ page: pagina, ok: revisar, visible, captura }) {
    await pagina.tap('#cambiarImpresora');
    await pagina.tap('#nuevaImpresora');
    await pagina.fill('[name=nombre]', 'Mi Ender 3 Pro');
    await pagina.fill('[name=ancho]', '235');
    await pagina.fill('[name=profundidad]', '235');
    await pagina.selectOption('[name=extrusor]', 'bowden');
    await pagina.selectOption('[name=firmware]', 'klipper');
    revisar('bowden propone 5 mm de retracción', (await pagina.inputValue('[name=retraccion]')) === '5');
    revisar(
        'Klipper cambia la plantilla de inicio',
        (await pagina.inputValue('[name=inicio]')).startsWith('PRINT_START'),
    );
    await captura('2-mi-impresora');
    await pagina.fill('[name=ancho]', '20');
    await pagina.tap('#formImpresora [type=submit]');
    await pagina.waitForFunction(() => document.getElementById('errorImpresora').textContent !== '');
    revisar(
        'valida los datos',
        (await visible('#errorImpresora')) && /Ancho/.test(await pagina.textContent('#errorImpresora')),
    );
    await pagina.fill('[name=ancho]', '235');
    await pagina.tap('#formImpresora [type=submit]');
    await pagina.waitForSelector('#hojaMiImpresora', { state: 'hidden' });
    revisar(
        'guardar cierra las dos hojas',
        !(await visible('#hojaImpresoras')) && (await visible('section[data-paso="2"]')),
    );
    revisar(
        'queda elegida la propia',
        /Mi Ender 3 Pro.*Tuya.*235 × 235 × 250/s.test(await pagina.textContent('#impresoraElegida')),
    );
}

async function laminarConPropia({ page: pagina, ok: revisar, esperarResultado }) {
    await pagina.tap('#laminar');
    await esperarResultado();
    const [desc2] = await Promise.all([pagina.waitForEvent('download'), pagina.tap('#descargar')]);
    const gcodePropio = fs.readFileSync(await desc2.path(), 'utf8');
    revisar(
        'G-code con la impresora propia',
        gcodePropio.includes('PRINT_START BED_TEMP=60 EXTRUDER_TEMP=200') && gcodePropio.includes('G1 E-5'),
    );
    await pagina.goBack();
}

// "Copiar como mía" a partir del perfil armado a mano.
async function copiarComoMia({ page: pagina, ok: revisar }) {
    await pagina.tap('#cambiarImpresora');
    await pagina.fill('#buscarImpresora', 'v3 se');
    await pagina.tap('[data-id="creality-ender-3-v3-se"]');
    await pagina.tap('#copiarImpresora');
    revisar(
        'copiar trae los datos',
        (await pagina.inputValue('[name=nombre]')) === 'Creality Ender 3 V3 SE (mía)' &&
            (await pagina.inputValue('[name=retraccion]')) === '0.8' &&
            (await pagina.inputValue('[name=inicio]')).includes('G28'),
    );
    await pagina.goBack();
}
