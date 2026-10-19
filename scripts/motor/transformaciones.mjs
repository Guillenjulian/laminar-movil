// Transformaciones del modelo (laminado en Chromium): escala ×2, "T" rotada 90° en X, "T" con la tapa apoyada y
// escala ×20 que no entra en la cama. Sin adhesión, así la falda no agranda la primera capa.

import * as T from '../../src/motor/transformar.js';

const sinFalda = { adhesion: 'nada' };

// Extensión en X e Y de las extrusiones de la primera capa (cada eje por
// separado: en los perímetros rectos Kiri escribe sólo X o sólo Y).
const primeraCapa = r => {
    const l = r.g.lineas,
        i0 = l.indexOf(';LAYER:0'),
        i1 = l.indexOf(';LAYER:1');
    const capa0 = l.slice(i0, i1);
    const coord = eje =>
        capa0
            .filter(x => new RegExp(`^G1 .*${eje}.*E\\d`).test(x))
            .map(x => +x.match(new RegExp(`${eje}([\\d.]+)`))[1]);
    const xs = coord('X'),
        ys = coord('Y');
    return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
};
const mm = n => n.toFixed(1);

async function probarEscala({ laminar, revisar }) {
    const doble = await laminar({ caso: 'cubo', personal: sinFalda, transformacion: T.escala(2) });
    const pc2 = primeraCapa(doble);
    revisar('escala ×2: altura ~40 mm', doble.g.zMax >= 39.8 && doble.g.zMax <= 41, `Z máx ${doble.g.zMax}`);
    revisar(
        'escala ×2: primera capa de ~40 × 40 mm',
        Math.abs(pc2.x - 40) < 1 && Math.abs(pc2.y - 40) < 1,
        `${mm(pc2.x)} × ${mm(pc2.y)} mm`,
    );
}

async function probarRotaciones({ laminar, revisar }) {
    const acostada = await laminar({ caso: 'te', personal: sinFalda, transformacion: T.rotacion90('x') });
    revisar(
        '"T" rotada 90° en X: altura ~10 mm',
        acostada.g.zMax >= 9.8 && acostada.g.zMax <= 10.6,
        `Z máx ${acostada.g.zMax}`,
    );
    const invertida = await laminar({ caso: 'te', personal: sinFalda, transformacion: T.rotacionQueApoya([0, 0, 1]) });
    const pcT = primeraCapa(invertida);
    revisar(
        '"T" con la tapa apoyada: altura ~23 mm',
        invertida.g.zMax >= 22.8 && invertida.g.zMax <= 23.6,
        `Z máx ${invertida.g.zMax}`,
    );
    revisar(
        '"T" con la tapa apoyada: primera capa de ~50 mm en X',
        Math.abs(pcT.x - 50) < 1 && Math.abs(pcT.y - 10) < 1,
        `${mm(pcT.x)} × ${mm(pcT.y)} mm`,
    );
}

export async function probarTransformaciones({ laminar, revisar, pagina }) {
    await probarEscala({ laminar, revisar });
    await probarRotaciones({ laminar, revisar });
    let errorCama = '';
    try {
        await pagina.evaluate(o => window.probar(o), { caso: 'cubo', transformacion: T.escala(20) });
    } catch (err) {
        errorCama = err.message;
    }
    revisar(
        'escala ×20: avisa que no entra en la cama',
        errorCama.includes('no entra en la cama'),
        errorCama ? `(${errorCama.split('\n')[0].replace(/^.*?El modelo/, 'El modelo')})` : '(laminó sin error)',
    );
}
