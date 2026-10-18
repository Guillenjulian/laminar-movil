// Paso 3: laminado con progreso, cancelar y bloqueo de pantalla (ADR 0001, sección 3.6).
//
// Responsabilidad: lanzar el laminado del modelo con la configuración elegida, mostrar el avance por
// etapas, dejar cancelarlo y mostrar el error si falla. No arma la pantalla de resultado: al terminar
// avisa con `alTerminar` (que carga el paso 4) y después va al paso 4 reemplazando el historial.
//
// Flujo: #laminar -> empezarLaminado -> configuracionActual (desde estado) -> prepararPantallaLaminado
// (paso 3, progreso en 0) -> AbortController + mantenerPantalla -> ejecutarLaminado (motor, con
// alProgresar = ponerProgreso) -> estado.resultado -> alTerminar() -> irA(4, reemplazar).
// Error: se muestra el mensaje y el botón pasa a "Volver". #cancelar aborta y vuelve atrás.
// Importarlo no toca el DOM: los manejadores se registran en `iniciarPaso3`.

import { laminar } from '../motor/motor.js';
import { armarConfiguracion } from '../perfiles/perfiles.js';
import { maxTriangulos } from '../config.js';
import { estado, matrizModelo } from './estado.js';
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
 * @returns {{dispositivo: object, proceso: object, avisos: string[]}}
 */
function configuracionActual() {
    return armarConfiguracion({
        impresoraId: estado.impresoraId,
        calidad: estado.calidad,
        material: estado.material,
        soportes: estado.soportes,
        personal: { ...estado.personal, avanzado: estado.avanzado },
        cambios: estado.cambios,
    });
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
 * Corre el motor sobre una copia del STL y arma el resultado (gcode, info, avisos, nombre de archivo).
 * @param {{dispositivo: object, proceso: object, avisos: string[], signal: AbortSignal}} config
 * @returns {Promise<object>} lo que devuelve `laminar`, más `avisos`, `archivo` e `impresoraId`.
 */
async function ejecutarLaminado({ dispositivo, proceso, avisos, signal }) {
    const r = await laminar({
        stl: estado.stl.slice(0), // copia: el original queda para volver a laminar
        dispositivo,
        proceso,
        maxTriangulos: maxTriangulos(),
        transformacion: matrizModelo(),
        alProgresar: ponerProgreso,
        signal,
    });
    const base = estado.nombre.replace(/\.(stl|obj|3mf)$/i, '').replace(/[^\w.-]+/g, '_');
    return {
        ...r,
        avisos,
        archivo: `${base}_${estado.calidad}.gcode`,
        impresoraId: estado.impresoraId,
    };
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

    estado.cancelar = new AbortController();
    const bloqueo = await mantenerPantalla();
    try {
        estado.resultado = await ejecutarLaminado({ ...config, signal: estado.cancelar.signal });
        alTerminar();
        irA(4, { reemplazar: true }); // así "atrás" desde el resultado vuelve a la configuración
    } catch (err) {
        if (err.name === 'AbortError') return;
        $('tituloLaminando').textContent = 'No se pudo laminar';
        $('errorLaminado').textContent = err.message;
        $('errorLaminado').hidden = false;
        $('cancelar').textContent = 'Volver';
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
