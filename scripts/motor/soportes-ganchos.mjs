// Ganchos de soportes en Kiri (ADR 0004, tarea T0; riesgo R5; adaptado en T4 al puente real y al registro opcional).
// Responsabilidad: laminar una "T" (voladizos de 20 mm) con sliceSupportType 'automatic' y dos copias en `track.pos`
// distintos, con `bloqueos` en la pieza, y comprobar con lo que registra el puente (`info.ganchos`, que sólo viaja con `diagnostico: true`; ver
// src/motor/soportes-kiri.js) que los parches de scripts/vendor-kiri.mjs disparan donde creemos:
//   b. `sinBloqueos` se llama una vez por capa de cada widget, con z de arriba hacia abajo, y `widget.anno.bloqueos`
//      llega con el contenido exacto que se mandó;
//   c. el G-code es idéntico al de una corrida sin ganchos (`window.probarPiezas` usa el worker original de Kiri,
//      sin puente instalado), salvo la línea de fecha;
//   d. las dos copias reciben las mismas zonas, en coordenadas locales (no desplazadas por su `track.pos`).
// El punto (a) (que `parchar` aplique) lo verifica `npm run vendor:kiri`: falla con un mensaje si el ancla no está.
// Lo llama scripts/probar-motor.mjs dentro de su `try`.

import { sinFecha } from './gcode-capas.mjs';

const POS = [
    { x: -40, y: 0 },
    { x: 40, y: 30 },
];
// Zonas de ejemplo: una esfera sobre la tapa de la T y otra en un lugar cualquiera (valores que se reconocen).
const BLOQUEOS = [
    { id: 3, forma: 'esfera', centro: { x: 4.2, y: -1.5, z: 12 }, radio: 8 },
    { id: 4, forma: 'esfera', centro: { x: -20, y: 2, z: 19.5 }, radio: 3.5 },
];
const SOPORTES = { soportes: true, personal: { adhesion: 'nada' }, diagnostico: true };

// El encabezado vuelca la configuración: con la opción prendida cambia la línea `; sliceSupportTree = ...`.
const sinCabecera = g => sinFecha(g).replace(/^; sliceSupportTree = .*$/m, '');

// Divide el registro de `sinBloqueos` en corridas (una por widget): cada vez que z deja de bajar empieza otra.
function corridas(registro) {
    const out = [];
    for (const e of registro) {
        const actual = out[out.length - 1];
        if (actual && e.z < actual[actual.length - 1].z) actual.push(e);
        else out.push([e]);
    }
    return out;
}

// Kiri agrega una capa vacía arriba de todo (`newSlice(index + 1)`: su `z` es un índice, no mm; ver slice.js, "inject
// one empty slice at the top"). Es la primera de cada corrida; el resto son las capas reales, con z en mm.
const reales = zs => zs.slice(1);
const bajaEstricto = zs => zs.every((z, i) => i === 0 || z < zs[i - 1]);
const f = n => Math.round(n * 1000) / 1000;
const rango = zs => `${f(zs[0])} → ${f(zs[zs.length - 1])}`;

// b y d: lo que llega a `sinBloqueos` y `arbol` en una corrida con sliceSupportType 'automatic'.
function revisarLlamadas({ revisar }, r) {
    const { sinBloqueos: sb, arbol } = r.info.ganchos;
    const capas = r.info.capas;
    const runs = corridas(sb.registro);
    const zs = runs.map(run => run.map(e => e.z));
    const esperado = JSON.stringify(BLOQUEOS);
    revisar(
        'b1. sinBloqueos se llama una vez por capa de cada copia (copias × capas)',
        sb.llamadas === POS.length * capas && sb.registro.length === sb.llamadas && runs.length === POS.length,
        `${sb.llamadas} llamadas, ${capas} capas, ${POS.length} copias, ${runs.length} corridas de ${runs.map(x => x.length)}`,
    );
    revisar(
        'b2. en cada copia, z va de arriba hacia abajo (estrictamente decreciente): capa vacía del tope, la tapa (~23 mm) y hasta la primera capa',
        zs.every(z => bajaEstricto(z) && z[0] === capas - 1) &&
            zs.map(reales).every(z => z[0] > 22 && z[0] <= 23 && z[z.length - 1] > 0 && z[z.length - 1] < 0.3),
        `z por copia: ${zs.map(rango).join(' | ')} (la primera es la capa vacía que Kiri agrega arriba, z = índice)`,
    );
    revisar(
        'b3. widget.anno.bloqueos llega con el contenido exacto que mandó la prueba, en todas las capas',
        sb.registro.every(e => e.bloqueos === esperado && e.n === BLOQUEOS.length),
        `${new Set(sb.registro.map(e => e.bloqueos)).size} contenido(s) distinto(s); n = ${[...new Set(sb.registro.map(e => e.n))]}`,
    );
    revisar(
        'd. las dos copias reciben las mismas zonas y los mismos z (marco local, sin sumar su track.pos)',
        runs.length === 2 && JSON.stringify(zs[0]) === JSON.stringify(zs[1]) && zs[0][1] <= 23,
        `copia 1: z ${rango(zs[0] || [0])}; copia 2: z ${rango(zs[1] || [0])}; centros ${BLOQUEOS.map(b => `(${b.centro.x}, ${b.centro.y}, ${b.centro.z})`)} idénticos en ambas`,
    );
    revisar(
        'arbol no se llama con sliceSupportType automático sin sliceSupportTree',
        arbol.llamadas === 0,
        `${arbol.llamadas} llamadas`,
    );
}

// El resto: sin soportes no hay llamadas; con sliceSupportTree llama `arbol` una vez por copia y, como el árbol real
// devuelve true, el bucle de Kiri no corre: `sinBloqueos` no se llama y el G-code ya no es el de 'automatic'.
async function revisarCasosLimite({ laminar, revisar }, referencia) {
    const sin = await laminar({
        piezas: [{ caso: 'te', posiciones: POS, bloqueos: BLOQUEOS }],
        soportes: false,
        diagnostico: true,
    });
    revisar(
        'sin soportes no se llama a ningún gancho',
        sin.info.ganchos.sinBloqueos.llamadas === 0 && sin.info.ganchos.arbol.llamadas === 0,
        `sinBloqueos ${sin.info.ganchos.sinBloqueos.llamadas}, arbol ${sin.info.ganchos.arbol.llamadas}`,
    );
    const arbol = await laminar({
        piezas: [{ caso: 'te', posiciones: POS, bloqueos: BLOQUEOS }],
        ...SOPORTES,
        extras: { sliceSupportTree: true },
    });
    const a = arbol.info.ganchos.arbol;
    revisar(
        'con sliceSupportTree se llama a arbol una vez por copia (stack completo, mismos bloqueos) y sinBloqueos no se llama',
        a.llamadas === POS.length &&
            a.registro.every(e => e.capas === arbol.info.capas && e.n === BLOQUEOS.length) &&
            arbol.info.ganchos.sinBloqueos.llamadas === 0,
        `${a.llamadas} llamadas, capas ${a.registro.map(e => e.capas)}, opciones ${JSON.stringify(a.registro[0]?.opciones)}`,
    );
    revisar(
        'con sliceSupportTree el G-code es el del árbol, no el de la corrida sin ganchos',
        sinCabecera(arbol.gcode) !== sinCabecera(referencia.gcode),
        `${arbol.gcode.length} caracteres`,
    );
    const viejo = await laminar({ caso: 'te', ...SOPORTES });
    revisar(
        'una pieza sin `bloqueos` llega con anno.bloqueos = [] (no undefined)',
        viejo.info.ganchos.sinBloqueos.registro.length > 0 &&
            viejo.info.ganchos.sinBloqueos.registro.every(e => e.bloqueos === '[]'),
        `${viejo.info.ganchos.sinBloqueos.registro.length} llamadas`,
    );
}

/**
 * Pruebas de la tarea T0 del ADR 0004: criterios b, c y d (el a lo cubre el script de vendor).
 * @param {{ laminar: Function, revisar: Function, pagina: object }} ctx `pagina` es la de Playwright con `window.probarPiezas`
 * @returns {Promise<void>}
 */
export async function probarSoportesGanchos(ctx) {
    console.log('\n▶ Ganchos de soportes con puente de mentira (ADR 0004, T0)');
    const r = await ctx.laminar({ piezas: [{ caso: 'te', posiciones: POS, bloqueos: BLOQUEOS }], ...SOPORTES });
    // Referencia sin ganchos: el worker original de Kiri (sin puente), una pieza por copia.
    const ref = await ctx.pagina.evaluate(o => window.probarPiezas(o), {
        piezas: POS.map(pos => ({ caso: 'te', pos })),
        ...SOPORTES,
    });
    revisarLlamadas(ctx, r);
    // Sin zonas el puente real no cambia nada; con zonas el G-code cambia (las zonas se restan de verdad).
    const sinZonas = await ctx.laminar({ piezas: [{ caso: 'te', posiciones: POS, bloqueos: [] }], ...SOPORTES });
    ctx.revisar(
        'c. sin zonas el G-code con ganchos es idéntico al de una corrida sin ganchos (salvo la fecha de la línea 2)',
        sinFecha(sinZonas.gcode) === sinFecha(ref.gcode),
        `${sinZonas.gcode.length} caracteres, ${sinZonas.gcode.split('\n').length} líneas`,
    );
    ctx.revisar(
        'con zonas el G-code cambia (se restan de la sombra)',
        sinFecha(r.gcode) !== sinFecha(ref.gcode),
        `${r.gcode.length} caracteres`,
    );
    await revisarCasosLimite(ctx, sinZonas);
}
