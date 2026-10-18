// Entrega: decide qué archivo se baja o se comparte en el paso 4 (ADR 0005, contrato 3.4).
// Responsabilidad: meter las pausas de filamento en el G-code y dejarlo como .gcode plano o dentro de un
// .gcode.3mf (Bambu), con el nombre y el MIME que corresponden.
// Flujo: paso4 arma `salida` e `infoBambu` y llama a `armarEntrega`; acá no se lee `estado` ni `perfiles`.
// No toca el DOM ni nada global al importarse: se puede probar en Node.
// Aristas permitidas: motor/pausas y motor/bambu-3mf.

import { insertarPausas } from '../motor/pausas.js';
import { armarGcode3mf } from '../motor/bambu-3mf.js';

/**
 * @typedef {object} Salida
 * @property {'gcode'|'gcode.3mf'} formato  `salidaDe(imp)`
 * @property {string[]} pausa               `lineasPausa(imp)`
 * @property {{id:string, nombre?:string}} [modelo]  `imp.modeloBambu`, obligatorio con 'gcode.3mf'
 */

/** @typedef {import('../motor/bambu-xml.js').InfoBambu} InfoBambu */

const EXT_GCODE = /\.gcode(\.3mf)?$/i;

/**
 * Nombre final del archivo. Se le saca la extensión `.gcode` (o `.gcode.3mf`) del final, si la tiene,
 * y se agrega la que corresponde al formato. Sólo cuenta la extensión del final: un `gcode` en el medio
 * ('mi.gcode.v2') es parte del nombre, así que da 'mi.gcode.v2.gcode' o 'mi.gcode.v2.gcode.3mf'.
 * @param {string} archivo ej. 'cubo_rapido.gcode' o 'cubo' (sin extensión)
 * @param {'gcode'|'gcode.3mf'} formato
 * @returns {string}
 */
export function nombreEntrega(archivo, formato) {
    return archivo.replace(EXT_GCODE, '') + (formato === 'gcode.3mf' ? '.gcode.3mf' : '.gcode');
}

/**
 * MIME para `File`: `text/plain` para G-code plano (varios celus no comparten `text/x-gcode`);
 * `application/octet-stream` para el 3MF al descargar.
 * @param {'gcode'|'gcode.3mf'} formato
 * @returns {string}
 */
export function mimeEntrega(formato) {
    return formato === 'gcode.3mf' ? 'application/octet-stream' : 'text/plain';
}

/**
 * Arma el archivo a entregar: inserta las pausas y, según `salida.formato`, lo deja como G-code plano
 * o dentro de un .gcode.3mf.
 * @param {{gcode:string, archivo:string, info:object}} resultado  `estado.resultado`
 * @param {{capa:number, offset:number, z:number}[]} pausas        `[...estado.pausas.values()]`
 * @param {Salida} salida
 * @param {InfoBambu} [infoBambu]   obligatorio con 'gcode.3mf' (lo arma paso4: tiempo, gramos, material)
 * @param {(fraccion:number) => void} [alProgreso]
 * @returns {Promise<File>}  nombre = `nombreEntrega(resultado.archivo, salida.formato)`
 * @throws {Error} con 'gcode.3mf' si falta `infoBambu` o `salida.modelo`
 */
export async function armarEntrega(resultado, pausas, salida, infoBambu, alProgreso) {
    const nombre = nombreEntrega(resultado.archivo, salida.formato);
    const type = mimeEntrega(salida.formato);
    if (salida.formato === 'gcode.3mf' && (!infoBambu || !salida.modelo)) {
        throw new Error('Falta el modelo o los datos de la impresora Bambu para armar el .gcode.3mf.');
    }
    const final = insertarPausas(resultado.gcode, pausas, salida.pausa);
    if (salida.formato !== 'gcode.3mf') return new File([final], nombre, { type });
    const info = { ...infoBambu, modelo: salida.modelo };
    const zip = await armarGcode3mf(final, info, { alProgreso });
    return new File([zip], nombre, { type });
}
