// Paso 2 de la app: calidad, material, soportes, "Personalizar" (relleno, paredes, adhesión) y Avanzado.
// Flujo: main.js llama una vez a iniciarPaso2() (cablea los manejadores y crea la sección Avanzado);
// dibujarOpciones() redibuja toda la pantalla desde `estado` y la usan impresoras (vía main) y el arranque;
// resumenPersonal() la usa el paso 4. Siempre se lee `estado.x` en el momento (`estado.personal` se reasigna).
// No toca el DOM al importarse.

import { estado, valoresActuales, guardarPreferencias } from './estado.js';
import { dibujarImpresoraElegida } from './impresoras.js';
import { acomodarPiezas } from './acomodo.js';
import { $ } from './util-dom.js';
import { crearAvanzado } from './avanzado.js';
import { crearCambios } from './cambios.js';
import * as materialesUI from './materiales.js';
import { iconoRelleno } from './iconos-relleno.js';
import { buscarImpresora, opciones, valoresDeCalidad } from '../perfiles/perfiles.js';
import { armarTorre } from '../perfiles/torres.js';

/** Sección Avanzado; se crea dentro de iniciarPaso2. */
let avanzado = null;
/** Sección Cambios por altura; se crea dentro de iniciarPaso2. */
let cambios = null;

/** HTML de una opción de radio.
 *  @param {string} grupo @param {string} valor @param {string} titulo @param {string} detalle
 *  @param {boolean} marcado @returns {string} */
function opcion(grupo, valor, titulo, detalle, marcado) {
    return `<label class="opcion">
        <input type="radio" name="${grupo}" value="${valor}" ${marcado ? 'checked' : ''}>
        <span><b>${titulo}</b>${detalle ? `<br><small>${detalle}</small>` : ''}</span>
    </label>`;
}

/** Redibuja todo el paso 2 desde `estado`: tarjeta de impresora, calidades, materiales,
 *  tarjeta del material, soportes, Personalizar y Avanzado. @returns {void} */
export function dibujarOpciones() {
    const imp = buscarImpresora(estado.impresoraId);
    dibujarImpresoraElegida();
    $('calidades').innerHTML = Object.entries(imp.calidades)
        .map(([id, c]) => opcion('calidad', id, c.nombre, c.descripcion, id === estado.calidad))
        .join('');
    $('materiales').innerHTML = materialesUI
        .listaMateriales()
        .map(([id, m]) =>
            opcion(
                'material',
                id,
                m.nombre,
                `${m.proceso.outputTemp}&nbsp;°C · cama ${m.proceso.outputBedTemp}&nbsp;°C`,
                id === estado.material,
            ),
        )
        .join('');
    dibujarMaterial();
    $('soportes').checked = estado.soportes;
    dibujarPersonalizar();
    avanzado?.dibujar();
    cambios?.dibujar();
    dibujarTorre();
    dibujarAvisoEntran();
}

/** Aviso del paso 2 si con la impresora elegida no entran todas las piezas (varias piezas o copias): lo dice
 *  junto a la tarjeta de impresora y deshabilita Laminar. Con una pieza y una copia no cambia nada (el aviso es el
 *  de ajuste-modelo en el paso 1 y el error del paso 3). Re-acomoda desde `estado`, así que sirve también al
 *  entrar al paso. @returns {void} */
function dibujarAvisoEntran() {
    const sola = estado.piezas.length === 1 && estado.piezas[0].copias === 1;
    const { entra, fuera } = acomodarPiezas();
    const bloquea = !entra && !sola;
    const texto = bloquea
        ? `Con esta impresora no entran todas las piezas (${fuera.length} ${fuera.length === 1 ? 'copia queda afuera' : 'copias quedan afuera'}): volvé al paso 1 para achicarlas, bajar copias o quitar piezas.`
        : '';
    // La región viva (role=status) queda siempre en el DOM y sólo cambia su texto; el botón va afuera.
    if ($('avisoEntranPaso2').textContent !== texto) $('avisoEntranPaso2').textContent = texto; // no re-anunciar
    $('irPaso1').hidden = !bloquea;
    $('laminar').disabled = bloquea;
}

/** Línea informativa de la torre de calibración cargada; sus valores pisan Avanzado, el relleno y los cambios.
 *  @returns {void} */
function dibujarTorre() {
    const t = estado.torre;
    $('lineaTorre').hidden = !t;
    $('cambiosAltura').hidden = !!t;
    if (!t) return;
    const tipo = t.tipo === 'temperatura' ? 'temperatura' : 'retracción';
    $('lineaTorre').textContent =
        `Torre de ${tipo}: ${t.resumen} (de abajo hacia arriba). La torre fija esos valores, el relleno y los ` +
        'cambios por altura, y no usa soportes. Los valores salieron de la impresora y el material que había al ' +
        'crearla: si los cambiás, creá la torre de nuevo. Coasting, wipe, z-hop y velocidad de Avanzado siguen ' +
        `aplicando.${avisoTorre(t)}`;
}

/** Avisos de la torre cargada (del material, o si la impresora elegida ya no aguanta sus temperaturas).
 *  @param {object} t torre @returns {string} texto con un espacio adelante, o '' si no hay avisos */
function avisoTorre(t) {
    const textos = t.aviso ? [t.aviso] : [];
    try {
        const hotendMax = buscarImpresora(estado.impresoraId).limites?.hotendMax;
        armarTorre({ tipo: t.tipo, valores: t.bloques.map(b => b.valor), altoBloqueMm: t.altoBloqueMm, hotendMax });
    } catch (err) {
        textos.push(`${err.message} Creá la torre de nuevo para esta impresora.`);
    }
    return textos.map(x => ` ${x}`).join('');
}

/** Tarjeta del material elegido (descripción, avisos y precio del rollo). @returns {void} */
function dibujarMaterial() {
    const { impresoraId, calidad, material, soportes, personal } = estado;
    materialesUI.dibujarTarjeta($('tarjetaMaterial'), { impresoraId, calidad, material, soportes, personal });
}

/** Guarda un cambio de Personalizar. Si coincide con el valor de la calidad, se borra el
 *  "personalizado" (así, si después cambia la calidad, ese valor la sigue).
 *  @param {string} clave @param {string|number} valor @returns {void} */
function cambiarPersonal(clave, valor) {
    const base = valoresDeCalidad(estado.impresoraId, estado.calidad);
    if (base[clave] === valor) delete estado.personal[clave];
    else estado.personal[clave] = valor;
    dibujarPersonalizar();
    guardarPreferencias();
}

/** Dibuja patrones, densidad, atajos, contadores, adhesiones y el título de "Personalizar".
 *  @returns {void} */
function dibujarPersonalizar() {
    const v = valoresActuales();
    $('patrones').innerHTML = Object.entries(opciones.patrones)
        .filter(([id]) => !id.startsWith('_'))
        .map(
            ([id, p]) =>
                `<label class="patron" title="${p.descripcion}">
            <input type="radio" name="patron" value="${id}" ${id === v.patron ? 'checked' : ''}>
            ${iconoRelleno(id)}<span>${p.nombre}</span>
        </label>`,
        )
        .join('');
    $('densidad').value = Math.round(v.densidad * 100);
    $('densidadValor').textContent = `${Math.round(v.densidad * 100)} %`;
    $('atajosDensidad').innerHTML = opciones.densidades
        .map(
            d =>
                `<button type="button" class="atajo ${Math.abs(d.valor - v.densidad) < 0.001 ? 'activo' : ''}" data-densidad="${d.valor}">
            ${d.nombre} <small>${Math.round(d.valor * 100)} %</small></button>`,
        )
        .join('');
    document.querySelectorAll('#personalizar .contador').forEach(c => {
        c.querySelector('output').textContent = v[c.dataset.clave];
    });
    $('adhesiones').innerHTML = Object.entries(opciones.adhesiones)
        .map(([id, a]) => opcion('adhesion', id, a.nombre, a.descripcion, id === v.adhesion))
        .join('');

    const cambiados = Object.keys(estado.personal).length;
    $('personalizar').querySelector('summary').textContent = cambiados
        ? `Personalizado: ${resumenPersonal(v)}`
        : 'Personalizar relleno, paredes y adhesión';
    $('restablecer').hidden = !cambiados;
}

/** Texto corto del relleno y la adhesión ("Cúbico 15 % · 3 paredes · Borde").
 *  @param {{patron:string, densidad:number, paredes:number, adhesion:string}} v
 *  @returns {string} */
export function resumenPersonal(v) {
    return (
        `${opciones.patrones[v.patron]?.nombre || v.patron} ${Math.round(v.densidad * 100)} % · ` +
        `${v.paredes} paredes · ${opciones.adhesiones[v.adhesion]?.nombre}`
    );
}

/** Cablea densidad (input), atajos, contadores de paredes y #restablecer. @returns {void} */
function conectarPersonalizar() {
    $('densidad').addEventListener('input', e => {
        $('densidadValor').textContent = `${e.target.value} %`;
    });
    $('atajosDensidad').onclick = e => {
        const b = e.target.closest('[data-densidad]');
        if (b) cambiarPersonal('densidad', Number(b.dataset.densidad));
    };
    document.querySelectorAll('#personalizar .contador').forEach(c =>
        c.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            const clave = c.dataset.clave;
            const nuevo = Math.min(
                Number(c.dataset.max),
                Math.max(Number(c.dataset.min), valoresActuales()[clave] + Number(b.dataset.delta)),
            );
            cambiarPersonal(clave, nuevo);
        }),
    );
    $('restablecer').onclick = () => {
        estado.personal = {};
        dibujarPersonalizar();
        guardarPreferencias();
    };
}

/** Cablea el `change` de la pantalla: calidad, material, soportes, patrón, adhesión y densidad.
 *  @returns {void} */
function conectarEleccion() {
    document.querySelector('[data-paso="2"].pantalla').addEventListener('change', e => {
        const { name, value, checked } = e.target;
        if (name === 'calidad') {
            estado.calidad = value;
            dibujarPersonalizar();
        }
        if (name === 'material') {
            estado.material = value;
            dibujarMaterial();
        }
        if (e.target.id === 'soportes') estado.soportes = checked;
        if (name === 'patron') return cambiarPersonal('patron', value);
        if (name === 'adhesion') return cambiarPersonal('adhesion', value);
        if (e.target.id === 'densidad') return cambiarPersonal('densidad', Number(value) / 100);
        guardarPreferencias();
    });
}

/** Cablea los cambios de calidad/material/soportes/patrón/adhesión/densidad, los contadores,
 *  los atajos de densidad y #restablecer; crea la sección Avanzado (crearAvanzado con
 *  { estado, alCambiar: guardarPreferencias }). `irAPaso1` es el callback de
 *  "Ir al paso 1" (lo inyecta main; paso2 no importa navegacion). Llamar una vez.
 *  @param {{irAPaso1?: () => void}} [cb] @returns {void} */
export function iniciarPaso2({ irAPaso1 } = {}) {
    $('irPaso1').onclick = () => irAPaso1?.();
    avanzado = crearAvanzado({
        estado,
        alCambiar: () => {
            guardarPreferencias();
            cambios?.dibujar();
        },
    });
    cambios = crearCambios({ estado, alCambiar: () => {} });
    conectarPersonalizar();
    conectarEleccion();
}
