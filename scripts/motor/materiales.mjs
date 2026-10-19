// Materiales (laminado en Chromium): temperaturas, ventilador, aviso y lo propio de cada uno (TPU lento y con
// retracción corta, PETG con z-hop). Se lamina en Rápido, así se ve que el material pisa a la calidad.
// También el recorte de temperatura en una impresora propia de 240 °C / 90 °C (ASA) y el aviso de TPU con Bowden.
// Recibe el cubo en Rápido (PLA) de `probarCubo`.

import fs from 'node:fs';

// F (mm/min) más alto de las extrusiones de la pieza, desde la capa 1 (la 0 va más lenta).
const maxFExtrusion = g => {
    const desde = g.lineas.indexOf(';LAYER:1');
    return Math.max(
        ...g.lineas
            .slice(desde)
            .filter(l => /^G1 .*E\d/.test(l) && / F/.test(l))
            .map(l => +l.match(/F([\d.]+)/)[1]),
    );
};
// Z-hop: retracciones de la pieza seguidas de un movimiento que sube Z 0,2 mm
// respecto del último Z (Kiri sólo levanta Z cuando retrae para viajar).
const zHops = g => {
    let z = 0,
        n = 0;
    const desde = g.lineas.indexOf(';LAYER:0');
    g.lineas.forEach((l, i) => {
        const m = l.match(/^G[01] .*Z([\d.]+)/);
        if (m) z = +m[1];
        const sig = g.lineas[i + 1]?.match(/^G[01] Z([\d.]+)/);
        if (i > desde && /^G1 E-/.test(l) && sig && Math.abs(+sig[1] - z - 0.2) < 0.001) n++;
    });
    return n;
};

function revisarGenerales(revisar, mat, r) {
    const { outputTemp: t, outputBedTemp: b, outputFanSpeed: fan } = mat.proceso;
    revisar(
        `${mat.nombre}: boquilla ${t} °C y cama ${b} °C`,
        r.g.tiene(`M104 S${t}`) && r.g.tiene(`M109 S${t}`) && r.g.tiene(`M140 S${b}`),
    );
    const iCapa1 = r.g.lineas.indexOf(';LAYER:1');
    const fans = r.g.lineas.map((l, i) => [i, l.match(/^M106 S(\d+)/)]).filter(([, m]) => m);
    const fanPieza = fans.filter(([i]) => i > iCapa1).map(([, m]) => +m[1]);
    revisar(
        `${mat.nombre}: ventilador ${Math.round(fan / 2.55)} % (sin ventilador en la 1ª capa)`,
        !fans.some(([i, m]) => i < iCapa1 && +m[1] > 0) && Math.max(0, ...fanPieza) === fan,
        `M106 S${Math.max(0, ...fanPieza)}`,
    );
    revisar(
        `${mat.nombre}: el aviso del material`,
        (r.avisos || []).includes(mat.aviso) === !!mat.aviso,
        (r.avisos || []).join(' | '),
    );
}

function revisarEspecificos(revisar, id, mat, r, rapido, fPla) {
    if (id === 'tpu') {
        const f = maxFExtrusion(r.g);
        revisar('TPU: retracción corta (0,5 mm)', r.g.tiene('G1 E-0.5') && !r.g.tiene('G1 E-0.8'));
        revisar(
            'TPU: extrusión a ≤ 25 mm/s (pisa a la calidad Rápido)',
            f <= 25 * 60 && fPla > 60 * 60,
            `F máx ${f} (PLA ${fPla})`,
        );
        revisar('TPU: sin aviso de Bowden en extrusor directo', !r.avisos.includes(mat.avisoBowden));
    }
    if (id === 'petg')
        revisar(
            'PETG: z-hop de 0,2 mm',
            zHops(r.g) > 0 && zHops(rapido.g) === 0,
            `${zHops(r.g)} z-hops (PLA ${zHops(rapido.g)})`,
        );
}

const impresoraTibia = {
    id: 'propia-tibia',
    nombre: 'Tibia',
    ancho: 220,
    profundidad: 220,
    alto: 250,
    origenCentro: false,
    boquilla: 0.4,
    filamento: 1.75,
    retraccion: 5,
    hotendMax: 240,
    camaMax: 90,
    velocidad: 60,
    firmware: 'marlin',
};

// Recorte de temperatura: una impresora propia que llega a 240 °C / 90 °C,
// con extrusor Bowden (retracción de 5 mm). ASA pide 250 °C / 100 °C.
async function probarRecorte({ laminar, revisar, pagina }) {
    await pagina.evaluate(imp => window.ponerImpresorasPropias([imp]), impresoraTibia);
    const asa = await laminar({ caso: 'cubo', calidad: 'rapido', impresoraId: 'propia-tibia', material: 'asa' });
    revisar(
        'ASA en una impresora de 240 °C: boquilla recortada',
        asa.g.tiene('M104 S240') &&
            !asa.g.tiene('M104 S250') &&
            asa.avisos.some(a => a.includes('boquilla se limitó a 240')),
        asa.avisos.join(' | '),
    );
    revisar(
        'ASA en una cama de 90 °C: cama recortada',
        asa.g.tiene('M140 S90') && asa.avisos.some(a => a.includes('cama se limitó a 90')),
    );
    const tpuBowden = await laminar({ caso: 'cubo', calidad: 'rapido', impresoraId: 'propia-tibia', material: 'tpu' });
    revisar(
        'TPU con Bowden: aviso',
        tpuBowden.avisos.some(a => a.startsWith('TPU con extrusor Bowden suele trabarse')),
        tpuBowden.avisos.join(' | '),
    );
    revisar(
        'TPU con Bowden: igual usa la retracción corta',
        tpuBowden.g.tiene('G1 E-0.5') && !tpuBowden.g.tiene('G1 E-5'),
    );
    await pagina.evaluate(() => window.ponerImpresorasPropias([]));
}

export async function probarMateriales({ laminar, revisar, pagina, rapido }) {
    const MATERIALES = JSON.parse(fs.readFileSync(new URL('../../src/perfiles/materiales.json', import.meta.url)));
    const fPla = maxFExtrusion(rapido.g);
    for (const [id, mat] of Object.entries(MATERIALES).filter(([id]) => !id.startsWith('_'))) {
        const r = id === 'pla' ? rapido : await laminar({ caso: 'cubo', calidad: 'rapido', material: id });
        revisarGenerales(revisar, mat, r);
        revisarEspecificos(revisar, id, mat, r, rapido, fPla);
    }
    await probarRecorte({ laminar, revisar, pagina });
}
