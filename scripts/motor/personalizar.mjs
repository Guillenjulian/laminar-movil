// Soportes automáticos y "Personalizar" (laminado en Chromium): soportes con los minions locales (agregan material y
// admiten pausas); patrones de relleno, densidad, paredes y adhesión (nada, falda, borde, balsa).
// Devuelve `base` (cubo con el perfil por defecto) y `nada` (adhesión nada): las pruebas de avanzado los comparan.

import { probarPausa, filamento } from './ayudas.mjs';

// 3. Soportes automáticos (con los minions locales).
async function probarSoportes({ laminar, revisar }) {
    const sinSop = await laminar({ caso: 'te' });
    const conSop = await laminar({ caso: 'te', soportes: true });
    const pSop = probarPausa(conSop.gcode, 50);
    revisar('pausa con soportes', pSop.ok, pSop.detalle);
    revisar(
        'soportes agregan material',
        conSop.info.filamento > sinSop.info.filamento * 1.1,
        `(${(sinSop.info.filamento / 1000).toFixed(2)} m → ${(conSop.info.filamento / 1000).toFixed(2)} m)`,
    );
}

// Patrones, densidad y paredes. Devuelve el cubo base para comparar.
async function probarRelleno({ laminar, revisar }) {
    const base = await laminar({ caso: 'cubo', personal: {} });
    const usados = {};
    for (const patron of ['hex', 'grid', 'gyroid', 'cubic', 'triangle', 'linear']) {
        const r = await laminar({ caso: 'cubo', personal: { patron } });
        usados[patron] = r.info.filamento;
        revisar(`relleno ${patron} lamina`, r.g.capas >= 99, filamento(r));
    }
    revisar('los patrones dan recorridos distintos', new Set(Object.values(usados).map(v => v.toFixed(0))).size >= 4);
    const macizo = await laminar({ caso: 'cubo', personal: { densidad: 1 } });
    const liviano = await laminar({ caso: 'cubo', personal: { densidad: 0.1 } });
    revisar(
        'densidad 100 % > 20 % > 10 %',
        macizo.info.filamento > base.info.filamento && base.info.filamento > liviano.info.filamento,
        `${filamento(liviano)} < ${filamento(base)} < ${filamento(macizo)}`,
    );
    const unaPared = await laminar({ caso: 'cubo', personal: { paredes: 1, densidad: 0 } });
    const cuatro = await laminar({ caso: 'cubo', personal: { paredes: 4, densidad: 0 } });
    revisar(
        'más paredes, más filamento',
        cuatro.info.filamento > unaPared.info.filamento * 1.5,
        `${filamento(unaPared)} → ${filamento(cuatro)}`,
    );
    return base;
}

// Adhesión: cuánto se extiende la primera capa alrededor del cubo (de 100 a 120 mm).
const margen = r => {
    const l = r.g.lineas,
        i0 = l.indexOf(';LAYER:0'),
        i1 = l.indexOf(';LAYER:1');
    const xs = l
        .slice(i0, i1)
        .filter(x => /^G1 .*X.*E\d/.test(x))
        .map(x => +x.match(/X([\d.]+)/)[1]);
    return Math.max(110 - Math.min(...xs), Math.max(...xs) - 110) - 10;
};

// Devuelve el cubo sin adhesión.
async function probarAdhesion({ laminar, revisar }) {
    const nada = await laminar({ caso: 'cubo', personal: { adhesion: 'nada' } });
    const falda = await laminar({ caso: 'cubo', personal: { adhesion: 'falda' } });
    const borde = await laminar({ caso: 'cubo', personal: { adhesion: 'borde' } });
    const balsa = await laminar({ caso: 'cubo', personal: { adhesion: 'balsa' } });
    revisar('adhesión nada: sin nada alrededor', margen(nada) < 0.5, `margen ${margen(nada).toFixed(1)} mm`);
    revisar(
        'adhesión falda: separada ~3 mm',
        margen(falda) > 3 && margen(falda) < 5,
        `margen ${margen(falda).toFixed(1)} mm`,
    );
    revisar(
        'adhesión borde: ~4 mm pegado',
        margen(borde) > 3 && margen(borde) < 5.5 && borde.info.filamento > falda.info.filamento,
        `margen ${margen(borde).toFixed(1)} mm`,
    );
    revisar(
        'adhesión balsa: capas extra debajo',
        balsa.g.zMax > nada.g.zMax + 0.3 && balsa.info.filamento > nada.info.filamento * 1.1,
        `Z máx ${nada.g.zMax} → ${balsa.g.zMax}`,
    );
    return nada;
}

export async function probarPersonalizar({ laminar, revisar }) {
    await probarSoportes({ laminar, revisar });
    // 4. Personalizar: patrones, densidad, paredes y adhesión.
    const base = await probarRelleno({ laminar, revisar });
    const nada = await probarAdhesion({ laminar, revisar });
    return { base, nada };
}
