// Paso 1: hoja "Torre de calibración" (ADR 0002, sección 6).
//
// Responsabilidad: elegir una torre de temperatura o de retracción, ver y ajustar el valor de cada
// bloque (precargado con los valores sugeridos para la impresora y el material elegidos) y cargarla
// como modelo. Después se configura y lamina como cualquier otro modelo: `paso3-laminar` aplica la
// configuración de la torre (perfiles/torres.js) si `estado.torre` existe.
//
// Flujo: prepararTorre({ abrir, cerrar, cargar, contexto }) -> abrir() sugiere valores y abre la hoja ->
// "Crear torre" valida con armarTorre (con el hotendMax de la impresora) -> cerrar() -> cargar(nombre,
// generar, torre). `revisar(torre)` muestra los avisos de la torre cargada (material, impresora nueva).
// Importarlo no toca el DOM: la hoja se cablea dentro de prepararTorre.

import { torreAStl } from '../motor/motor.js';
import { buscarImpresora } from '../perfiles/perfiles.js';
import { armarTorre, valoresSugeridos } from '../perfiles/torres.js';
import { $, anunciar } from './util-dom.js';
import { numeroHasta } from './formato.js';

const TIPOS = {
    temperatura: { nombre: 'Torre de temperatura', unidad: '°C', paso: 5 },
    retraccion: { nombre: 'Torre de retracción', unidad: 'mm', paso: 0.5 },
};
const BLOQUES_MIN = 3;
const BLOQUES_MAX = 8;

/** Texto "225, 220 °C" de los valores de una torre (lo muestra el paso 2).
 *  @param {{ tipo: string, bloques: { valor: number }[] }} torre @returns {string} */
const resumenTorre = torre => {
    const { unidad } = TIPOS[torre.tipo];
    const decimales = unidad === 'mm' ? 1 : 0; // 0,5 mm de retracción no se puede redondear a 1
    const ver = v => numeroHasta(v, decimales);
    return `${torre.bloques.map(b => ver(b.valor)).join(', ')} ${unidad}`;
};

/** Máximo de temperatura de la boquilla de la impresora, en °C (Infinity si no lo define).
 *  @param {string} impresoraId @returns {number} */
const hotendDe = impresoraId => buscarImpresora(impresoraId).limites?.hotendMax ?? Infinity;

/** Número escrito con coma o punto (NaN si está vacío o no es un número). @param {string} texto @returns {number} */
const leerNumero = texto => (texto.trim() === '' ? NaN : Number(texto.replace(',', '.')));

/** Muestra u oculta un mensaje de la hoja. @param {string} id @param {string} texto @returns {void} */
function mensaje(id, texto) {
    anunciar($(id), texto || '');
}

/** Dibuja un campo por bloque, de abajo hacia arriba. @param {string} tipo @param {number[]} valores @returns {void} */
function dibujarValores(tipo, valores) {
    const { unidad, paso } = TIPOS[tipo];
    $('valoresTorre').innerHTML = valores
        .map(
            (v, i) => `<label>Bloque ${i + 1}${i === 0 ? ' (abajo)' : ''}
            <span><input type="number" inputmode="decimal" step="${paso}" value="${v}" aria-label="Bloque ${i + 1} en ${unidad}"> ${unidad}</span></label>`,
        )
        .join('');
}

/** Valores escritos en la hoja, de abajo hacia arriba. @returns {number[]} */
const leerValores = () => [...$('valoresTorre').querySelectorAll('input')].map(c => leerNumero(c.value));

/** Agrega o quita bloques al final, siguiendo el paso de los últimos dos valores.
 *  @param {string} tipo @param {number} cantidad @returns {void} */
function ajustarCantidad(tipo, cantidad) {
    const valores = leerValores().slice(0, cantidad);
    const paso = valores.length > 1 ? valores.at(-1) - valores.at(-2) : TIPOS[tipo].paso;
    while (valores.length < cantidad) valores.push(Math.round((valores.at(-1) + paso) * 100) / 100);
    dibujarValores(tipo, valores);
}

/** Valida la torre contra la impresora elegida. @param {object} torre sin validar o ya armada
 *  @param {string} impresoraId @returns {object} la torre armada (lanza Error en castellano) */
function validar({ tipo, valores, altoBloqueMm }, impresoraId) {
    return armarTorre({ tipo, valores, altoBloqueMm, hotendMax: hotendDe(impresoraId) });
}

/** Precarga cantidad, alto y valores sugeridos; si la impresora no da, lo dice en la hoja.
 *  @param {HTMLFormElement} form @param {{ impresoraId: string, material: string }} ctx @returns {string} aviso */
function sugerir(form, ctx) {
    const tipo = form.elements.tipoTorre.value;
    mensaje('errorTorre', '');
    let aviso = '';
    try {
        const s = valoresSugeridos(tipo, ctx);
        form.elements.bloques.value = s.bloques;
        form.elements.alto.value = s.altoBloqueMm;
        dibujarValores(tipo, s.valores);
        aviso = s.aviso || '';
    } catch (err) {
        mensaje('errorTorre', err.message);
    }
    mensaje('avisoTorreHoja', aviso);
    return aviso;
}

/** Avisos de la torre cargada: el del material y si la impresora elegida ya no la aguanta.
 *  @param {object|null} torre @param {string} impresoraId @returns {void} */
function avisarTorre(torre, impresoraId) {
    const textos = torre?.aviso ? [torre.aviso] : [];
    try {
        if (torre) validar({ ...torre, valores: torre.bloques.map(b => b.valor) }, impresoraId);
    } catch (err) {
        textos.push(`${err.message} Creá la torre de nuevo para esta impresora.`);
    }
    mensaje('avisoTorre', textos.join(' '));
}

/**
 * Arma la hoja y la conecta. `abrir` y `cerrar` son abrirHoja/cerrarHojas de navegacion.js;
 * `cargar(nombre, generar, torre)` carga el modelo (`generar()` devuelve una promesa con el STL);
 * `contexto()` da la impresora y el material elegidos en el momento.
 * @param {{ abrir: () => void, cerrar: () => void,
 *           cargar: (nombre: string, generar: () => Promise<ArrayBuffer>, torre: object) => void,
 *           contexto: () => { impresoraId: string, material: string } }} deps
 * @returns {{ abrir: () => void, revisar: (torre: object|null) => void }}
 */
export function prepararTorre({ abrir, cerrar, cargar, contexto }) {
    const form = $('formTorre');
    let aviso = ''; // aviso del material para la torre que se está armando (ej. TPU en Bowden)
    const tipo = () => form.elements.tipoTorre.value;

    form.addEventListener('change', e => {
        if (e.target.name === 'tipoTorre') aviso = sugerir(form, contexto());
        if (e.target.name !== 'bloques') return;
        const n = Math.round(Number(e.target.value)) || BLOQUES_MIN;
        e.target.value = Math.min(BLOQUES_MAX, Math.max(BLOQUES_MIN, n));
        ajustarCantidad(tipo(), Number(e.target.value));
    });

    form.addEventListener('submit', e => {
        e.preventDefault();
        let torre;
        try {
            const altoBloqueMm = leerNumero(form.elements.alto.value);
            torre = validar({ tipo: tipo(), valores: leerValores(), altoBloqueMm }, contexto().impresoraId);
        } catch (err) {
            mensaje('errorTorre', err.message);
            return;
        }
        mensaje('errorTorre', '');
        cerrar();
        const opciones = { tipo: torre.tipo, bloques: torre.bloques.length, altoBloqueMm: torre.altoBloqueMm };
        const generar = async () => (await torreAStl(opciones)).stl;
        cargar(TIPOS[torre.tipo].nombre, generar, { ...torre, aviso, resumen: resumenTorre(torre) });
    });

    return {
        abrir() {
            aviso = sugerir(form, contexto());
            abrir();
            form.parentElement.scrollTo?.(0, 0);
            form.querySelector('input:checked').focus();
        },
        revisar: torre => avisarTorre(torre, contexto().impresoraId),
    };
}
