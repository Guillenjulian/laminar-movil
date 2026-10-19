// Guardianes de los diccionarios es/en (ADR 0008, "Pruebas", puntos 2 a 9; el 1, `t`, es de nucleo.mjs).
// Lee src/textos/<idioma>/<area>.json con fs (sin Vite). Primero corre las autopruebas con diccionarios sintéticos
// (autopruebas.mjs) y después los chequeos reales. Si falta src/textos/, cada chequeo informa "✘ falta src/textos/…".
//
// Convención de "claves no usadas" (punto 5): el escáner busca usos LITERALES, con comillas, en todo `src/**/*.js`
// (menos src/textos/, src/ui/idioma.js que define las funciones y el Kiri vendorizado) y en index.html:
//   - JavaScript: t('a.b'), existe('a.b') y marcar('a.b') (también con "" o `` sin ${}); se ignoran los comentarios.
//   - HTML: data-t="a.b", data-t-html="a.b" y data-t-attr="atributo:a.b;otro:a.c".
// Una clave dinámica (t(variable), t(`a.${x}`), marcar(id)) falla: usá una tabla con marcar() y después t(TABLA[id]).
// existe(variable) se tolera (perfiles busca existe por id): sus claves se declaran por prefijo en CLAVES_RESERVADAS.
//
// Español suelto (punto 8): MIGRADOS lista los archivos de src/ui/ ya migrados; en ellos ningún literal fuera de
// comentarios lleva áéíóúñ¿¡ ni (en textos de dos palabras o más) el, la, de, que, para, con, no, salvo `// t-ignorar`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
    aplanar,
    clavesDelHtml,
    compararEstructura,
    cruzarClaves,
    elementosConTexto,
    espanolSuelto,
    formaDeClaves,
    htmlContraEs,
    inglesCopiado,
    marcadoNoPermitido,
    usosEnJs,
} from './detectores.mjs';
import { autopruebas } from './autopruebas.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const TEXTOS = join(RAIZ, 'src', 'textos');
/** Prefijos de claves definidas que se usan sin literal (p. ej. `existe('perfiles.material.' + id)`). Vacía al empezar. */
export const CLAVES_RESERVADAS = [];
/** Archivos de src/ ya migrados a t(), con ruta desde la raíz. Cada tarea de migración suma el suyo. */
export const MIGRADOS = [];
const SIN_ESCANEAR = ['src/textos', 'src/ui/idioma.js', 'src/perfiles/impresoras/kiri'];

/** Lee src/textos/<idioma>/*.json. @returns {Record<string, Record<string, any>>|null} área → claves; null si falta */
function leerIdioma(idioma) {
    const carpeta = join(TEXTOS, idioma);
    if (!existsSync(carpeta)) return null;
    const dic = {};
    for (const f of readdirSync(carpeta).filter(n => n.endsWith('.json'))) {
        dic[f.slice(0, -5)] = JSON.parse(readFileSync(join(carpeta, f), 'utf8'));
    }
    return dic;
}

/** Archivos .js de src/ salvo SIN_ESCANEAR. @returns {string[]} rutas absolutas */
function archivosJs(carpeta = join(RAIZ, 'src')) {
    return readdirSync(carpeta, { withFileTypes: true }).flatMap(e => {
        const ruta = join(carpeta, e.name);
        if (SIN_ESCANEAR.includes(relative(RAIZ, ruta).split('\\').join('/'))) return [];
        if (e.isDirectory()) return archivosJs(ruta);
        return e.name.endsWith('.js') ? [ruta] : [];
    });
}

/** Usos de claves en src/**.js y en index.html. @returns {{usadas: Set<string>, dinamicas: string[], elementos: any[]}} */
function escanearUsos() {
    const usadas = new Set();
    const dinamicas = [];
    for (const ruta of archivosJs()) {
        const usos = usosEnJs(readFileSync(ruta, 'utf8'));
        usos.claves.forEach(k => usadas.add(k));
        dinamicas.push(...usos.dinamicas.map(d => `${relative(RAIZ, ruta)}: ${d}`));
    }
    const elementos = elementosConTexto(readFileSync(join(RAIZ, 'index.html'), 'utf8'));
    clavesDelHtml(elementos).forEach(k => usadas.add(k));
    return { usadas, dinamicas, elementos };
}

/** Informa un chequeo: ✔ si no hay mensajes; si no, ✘ con la lista (tope de 15 líneas). */
function informar(revisar, nombre, errores) {
    const resto = errores.length > 15 ? [`… y ${errores.length - 15} más`] : [];
    revisar(nombre, errores.length === 0, `\n      ${[...errores.slice(0, 15), ...resto].join('\n      ')}`);
}

const definidas = es => new Set(aplanar(es).keys());
const migrado = m =>
    existsSync(join(RAIZ, m))
        ? espanolSuelto(readFileSync(join(RAIZ, m), 'utf8'), m)
        : [`falta el módulo migrado ${m}`];

/** Los chequeos reales; cada uno recibe { es, en, usos } y devuelve mensajes. */
const CHEQUEOS = [
    ['mismas áreas, claves, tipos, variables y plurales en es y en', ({ es, en }) => compararEstructura(es, en)],
    [
        'forma de las claves (regex, prefijo = archivo, sin repetidas)',
        ({ es, en }) => [...formaDeClaves(es), ...formaDeClaves(en)],
    ],
    [
        'marcado permitido (sólo <b>, <small>, <br>; sin &)',
        ({ es, en }) => [...marcadoNoPermitido(es), ...marcadoNoPermitido(en)],
    ],
    ['sin claves dinámicas (usá marcar())', ({ usos }) => usos.dinamicas],
    [
        'claves usadas y definidas en es',
        ({ es, usos }) => cruzarClaves(definidas(es), usos.usadas).sinDefinir.map(k => `usada pero no definida: ${k}`),
    ],
    [
        'claves definidas y usadas',
        ({ es, usos }) =>
            cruzarClaves(definidas(es), usos.usadas, CLAVES_RESERVADAS).sinUso.map(k => `definida pero sin uso: ${k}`),
    ],
    [
        'el HTML dice lo mismo que es (sin variables, data-t sin hijos)',
        ({ es, usos }) => htmlContraEs(usos.elementos, aplanar(es)),
    ],
    ['módulos migrados sin español suelto', () => MIGRADOS.flatMap(migrado)],
];

/** @param {{revisar: Function, igual: Function}} ctx @returns {Promise<void>} */
export default async function (ctx) {
    autopruebas(ctx);
    console.log('-- diccionarios reales (src/textos)');
    const es = leerIdioma('es');
    const en = leerIdioma('en');
    if (!es || !en) {
        for (const [nombre] of CHEQUEOS) ctx.revisar(`falta src/textos/${es ? 'en' : 'es'}/ (${nombre})`, false);
        return;
    }
    const usos = escanearUsos();
    for (const [nombre, chequeo] of CHEQUEOS) informar(ctx.revisar, nombre, chequeo({ es, en, usos }));
    const copias = inglesCopiado(es, en);
    if (copias.length) {
        console.log(
            `  ! aviso: ${copias.length} valores de en iguales a es:\n      ${copias.slice(0, 10).join('\n      ')}`,
        );
    }
}
