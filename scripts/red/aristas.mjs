// Aristas y prohibiciones de src/red/ (ADR 0007, 6.10): lee el texto de cada archivo, sin ejecutarlo.
// No entra en scripts/lib/contratos-ui.js, que sólo recorre src/ui/.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../src/', import.meta.url));
const PERMITIDAS = {
    direccion: [],
    peticiones: [],
    errores: [],
    transporte: ['red/direccion'],
    cliente: ['red/peticiones', 'red/errores'],
    'config-red': ['red/direccion'],
};

/** Saca los comentarios (de bloque y de línea entera o finales con espacio) para no confundirlos con código. */
function sinComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\s\/\/\s.*$/gm, '');
}

/** Rutas importadas (estáticas, `export … from` y dinámicas), normalizadas a `carpeta/archivo` sin `.js`. */
function importados(codigo, archivo) {
    const patron =
        /(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    const rutas = [];
    for (const m of codigo.matchAll(patron)) {
        const ruta = m[1] ?? m[2] ?? m[3];
        const absoluta = ruta.startsWith('.') ? new URL(ruta, `file://${RAIZ}red/${archivo}.js`).pathname : ruta;
        rutas.push(absoluta.startsWith(RAIZ) ? absoluta.slice(RAIZ.length).replace(/\.js$/, '') : ruta);
    }
    return rutas;
}

const PROHIBIDO = [
    ['document', /\bdocument\b/],
    ['window', /\bwindow\b/],
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['console', /\bconsole\b/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['eval', /\beval\s*\(|\bnew\s+Function\b/],
];

export default async function ({ revisar }) {
    for (const [archivo, permitidas] of Object.entries(PERMITIDAS)) {
        console.log(`\nsrc/red/${archivo}.js`);
        const ruta = `${RAIZ}red/${archivo}.js`;
        if (!existsSync(ruta)) {
            revisar(`falta src/red/${archivo}.js`, false);
            continue;
        }
        const codigo = sinComentarios(readFileSync(ruta, 'utf8'));
        const rutas = importados(codigo, archivo);
        const sobran = rutas.filter(r => !permitidas.includes(r));
        revisar(
            `sólo importa ${permitidas.length ? permitidas.join(', ') : 'nada'}`,
            sobran.length === 0,
            `importa además: ${sobran.join(', ')}`,
        );
        for (const r of permitidas) revisar(`usa ${r}`, rutas.includes(r));
        revisar(
            'no importa de ui, almacen, perfiles ni motor',
            !rutas.some(r => /^(ui|perfiles|motor)\/|^almacen$|(^|\/)almacen(\.js)?$/.test(r)),
            rutas.join(', '),
        );
        for (const [nombre, patron] of PROHIBIDO) {
            revisar(`no usa ${nombre}`, !patron.test(codigo));
        }
        // fetch global: sólo transporte.js lo toca (el resto lo recibe por parámetro).
        if (archivo !== 'transporte') revisar('no nombra fetch (lo recibe por parámetro)', !/\bfetch\b/.test(codigo));
    }
}
