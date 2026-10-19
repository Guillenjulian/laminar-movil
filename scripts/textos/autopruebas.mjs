// La suite de textos se prueba a sí misma (ADR 0008, I2): diccionarios sintéticos en memoria. Cada detector tiene un
// caso que lo hace fallar (se espera su mensaje) y uno que pasa (lista vacía). Sin disco ni src/. Sin `export default`.
import { autopruebasNuevas } from './autopruebas-cableado.mjs';
import {
    aplanar,
    clavesDelHtml,
    compararEstructura,
    cruzarClaves,
    elementosConTexto,
    espanolSuelto,
    faltantes,
    formaDeClaves,
    htmlContraEs,
    inglesCopiado,
    marcadoNoPermitido,
    pluralDistinto,
    tiposDistintos,
    usosEnJs,
    variablesDe,
    variablesDistintas,
} from './detectores.mjs';

const ES = {
    paso2: { 'paso2.entran.error': 'No entra: {n} piezas', 'paso2.cant': { one: '{n} pieza', other: '{n} piezas' } },
    comun: { 'comun.ok': 'Listo' },
};
const EN = {
    paso2: { 'paso2.entran.error': 'Does not fit: {n} parts', 'paso2.cant': { one: '{n} part', other: '{n} parts' } },
    comun: { 'comun.ok': 'Done' },
};

/** Copia de `base` con `area[clave] = valor` (o sin la clave si `valor` es undefined; sin el área si no hay clave). */
function mutar(base, area, clave, valor) {
    const copia = JSON.parse(JSON.stringify(base));
    if (clave === undefined) delete copia[area];
    else if (valor === undefined) delete copia[area][clave];
    else copia[area][clave] = valor;
    return copia;
}

/** Un caso: [nombre, mensajes que salen de la mutación, fragmento esperado, mensajes del caso correcto]. */
const ESTRUCTURA = [
    [
        'clave faltante en en',
        () => faltantes(ES, mutar(EN, 'paso2', 'paso2.entran.error')),
        'falta en en: paso2.entran.error',
        () => faltantes(ES, EN),
    ],
    [
        'clave sobrante en en (falta en es)',
        () => faltantes(mutar(ES, 'comun', 'comun.ok'), EN),
        'falta en es: comun.ok',
        () => faltantes(ES, EN),
    ],
    [
        'archivo (área) faltante',
        () => faltantes(ES, mutar(EN, 'comun')),
        'falta en en: archivo comun.json',
        () => faltantes(ES, EN),
    ],
    [
        'variables distintas ({n} contra {y})',
        () => variablesDistintas(ES, mutar(EN, 'paso2', 'paso2.entran.error', 'Fit: {y}')),
        'variables distintas en paso2.entran.error',
        () => variablesDistintas(ES, EN),
    ],
    [
        'variable de más en una forma del plural',
        () => variablesDistintas(ES, mutar(EN, 'paso2', 'paso2.cant', { one: 'a', other: '{n} {z}' })),
        'variables distintas en paso2.cant',
        () => variablesDistintas(ES, EN),
    ],
    [
        'plural con formas distintas',
        () => pluralDistinto(ES, mutar(EN, 'paso2', 'paso2.cant', { other: '{n} parts' })),
        'formas de plural distintas en paso2.cant',
        () => pluralDistinto(ES, EN),
    ],
    [
        'texto contra plural',
        () => tiposDistintos(ES, mutar(EN, 'paso2', 'paso2.cant', '{n} parts')),
        'tipo distinto en paso2.cant',
        () => tiposDistintos(ES, EN),
    ],
    [
        'compararEstructura: clave faltante',
        () => compararEstructura(ES, mutar(EN, 'comun', 'comun.ok', undefined)),
        'falta en en: comun.ok',
        () => compararEstructura(ES, EN),
    ],
    [
        'compararEstructura: texto contra plural',
        () => compararEstructura(ES, mutar(EN, 'paso2', 'paso2.cant', '{n} parts')),
        'tipo distinto en paso2.cant',
        () => compararEstructura(ES, EN),
    ],
    [
        'compararEstructura: variables distintas',
        () => compararEstructura(ES, mutar(EN, 'paso2', 'paso2.entran.error', 'Fit: {y}')),
        'variables distintas en paso2.entran.error',
        () => compararEstructura(ES, EN),
    ],
    [
        'compararEstructura: formas de plural distintas',
        () => compararEstructura(ES, mutar(EN, 'paso2', 'paso2.cant', { other: '{n} parts' })),
        'formas de plural distintas en paso2.cant',
        () => compararEstructura(ES, EN),
    ],
    [
        'pluralDistinto compara los nombres de las formas, no la cantidad',
        () => pluralDistinto({ a: { 'a.x': { one: 'u', other: 'o' } } }, { a: { 'a.x': { few: 'u', other: 'o' } } }),
        'formas de plural distintas en a.x',
        () => pluralDistinto({ a: { 'a.x': { one: 'u', other: 'o' } } }, { a: { 'a.x': { one: 'v', other: 'p' } } }),
    ],
];

const CLAVES = [
    ['clave mal formada', () => formaDeClaves({ a: { 'A.x': 'x' } }), 'clave mal formada', () => formaDeClaves(ES)],
    [
        'clave sin punto',
        () => formaDeClaves({ a: { a: 'x' } }),
        'clave mal formada',
        () => formaDeClaves({ a: { 'a.b.c': 'x' } }),
    ],
    [
        'prefijo distinto del archivo',
        () => formaDeClaves({ a: { 'b.x': 'x' } }),
        'el prefijo de b.x no es a',
        () => formaDeClaves(ES),
    ],
    [
        'clave repetida entre archivos',
        () => formaDeClaves({ a: { 'a.x': '1' }, b: { 'a.x': '2' } }),
        'clave repetida',
        () => formaDeClaves(ES),
    ],
    [
        'marcado no permitido (<i>)',
        () => marcadoNoPermitido({ a: { 'a.x': 'Uno <i>dos</i>' } }),
        'marcado no permitido en a.x',
        () => marcadoNoPermitido({ a: { 'a.x': 'Uno <b>dos</b><br><small>tres</small>' } }),
    ],
    [
        'marcado no permitido (& en un plural)',
        () => marcadoNoPermitido({ a: { 'a.y': { one: 'a & b', other: 'x' } } }),
        'marcado no permitido en a.y',
        () => marcadoNoPermitido(ES),
    ],
];

/** Corre los casos de una tabla. */
function correr({ revisar, igual }, tabla) {
    for (const [nombre, falla, esperado, pasa] of tabla) {
        const salida = falla();
        revisar(
            `${nombre}: detecta el error`,
            salida.some(m => m.includes(esperado)),
            `(salió: ${JSON.stringify(salida)})`,
        );
        revisar(`${nombre}: lo correcto pasa`, igual(pasa(), []), `(salió: ${JSON.stringify(pasa())})`);
    }
}

/** Utilidades y cruce de claves usadas/definidas. */
function cruce({ revisar, igual }) {
    revisar('variablesDe: sin repetir y en orden', igual(variablesDe('{b} y {a} y {b}'), ['b', 'a']));
    const copiado = mutar(EN, 'paso2', 'paso2.entran.error', ES.paso2['paso2.entran.error']);
    revisar('inglés copiado: avisa (más de una palabra)', inglesCopiado(ES, copiado).length === 1);
    revisar(
        'inglés copiado: traducido o de una palabra no avisa',
        inglesCopiado(ES, mutar(EN, 'comun', 'comun.ok', 'Listo')).length === 0,
    );
    const r = cruzarClaves(new Set(['a.x', 'a.y', 'r.z']), new Set(['a.x', 'a.w']), ['r.']);
    revisar('cruce: usada sin definir', igual(r.sinDefinir, ['a.w']));
    revisar('cruce: definida sin uso, salvo reservadas', igual(r.sinUso, ['a.y']));
    revisar(
        'cruce: todo usado y definido pasa',
        igual(cruzarClaves(new Set(['a.x']), new Set(['a.x'])), { sinDefinir: [], sinUso: [] }),
    );
}

const JS = `import { t, marcar } from './idioma.js';
// t('comentario.no') y marcar('comentario.tampoco')
/* existe('bloque.no') */
const a = t('a.uno', { n: 1 }) + t("a.dos") + existe('a.tres') + t(\`a.cuatro\`);
const E = { x: marcar('a.cinco') };
const re = /['"]t\\('/; const b = x.t('ajeno.no'); function t(clave) {}`;

/** El escáner de usos de t()/existe()/marcar() y el lector de comentarios. */
function escaner({ revisar, igual }) {
    const { claves, dinamicas } = usosEnJs(JS);
    revisar(
        'usos: junta las claves de t, existe y marcar',
        igual(claves, ['a.uno', 'a.dos', 'a.tres', 'a.cuatro', 'a.cinco']),
        `(salió ${claves})`,
    );
    revisar(
        'usos: ignora comentarios, métodos ajenos, regex y la definición',
        igual(dinamicas, []),
        `(salió ${dinamicas})`,
    );
    const din = usosEnJs("t(clave); t(`a.${x}`); marcar(id); existe(id); t('a.b' + x)");
    revisar(
        "usos: t(variable), t(`a.${x}`), marcar(id) y t('a' + x) son dinámicas",
        din.dinamicas.length === 4,
        `(salió ${din.dinamicas})`,
    );
    revisar('usos: existe(variable) se tolera', !din.dinamicas.some(d => d.startsWith('existe')));
    revisar('usos: una plantilla sin ${} es literal', usosEnJs('t(`a.b`)').claves[0] === 'a.b');
}

const PAGINA = `<title data-t="app.titulo">Laminar</title>
<meta name="d" content="Hola" data-t-attr="content:app.desc" />
<h2 data-t="paso1.titulo">Subí   tu
 modelo</h2>
<p data-t-html="paso1.ayuda">Elegí <b>STL</b> o <small>OBJ</small>.</p>
<label><span data-t="paso1.nombre">Nombre</span> <input placeholder="Buscar" data-t-attr="placeholder:paso1.buscar; aria-label:paso1.lupa" aria-label="Lupa" /></label>
<!-- <p data-t="comentado.no">x</p> -->`;
const ES_PAGINA = aplanar({
    app: { 'app.titulo': 'Laminar', 'app.desc': 'Hola' },
    paso1: {
        'paso1.titulo': 'Subí tu modelo',
        'paso1.ayuda': 'Elegí <b>STL</b> o <small>OBJ</small>.',
        'paso1.nombre': 'Nombre',
        'paso1.buscar': 'Buscar',
        'paso1.lupa': 'Lupa',
    },
});
const un = (html, def) => htmlContraEs(elementosConTexto(html), aplanar({ a: def }));

/** El lector de index.html. */
function lectorHtml({ revisar, igual }) {
    const el = elementosConTexto(PAGINA);
    revisar('html: lee los seis elementos con data-t (sin el comentado)', el.length === 6, `(leyó ${el.length})`);
    const claves = [
        'app.desc',
        'app.titulo',
        'paso1.ayuda',
        'paso1.buscar',
        'paso1.lupa',
        'paso1.nombre',
        'paso1.titulo',
    ];
    revisar('html: las claves salen de data-t, data-t-html y data-t-attr', igual(clavesDelHtml(el).sort(), claves));
}

const HTML = [
    [
        'html contra es.json',
        () => htmlContraEs(elementosConTexto(PAGINA), aplanar({ paso1: { 'paso1.titulo': 'Otro texto' } })),
        'paso1.titulo dice',
        () => htmlContraEs(elementosConTexto(PAGINA), ES_PAGINA),
    ],
    [
        'data-t en elemento con hijos',
        () => un('<div data-t="a.x">Hola <b>mundo</b></div>', { 'a.x': 'Hola mundo' }),
        'elemento con hijos',
        () => un('<div data-t="a.x">Hola</div>', { 'a.x': 'Hola' }),
    ],
    [
        'variables en una clave del HTML',
        () => un('<i data-t="a.x">Hola {n}</i>', { 'a.x': 'Hola {n}' }),
        'lleva variables',
        () => un('<i data-t="a.x">Hola</i>', { 'a.x': 'Hola' }),
    ],
    [
        'plural en una clave del HTML',
        () => un('<i data-t="a.y">u</i>', { 'a.y': { one: 'u', other: 'o' } }),
        'es un plural',
        () => un('<i data-t="a.y">u</i>', { 'a.y': 'u' }),
    ],
    [
        'atributo distinto de es.json',
        () => un('<input placeholder="X" data-t-attr="placeholder:a.z" />', { 'a.z': 'Y' }),
        '[placeholder]',
        () => un('<input placeholder="Y" data-t-attr="placeholder:a.z" />', { 'a.z': 'Y' }),
    ],
    [
        'data-t-attr con un atributo no traducible',
        () => un('<a href="Y" data-t-attr="href:a.z" />', { 'a.z': 'Y' }),
        'no traduce el atributo href',
        () => un('<a title="Y" data-t-attr="title:a.z" />', { 'a.z': 'Y' }),
    ],
];

const SUCIO = `const a = t('x.y'); // acá un comentario con ñ
const b = 'Subí el archivo';
const c = "para ti";
const d = \`Quedan \${n} piezas con el borde\`;
const e = '¿Listo?'; // t-ignorar
const f = /['"]ñ/; const g = 'no'; const h = 'Done'; const i = 'AbortError';`;

/** El detector de español suelto en módulos migrados. */
function suelto({ revisar, igual }) {
    const salida = espanolSuelto(SUCIO, 'x.js');
    const lineas = salida.map(s => parseInt(s.split(':')[1]));
    revisar(
        'español suelto: acento, comillas dobles, plantilla y mayúscula (líneas 2, 3, 4 y 6)',
        igual(lineas, [2, 3, 4, 6]),
        `(salió ${JSON.stringify(salida)})`,
    );
    const limpio =
        "// Cargá el modelo\nconst a = t('x.y', { n });\nconst b = 'es-AR'; const c = 'solo-lectores'; const d = 'no';\n/* ñ */";
    revisar(
        'español suelto: comentarios, claves, códigos y una sola palabra pasan',
        igual(espanolSuelto(limpio, 'x.js'), []),
    );
}

/** @param {{revisar: Function, igual: Function}} ctx @returns {void} */
export function autopruebas(ctx) {
    console.log('-- autopruebas con diccionarios sintéticos');
    correr(ctx, ESTRUCTURA);
    correr(ctx, CLAVES);
    cruce(ctx);
    escaner(ctx);
    lectorHtml(ctx);
    correr(ctx, HTML);
    suelto(ctx);
    autopruebasNuevas(ctx);
}
