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
const MARCA_ES = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/;
const PALABRAS_VACIAS = /(?<![\p{L}\p{N}_])(?:el|la|de|que|para|con|no)(?![\p{L}\p{N}_])/iu;

/** @param {string} texto @returns {string[]} variables `{x}` sin repetir, en orden de aparición */
export function variablesDe(texto) {
    return [...new Set([...texto.matchAll(/\{([a-zA-Z0-9]+)\}/g)].map(m => m[1]))];
}

/** @param {string} s @returns {string} espacios colapsados */
export const colapsar = s => s.replace(/\s+/g, ' ').trim();

/** Todas las formas de texto de un valor (un texto, o las formas del plural). @param {string|object} valor */
export const formasDe = valor => (typeof valor === 'string' ? [valor] : Object.values(valor ?? {}));

/** @param {Record<string, Record<string, any>>} dic @returns {Map<string, {area: string, valor: any}>} */
export function aplanar(dic) {
    const mapa = new Map();
    for (const [area, claves] of Object.entries(dic)) {
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
    const tipo = v => (typeof v === 'string' ? 'texto' : 'plural');
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

/** Mismas formas de plural (`one`, `other`) en las claves que son plural en los dos. @returns {string[]} */
export function pluralDistinto(es, en) {
    const formas = v => Object.keys(v).sort();
    return pares(es, en)
        .filter(([, a, b]) => typeof a === 'object' && typeof b === 'object' && String(formas(a)) !== String(formas(b)))
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
// Lectura de JavaScript: comentarios, literales y usos de t()/existe()/marcar()
// ---------------------------------------------------------------------------------------------------------------------

/** Fin (exclusivo) de una cadena '…' o "…" que empieza en `i`; se corta en el salto de línea. */
function finCadena(js, i) {
    let j = i + 1;
    while (j < js.length && js[j] !== js[i] && js[j] !== '\n') j += js[j] === '\\' ? 2 : 1;
    return js[j] === js[i] ? j + 1 : j;
}

/** Fin (exclusivo) del bloque `{…}` que empieza en `i`, saltando cadenas. */
function finLlave(js, i) {
    let profundidad = 0;
    for (let j = i; j < js.length; j++) {
        if (js[j] === '"' || js[j] === "'") j = finCadena(js, j) - 1;
        else if (js[j] === '`') j = finPlantilla(js, j) - 1;
        else if (js[j] === '{') profundidad++;
        else if (js[j] === '}' && --profundidad === 0) return j + 1;
    }
    return js.length;
}

/** Fin (exclusivo) de una plantilla `…` que empieza en `i`, con sus `${…}`. */
function finPlantilla(js, i) {
    let j = i + 1;
    while (j < js.length && js[j] !== '`') {
        if (js[j] === '$' && js[j + 1] === '{') j = finLlave(js, j + 1);
        else j += js[j] === '\\' ? 2 : 1;
    }
    return j + 1;
}

/** Fin (exclusivo) de un literal de regex que empieza en `i`. */
function finRegex(js, i) {
    let j = i + 1;
    for (let clase = false; j < js.length && js[j] !== '\n' && (clase || js[j] !== '/'); j++) {
        if (js[j] === '\\') j++;
        else if (js[j] === '[') clase = true;
        else if (js[j] === ']') clase = false;
    }
    return js[j] === '/' ? j + 1 : i + 1;
}

/** Qué empieza en `i`: comentario, cadena, regex u otro (un carácter). @param {string} previo último carácter útil
 *  @returns {{tipo: 'comentario'|'cadena'|'regex'|'otro', fin: number}} */
function tokenEn(js, i, previo) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/')
        return { tipo: 'comentario', fin: js.indexOf('\n', i) < 0 ? js.length : js.indexOf('\n', i) };
    if (c === '/' && js[i + 1] === '*')
        return { tipo: 'comentario', fin: js.indexOf('*/', i + 2) < 0 ? js.length : js.indexOf('*/', i + 2) + 2 };
    if (c === '"' || c === "'") return { tipo: 'cadena', fin: finCadena(js, i) };
    if (c === '`') return { tipo: 'cadena', fin: finPlantilla(js, i) };
    if (c === '/' && (previo === '' || '(,=:[!&|?{};'.includes(previo))) return { tipo: 'regex', fin: finRegex(js, i) };
    return { tipo: 'otro', fin: i + 1 };
}

/** Separa el código de sus comentarios y junta los literales de texto.
 *  @param {string} js @returns {{codigo: string, literales: {texto: string, linea: number}[]}}
 *  `codigo` es el mismo texto con los comentarios en blanco (mismas líneas y columnas). */
export function analizarJs(js) {
    const literales = [];
    let codigo = '';
    let previo = '';
    let linea = 1;
    for (let i = 0; i < js.length;) {
        const { tipo, fin } = tokenEn(js, i, previo);
        const trozo = js.slice(i, fin);
        if (tipo === 'comentario') codigo += trozo.replace(/[^\n]/g, ' ');
        else codigo += trozo;
        if (tipo === 'cadena')
            literales.push({ texto: trozo.slice(1, trozo.at(-1) === trozo[0] ? -1 : undefined), linea });
        if (tipo !== 'comentario' && !/^\s$/.test(trozo)) previo = tipo === 'otro' ? trozo : 'x';
        linea += trozo.split('\n').length - 1;
        i = fin;
    }
    return { codigo, literales };
}

/** Claves literales y llamadas dinámicas de t()/existe()/marcar() en un JavaScript (sin mirar los comentarios).
 *  Una llamada dinámica a `existe` se tolera (la usan las claves de perfiles por id); a `t` y `marcar`, no.
 *  @returns {{claves: string[], dinamicas: string[]}} */
export function usosEnJs(js) {
    const { codigo } = analizarJs(js);
    const claves = [];
    const dinamicas = [];
    const llamada = /(?<![\w$.])(?<!function\s+)(t|existe|marcar)\(\s*(?=[^\s)])/g;
    const literal = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1(?=\s*[,)])/y;
    for (const m of codigo.matchAll(llamada)) {
        literal.lastIndex = m.index + m[0].length;
        const lit = literal.exec(codigo);
        if (lit && !(lit[1] === '`' && lit[2].includes('${'))) claves.push(lit[2]);
        else if (m[1] !== 'existe') {
            const resto = codigo
                .slice(m.index + m[0].length)
                .split('\n')[0]
                .slice(0, 40)
                .trim();
            dinamicas.push(`${m[1]}(${resto}`);
        }
    }
    return { claves, dinamicas };
}

/** Literales con español suelto: acentos, ñ, ¿ ¡ o (en textos de dos palabras o más) palabras vacías del español.
 *  Una línea con `// t-ignorar` no cuenta. @returns {string[]} */
export function espanolSuelto(js, nombre = '') {
    const lineas = js.split('\n');
    const errores = [];
    for (const { texto, linea } of analizarJs(js).literales) {
        if (lineas[linea - 1]?.includes('// t-ignorar')) continue;
        const limpio = texto.replace(/\$\{[^}]*\}/g, '');
        const espanol =
            MARCA_ES.test(limpio) || (limpio.trim().split(/\s+/).length > 1 && PALABRAS_VACIAS.test(limpio));
        if (espanol) errores.push(`${nombre}:${linea} español suelto: ${texto.slice(0, 60)}`);
    }
    return errores;
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
        for (const [atributo, clave] of paresAttr(attrs['data-t-attr'] ?? ''))
            comparar(`${donde} [${atributo}]`, clave, decodificar(attrs[atributo] ?? ''));
    }
    return errores;
}
