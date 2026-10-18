// Materiales y costo.
//
// Flujo: sin precio cargado, el costo invita a ponerlo; el enlace vuelve al paso 2. Ahí se elige
// PETG, se pone el precio y se relamina. Al final se vuelve a PLA y se relamina, así la vista
// previa de las áreas siguientes arranca con el mismo cubo de siempre.
//
// Precondición: paso 4 con el cubo laminado en PLA (Rápido, personalizado), sin precio cargado.
// Deja: paso 4 con el cubo laminado en PLA otra vez (el precio del PETG queda guardado aparte).

/** Texto de una fila ("Costo", "Filamento"…) del resumen del resultado. */
const filaResumen = (pagina, clave) =>
    pagina.$eval(
        '#resumen',
        (dl, k) =>
            [...dl.querySelectorAll('dt')].find(dt => dt.textContent === k)?.nextElementSibling.textContent.trim(),
        clave,
    );

/** @param {import('../lib/app.mjs').Ctx} ctx */
export async function probarMateriales(ctx) {
    await volverAPonerPrecio(ctx);
    await elegirPetg(ctx);
    await revisarResultadoPetg(ctx);
    await volverAPla(ctx);
}

async function volverAPonerPrecio({ page: pagina, ok: revisar }) {
    revisar(
        'sin precio: el costo pide ponerlo',
        /Poné el precio del rollo/.test(await filaResumen(pagina, 'Costo')),
        await filaResumen(pagina, 'Costo'),
    );
    await pagina.tap('[data-poner-precio]');
    await pagina.waitForSelector('section[data-paso="2"]:not([hidden])');
    revisar(
        '"poner precio" vuelve al paso 2 con el foco en el precio',
        await pagina
            .waitForFunction(() => document.activeElement?.id === 'precioRollo', null, { timeout: 3000 })
            .then(
                () => true,
                () => false,
            ),
    );
}

async function elegirPetg({ page: pagina, ok: revisar, captura, esperarResultado }) {
    await pagina.tap('label.opcion:has(input[value="petg"])');
    const tarjetaPetg = await pagina.textContent('#tarjetaMaterial');
    revisar(
        'tarjeta de PETG con su aviso y el precio',
        /PEI liso/.test(tarjetaPetg) &&
            /Precio del rollo \(1 kg\)/.test(tarjetaPetg) &&
            (await pagina.isVisible('#precioRollo')),
    );
    await pagina.fill('#precioRollo', '20000');
    await pagina.locator('#tarjetaMaterial').scrollIntoViewIfNeeded();
    await captura('2-material');
    await pagina.tap('#laminar');
    await esperarResultado();
}

async function revisarResultadoPetg({ page: pagina, ok: revisar, captura }) {
    // "1,93 m (≈ 6 g)": con el largo recalculamos los gramos con la densidad del PETG (1,27).
    const filamento = await filaResumen(pagina, 'Filamento');
    const [, metros, g] = filamento.match(/^([\d,]+) m \(≈ (\d+) g\)$/) || [];
    const gramos = Math.PI * 0.875 ** 2 * parseFloat(metros.replace(',', '.')) * 1.27;
    revisar(
        'PETG: filamento con la densidad del PETG',
        Math.abs(Number(g) - gramos) <= 0.6,
        `${filamento} (esperado ≈ ${gramos.toFixed(2)} g)`,
    );
    // Costo = gramos × precio / 1000. El largo viene redondeado a 1 cm: ±0,03 g → ±$ 1.
    const costo = await filaResumen(pagina, 'Costo');
    const pesos = Number((costo.match(/^≈ \$ ([\d.]+)$/)?.[1] || 'NaN').replace(/\./g, ''));
    revisar(
        'PETG: costo = gramos × precio / 1000',
        Math.abs(pesos - (gramos * 20000) / 1000) <= 1.5 && Math.abs(pesos - (gramos / 1.27) * 1.24 * 20) > 1.5,
        `${costo} (esperado ≈ $ ${(gramos * 20).toFixed(1)})`,
    );
    revisar(
        'PETG: se ve el aviso del material',
        /PEI liso/.test(await pagina.textContent('#avisoResultado')) && (await pagina.isVisible('#avisoResultado')),
    );
    await pagina.locator('#resumen').scrollIntoViewIfNeeded();
    await captura('4-costo');
}

async function volverAPla({ page: pagina, ok: revisar, esperarResultado }) {
    await pagina.goBack();
    await pagina.tap('label.opcion:has(input[value="pla"])');
    revisar('el precio es por material (PLA sin precio)', (await pagina.inputValue('#precioRollo')) === '');
    await pagina.tap('#laminar');
    await esperarResultado();
    revisar(
        'de vuelta en PLA',
        (await filaResumen(pagina, 'Calidad')).includes('PLA') && (await pagina.isHidden('#avisoResultado')),
    );
}
