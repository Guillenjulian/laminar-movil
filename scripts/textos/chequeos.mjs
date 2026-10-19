// Cableado de los chequeos de diccionarios (ADR 0008, I2): une los detectores de detectores.mjs en una sola función
// pura, `chequeos`, que reciben tanto `diccionarios.mjs` (con los archivos reales) como `autopruebas.mjs` (con
// datos sintéticos). Así las autopruebas prueban el cableado, no sólo cada detector. Sin `export default`.
import {
    aliasDeT,
    aplanar,
    clavesDelHtml,
    compararEstructura,
    cruzarClaves,
    elementosConTexto,
    espanolSuelto,
    formaDeClaves,
    htmlContraEs,
    marcadoNoPermitido,
    reservasVencidas,
    usosEnJs,
    valoresInvalidos,
} from './detectores.mjs';

const ambos = (detector, es, en) => [...detector(es).map(m => `[es] ${m}`), ...detector(en).map(m => `[en] ${m}`)];

/** Usos de claves en los JavaScript y en el HTML. @param {{ruta: string, texto: string}[]} js @param {string} html */
export function usosDeClaves(js, html) {
    const usadas = new Set();
    const dinamicas = [];
    const alias = [];
    for (const { ruta, texto } of js) {
        const usos = usosEnJs(texto);
        usos.claves.forEach(k => usadas.add(k));
        dinamicas.push(...usos.dinamicas.map(d => `${ruta}: ${d}`));
        alias.push(...aliasDeT(texto).map(a => `${ruta}: ${a}`));
    }
    const elementos = elementosConTexto(html);
    clavesDelHtml(elementos).forEach(k => usadas.add(k));
    return { usadas, dinamicas, alias, elementos };
}

/**
 * Todos los chequeos de los textos.
 * @param {object} entrada
 * @param {Record<string, Record<string, any>>} entrada.es  diccionario es (área -> claves)
 * @param {Record<string, Record<string, any>>} entrada.en  diccionario en
 * @param {{ruta: string, texto: string}[]} entrada.js  los JavaScript que se escanean en busca de t()/marcar()
 * @param {string} entrada.html  index.html
 * @param {{ruta: string, texto: string|null}[]} entrada.migrados  módulos de MIGRADOS (texto null = no existe)
 * @param {string[]} entrada.reservadas  CLAVES_RESERVADAS
 * @param {string[]} [entrada.lectura]  errores al leer los .json (JSON inválido, con el nombre del archivo)
 * @returns {[string, string, string[]][]} [id, nombre, mensajes] de cada chequeo; sin mensajes = pasa
 */
export function chequeos({ es, en, js, html, migrados, reservadas, lectura = [] }) {
    const usos = usosDeClaves(js, html);
    const definidas = new Set(aplanar(es).keys());
    const { sinDefinir, sinUso } = cruzarClaves(definidas, usos.usadas, reservadas);
    const migrado = ({ ruta, texto }) =>
        texto === null ? [`falta el módulo migrado ${ruta}`] : espanolSuelto(texto, ruta);
    return [
        ['lectura', 'los .json se leen y son JSON válido', lectura],
        ['valores', 'cada valor es un texto o un plural {one?, other}', ambos(valoresInvalidos, es, en)],
        ['estructura', 'mismas áreas, claves, tipos, variables y plurales en es y en', compararEstructura(es, en)],
        ['forma', 'forma de las claves (regex, prefijo = archivo, sin repetidas)', ambos(formaDeClaves, es, en)],
        ['marcado', 'marcado permitido (sólo <b>, <small>, <br>; sin &)', ambos(marcadoNoPermitido, es, en)],
        ['dinamicas', 'sin claves dinámicas (usá marcar() o // t-dinamica: motivo)', usos.dinamicas],
        ['alias', 'sin alias de t, existe ni marcar al importar', usos.alias],
        ['sinDefinir', 'claves usadas y definidas en es', sinDefinir.map(k => `usada pero no definida: ${k}`)],
        ['sinUso', 'claves definidas y usadas', sinUso.map(k => `definida pero sin uso: ${k}`)],
        [
            'reserva',
            'cada reserva de CLAVES_RESERVADAS sigue haciendo falta',
            reservasVencidas(definidas, usos.usadas, reservadas),
        ],
        [
            'html',
            'el HTML dice lo mismo que es (sin variables, data-t sin hijos)',
            htmlContraEs(usos.elementos, aplanar(es)),
        ],
        ['migrados', 'módulos migrados sin español suelto', migrados.flatMap(migrado)],
    ];
}
