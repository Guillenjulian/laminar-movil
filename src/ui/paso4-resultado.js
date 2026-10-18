// Paso 4 (resultado): resumen de la laminación, avisos y entrega del G-code.
// Responsabilidad: mostrar qué salió (tiempo, filamento, capas, calidad, tamaño), armar la vista previa
// capa por capa y ofrecer Compartir / Descargar / Elegir otro modelo.
// Flujo: `mostrarResultado()` (lo llama el paso 3 al terminar) llena la pantalla con `estado.resultado`
// y arma la vista previa; `iniciarPaso4()` cablea los tres botones una vez, desde `main.js`.
// No toca el DOM al importarse: todo el cableado ocurre dentro de `iniciarPaso4`.

import { estado, valoresActuales } from './estado.js';
import { irA } from './navegacion.js';
import { $ } from './util-dom.js';
import { armarVistaPrevia } from './vista-capas.js';
import { resumenPersonal } from './paso2-config.js';
import * as formato from './formato.js';
import * as materialesUI from './materiales.js';
import { insertarPausas } from '../motor/pausas.js';
import { buscarImpresora, materiales, lineasPausa } from '../perfiles/perfiles.js';
import { avisosPostLaminado } from '../perfiles/cambios.js';

/** Arma el archivo .gcode con las pausas de filamento insertadas, listo para compartir o descargar.
 *  Usa text/plain: varios celus no dejan compartir tipos "raros" como text/x-gcode.
 *  @returns {File} */
function archivoGcode() {
    const { gcode, archivo, impresoraId } = estado.resultado;
    const final = insertarPausas(gcode, [...estado.pausas.values()], lineasPausa(buscarImpresora(impresoraId)));
    return new File([final], archivo, { type: 'text/plain' });
}

/** Avisos de los cambios por altura que cayeron por encima de la pieza (ADR 0002).
 *  Usa lo guardado al laminar: la altura sale de `info.tamano.z`; capas y cambios, de `estado.resultado`.
 *  @returns {string[]} */
function avisosDeCambios() {
    const { info, capas, cambios } = estado.resultado;
    if (!cambios?.length) return [];
    return avisosPostLaminado(cambios, info.tamano?.z, capas);
}

/** Cablea #compartir, #descargar y #otro.
 *  `alOtroModelo`: vuelve al inicio del paso 1 (main: elegirOtroModelo). #otro hace
 *  `estado.resultado = null`, llama a `alOtroModelo()` y después `irA(1)`.
 *  @param {{alOtroModelo: () => void}} callbacks
 *  @returns {void} */
export function iniciarPaso4({ alOtroModelo }) {
    $('compartir').onclick = async () => {
        try {
            await navigator.share({ files: [archivoGcode()], title: estado.resultado.archivo });
        } catch (err) {
            if (err.name !== 'AbortError') alert('No se pudo compartir: ' + err.message);
        }
    };

    $('descargar').onclick = () => {
        const url = URL.createObjectURL(archivoGcode());
        const a = document.createElement('a');
        a.href = url;
        a.download = estado.resultado.archivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };

    $('otro').onclick = () => {
        estado.resultado = null;
        alOtroModelo();
        irA(1);
    };
}

/** Llena el resumen, los avisos y el botón Compartir/Descargar con `estado.resultado` y arma la
 *  vista previa (armarVistaPrevia). @returns {void} */
export function mostrarResultado() {
    const { info, gcode, avisos, archivo } = estado.resultado;
    const imp = buscarImpresora(estado.impresoraId);
    const cal = imp.calidades[estado.calidad];
    const filas = [
        ['Tiempo estimado', formato.duracion(info.tiempo)],
        ...materialesUI.filasResumen(info.filamento, imp.dispositivo.extruders[0].extFilament, estado.material),
        ['Capas', formato.numero(info.capas)],
        ['Calidad', `${cal.nombre} · ${materiales[estado.material].nombre}${estado.soportes ? ' · con soportes' : ''}`],
        ['Relleno y adhesión', resumenPersonal(valoresActuales())],
        ['Tamaño', formato.milimetros(info.tamano)],
        ['Archivo', formato.bytes(gcode.length)],
    ];
    $('resumen').innerHTML = filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('nombreArchivo').textContent = archivo;

    const notas = [...avisos, ...avisosDeCambios()];
    if (info.decimado) {
        const d = info.decimado;
        notas.push(
            `Simplificamos el modelo de ${formato.triangulos(d.original)} a ${formato.triangulos(d.final)} ` +
                `para que entre en la memoria del celu (detalle mínimo ≈ ${formato.numero(d.precisionMm, 2)} mm).`,
        );
    }
    $('avisoResultado').innerHTML = notas.join('<br><br>');
    $('avisoResultado').hidden = notas.length === 0;

    // "Compartir" sólo si el navegador puede compartir archivos (Android/iOS sí; la mayoría de las PCs no).
    $('compartir').hidden = !navigator.canShare?.({ files: [archivoGcode()] });
    $('descargar').classList.toggle('primario', $('compartir').hidden);

    armarVistaPrevia();
}
