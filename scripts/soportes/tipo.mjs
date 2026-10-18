// Pruebas de src/perfiles/soportes.js (Node, sin navegador). Las corre scripts/probar-soportes.mjs.

import { normalizarSoportes, procesoDeSoportes, etiquetaSoportes } from '../../src/perfiles/soportes.js';

const J = JSON.stringify;

export default async function ({ revisar }) {
    console.log('\n▶ normalizarSoportes');
    const tabla = [
        [true, 'normal'],
        [false, 'no'],
        ['no', 'no'],
        ['normal', 'normal'],
        ['arbol', 'arbol'],
        [undefined, 'no'],
        [null, 'no'],
        ['cualquiera', 'no'],
        [1, 'no'],
    ];
    for (const [entrada, esperado] of tabla) {
        revisar(`normalizarSoportes(${String(J(entrada))}) -> '${esperado}'`, normalizarSoportes(entrada) === esperado);
    }

    console.log('\n▶ procesoDeSoportes');
    revisar("'no' -> {}", J(procesoDeSoportes('no')) === '{}');
    revisar(
        "'normal' -> sliceSupportType automatic",
        J(procesoDeSoportes('normal')) === J({ sliceSupportType: 'automatic' }),
    );
    revisar(
        "'arbol' -> automatic + sliceSupportTree",
        J(procesoDeSoportes('arbol')) === J({ sliceSupportType: 'automatic', sliceSupportTree: true }),
    );
    revisar(
        'acepta lo viejo (true -> normal, false -> {})',
        J(procesoDeSoportes(true)) === J({ sliceSupportType: 'automatic' }) && J(procesoDeSoportes(false)) === '{}',
    );

    // perfiles.js hoy hace `...(soportes ? { sliceSupportType: 'automatic' } : {})` (línea 228); perfiles.js necesita Vite
    // (import.meta.glob) y no se carga acá, por eso se compara contra ese literal.
    console.log('\n▶ etiquetaSoportes');
    revisar(
        'etiquetas por tipo',
        etiquetaSoportes('no') === '' &&
            etiquetaSoportes('normal') === ' · con soportes' &&
            etiquetaSoportes('arbol') === ' · soportes árbol',
    );
}
