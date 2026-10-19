// Ajuste del modelo en la cama (ADR 0003, secciones 4 y 7; sale de paso1-modelo.js, ADR 0001).
//
// Responsabilidad: escala, rotaciones de 90°, "apoyar cara", "ajustar a la cama", "restablecer" y los
// avisos del modelo ("no entra en la cama", "modelo pesado"). No es dueño del visor ni de la hoja de la
// torre: se los pasan como funciones (se leen en el momento, porque se crean más tarde). Opera sobre
// `estado.escala` y `estado.rotacion` (la pieza activa) y avisa cada cambio con `alCambiar`.
//
// Flujo: crearAjuste(ctx) -> conectar() cablea los controles -> cada cambio llama a aplicar()
// (visor, textos, "restablecer", avisos) y por último a ctx.alCambiar(). Importarlo no toca el DOM.

import * as transformar from '../motor/transformar.js';
import { buscarImpresora } from '../perfiles/perfiles.js';
import { maxTriangulos } from '../config.js';
import * as formato from './formato.js';
import { $, anunciar } from './util-dom.js';
import { estado, matrizModelo, piezaActiva } from './estado.js';

/**
 * Crea el ajuste del modelo. No toca el DOM hasta `conectar()`.
 * @param {object} ctx
 * @param {() => (object|null)} ctx.visor visor del paso 1 (null si todavía no se creó)
 * @param {() => void} ctx.alCambiar se llama al final de cada cambio de escala o rotación
 *   (paso1: guardar el reciente; después, reacomodar las piezas)
 * @param {() => void} [ctx.alActivarCara] se llama al entrar al modo "apoyar cara" (paso1 apaga el de marcar zonas)
 * @param {() => (object|null)} ctx.torres hoja de torres (su `revisar(torre)` se llama al avisar)
 * @returns {{conectar: () => void, aplicar: () => void, actualizarAviso: () => void, cancelarCara: () => void}}
 *   `conectar()` cablea escala, rotaciones, "ajustar a la cama", "restablecer" y "apoyar cara" (una vez);
 *   `aplicar()` reaplica rotación y escala (llamar tras cargar un modelo o cambiar `estado.rotacion/escala`);
 *   `actualizarAviso()` recalcula los avisos (llamar al cambiar de impresora);
 *   `cancelarCara()` sale del modo "apoyar cara" (llamar al montar un modelo).
 */
export function crearAjuste(ctx) {
    return {
        aplicar: () => aplicar(ctx),
        actualizarAviso: () => actualizarAviso(ctx),
        cancelarCara: () => activarElegirCara(ctx, false),
        conectar: () => conectar(ctx),
    };
}

/** Tamaño del modelo como va a quedar en la cama. */
function tamanoActual(ctx) {
    return ctx.visor()?.tamanoModelo(piezaActiva()?.id) || estado.vista.tamano;
}

/** Guarda en la pieza su medida real (lo que se ve es lo que se imprime): la usa el acomodo sin visor. */
function guardarMedida(ctx) {
    const p = piezaActiva();
    const t = p && ctx.visor().tamanoModelo(p.id);
    if (t) p.tamano = t;
}

/** Cambia la escala (entre 0,01 y 20) y reaplica; ignora valores no positivos. */
function ponerEscala(ctx, s) {
    if (!(s > 0)) return;
    estado.escala = Math.min(20, Math.max(0.01, s));
    aplicar(ctx);
}

/** Aplica rotación y escala al visor y refresca escala, textos, "restablecer" y avisos. */
function aplicar(ctx) {
    ctx.visor().ponerTransformacion(matrizModelo(), piezaActiva()?.id);
    guardarMedida(ctx);
    const pct = Math.round(estado.escala * 1000) / 10;
    $('escala').value = pct;
    $('datosModelo').textContent =
        `${formato.milimetros(tamanoActual(ctx))} · ${formato.triangulos(estado.vista.triangulos)}`;
    $('restablecerModelo').hidden = estado.escala === 1 && transformar.esIdentidad(estado.rotacion);
    actualizarAviso(ctx);
    ctx.alCambiar();
}

/** Avisos sobre el modelo: si no entra en la cama o si es muy pesado (se va a simplificar). */
function actualizarAviso(ctx) {
    if (!estado.vista) return;
    ctx.torres()?.revisar(estado.torre);
    const imp = buscarImpresora(estado.impresoraId);
    const noEntra = noEntraEnCama(tamanoActual(ctx), imp.dispositivo);
    const avisos = [];
    // Con varias piezas o copias lo dice #avisoEntran (alerta); acá sólo con una pieza y una copia, para no anunciarlo dos veces.
    const sola = estado.piezas.length === 1 && estado.piezas[0].copias === 1;
    if (noEntra && sola) avisos.push(textoNoEntra(imp));
    $('ajustarCama').hidden = !noEntra;
    const { triangulos } = estado.vista;
    if (triangulos > maxTriangulos()) avisos.push(textoPesado(triangulos));
    anunciar($('avisoModelo'), avisos.join('<br><br>'), true);
}

/** "Apoyar cara": el usuario toca una cara y el modelo gira para que quede sobre la cama. */
function activarElegirCara(ctx, activo) {
    estado.eligiendoCara = activo;
    $('apoyarCara').classList.toggle('activo', activo);
    $('apoyarCara').setAttribute('aria-pressed', String(activo));
    if (activo) ctx.alActivarCara?.();
    $('apoyarCara').textContent = activo ? 'Cancelar' : 'Apoyar cara';
    $('ayudaCara').hidden = !activo;
    ctx.visor()?.elegirCara(activo, normal => {
        // La normal viene en coordenadas de la impresora; la escala es uniforme, así
        // que alcanza con agregar la rotación que la lleva hacia abajo.
        estado.rotacion = transformar.multiplicar(transformar.rotacionQueApoya(normal), estado.rotacion);
        activarElegirCara(ctx, false);
        aplicar(ctx);
    });
}

/** "Achicar para que entre": la escala más grande que entra en la cama (con un 2 % de margen). */
function ajustarACama(ctx) {
    const d = buscarImpresora(estado.impresoraId).dispositivo;
    const t = tamanoActual(ctx);
    const factor = Math.min(d.bedWidth / t.x, d.bedDepth / t.y, d.maxHeight / t.z) * 0.98;
    ponerEscala(ctx, Math.floor(estado.escala * factor * 100) / 100);
}

/** Vuelve a rotación identidad y escala 100 %. */
function restablecer(ctx) {
    estado.rotacion = transformar.identidad();
    estado.escala = 1;
    activarElegirCara(ctx, false);
    aplicar(ctx);
}

/** Cablea escala, rotaciones, "ajustar a la cama", "restablecer" y "apoyar cara". */
function conectar(ctx) {
    $('escalaMenos').onclick = () => ponerEscala(ctx, Math.round(estado.escala * 10 - 1) / 10 || 0.05);
    $('escalaMas').onclick = () => ponerEscala(ctx, Math.round(estado.escala * 10 + 1) / 10);
    $('escala').addEventListener('change', e => ponerEscala(ctx, Number(e.target.value) / 100));
    document.querySelectorAll('[data-rotar]').forEach(b => {
        b.onclick = () => {
            estado.rotacion = transformar.multiplicar(transformar.rotacion90(b.dataset.rotar), estado.rotacion);
            aplicar(ctx);
        };
    });
    $('ajustarCama').onclick = () => ajustarACama(ctx);
    $('restablecerModelo').onclick = () => restablecer(ctx);
    $('apoyarCara').onclick = () => activarElegirCara(ctx, !estado.eligiendoCara);
}

/** ¿El tamaño `t` no entra en la cama del dispositivo `d`? */
function noEntraEnCama(t, d) {
    return t.x > d.bedWidth || t.y > d.bedDepth || t.z > d.maxHeight;
}

/** Texto (HTML) del aviso "No entra en la <impresora>". */
function textoNoEntra(imp) {
    const d = imp.dispositivo;
    return (
        `<b>No entra en la ${imp.nombre}</b> (${d.bedWidth} × ${d.bedDepth} × ${d.maxHeight} mm). ` +
        'Rotalo o achicalo con los botones de abajo.'
    );
}

/** Texto (HTML) del aviso "Modelo pesado" para un modelo de `triangulos` triángulos. */
function textoPesado(triangulos) {
    const max = maxTriangulos();
    return (
        `<b>Modelo pesado:</b> tiene ${formato.triangulos(triangulos)}. Para que el celu no se quede ` +
        `sin memoria, antes de laminar lo vamos a simplificar a unos ${formato.triangulos(max)}. ` +
        'Se pueden perder detalles muy finos.'
    );
}
