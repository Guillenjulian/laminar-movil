// Pruebas del núcleo del idioma (ADR 0008, I1): src/textos/traducir.js y src/ui/idioma.js, en Node.
// Cada archivo de scripts/textos/ exporta por defecto `async ({ revisar, igual })`.
import {
    IDIOMAS,
    LOCALES,
    elegirForma,
    elegirIdioma,
    interpolar,
    traducir,
    variablesDe,
} from '../../src/textos/traducir.js';
import {
    alCambiarIdioma,
    cambiarIdioma,
    existe,
    idiomaActual,
    iniciarIdioma,
    localeActual,
    marcar,
    ponerDiccionarios,
    t,
} from '../../src/ui/idioma.js';

const ES = {
    'a.saludo': 'Hola {nombre}, tenés {n} mensajes',
    'a.repetida': '{x} y {x}',
    'a.pieza': { one: '{n} pieza', other: '{n} piezas' },
    'a.soloEs': 'Sólo en español',
    'a.soloEsPlural': { one: '{n} cosa', other: '{n} cosas' },
};
const EN = {
    'a.saludo': 'Hi {nombre}, you have {n} messages',
    'a.repetida': '{x} and {x}',
    'a.pieza': { one: '{n} part', other: '{n} parts' },
};

/** Un indexedDB mínimo: guarda los `put` de ajustes en `datos`. */
function indexedDBFalso(datos, demora = 0) {
    const pedido = valor => {
        const req = { result: valor };
        setTimeout(() => req.onsuccess?.(), demora);
        return req;
    };
    const db = {
        createObjectStore() {},
        transaction() {
            const tx = {
                objectStore: () => ({
                    put: (valor, clave) => datos.set(clave, valor),
                    get: clave => pedido(datos.get(clave)),
                }),
            };
            setTimeout(() => tx.oncomplete?.(), 0);
            return tx;
        },
    };
    return {
        open() {
            const req = { result: db };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
        },
    };
}

function probarInterpolar({ revisar }) {
    revisar('interpolar: dos variables', interpolar('{a} y {b}', { a: 'uno', b: 2 }) === 'uno y 2');
    revisar('interpolar: repetida', interpolar('{x}-{x}', { x: 7 }) === '7-7');
    revisar('interpolar: falta una, queda literal', interpolar('{a} y {b}', { a: 1 }) === '1 y {b}');
    revisar('interpolar: sin valores', interpolar('{a}', undefined) === '{a}');
    revisar('interpolar: 0 es un valor', interpolar('{n}', { n: 0 }) === '0');
    revisar('interpolar: no usa el prototipo', interpolar('{constructor}', {}) === '{constructor}');
    revisar('interpolar: un valor con {b} no se reinterpola', interpolar('{a} {b}', { a: '{b}', b: 'B' }) === '{b} B');
    revisar('interpolar: texto sin variables', interpolar('hola', { a: 1 }) === 'hola');
    revisar('variablesDe: orden y sin repetir', variablesDe('{b} {a} {b}').join() === 'b,a');
    revisar('variablesDe: ninguna', variablesDe('nada').length === 0);
}

function probarPlural({ revisar }) {
    const p = { one: '{n} pieza', other: '{n} piezas' };
    for (const idioma of IDIOMAS) {
        revisar(`elegirForma ${idioma}: 0 → other`, elegirForma(p, 0, idioma) === p.other);
        revisar(`elegirForma ${idioma}: 1 → one`, elegirForma(p, 1, idioma) === p.one);
        revisar(`elegirForma ${idioma}: 2 → other`, elegirForma(p, 2, idioma) === p.other);
        revisar(`elegirForma ${idioma}: sin n → other`, elegirForma(p, undefined, idioma) === p.other);
    }
    revisar('elegirForma: n como texto numérico', elegirForma(p, '1', 'es') === p.one);
    revisar(
        'elegirForma: n no numérico → other',
        elegirForma(p, 'x', 'es') === p.other && elegirForma(p, '', 'es') === p.other,
    );
    revisar('elegirForma: texto se devuelve tal cual', elegirForma('hola', 1, 'es') === 'hola');
    revisar('elegirForma: sin `one` cae en other', elegirForma({ other: 'x' }, 1, 'es') === 'x');
    revisar('traducir: plural 1', traducir(ES, {}, 'a.pieza', { n: 1 }, 'es') === '1 pieza');
    revisar('traducir: plural 0', traducir(ES, {}, 'a.pieza', { n: 0 }, 'es') === '0 piezas');
    revisar('traducir: plural 2 en', traducir(EN, {}, 'a.pieza', { n: 2 }, 'en') === '2 parts');
}

function probarTraducir({ revisar, igual }) {
    revisar(
        'traducir: interpolación múltiple',
        traducir(ES, {}, 'a.saludo', { nombre: 'Ana', n: 3 }, 'es') === 'Hola Ana, tenés 3 mensajes',
    );
    revisar(
        'traducir: variable faltante queda literal',
        traducir(ES, {}, 'a.saludo', { nombre: 'Ana' }, 'es') === 'Hola Ana, tenés {n} mensajes',
    );
    revisar('traducir: variable repetida', traducir(EN, {}, 'a.repetida', { x: 'A' }, 'en') === 'A and A');
    revisar('traducir: cae al respaldo', traducir(EN, ES, 'a.soloEs', undefined, 'en') === 'Sólo en español');
    revisar(
        'traducir: plural del respaldo con reglas del español',
        traducir(EN, ES, 'a.soloEsPlural', { n: 1 }, 'en') === '1 cosa',
    );
    revisar('traducir: clave inexistente devuelve la clave', traducir(EN, ES, 'a.nada', undefined, 'en') === 'a.nada');
    revisar(
        'traducir: clave del prototipo no cuenta',
        traducir({}, {}, 'constructor', undefined, 'es') === 'constructor',
    );
    revisar('LOCALES', igual(LOCALES, { es: 'es-AR', en: 'en-US' }));
}

function probarElegirIdioma({ revisar }) {
    const casos = [
        ['en', ['es-AR'], 'en', 'guardado en gana'],
        ['es', ['en-US'], 'es', 'guardado es gana'],
        [null, ['fr', 'en-GB'], 'en', 'primer idioma soportado'],
        [null, ['pt-BR'], 'es', 'ninguno soportado → es'],
        [null, [], 'es', 'vacío → es'],
        [undefined, ['es-AR', 'en'], 'es', 'primero es'],
        ['fr', ['en-US'], 'en', 'guardado inválido se ignora'],
        ['EN', ['es'], 'es', 'guardado en mayúsculas no vale'],
        [null, ['EN-us'], 'en', 'mayúsculas del navegador'],
        [null, ['de', 'es-ES', 'en'], 'es', 'salta los no soportados'],
    ];
    for (const [guardado, navegador, esperado, nombre] of casos) {
        revisar(`elegirIdioma: ${nombre}`, elegirIdioma(guardado, navegador) === esperado);
    }
}

async function probarUI({ revisar, igual }) {
    const avisos = [];
    const warn = console.warn;
    console.warn = (...a) => avisos.push(a.join(' '));
    revisar('t antes de instalar devuelve la clave marcada', t('a.saludo') === '⟦a.saludo⟧');
    ponerDiccionarios('es', ES, {});
    revisar('t interpola', t('a.saludo', { nombre: 'Luz', n: 2 }) === 'Hola Luz, tenés 2 mensajes');
    revisar('t plural 1', t('a.pieza', { n: 1 }) === '1 pieza');
    revisar('t plural 0', t('a.pieza', { n: 0 }) === '0 piezas');
    revisar('t plural 2', t('a.pieza', { n: 2 }) === '2 piezas');
    revisar('t clave inexistente: marcada y no tira', t('a.nada') === '⟦a.nada⟧');
    t('a.nada');
    revisar('t clave inexistente: avisa una sola vez', avisos.filter(a => a.includes('a.nada')).length === 1);
    revisar('marcar devuelve la clave', marcar('a.dinamica') === 'a.dinamica');
    revisar('existe', existe('a.saludo') && !existe('a.nada') && !existe('toString'));

    ponerDiccionarios('en', EN, ES);
    revisar('idiomaActual / localeActual en', idiomaActual() === 'en' && localeActual() === 'en-US');
    revisar('t en usa el diccionario', t('a.pieza', { n: 2 }) === '2 parts');
    revisar('t en cae al español', t('a.soloEs') === 'Sólo en español');
    t('a.soloEs');
    revisar(
        't en desarrollo avisa una vez que cae al respaldo',
        igual(
            avisos.filter(a => a.includes('a.soloEs')),
            ['[idioma] falta en en: a.soloEs'],
        ),
    );
    revisar('existe no mira el respaldo', !existe('a.soloEs'));
    console.warn = warn;
    await probarCambio({ revisar, igual });
    await probarCarreras({ revisar, igual });
    await probarProduccion({ revisar, igual });
}

async function probarCambio({ revisar, igual }) {
    const datos = new Map();
    globalThis.indexedDB = indexedDBFalso(datos);
    const vistos = [];
    const baja = alCambiarIdioma(i => vistos.push(`${i}:${t('a.pieza', { n: 1 })}`));
    revisar('alCambiarIdioma devuelve la función de baja', typeof baja === 'function');
    revisar('ponerDiccionarios no guarda ni avisa', datos.size === 0 && vistos.length === 0);

    await cambiarIdioma('es');
    revisar('cambiarIdioma: activa es', idiomaActual() === 'es' && localeActual() === 'es-AR');
    revisar('cambiarIdioma: guarda la preferencia', datos.get('idioma') === 'es');
    revisar('cambiarIdioma: avisa ya con el idioma cambiado', igual(vistos, ['es:1 pieza']));

    await cambiarIdioma('en');
    revisar('cambiarIdioma: vuelve a en y guarda', idiomaActual() === 'en' && datos.get('idioma') === 'en');
    revisar('cambiarIdioma: segundo aviso', igual(vistos, ['es:1 pieza', 'en:1 part']));

    baja();
    await cambiarIdioma('es');
    revisar('desuscribir: no vuelve a avisar', vistos.length === 2 && idiomaActual() === 'es');

    let mensaje = null;
    try {
        await cambiarIdioma('fr');
    } catch (e) {
        mensaje = e.message;
    }
    revisar(
        'cambiarIdioma inválido: mensaje exacto y no cambia nada',
        mensaje === 'Idioma desconocido: fr' && idiomaActual() === 'es',
    );

    const bajaRoto = alCambiarIdioma(() => {
        throw new Error('suscripto roto');
    });
    const error = console.error;
    console.error = () => {};
    const otros = [];
    alCambiarIdioma(i => otros.push(i));
    await cambiarIdioma('en');
    console.error = error;
    bajaRoto();
    revisar('un suscripto que tira no frena a los demás', igual(otros, ['en']));

    await probarLang({ revisar });
}

async function probarLang({ revisar }) {
    // <html lang> con un document falso
    globalThis.document = { documentElement: { lang: '' } };
    await cambiarIdioma('es');
    const langEs = globalThis.document.documentElement.lang;
    await cambiarIdioma('en');
    const langEn = globalThis.document.documentElement.lang;
    delete globalThis.document;
    revisar('cambiarIdioma pone <html lang>', langEs === 'es-AR' && langEn === 'en-US');
    delete globalThis.indexedDB;
}

async function probarCarreras({ revisar, igual }) {
    globalThis.indexedDB = indexedDBFalso(new Map());
    const vistos = [];
    alCambiarIdioma(i => vistos.push(`${i}:${idiomaActual()}`));
    ponerDiccionarios('en', EN, ES);
    ponerDiccionarios('es', ES, {});
    vistos.length = 0;

    // (a) dos cambios sin await: queda el último y los suscriptos reciben un solo aviso, con el idioma activo
    await Promise.all([cambiarIdioma('en'), cambiarIdioma('es'), cambiarIdioma('en')]);
    revisar('dos cambios seguidos: queda el último', idiomaActual() === 'en');
    revisar(
        'dos cambios seguidos: un solo aviso con el idioma activo',
        igual(vistos.slice(-1), ['en:en']) && vistos.filter(v => v !== 'en:en').length === 0,
    );
    revisar('dos cambios seguidos: un solo aviso', vistos.length === 1);

    // (b) iniciarIdioma con la lectura lenta y un cambio en el medio: gana el cambio
    ponerDiccionarios('en', EN, ES);
    ponerDiccionarios('es', ES, {});
    globalThis.indexedDB = indexedDBFalso(new Map(), 30);
    const inicio = iniciarIdioma({ navegador: ['es'] });
    await cambiarIdioma('en');
    const inicial = await inicio;
    revisar('iniciarIdioma lento + cambio en el medio: gana el cambio', idiomaActual() === 'en' && inicial === 'en');
    delete globalThis.indexedDB;
}

async function probarProduccion({ revisar, igual }) {
    // Instancia nueva del módulo, sin nada cargado: el import() de en.js falla en Node (no hay import.meta.glob).
    const fresco = await import('../../src/ui/idioma.js?carrera');
    const vistos = [];
    fresco.alCambiarIdioma(i => vistos.push(i));
    globalThis.indexedDB = indexedDBFalso(new Map());
    fresco.ponerDiccionarios('es', ES, {});
    const valido = fresco.cambiarIdioma('es');
    const fallo = fresco.cambiarIdioma('en').then(
        () => 'ok',
        () => 'error',
    );
    await Promise.all([valido, fallo]);
    revisar(
        'una carga fallida no cancela a un cambio válido',
        (await fallo) === 'error' && igual(vistos, ['es']) && fresco.idiomaActual() === 'es',
    );
    delete globalThis.indexedDB;

    // Producción: sin respaldo español y sin marca, siempre determinista.
    globalThis.IDIOMA_DESARROLLO = false;
    const prod = await import('../../src/ui/idioma.js?produccion');
    delete globalThis.IDIOMA_DESARROLLO;
    prod.ponerDiccionarios('en', EN, ES);
    revisar('producción: clave sin traducir sale cruda, sin respaldo', prod.t('a.soloEs') === 'a.soloEs');
    revisar('producción: clave inexistente sale cruda', prod.t('a.nada') === 'a.nada');
    revisar('producción: lo traducido sigue andando', prod.t('a.pieza', { n: 1 }) === '1 part');
}

export default async function (ctx) {
    probarInterpolar(ctx);
    probarPlural(ctx);
    probarTraducir(ctx);
    probarElegirIdioma(ctx);
    await probarUI(ctx);
}
