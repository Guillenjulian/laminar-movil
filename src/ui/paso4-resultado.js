// Paso 4 (resultado): resumen de la laminación, avisos y entrega del G-code.
// Responsabilidad: mostrar qué salió (tiempo, filamento, capas, calidad, tamaño), armar la vista previa
// capa por capa y ofrecer Compartir / Descargar / Elegir otro modelo. Qué archivo se baja (.gcode o .gcode.3mf
// de Bambu) lo decide `entrega-ui.js`.
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
import { nombreEntrega } from './entrega.js';
import { entregaDe, esperarArchivo, paraCompartir, precargar, puedeCompartir, soltarEntrega } from './entrega-ui.js';
import { buscarImpresora, materiales } from '../perfiles/perfiles.js';
import { avisosPostLaminado } from '../perfiles/cambios.js';

/** Avisos de los cambios por altura que cayeron por encima de la pieza (ADR 0002).
 *  Usa lo guardado al laminar: la altura sale de `info.tamano.z`; capas y cambios, de `estado.resultado`.
 *  @returns {string[]} */
function avisosDeCambios() {
    const { info, capas, cambios } = estado.resultado;
    if (!cambios?.length) return [];
    return avisosPostLaminado(cambios, info.tamano?.z, capas);
}

/** Comparte el archivo con la hoja del sistema. Si el gesto venció mientras se armaba el .gcode.3mf
 *  (`NotAllowedError`), avisa en el mismo botón: el archivo ya quedó en el cache.
 *  @returns {Promise<void>} */
async function compartir() {
    $('estadoEntrega').textContent = '';
    let archivo;
    try {
        archivo = await esperarArchivo($('compartir'));
        await navigator.share({ files: [paraCompartir(archivo)], title: archivo.name });
    } catch (err) {
        if (err.name === 'NotAllowedError' && archivo) {
            $('estadoEntrega').textContent = 'Listo el archivo. Tocá Compartir otra vez';
        } else if (err.name !== 'AbortError') alert('No se pudo compartir: ' + err.message);
    }
}

/** Baja el archivo (con `a.download` = su nombre final). @returns {Promise<void>} */
async function descargar() {
    let archivo;
    try {
        archivo = await esperarArchivo($('descargar'));
    } catch (err) {
        return alert('No se pudo armar el archivo: ' + err.message);
    }
    const url = URL.createObjectURL(archivo);
    const a = document.createElement('a');
    a.href = url;
    a.download = archivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Cablea #compartir, #descargar y #otro.
 *  `alOtroModelo`: vuelve al inicio del paso 1 (main: elegirOtroModelo). #otro hace
 *  `estado.resultado = null`, llama a `alOtroModelo()` y después `irA(1)`.
 *  @param {{alOtroModelo: () => void}} callbacks
 *  @returns {void} */
export function iniciarPaso4({ alOtroModelo }) {
    $('compartir').onclick = compartir;
    $('descargar').onclick = descargar;

    $('otro').onclick = () => {
        soltarEntrega();
        estado.resultado = null;
        alOtroModelo();
        irA(1);
    };
}

/** Llena el resumen, los avisos y el botón Compartir/Descargar con `estado.resultado` y arma la
 *  vista previa (armarVistaPrevia). @returns {void} */
export function mostrarResultado() {
    soltarEntrega(); // el archivo del resultado anterior ya no sirve
    const { info, gcode, avisos, archivo } = estado.resultado;
    const { formato: salida } = entregaDe();
    const imp = buscarImpresora(estado.impresoraId);
    const cal = imp.calidades[estado.calidad];
    const filas = [
        ['Tiempo estimado', formato.duracion(info.tiempo)],
        ...materialesUI.filasResumen(info.filamento, imp.dispositivo.extruders[0].extFilament, estado.material),
        ['Capas', formato.numero(info.capas)],
        ['Calidad', `${cal.nombre} · ${materiales[estado.material].nombre}${estado.soportes ? ' · con soportes' : ''}`],
        ['Relleno y adhesión', resumenPersonal(valoresActuales())],
        ...(info.copias > 1 ? [['Piezas', `${info.copias} piezas`]] : []),
        ['Tamaño', formato.milimetros(info.tamano)],
        [salida === 'gcode.3mf' ? 'G-code' : 'Archivo', formato.bytes(gcode.length)],
    ];
    $('resumen').innerHTML = filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('nombreArchivo').textContent = nombreEntrega(archivo, salida);

    const notas = [...avisos, ...avisosDeCambios()];
    if (info.decimado) {
        const d = info.decimado;
        notas.push(
            `Simplificamos ${info.copias > 1 ? 'las piezas' : 'el modelo'} de ${formato.triangulos(d.original)} a ${formato.triangulos(d.final)} ` +
                `para que entre en la memoria del celu (detalle mínimo ≈ ${formato.numero(d.precisionMm, 2)} mm).`,
        );
    }
    $('avisoResultado').innerHTML = notas.join('<br><br>');
    $('avisoResultado').hidden = notas.length === 0;

    // "Compartir" sólo si el navegador puede compartir archivos (Android/iOS sí; la mayoría de las PCs no).
    $('compartir').hidden = !puedeCompartir(archivo);
    $('compartir').textContent = salida === 'gcode.3mf' ? 'Compartir archivo' : 'Compartir G-code';
    $('estadoEntrega').textContent = '';
    $('descargar').classList.toggle('primario', $('compartir').hidden);
    armarVistaPrevia(); // reinicia las pausas: la precarga va después, con las pausas de ahora
    precargar();
}
