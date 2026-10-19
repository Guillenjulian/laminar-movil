// Lector de JavaScript para los guardianes de textos (ADR 0008, I2): comentarios, literales, usos de
// t()/existe()/marcar() y español suelto. Puro; lo reexporta detectores.mjs. Sin `export default`.

const MARCA_ES = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/;
const MAYUSCULA_INICIAL = /^[A-ZÁÉÍÓÚÑ]\p{Ll}{2,}/u;
// Palabras vacías del español; el guion no es frontera de palabra ("sin-modelo" no cuenta como "sin").
const PALABRAS_VACIAS =
    /(?<![\p{L}\p{N}_-])(?:el|la|los|las|de|del|al|en|un|una|mi|tu|se|por|y|sin|más|que|para|con|no)(?![\p{L}\p{N}_-])/iu;

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

/** Expresiones `${…}` de una plantilla. @param {string} trozo la plantilla con sus comillas
 *  @returns {[number, number][]} [inicio, fin) del código de cada una, dentro de `trozo` */
function expresiones(trozo) {
    const lista = [];
    for (let i = 1; i < trozo.length;) {
        if (trozo[i] === '\\') i += 2;
        else if (trozo[i] === '$' && trozo[i + 1] === '{') {
            const fin = finLlave(trozo, i + 1);
            lista.push([i + 2, fin - 1]);
            i = fin;
        } else i++;
    }
    return lista;
}

/** Literales de un token de cadena: el texto y, si es plantilla, el texto fijo más los literales de sus `${…}`.
 *  @returns {{texto: string, linea: number}[]} */
function literalesDe(trozo, linea) {
    const cierra = trozo.at(-1) === trozo[0] && trozo.length > 1;
    if (trozo[0] !== '`') return [{ texto: trozo.slice(1, cierra ? -1 : undefined), linea }];
    let fijo = '';
    let pos = 1;
    const dentro = [];
    for (const [a, b] of expresiones(trozo)) {
        fijo += trozo.slice(pos, a - 2);
        pos = b + 1;
        const base = linea + trozo.slice(0, a).split('\n').length - 1;
        for (const l of analizarJs(trozo.slice(a, b)).literales)
            dentro.push({ texto: l.texto, linea: base + l.linea - 1 });
    }
    fijo += trozo.slice(pos, cierra ? -1 : undefined);
    return [{ texto: fijo, linea }, ...dentro];
}

/** Separa el código de sus comentarios y junta los literales de texto (también los de dentro de `${…}`).
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
        codigo += tipo === 'comentario' ? trozo.replace(/[^\n]/g, ' ') : trozo;
        if (tipo === 'cadena') literales.push(...literalesDe(trozo, linea));
        if (tipo !== 'comentario' && !/^\s$/.test(trozo)) previo = tipo === 'otro' ? trozo : 'x';
        linea += trozo.split('\n').length - 1;
        i = fin;
    }
    return { codigo, literales };
}

/** ¿Lleva `// t-dinamica: <motivo>` la línea de la llamada o la anterior? Mira el texto original (los comentarios ya
 *  están en blanco en `codigo`, que conserva las líneas). */
function marcadaDinamica(js, codigo, indice) {
    const linea = codigo.slice(0, indice).split('\n').length;
    const lineas = js.split('\n');
    return [lineas[linea - 1], lineas[linea - 2]].some(l => /\/\/ t-dinamica:\s*\S/.test(l ?? ''));
}

/** Importaciones con alias de t, existe o marcar (`import { t as x }`): el escáner no las reconocería.
 *  @returns {string[]} */
export function aliasDeT(js) {
    const { codigo } = analizarJs(js);
    return [...codigo.matchAll(/import\s*\{([^}]*)\}\s*from/g)].flatMap(m =>
        [...m[1].matchAll(/\b(t|existe|marcar)\s+as\s+(\w+)/g)].map(a => `import { ${a[1]} as ${a[2]} }`),
    );
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
        else if (m[1] !== 'existe' && !marcadaDinamica(js, codigo, m.index)) {
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

/** ¿Es español un literal de un módulo migrado? Devuelve el motivo o null.
 *  - lleva áéíóúñ¿¡; - empieza con mayúscula y 2 o más minúsculas ("Cancelar"), salvo un nombre sin espacios con otra
 *  mayúscula adentro ("AbortError"); - tiene dos palabras o más y alguna palabra vacía del español. */
export function motivoEspanol(texto) {
    const t = texto.trim();
    if (MARCA_ES.test(t)) return 'lleva acentos, ñ, ¿ o ¡';
    if (MAYUSCULA_INICIAL.test(t) && !(/^\S+$/.test(t) && /\p{Lu}/u.test(t.slice(1)))) return 'empieza con mayúscula';
    if (t.split(/\s+/).length > 1 && PALABRAS_VACIAS.test(t)) return 'lleva palabras del español';
    return null;
}

/** Literales con español suelto (ver `motivoEspanol`), también dentro de `${…}`. Una línea con `// t-ignorar` no
 *  cuenta. @returns {string[]} */
export function espanolSuelto(js, nombre = '') {
    const lineas = js.split('\n');
    const errores = [];
    for (const { texto, linea } of analizarJs(js).literales) {
        if (lineas[linea - 1]?.includes('// t-ignorar')) continue;
        const motivo = motivoEspanol(texto);
        if (motivo) errores.push(`${nombre}:${linea} español suelto (${motivo}): ${texto.slice(0, 60)}`);
    }
    return errores;
}
