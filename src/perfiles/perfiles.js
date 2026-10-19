// Materiales y opciones, y la configuración final que recibe el motor. El catálogo de
// impresoras vive en catalogo.js y lo que se lee de un perfil en valores.js; se re-exportan desde acá,
// así que los demás módulos siguen importando todo de perfiles.js.

import materiales from './materiales.json';
import opciones from './opciones.json';
import { buscarImpresora } from './catalogo.js';
import { esBowden } from './valores.js';
import { validarCambios, cambiosARangos } from './cambios.js';

export {
    IMPRESORA_INICIAL,
    ponerImpresorasPropias,
    listaImpresoras,
    idVigente,
    existeImpresora,
    buscarImpresora,
} from './catalogo.js';
export { lineasPausa, valoresDeCalidad, esBowden, valoresDeAvanzado } from './valores.js';
export { materiales, opciones };

// Saca las claves que empiezan con "_" (son comentarios dentro del JSON).
function sinComentarios(obj) {
    if (Array.isArray(obj)) return obj.map(sinComentarios);
    if (obj && typeof obj === 'object') {
        const limpio = {};
        for (const [k, v] of Object.entries(obj)) {
            if (!k.startsWith('_')) limpio[k] = sinComentarios(v);
        }
        return limpio;
    }
    return obj;
}

// Pasa las opciones de "Personalizar" a claves de Kiri. Sólo las que el
// usuario cambió: el resto queda como lo define la calidad.
// Las de "Avanzado" vienen aparte en `personal.avanzado` (ver avanzadoAProceso).
function personalAProceso(personal = {}) {
    const proceso = {};
    if (personal.patron) proceso.sliceFillType = personal.patron;
    if (personal.densidad !== undefined) proceso.sliceFillSparse = personal.densidad;
    if (personal.paredes !== undefined) proceso.sliceShells = personal.paredes;
    if (personal.arriba !== undefined) proceso.sliceTopLayers = personal.arriba;
    if (personal.abajo !== undefined) proceso.sliceBottomLayers = personal.abajo;
    return proceso;
}

// --- Avanzado ---

// Dónde empieza cada capa (la "costura"). Son los valores de `sliceLayerStart`
// que entiende Kiri (vendor/kiri/src/kiri/mode/fdm/work/prepare.js):
//   last     -> sigue desde donde terminó la capa anterior (lo de Kiri por defecto)
//   position -> lo más cerca posible de un punto de la cama (lo usamos para "Atrás")
//   random   -> un lugar al azar en cada capa
//   spiral   -> el arranque va girando alrededor de la pieza a medida que sube
export const COSTURAS = {
    ultima: { nombre: 'Donde terminó la anterior', descripcion: 'Viaja menos. La marca queda repartida.' },
    atras: { nombre: 'Atrás', descripcion: 'Todas en el fondo de la cama: la marca queda en una línea atrás.' },
    azar: { nombre: 'Al azar', descripcion: 'Cada capa en otro lugar: no se nota una línea.' },
    giro: { nombre: 'Girando', descripcion: 'El arranque da vueltas alrededor de la pieza a medida que sube.' },
};

// Pasa lo que el usuario cambió en "Avanzado" a claves de Kiri. Se aplica
// sobre el proceso ya combinado (la velocidad escala la de la calidad y la
// altura variable usa la altura de capa como máximo). Lo que no está en
// `av` no se toca.
function avanzadoAProceso(av = {}, proceso, dispositivo) {
    const p = {};
    if (av.jarron) {
        // Kiri reconoce el modo jarrón por el "patrón de relleno" 'vase': saca los
        // agujeros, el relleno y las tapas (deja sólo el fondo). Una sola pared y
        // arranque donde terminó la capa anterior, así la espiral sale continua
        // (la Z que sube de a poco la agrega src/motor/espiral.js).
        p.sliceFillType = 'vase';
        p.sliceShells = 1;
        p.sliceTopLayers = 0;
        p.sliceFillSparse = 0;
        p.sliceLayerStart = 'last';
    }
    if (av.alturaVariable && !av.jarron) {
        // (En modo jarrón no: la espiral necesita capas parejas.)
        // Kiri corta más fino donde la pieza tiene curvas y usa la altura de capa
        // de la calidad como máximo. Sin un mínimo > 0 no hace nada: usamos el
        // 20 % de la boquilla (0,08 mm con 0,4), nunca más que la altura de capa.
        const boquilla = dispositivo.extruders?.[0]?.extNozzle || 0.4;
        p.sliceAdaptive = true;
        p.sliceMinHeight = +Math.min(proceso.sliceHeight, Math.max(0.04, boquilla * 0.2)).toFixed(2);
    }
    if (av.costura && !av.jarron) {
        const kiri = { ultima: 'last', atras: 'position', azar: 'random', giro: 'spiral' };
        p.sliceLayerStart = kiri[av.costura] || 'last';
        if (av.costura === 'atras') {
            // Coordenadas como las del G-code: con origen en el centro, (0, fondo/2);
            // si no, (medio, fondo). Y más grande = más al fondo de la cama.
            const centro = dispositivo.originCenter || dispositivo.bedRound;
            p.sliceLayerStartX = centro ? 0 : dispositivo.bedWidth / 2;
            p.sliceLayerStartY = centro ? dispositivo.bedDepth / 2 : dispositivo.bedDepth;
        }
    }
    if (av.retraccion !== undefined) p.outputRetractDist = av.retraccion;
    if (av.zHop !== undefined) p.zHopDistance = av.zHop;
    if (av.coasting !== undefined) p.outputCoastDist = av.coasting;
    if (av.wipe !== undefined) p.outputRetractWipe = av.wipe;
    // Compensación (mm, en total, no por lado). En Kiri sliceCompInner > 0 agranda
    // los agujeros y sliceCompOuter > 0 ACHICA el contorno (lo desplaza hacia
    // adentro). Acá las dos son "+ agranda", así que la de afuera va con el signo cambiado.
    if (av.compAgujeros !== undefined) p.sliceCompInner = av.compAgujeros;
    if (av.compExterior !== undefined) p.sliceCompOuter = -av.compExterior;
    if (av.velocidad !== undefined && av.velocidad !== 100) {
        const f = av.velocidad / 100;
        for (const clave of ['outputFeedrate', 'outputFinishrate', 'firstLayerRate', 'firstLayerFillRate']) {
            if (proceso[clave] > 0) p[clave] = Math.round(proceso[clave] * f);
        }
    }
    // Temperaturas: la manual vale también para la primera capa. Los límites de
    // la impresora se aplican después, en armarConfiguracion.
    if (av.tempBoquilla !== undefined) p.outputTemp = p.firstLayerNozzleTemp = av.tempBoquilla;
    if (av.tempCama !== undefined) p.outputBedTemp = p.firstLayerBedTemp = av.tempCama;
    if (av.ventilador !== undefined) p.outputFanSpeed = Math.round((av.ventilador * 255) / 100); // 50 % -> 128
    return p;
}

/**
 * Recorta la temperatura de boquilla de `campos` (el proceso o los campos de un rango) a `hotendMax`.
 * El aviso sale una sola vez aunque recorten varios valores.
 * @param {object} campos claves de Kiri (`outputTemp`, `firstLayerNozzleTemp`); se modifica
 * @param {object} imp perfil de la impresora (`nombre`, `limites`)
 * @param {string[]} avisos avisos de armarConfiguracion
 */
function limitarBoquilla(campos, imp, avisos) {
    const { hotendMax } = imp.limites || {};
    const aviso = `La boquilla se limitó a ${hotendMax} °C (máximo de la ${imp.nombre}).`;
    for (const clave of ['outputTemp', 'firstLayerNozzleTemp']) {
        if (!hotendMax || !(campos[clave] > hotendMax)) continue;
        if (!avisos.includes(aviso)) avisos.push(aviso);
        campos[clave] = hotendMax;
    }
}

/**
 * Avisos del material: el propio (ej. "necesita gabinete") y, para los que no se llevan bien con
 * Bowden (TPU), si la impresora retrae más de 2 mm.
 * @param {object} mat material (`aviso`, `avisoBowden`)
 * @param {number | undefined} retraccion retracción de la impresora y la calidad, en mm
 * @param {string[]} avisos avisos de armarConfiguracion
 */
function avisosDeMaterial(mat, retraccion, avisos) {
    if (mat.aviso) avisos.push(mat.aviso);
    if (mat.avisoBowden && esBowden(retraccion)) avisos.push(mat.avisoBowden);
}

/**
 * Recorta las temperaturas del proceso final (boquilla y cama) a los límites de la impresora y avisa.
 * @param {object} proceso proceso final; se modifica
 * @param {object} imp perfil de la impresora (`nombre`, `limites`)
 * @param {string[]} avisos avisos de armarConfiguracion
 */
function limitarTemperaturas(proceso, imp, avisos) {
    limitarBoquilla(proceso, imp, avisos);
    const { camaMax } = imp.limites || {};
    for (const clave of ['outputBedTemp', 'firstLayerBedTemp']) {
        if (camaMax && proceso[clave] > camaMax) {
            avisos.push(`La cama se limitó a ${camaMax} °C (máximo de la ${imp.nombre}).`);
            proceso[clave] = camaMax;
        }
    }
}

/**
 * Cambios por altura (ADR 0002): los valida, los pasa a `proceso.ranges` de Kiri y recorta la temperatura de
 * cada rango a `hotendMax`. Con altura variable (sin jarrón) los ignora; en jarrón descarta relleno y patrón.
 * Sin cambios no toca `proceso`. Los avisos se agregan a `avisos`.
 * @param {object} proceso proceso final (se le agrega `ranges`)
 * @param {object[]} cambios cambios por altura en mm (ver cambios.js)
 * @param {object} imp perfil de la impresora (`nombre`, `limites`)
 * @param {object | undefined} av opciones de Avanzado (`jarron`, `alturaVariable`)
 * @param {string[]} avisos avisos de armarConfiguracion
 */
function aplicarCambios(proceso, cambios, imp, av = {}, avisos) {
    if (!cambios?.length) return;
    const { cambios: ok, errores } = validarCambios(cambios, { patrones: Object.keys(opciones.patrones) });
    avisos.push(...errores);
    if (av.alturaVariable && !av.jarron) {
        avisos.push('Los cambios por altura no funcionan con altura de capa variable: se ignoraron.');
        return;
    }
    let lista = ok;
    if (av.jarron) {
        const conRelleno = ok.some(c => 'relleno' in c || 'patron' in c);
        lista = ok.map(({ relleno: _r, patron: _p, ...resto }) => resto);
        if (conRelleno) avisos.push('En modo jarrón el relleno no se cambia por altura.');
    }
    const ranges = cambiosARangos(lista, proceso);
    for (const r of ranges) limitarBoquilla(r.fields, imp, avisos);
    if (ranges.length) proceso.ranges = ranges;
}

// Combina, en este orden (lo último gana):
//   proceso base de la impresora → calidad → material → adhesión → personalizado → avanzado → soportes → extras
//   → cambios por altura (se agregan aparte, como `proceso.ranges`)
// y recorta las temperaturas a los límites de la impresora.
// Devuelve { dispositivo, proceso, avisos }.
export function armarConfiguracion({
    impresoraId,
    calidad = 'normal',
    material = 'pla',
    soportes = false,
    personal = {},
    extras = {},
    cambios = [],
}) {
    const imp = buscarImpresora(impresoraId);
    const cal = imp.calidades[calidad] || imp.calidades.normal;
    const mat = materiales[material] || materiales.pla;
    const adh = opciones.adhesiones[personal.adhesion || imp.adhesion || 'falda'];

    const dispositivo = sinComentarios(imp.dispositivo);
    const combinado = {
        ...imp.proceso,
        ...cal.proceso,
        ...mat.proceso,
        ...adh.proceso,
        ...personalAProceso(personal),
    };
    const proceso = sinComentarios({
        ...combinado,
        ...avanzadoAProceso(personal.avanzado, combinado, dispositivo),
        ...(soportes ? { sliceSupportType: 'automatic' } : {}),
        ...extras,
    });
    const avisos = [];
    aplicarCambios(proceso, cambios, imp, personal.avanzado, avisos);

    avisosDeMaterial(mat, { ...imp.proceso, ...cal.proceso }.outputRetractDist, avisos);
    limitarTemperaturas(proceso, imp, avisos);

    proceso.processName = `${imp.nombre} · ${cal.nombre} · ${mat.nombre}`;
    return { dispositivo, proceso, avisos };
}
