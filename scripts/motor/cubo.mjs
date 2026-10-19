// Cubo con el perfil real de la Ender 3 V3 SE y las calidades (laminado en Chromium).
// Calidad Normal: start/end G-code, ventilador, retracción, centrado, altura, capas, macros; pausas de filamento en
// las capas 10 y última; calidades Rápido (0,28 mm) y Detalle (0,12 mm).
// Devuelve el cubo en Rápido: las pruebas de materiales y de avanzado lo comparan.

import { probarPausa } from './ayudas.mjs';

function perfilNormal(normal, revisar) {
    revisar(
        'start G-code con temperaturas PLA',
        ['M140 S60', 'M190 S60', 'M104 S200', 'M109 S200', 'G28'].every(normal.g.tiene),
    );
    // Ventilador: apagado en la primera capa y al 100 % desde la segunda.
    const capa = n => normal.g.lineas.indexOf(`;LAYER:${n}`);
    const ventilador = normal.g.lineas.map((l, i) => [i, l.match(/^M106 S(\d+)/)]).filter(([, m]) => m);
    const prendidoAntes = n => ventilador.some(([i, m]) => i < capa(n) && +m[1] > 0);
    revisar('ventilador apagado en la capa 0', !prendidoAntes(1));
    revisar(
        'ventilador al 100 % desde la capa 1',
        ventilador.some(([i, m]) => i > capa(1) && i < capa(2) && m[1] === '255'),
    );
    revisar('retracción de 0,8 mm', normal.g.tiene('G1 E-0.8'));
    revisar(
        'cubo centrado en la cama',
        normal.g.x[0] > 95 && normal.g.x[1] < 125 && normal.g.y[0] > 95 && normal.g.y[1] < 125,
        `X ${normal.g.x} Y ${normal.g.y}`,
    );
    revisar('altura ~20 mm', normal.g.zMax >= 19.8 && normal.g.zMax <= 21, `Z máx ${normal.g.zMax}`);
    revisar('capas de 0,2 mm', Math.abs(normal.g.capas - 100) <= 1, `(${normal.g.capas} capas)`);
    revisar('end G-code', normal.g.tiene('M84 X Y E') && normal.g.tiene('G1 X0 Y220'));
    revisar('sin macros sin reemplazar', !normal.gcode.includes('{'));
}

export async function probarCubo({ laminar, revisar }) {
    // 1. Cubo con calidad Normal: perfil completo de la Ender 3 V3 SE.
    const normal = await laminar({ caso: 'cubo', calidad: 'normal' });
    perfilNormal(normal, revisar);

    // Pausa de filamento en el G-code del cubo (capa 10 y la última).
    for (const capa of [9, normal.g.capas - 1]) {
        const p = probarPausa(normal.gcode, capa);
        revisar('pausa entre capas', p.ok, p.detalle);
    }

    // 2. Las otras calidades cambian la altura de capa.
    const rapido = await laminar({ caso: 'cubo', calidad: 'rapido' });
    revisar('Rápido: capas de 0,28 mm', Math.abs(rapido.g.capas - 20 / 0.28) <= 2, `(${rapido.g.capas} capas)`);
    const detalle = await laminar({ caso: 'cubo', calidad: 'detalle' });
    revisar(
        'Detalle: capas de 0,12 mm',
        Math.abs(detalle.g.capas - (1 + 19.8 / 0.12)) <= 2,
        `(${detalle.g.capas} capas)`,
    );
    return rapido;
}
