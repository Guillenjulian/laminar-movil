// Autoprueba de las reglas de textos de scripts/verificar-chunks.mjs (ADR 0008, I2): `evaluar()` con filas sintéticas,
// sin build. Vive en test:textos porque test:chunks necesita `npm run build` y esto no.
import { evaluar } from '../verificar-chunks.mjs';

const fila = (nombre, extra = {}) => ({
    ruta: `/dist/${nombre}`,
    nombre,
    bytes: 1000,
    gzip: 500,
    clausura: false,
    visor: false,
    jszip: false,
    diagnostico: false,
    textos: false,
    idioma: false,
    ...extra,
});
const principal = fila('assets/main.js', { bytes: 70000, clausura: true });
const dic = fila('assets/es-1.js', { textos: true });
const ARCHIVOS = ['assets/main.js', 'assets/es-1.js', 'assets/otro.js'];
const correr = (filas, archivos = ARCHIVOS, hayTextos = true) =>
    evaluar(principal, [principal, ...filas], archivos, hayTextos);
const da = (fallas, regla) => fallas.some(f => f.startsWith(regla));

/** Los diccionarios fuera de la carga inicial y en el service worker. */
function diccionarios({ revisar, igual }) {
    revisar('chunks: diccionarios dinámicos y en el service worker pasan', igual(correr([dic]), []));
    const dentro = fila('assets/en-2.js', { textos: true, clausura: true });
    const enClausura = correr([dentro], [...ARCHIVOS, dentro.nombre]);
    revisar(
        'chunks: diccionarios en un chunk de la clausura (no el principal) dan ✘',
        da(enClausura, '[textos-en-clausura]'),
    );
    revisar(
        'chunks: diccionarios que el service worker no guarda dan ✘',
        da(correr([dic], ['assets/main.js']), '[textos-fuera-sw]'),
    );
    const conTextos = { ...principal, textos: true };
    revisar(
        'chunks: diccionarios dentro del principal dan ✘',
        da(evaluar(conTextos, [conTextos], ARCHIVOS, true), '[textos-en-clausura]'),
    );
}

/** idioma.js en la carga inicial y los chunks es/en. */
function idioma({ revisar, igual }) {
    const p = { ...principal, idioma: true };
    revisar(
        'chunks: idioma.js en la carga inicial y ningún chunk es/en da ✘',
        da(evaluar(p, [p], ARCHIVOS, true), '[textos-sin-chunks]'),
    );
    revisar('chunks: idioma.js con sus chunks es/en pasa', igual(evaluar(p, [p, dic], ARCHIVOS, true), []));
    revisar('chunks: sin claves en src/textos no se exige nada', igual(evaluar(p, [p], ARCHIVOS, false), []));
}

/** @param {{revisar: Function, igual: Function}} ctx @returns {Promise<void>} */
export default async function (ctx) {
    diccionarios(ctx);
    idioma(ctx);
    const a = fila('assets/a.js', { bytes: 200000, clausura: true });
    const b = fila('assets/b.js', { bytes: 200000, clausura: true });
    const pesada = correr([a, b], [...ARCHIVOS, a.nombre, b.nombre]);
    ctx.revisar('chunks: la clausura (no sólo el principal) pesa de más da ✘', da(pesada, '[clausura]'));
}
