// Autopruebas (ADR 0008, I2) de valorValido, reservas vencidas, español suelto ampliado y, sobre todo, del CABLEADO:
// `chequeos()` con datos sintéticos, una mutación por chequeo (sacar o romper una pieza tiene que dar ✘).
// Sin `export default`; las llama autopruebas.mjs.
import { chequeos } from './chequeos.mjs';
import { aliasDeT, espanolSuelto, reservasVencidas, usosEnJs, valorValido } from './detectores.mjs';

const VALIDOS = ['Listo', { other: 'x' }, { one: '{n} a', other: '{n} b' }, 'Hola {nombre}'];
const INVALIDOS = [
    [null, 'no es un texto'],
    [5, 'no es un texto'],
    [['a'], 'no es un texto'],
    ['', 'no vacío'],
    [{ one: 'a' }, 'falta la forma other'],
    [{ other: 'a', many: 'b' }, 'forma de plural no permitida'],
    [{ other: { x: 1 } }, 'la forma other'],
    [{ other: 'a', one: '' }, 'la forma one'],
    ['Abre { y cierra', 'llave'],
    ['Cierra } sola', 'llave'],
];

/** valorValido: lo válido pasa y cada tipo de valor roto da su motivo (sin TypeError). */
function valores({ revisar }) {
    revisar(
        'valorValido: texto, plural y variables pasan',
        VALIDOS.every(v => valorValido(v) === null),
    );
    for (const [valor, motivo] of INVALIDOS) {
        const salida = valorValido(valor);
        revisar(
            `valorValido: ${JSON.stringify(valor)} da ✘ (${motivo})`,
            !!salida && salida.includes(motivo),
            `(salió ${salida})`,
        );
    }
}

/** reservasVencidas: un prefijo sin claves sin uso vence. */
function reservas({ revisar, igual }) {
    const definidas = new Set(['app.a', 'app.b', 'x.y']);
    revisar(
        'reservas: con una clave sin uso, vigente',
        igual(reservasVencidas(definidas, new Set(['app.a']), ['app.']), []),
    );
    const venc = reservasVencidas(definidas, new Set(['app.a', 'app.b']), ['app.']);
    revisar('reservas: todas usadas, vencida', venc.length === 1 && venc[0].includes('app.'), `(salió ${venc})`);
    revisar(
        'reservas: sin ninguna clave definida, vencida',
        reservasVencidas(definidas, new Set(), ['zz.']).length === 1,
    );
}

const SUELTOS = ['Cancelar', 'Laminando…', 'Relleno', 'Volver', 'Probando…', 'Quedan los demás', 'sin modelo cargado'];

/** Español suelto en un módulo sintético migrado. */
function suelto({ revisar, igual }) {
    for (const palabra of SUELTOS) {
        revisar(`español suelto: '${palabra}' da ✘`, espanolSuelto(`const a = '${palabra}';`, 'm.js').length === 1);
    }
    revisar(
        'español suelto: dentro de ${…} de una plantilla da ✘',
        espanolSuelto("const a = `${n} ${ok ? 'Listo' : 'x'}`;", 'm.js').length === 1,
    );
    revisar(
        'español suelto: la línea de un literal de una expresión',
        espanolSuelto("const a = 1;\nconst b = `${\n  'Cancelar'}`;", 'm.js')[0]?.includes('m.js:3'),
    );
    revisar(
        'español suelto: palabras vacías ampliadas (mi, tu, se, por, del, al, y, más)',
        ['mi cosa', 'tu cosa', 'se abre', 'por ahí', 'cosa del dia', 'ir al sur', 'a y b', 'x más y'].every(
            t => espanolSuelto(`const a = '${t}';`, 'm.js').length === 1,
        ),
    );
    revisar(
        'español suelto: el guion no es frontera ("sin-modelo", "es-AR", "solo-lectores")',
        igual(espanolSuelto("const a = 'sin-modelo'; const b = 'x-no-y z'; const c = 'es-AR';", 'm.js'), []),
    );
    revisar(
        'español suelto: AbortError, claves, códigos y // t-ignorar pasan',
        igual(
            espanolSuelto(
                "const a = 'AbortError'; const b = t('x.y'); const c = 'Cancelar'; // t-ignorar\nconst d = 'normal';",
                'm.js',
            ),
            [],
        ),
    );
}

const ES = {
    app: { 'app.titulo': 'Laminar', 'app.cant': { one: '{n} pieza', other: '{n} piezas' } },
    res: { 'res.x': 'Reservada' },
};
const EN = {
    app: { 'app.titulo': 'Slice', 'app.cant': { one: '{n} part', other: '{n} parts' } },
    res: { 'res.x': 'Reserved' },
};
const BASE = {
    es: ES,
    en: EN,
    js: [{ ruta: 'src/a.js', texto: "t('app.cant', { n });" }],
    html: '<h1>Hola</h1>',
    migrados: [{ ruta: 'src/ui/m.js', texto: "const a = t('app.cant');" }],
    reservadas: ['res.'],
};
const con = (cambios, base = BASE) => ({ ...base, ...cambios });
const clon = o => JSON.parse(JSON.stringify(o));
const sin = (dic, area, clave) => {
    const c = clon(dic);
    delete c[area][clave];
    return c;
};
const poner = (dic, area, clave, valor) => ({ ...dic, [area]: { ...dic[area], [clave]: valor } });
const HTML_OK = '<h1 data-t="app.titulo">Laminar</h1>';

/** [id del chequeo que tiene que dar ✘, nombre de la mutación, entrada mutada] */
const MUTACIONES = [
    [
        'lectura',
        'JSON inválido con el nombre del archivo',
        con({ lectura: ['JSON inválido en src/textos/es/app.json: x'] }),
    ],
    ['valores', 'es con un valor null', con({ es: poner(ES, 'app', 'app.titulo', null) })],
    ['valores', 'en con un plural anidado', con({ en: poner(EN, 'app', 'app.titulo', { other: { x: 1 } }) })],
    ['estructura', 'clave de es que falta en en', con({ en: sin(EN, 'app', 'app.titulo') })],
    ['forma', 'es con una clave mal formada', con({ es: poner(ES, 'app', 'App.x', 'x'), js: [] })],
    ['forma', 'en con el prefijo de otro archivo', con({ en: poner(EN, 'app', 'res.otra', 'x') })],
    ['marcado', 'es con <i>', con({ es: poner(ES, 'app', 'app.titulo', 'Una <i>cosa</i>') })],
    ['marcado', 'en con &', con({ en: poner(EN, 'app', 'app.titulo', 'a & b') })],
    ['dinamicas', 't(variable)', con({ js: [...BASE.js, { ruta: 'src/b.js', texto: 't(clave);' }] })],
    [
        'dinamicas',
        't(variable) con un // t-dinamica: sin motivo',
        con({ js: [...BASE.js, { ruta: 'src/b.js', texto: 't(clave); // t-dinamica:' }] }),
    ],
    [
        'alias',
        'import { t as x } (alias de t)',
        con({ js: [...BASE.js, { ruta: 'src/b.js', texto: "import { existe, t as x } from './idioma.js';" }] }),
    ],
    [
        'sinDefinir',
        'clave usada que no existe',
        con({ js: [...BASE.js, { ruta: 'src/b.js', texto: "t('app.nada');" }] }),
    ],
    [
        'sinUso',
        'clave definida que nadie usa',
        con({ js: [BASE.js[0]], es: poner(ES, 'app', 'app.sobra', 'x'), en: poner(EN, 'app', 'app.sobra', 'x') }),
    ],
    [
        'reserva',
        'reserva cuyas claves ya se usan',
        con({ js: [...BASE.js, { ruta: 'src/b.js', texto: "t('res.x');" }] }),
    ],
    ['html', 'el HTML dice otra cosa que es', con({ html: '<h1 data-t="app.titulo">Otro</h1>' })],
    [
        'html',
        'data-t-attr con un atributo no traducible',
        con({ html: '<a href="x" data-t-attr="href:app.titulo"></a>' }),
    ],
    [
        'migrados',
        'módulo migrado con español suelto',
        con({ migrados: [{ ruta: 'src/ui/m.js', texto: "alert('Cancelar');" }] }),
    ],
    ['migrados', 'módulo migrado que no existe', con({ migrados: [{ ruta: 'src/ui/nada.js', texto: null }] })],
];

const mensajes = (entrada, id) => chequeos(entrada).find(([i]) => i === id)[2];

/** El cableado: la base pasa en todos los chequeos y cada mutación da ✘ en el suyo (y la base no). */
function cableado({ revisar }) {
    const base = con({ html: HTML_OK });
    const fallan = chequeos(base).filter(([, , m]) => m.length);
    revisar(
        'cableado: la entrada sintética sana pasa todos los chequeos',
        fallan.length === 0,
        `(fallan ${fallan.map(f => f[0])}: ${fallan.map(f => f[2])})`,
    );
    for (const [id, nombre, entrada] of MUTACIONES) {
        const mutada = entrada.html === BASE.html ? { ...entrada, html: HTML_OK } : entrada;
        revisar(`cableado: ${nombre} da ✘ en «${id}»`, mensajes(mutada, id).length > 0, '(no lo detectó)');
    }
    const sinHtml = con({ html: '' });
    revisar(
        'cableado: sin index.html, las claves del HTML quedan sin definir/uso (se nota)',
        chequeos(sinHtml).some(([, , m]) => m.length > 0),
    );
}

/** Marca `// t-dinamica:` y alias de t/existe/marcar. */
function marcasDinamicas({ revisar }) {
    revisar(
        'usos: // t-dinamica: motivo (misma línea o anterior) no cuenta como dinámica; sin motivo, sí',
        usosEnJs('t(clave); // t-dinamica: viene de data-t').dinamicas.length === 0 &&
            usosEnJs('// t-dinamica: viene de data-t\nt(clave);').dinamicas.length === 0 &&
            usosEnJs('t(clave); // t-dinamica:').dinamicas.length === 1 &&
            usosEnJs('// t-dinamica: x\n\nt(clave);').dinamicas.length === 1,
    );
    revisar(
        'alias: import { t as x } falla; import { t } y otros alias no',
        aliasDeT("import { a, t as x } from './i.js';").length === 1 &&
            aliasDeT("import {\n existe as e,\n marcar } from './i.js';").length === 1 &&
            aliasDeT("import { t, existe } from './i.js'; import { otro as o } from 'x';").length === 0 &&
            aliasDeT("// import { t as x } from 'y';").length === 0,
    );
}

/** @param {{revisar: Function, igual: Function}} ctx @returns {void} */
export function autopruebasNuevas(ctx) {
    marcasDinamicas(ctx);
    valores(ctx);
    reservas(ctx);
    suelto(ctx);
    cableado(ctx);
}
