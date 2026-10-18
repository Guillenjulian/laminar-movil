// Pruebas de `textoAvisoVista` (ADR 0006, T6): el texto del aviso de la vista previa según el resultado de leer.
// Puro: corre en Node, sin navegador. Se usa `simplificado`, no `nivel > 0`.
import { textoAvisoVista } from '../../src/ui/aviso-vista.js';
import { leer } from './ayuda.mjs';

export function probarAviso({ revisar }) {
    console.log('\ntextoAvisoVista');
    const ni = { simplificado: false, incompleta: false, nivel: 0 };
    revisar('nada: texto vacío', textoAvisoVista(ni, 72) === '');
    // El caso que distingue `simplificado` de `nivel > 0`: se pidió el nivel 3 pero no se unió nada.
    revisar('nivel 3 sin simplificar: texto vacío', textoAvisoVista({ ...ni, nivel: 3 }, 72) === '');

    const simp = textoAvisoVista({ simplificado: true, incompleta: false, nivel: 1 }, 72);
    revisar('simplificado: dice que la vista previa está simplificada', /simplificada/.test(simp), simp);
    revisar('simplificado: dice que el G-code no cambia', /G-code[^.]*no cambia/.test(simp), simp);
    revisar('simplificado: no habla de capas cortadas', !/hasta la capa/.test(simp), simp);

    const inc = textoAvisoVista({ simplificado: false, incompleta: true }, 31);
    revisar('incompleta: dice hasta qué capa llega', /muy grande/.test(inc) && /hasta la capa 31\b/.test(inc), inc);
    revisar('incompleta: dice que el G-code está completo', /G-code está completo/.test(inc), inc);
    revisar(
        'incompleta y simplificado: manda el texto de incompleta',
        textoAvisoVista({ simplificado: true, incompleta: true }, 31) === inc,
    );
    revisar('el texto de incompleta usa las capas pedidas', /capa 5\b/.test(textoAvisoVista({ incompleta: true }, 5)));

    // Con un resultado real de `leer`: un G-code corto en el nivel 3 no se simplifica, así que no avisa.
    const corto = 'G1 Z0.2\nG1 X0 Y0\nG1 X10 Y0 E1\nG1 X10 Y10 E2\n';
    const r = leer(corto, Infinity, { nivel: 3 });
    revisar(
        'leer en nivel 3 sin nada que unir: sin aviso',
        r.nivel === 3 && !r.simplificado && textoAvisoVista(r, 1) === '',
        JSON.stringify({ nivel: r.nivel, simplificado: r.simplificado }),
    );
}
