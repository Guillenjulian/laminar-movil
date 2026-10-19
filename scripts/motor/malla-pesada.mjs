// Malla pesada (laminado en Chromium): una esfera de más de un millón de triángulos tiene que decimarse por debajo del
// límite y laminar igual, con 80 mm de alto.

export async function probarMallaPesada({ laminar, revisar }) {
    const pesada = await laminar({ caso: 'esfera', limite: 250000 });
    const d = pesada.info.decimado;
    revisar(
        'esfera decimada',
        d && d.original > 1e6 && d.final <= 250000,
        d ? `(${d.original} → ${d.final} triángulos, celda ${d.precisionMm.toFixed(3)} mm)` : '',
    );
    revisar('esfera de 80 mm de alto', pesada.g.zMax >= 79 && pesada.g.zMax <= 81, `Z máx ${pesada.g.zMax}`);
}
