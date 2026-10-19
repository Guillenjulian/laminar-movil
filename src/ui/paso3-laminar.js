// Paso 3: laminado con progreso, cancelar y bloqueo de pantalla (ADR 0001, sección 3.6).
//
// Responsabilidad: lanzar el laminado del modelo con la configuración elegida, mostrar el avance por
// etapas, dejar cancelarlo y mostrar el error si falla. No arma la pantalla de resultado: al terminar
// avisa con `alTerminar` (que carga el paso 4) y después va al paso 4 reemplazando el historial.
//
// Flujo: #laminar -> empezarLaminado -> configuracionActual (desde estado) -> prepararPantallaLaminado
// (paso 3, progreso en 0) -> acomodarPiezas (si no entran: error y no lamina; con una sola pieza y una copia
// lo decide el worker) -> AbortController + mantenerPantalla -> ejecutarLaminado (motor, con
// alProgresar = ponerProgreso) -> estado.resultado -> alTerminar() -> irA(4, reemplazar).
// Error: se muestra el mensaje y el botón pasa a "Volver". #cancelar aborta y vuelve atrás.
// Importarlo no toca el DOM: los manejadores se registran en `iniciarPaso3`.

import { laminar } from '../motor/motor.js';
import { validarCambios } from '../perfiles/cambios.js';
import { armarConfiguracion } from '../perfiles/perfiles.js';
import { configuracionDeTorre } from '../perfiles/torres.js';
import { maxTriangulos } from '../config.js';
import { acomodarPiezas } from './acomodo.js';
import { estado, piezasParaMotor } from './estado.js';
import { irA } from './navegacion.js';
import { $ } from './util-dom.js';

// Cada etapa del motor ocupa un tramo de la barra de progreso.
const ETAPAS = {
    leyendo: { desde: 0, hasta: 2, texto: 'Leyendo el archivo…' },
    reduciendo: { desde: 2, hasta: 10, texto: 'Simplificando la malla…' },
    laminando: { desde: 10, hasta: 60, texto: 'Cortando en capas…' },
    preparando: { desde: 60, hasta: 92, texto: 'Armando los recorridos…' },
    exportando: { desde: 92, hasta: 100, texto: 'Generando el G-code…' },
};

/**
 * Pinta la etapa y su avance en la barra de progreso (#relleno, #progreso, #porcentaje, #etapa).
 * @param {string} etapa  clave de ETAPAS; una desconocida cuenta como "leyendo".
 * @param {number} valor  avance dentro de la etapa, de 0 a 1.
 * @returns {void}
 */
function ponerProgreso(etapa, valor) {
    const e = ETAPAS[etapa] || ETAPAS.leyendo;
    const pct = Math.round(e.desde + (e.hasta - e.desde) * Math.min(1, valor));
    $('relleno').style.width = pct + '%';
    $('progreso').setAttribute('aria-valuenow', pct);
    $('progreso').setAttribute('aria-valuetext', `${pct} %, ${e.texto.replace(/…$/, '')}`);
    $('porcentaje').textContent = pct + ' %';
    $('etapa').textContent = e.texto;
}

// Evita que el celu apague la pantalla mientras lamina (si se bloquea, el
// navegador puede frenar o matar el worker).
/**
 * Pide el wake lock de pantalla. Si el navegador no lo soporta o lo niega, devuelve null.
 * @returns {Promise<WakeLockSentinel|null>}
 */
async function mantenerPantalla() {
    try {
        return await navigator.wakeLock?.request('screen');
    } catch {
        return null;
    }
}

/**
 * Arma la configuración del motor (dispositivo, proceso y avisos) con lo que el usuario eligió.
 * @returns {{dispositivo: object, proceso: object, avisos: string[], cambios: object[]}}
 */
function configuracionActual() {
    // Si hay una torre de calibración, lo que ella fija (Avanzado, relleno, cambios) pisa lo del usuario.
    const t = estado.torre ? configuracionDeTorre(estado.torre) : null;
    const usados = t ? t.cambios : estado.cambios;
    const avanzado = { ...estado.avanzado, ...t?.avanzado };
    const config = armarConfiguracion({
        impresoraId: estado.impresoraId,
        calidad: estado.calidad,
        material: estado.material,
        soportes: t ? t.soportes : estado.soportes,
        personal: { ...estado.personal, ...t?.personal, avanzado },
        cambios: usados,
    });
    // `cambios`: los efectivos (los de la torre si hay una) y ya validados; el paso 4 avisa sólo de esos.
    // Con altura variable (sin jarrón) armarConfiguracion los ignora: no hay nada que avisar.
    const ignorados = avanzado.alturaVariable && !avanzado.jarron;
    return { ...config, cambios: ignorados ? [] : validarCambios(usados).cambios };
}

/**
 * Pasa al paso 3 y deja la pantalla de progreso en su estado inicial (sin error, en 0 %).
 * @returns {void}
 */
function prepararPantallaLaminado() {
    irA(3);
    $('tituloLaminando').textContent = 'Laminando…';
    $('errorLaminado').hidden = true;
    $('cancelar').textContent = 'Cancelar';
    ponerProgreso('leyendo', 0);
}

/**
 * Corre el motor sobre las piezas ya acomodadas y arma el resultado (gcode, info, avisos, nombre de archivo).
 * @param {{dispositivo: object, proceso: object, avisos: string[], cambios: object[], signal: AbortSignal}} config
 * @returns {Promise<object>} lo que devuelve `laminar`, más `avisos`, `archivo` e `impresoraId`.
 */
async function ejecutarLaminado({ dispositivo, proceso, avisos, cambios, signal }) {
    const r = await laminar({
        piezas: piezasParaMotor(), // copias de los STL: los originales quedan para volver a laminar
        dispositivo,
        proceso,
        maxTriangulos: maxTriangulos(),
        alProgresar: ponerProgreso,
        signal,
    });
    const base = estado.nombre.replace(/\.(stl|obj|3mf)$/i, '').replace(/[^\w.-]+/g, '_');
    return {
        ...r,
        avisos,
        archivo: `${base}_${estado.calidad}.gcode`,
        impresoraId: estado.impresoraId,
        capas: { sliceHeight: proceso.sliceHeight, firstSliceHeight: proceso.firstSliceHeight },
        cambios: cambios.map(c => ({ ...c })),
    };
}

/**
 * Muestra el error en la pantalla de laminado y deja el botón como "Volver".
 * @param {string} mensaje
 * @returns {void}
 */
function mostrarError(mensaje) {
    $('tituloLaminando').textContent = 'No se pudo laminar';
    $('errorLaminado').textContent = mensaje;
    $('errorLaminado').hidden = false;
    $('cancelar').textContent = 'Volver';
}

/**
 * Flujo completo del laminado: prepara la pantalla, lanza el motor con cancelación y bloqueo de
 * pantalla, guarda el resultado y avisa a `alTerminar`. Si falla muestra el error; si se canceló, no hace nada más.
 * @param {() => void} alTerminar  se llama con `estado.resultado` ya cargado.
 * @returns {Promise<void>}
 */
async function empezarLaminado(alTerminar) {
    const config = configuracionActual();
    prepararPantallaLaminado();
    const sola = estado.piezas.length === 1 && estado.piezas[0].copias === 1;
    if (!acomodarPiezas().entra && !sola) {
        mostrarError('Las piezas no entran en la cama. Probá con menos copias o más chicas.');
        return;
    }

    estado.cancelar = new AbortController();
    const bloqueo = await mantenerPantalla();
    try {
        estado.resultado = await ejecutarLaminado({ ...config, signal: estado.cancelar.signal });
        alTerminar();
        irA(4, { reemplazar: true }); // así "atrás" desde el resultado vuelve a la configuración
    } catch (err) {
        if (err.name === 'AbortError') return;
        mostrarError(err.message);
    } finally {
        bloqueo?.release();
        estado.cancelar = null;
    }
}

/**
 * Cablea #laminar y #cancelar. Llamar una vez.
 * `alTerminar` se llama con `estado.resultado` ya cargado (main: mostrarResultado del paso 4);
 * después este módulo hace irA(4, { reemplazar: true }).
 * @param {{ alTerminar: () => void }} callbacks
 * @returns {void}
 */
export function iniciarPaso3({ alTerminar }) {
    $('laminar').onclick = () => empezarLaminado(alTerminar);
    $('cancelar').onclick = () => {
        estado.cancelar?.abort();
        history.back();
    };
}
