// Detectores puros de los diccionarios (ADR 0008, I2). No leen disco ni exportan `default` (el orquestador
// `scripts/probar-textos.mjs` los saltea): los usa `diccionarios.mjs` con los .json reales y `autopruebas.mjs`
// con diccionarios sintéticos en memoria. Cada detector devuelve una lista de mensajes; vacía = pasa.
//
// Formas de datos:
//   Diccionario de un idioma = { [area]: { [clave]: texto | { one?: texto, other: texto } } }  (un área = un .json)
//   Aplanado = Map<clave, { area, valor }>

/** Clave válida (ADR 0008, B.3). */
export const CLAVE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
const MARCADO_PERMITIDO = /<\/?(?:b|small)>|<br>/g;

export * from './lector-js.mjs';
import { ATRIBUTOS_TRADUCIBLES } from '../../src/textos/atributos.js';

/** @param {string} texto @returns {string[]} variables `{x}` sin repetir, en orden de aparición */
export function variablesDe(texto) {
    return [...new Set([...texto.matchAll(/\{([a-zA-Z0-9]+)\}/g)].map(m => m[1]))];
}

/** @param {string} s @returns {string} espacios colapsados */
export const colapsar = s => s.replace(/\s+/g, ' ').trim();

/** Todas las formas de texto de un valor (un texto, o las formas del plural). @param {string|object} valor */
export const formasDe = valor =>
    (typeof valor === 'string' ? [valor] : valor && typeof valor === 'object' ? Object.values(valor) : []).filter(
        f => typeof f === 'string',
    );

/** Atributos que `data-t-attr` puede traducir (ADR 0008, B.4). */
export { ATRIBUTOS_TRADUCIBLES };

/** Un texto del diccionario: no vacío y sin llaves sueltas fuera de `{variable}`. @returns {string|null} el motivo */
function textoInvalido(texto) {
    if (typeof texto !== 'string' || texto.trim() === '') return 'tiene que ser un texto no vacío';
    if (/[{}]/.test(texto.replace(/\{[a-zA-Z0-9]+\}/g, '')))
        return 'lleva una llave { o } suelta (sólo valen {variable})';
    return null;
}

/** Valor válido: texto no vacío, o `{ other: texto, one?: texto }` y nada más. @param {unknown} valor
 *  @returns {string|null} el motivo del error, o null si es válido */
export function valorValido(valor) {
    if (typeof valor === 'string') return textoInvalido(valor);
    if (valor === null || typeof valor !== 'object' || Array.isArray(valor))
        return 'no es un texto ni un plural {one, other}';
    const raras = Object.keys(valor).filter(f => f !== 'one' && f !== 'other');
    if (raras.length) return `forma de plural no permitida: ${raras}`;
    if (!('other' in valor)) return 'al plural le falta la forma other';
    const mala = ['other', 'one'].find(f => f in valor && textoInvalido(valor[f]));
    return mala ? `la forma ${mala}: ${textoInvalido(valor[mala])}` : null;
}

/** Valores inválidos de un diccionario (y áreas que no son un objeto de claves). @returns {string[]} */
export function valoresInvalidos(dic) {
    const errores = [];
    for (const [area, claves] of Object.entries(dic)) {
        if (claves === null || typeof claves !== 'object' || Array.isArray(claves)) {
            errores.push(`${area}.json: tiene que ser un objeto { clave: valor }`);
            continue;
        }
        for (const [clave, valor] of Object.entries(claves)) {
            const motivo = valorValido(valor);
            if (motivo) errores.push(`valor inválido en ${clave} (${area}.json): ${motivo}`);
        }
    }
    return errores;
}

/** Reservas vencidas: un prefijo de `CLAVES_RESERVADAS` que ya no tiene ninguna clave definida sin uso.
 *  @param {Set<string>} definidas @param {Set<string>} usadas @param {string[]} reservadas @returns {string[]} */
export function reservasVencidas(definidas, usadas, reservadas) {
    return reservadas
        .filter(prefijo => ![...definidas].some(k => k.startsWith(prefijo) && !usadas.has(k)))
        .map(p => `reserva vencida: ${p} ya no tiene claves sin uso; sacala de CLAVES_RESERVADAS`);
}

/** @param {Record<string, Record<string, any>>} dic @returns {Map<string, {area: string, valor: any}>} */
export function aplanar(dic) {
    const mapa = new Map();
    for (const [area, claves] of Object.entries(dic)) {
        if (!claves || typeof claves !== 'object') continue;
        for (const [clave, valor] of Object.entries(claves)) if (!mapa.has(clave)) mapa.set(clave, { area, valor });
    }
    return mapa;
}

/** Áreas (archivos) y claves que están en un idioma y faltan en el otro.
 *  @returns {string[]} p. ej. `falta en en: paso2.entran.error` */
export function faltantes(es, en) {
    const errores = [];
    for (const [de, a, nombre] of [
        [es, en, 'en'],
        [en, es, 'es'],
    ]) {
        for (const area of Object.keys(de)) if (!(area in a)) errores.push(`falta en ${nombre}: archivo ${area}.json`);
        const ajenas = aplanar(a);
        for (const clave of aplanar(de).keys()) if (!ajenas.has(clave)) errores.push(`falta en ${nombre}: ${clave}`);
    }
    return errores;
}

/** Pares de claves presentes en los dos idiomas. @returns {[string, any, any][]} */
function pares(es, en) {
    const b = aplanar(en);
    return [...aplanar(es)].filter(([k]) => b.has(k)).map(([k, v]) => [k, v.valor, b.get(k).valor]);
}

/** Misma forma (texto o plural) en las dos lenguas. @returns {string[]} */
export function tiposDistintos(es, en) {
    const tipo = v => (typeof v === 'string' ? 'texto' : esPlural(v) ? 'plural' : 'otro');
    return pares(es, en)
        .filter(([, a, b]) => tipo(a) !== tipo(b))
        .map(([k, a, b]) => `tipo distinto en ${k}: es ${tipo(a)}, en ${tipo(b)}`);
}

/** Mismas variables `{x}` por clave (unión de las formas). @returns {string[]} */
export function variablesDistintas(es, en) {
    const vars = v => [...new Set(formasDe(v).flatMap(variablesDe))].sort();
    return pares(es, en)
        .filter(([, a, b]) => String(vars(a)) !== String(vars(b)))
        .map(([k, a, b]) => `variables distintas en ${k}: es {${vars(a)}} / en {${vars(b)}}`);
}

const esPlural = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Mismas formas de plural (`one`, `other`) en las claves que son plural en los dos. @returns {string[]} */
export function pluralDistinto(es, en) {
    const formas = v => Object.keys(v).sort();
    return pares(es, en)
        .filter(([, a, b]) => esPlural(a) && esPlural(b) && String(formas(a)) !== String(formas(b)))
        .map(([k, a, b]) => `formas de plural distintas en ${k}: es ${formas(a)} / en ${formas(b)}`);
}

/** Todas las comparaciones es/en. @returns {string[]} */
export const compararEstructura = (es, en) => [
    ...faltantes(es, en),
    ...tiposDistintos(es, en),
    ...variablesDistintas(es, en),
    ...pluralDistinto(es, en),
];

/** Regex de la clave, prefijo igual al nombre del archivo y sin claves repetidas entre archivos. @returns {string[]} */
export function formaDeClaves(dic) {
    const errores = [];
    const vistas = new Map();
    for (const [area, claves] of Object.entries(dic)) {
        for (const clave of Object.keys(claves)) {
            if (!CLAVE.test(clave)) errores.push(`clave mal formada en ${area}.json: ${clave}`);
            else if (clave.split('.')[0] !== area)
                errores.push(`el prefijo de ${clave} no es ${area} (archivo ${area}.json)`);
            if (vistas.has(clave)) errores.push(`clave repetida en ${vistas.get(clave)}.json y ${area}.json: ${clave}`);
            else vistas.set(clave, area);
        }
    }
    return errores;
}

/** Ningún valor lleva `<` ni `&` salvo `<b>`, `<small>` y `<br>`. @returns {string[]} */
export function marcadoNoPermitido(dic) {
    const errores = [];
    for (const [clave, { valor }] of aplanar(dic)) {
        for (const forma of formasDe(valor)) {
            if (/[<&]/.test(forma.replace(MARCADO_PERMITIDO, '')))
                errores.push(`marcado no permitido en ${clave}: ${forma}`);
        }
    }
    return errores;
}

/** Valores de `en` iguales a los de `es` con más de una palabra (aviso, no falla). @returns {string[]} */
export function inglesCopiado(es, en) {
    const copias = [];
    for (const [clave, a, b] of pares(es, en)) {
        const iguales = formasDe(a).filter(
            (texto, i) => texto === formasDe(b)[i] && texto.trim().split(/\s+/).length > 1,
        );
        if (iguales.length) copias.push(`${clave}: ${iguales[0]}`);
    }
    return copias;
}

/** Claves usadas sin definir y definidas sin uso (salvo prefijos reservados). @param {Set<string>} definidas
 *  @param {Set<string>} usadas @param {string[]} reservadas prefijos de `CLAVES_RESERVADAS`
 *  @returns {{sinDefinir: string[], sinUso: string[]}} */
export function cruzarClaves(definidas, usadas, reservadas = []) {
    const reservada = clave => reservadas.some(prefijo => clave.startsWith(prefijo));
    return {
        sinDefinir: [...usadas].filter(k => !definidas.has(k)).sort(),
        sinUso: [...definidas].filter(k => !usadas.has(k) && !reservada(k)).sort(),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura de index.html: elementos con data-t, data-t-html y data-t-attr
// ---------------------------------------------------------------------------------------------------------------------

const VACIOS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'source',
    'track',
    'wbr',
]);
const ETIQUETA =
    /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;

/** @param {string} texto @returns {Record<string, string>} atributos de una etiqueta de apertura */
function atributosDe(texto) {
    const atributos = {};
    for (const m of texto.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        atributos[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    return atributos;
}

/** @param {string} s @returns {string} entidades HTML comunes resueltas */
export function decodificar(s) {
    const mapa = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (todo, e) => {
        if (e[0] === '#')
            return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
        return mapa[e] ?? todo;
    });
}

/** Elementos de `html` que llevan algún `data-t*`.
 *  @returns {{tag: string, attrs: Record<string,string>, interno: string, hijos: boolean, linea: number}[]} */
export function elementosConTexto(html) {
    const pila = [];
    const hallados = [];
    for (const m of html.matchAll(ETIQUETA)) {
        if (!m[2]) continue; // comentario
        const tag = m[2].toLowerCase();
        const fin = m.index + m[0].length;
        if (m[1]) {
            const ix = pila.findLastIndex(e => e.tag === tag);
            if (ix >= 0) for (const e of pila.splice(ix)) e.interno = html.slice(e.inicio, m.index);
            continue;
        }
        if (pila.length) pila.at(-1).hijos = true;
        const el = {
            tag,
            attrs: atributosDe(m[3]),
            interno: '',
            hijos: false,
            inicio: fin,
            linea: html.slice(0, m.index).split('\n').length,
        };
        if (Object.keys(el.attrs).some(a => a.startsWith('data-t'))) hallados.push(el);
        if (!VACIOS.has(tag) && !m[4]) pila.push(el);
    }
    return hallados;
}

/** Pares [atributo, clave] de un `data-t-attr="a:clave;b:clave2"`. @param {string} texto */
export const paresAttr = texto =>
    texto
        .split(';')
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)]);

/** Claves que usa el HTML. @returns {string[]} */
export function clavesDelHtml(elementos) {
    return elementos.flatMap(({ attrs }) => [
        ...(attrs['data-t'] ? [attrs['data-t']] : []),
        ...(attrs['data-t-html'] ? [attrs['data-t-html']] : []),
        ...paresAttr(attrs['data-t-attr'] ?? '').map(([, clave]) => clave),
    ]);
}

/** Lo que el HTML dice en español contra `es` (comparando con espacios colapsados), sin variables y con
 *  `data-t` sólo en elementos sin hijos elemento. Las claves no definidas las informa `cruzarClaves`.
 *  @param {ReturnType<typeof elementosConTexto>} elementos @param {Map<string, {valor: any}>} es @returns {string[]} */
export function htmlContraEs(elementos, es) {
    const errores = [];
    const comparar = (donde, clave, real) => {
        const def = es.get(clave);
        if (!def) return;
        if (typeof def.valor !== 'string')
            return errores.push(`${donde}: ${clave} es un plural; el HTML no lleva plurales`);
        if (variablesDe(def.valor).length) errores.push(`${donde}: ${clave} lleva variables {…}; el HTML no puede`);
        if (colapsar(real) !== colapsar(def.valor))
            errores.push(`${donde}: ${clave} dice «${colapsar(real)}» y es.json «${colapsar(def.valor)}»`);
    };
    for (const { tag, attrs, interno, hijos, linea } of elementos) {
        const donde = `index.html:${linea} <${tag}>`;
        if (attrs['data-t'] !== undefined) {
            if (hijos)
                errores.push(
                    `${donde}: data-t=${attrs['data-t']} en un elemento con hijos; envolvé el texto en un <span>`,
                );
            comparar(donde, attrs['data-t'], decodificar(interno.replace(/<[^>]*>/g, '')));
        }
        if (attrs['data-t-html'] !== undefined) comparar(donde, attrs['data-t-html'], interno);
        for (const [atributo] of paresAttr(attrs['data-t-attr'] ?? '')) {
            if (!ATRIBUTOS_TRADUCIBLES.includes(atributo))
                errores.push(`${donde}: data-t-attr no traduce el atributo ${atributo}`);
        }
        for (const [atributo, clave] of paresAttr(attrs['data-t-attr'] ?? ''))
            comparar(`${donde} [${atributo}]`, clave, decodificar(attrs[atributo] ?? ''));
    }
    return errores;
}
