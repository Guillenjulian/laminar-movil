// Carga los perfiles (impresoras y materiales) y arma la configuración final
// que recibe el motor. Para sumar una impresora alcanza con agregar un JSON
// en src/perfiles/impresoras/ (se detecta solo, ver LEEME.md).
//
// Hay tres tipos de impresora (campo `estado`):
//   revisado  -> perfiles hechos a mano en src/perfiles/impresoras/*.json
//   importado -> traídos de Kiri:Moto (src/perfiles/impresoras/kiri/), sin revisar
//   propio    -> creados por el usuario con "Mi impresora" (guardados en el celu)

import materiales from './materiales.json';
import opciones from './opciones.json';
import { perfilPropio } from './generico.js';

// Vite junta todos los JSON de las carpetas en tiempo de build.
const archivos = import.meta.glob('./impresoras/**/*.json', { eager: true, import: 'default' });
const incluidas = Object.values(archivos).map(i => ({ estado: 'revisado', ...i }));

export const IMPRESORA_INICIAL = 'creality-ender-3-v3-se';
const ORDEN = { propio: 0, revisado: 1, importado: 2 };

let propias = [];

// Las impresoras del usuario (datos del formulario, ver generico.js).
export function ponerImpresorasPropias(lista) {
    propias = lista.map(perfilPropio);
}

// Todas: primero las propias, después las revisadas y al final las importadas.
export function listaImpresoras() {
    return [...propias, ...incluidas].sort((a, b) =>
        ORDEN[a.estado] - ORDEN[b.estado] || (a.marca || '').localeCompare(b.marca || '') || a.nombre.localeCompare(b.nombre));
}

export { materiales, opciones };

export function existeImpresora(id) {
    return listaImpresoras().some(i => i.id === id);
}

// G-code que se inserta para pausar en una capa (cambio de filamento).
export function lineasPausa(imp) {
    return imp.pausa?.length ? imp.pausa : ['M600'];
}

export function buscarImpresora(id) {
    const lista = listaImpresoras();
    return lista.find(i => i.id === id) || lista.find(i => i.id === IMPRESORA_INICIAL) || lista[0];
}

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

// Valores que trae la calidad elegida (para mostrarlos en "Personalizar").
export function valoresDeCalidad(impresoraId, calidad) {
    const imp = buscarImpresora(impresoraId);
    const p = { ...imp.proceso, ...(imp.calidades[calidad] || imp.calidades.normal).proceso };
    return {
        patron: p.sliceFillType || 'hex',
        densidad: p.sliceFillSparse ?? 0.2,
        paredes: p.sliceShells ?? 3,
        arriba: p.sliceTopLayers ?? 3,
        abajo: p.sliceBottomLayers ?? 3,
        adhesion: imp.adhesion || 'falda',
    };
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

// Valores "de fábrica" de Avanzado para la impresora, calidad y material
// elegidos (lo que se usa si el usuario no toca nada).
export function valoresDeAvanzado(impresoraId, calidad, material) {
    const imp = buscarImpresora(impresoraId);
    const p = { ...imp.proceso, ...(imp.calidades[calidad] || imp.calidades.normal).proceso };
    const mat = (materiales[material] || materiales.pla).proceso;
    const { hotendMax = Infinity, camaMax = Infinity } = imp.limites || {};
    return {
        jarron: false,
        alturaVariable: false,
        costura: 'ultima',
        // si el perfil no las define, valen las de Kiri (defaults.js)
        retraccion: p.outputRetractDist ?? 1.5,
        zHop: p.zHopDistance ?? 0.2,
        coasting: p.outputCoastDist ?? 0,
        wipe: p.outputRetractWipe ?? 0,
        compAgujeros: 0,
        compExterior: 0,
        velocidad: 100,
        tempBoquilla: Math.min(mat.outputTemp, hotendMax),
        tempCama: Math.min(mat.outputBedTemp, camaMax),
        ventilador: Math.round((mat.outputFanSpeed ?? 255) * 100 / 255),
    };
}

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
    if (av.ventilador !== undefined) p.outputFanSpeed = Math.round(av.ventilador * 255 / 100); // 50 % -> 128
    return p;
}

// Combina, en este orden (lo último gana):
//   proceso base de la impresora → calidad → material → adhesión → personalizado → avanzado → extras
// y recorta las temperaturas a los límites de la impresora.
// Devuelve { dispositivo, proceso, avisos }.
export function armarConfiguracion({ impresoraId, calidad = 'normal', material = 'pla', soportes = false, personal = {}, extras = {} }) {
    const imp = buscarImpresora(impresoraId);
    const cal = imp.calidades[calidad] || imp.calidades.normal;
    const mat = materiales[material] || materiales.pla;
    const adh = opciones.adhesiones[personal.adhesion || imp.adhesion || 'falda'];

    const dispositivo = sinComentarios(imp.dispositivo);
    const combinado = {
        ...imp.proceso, ...cal.proceso, ...mat.proceso, ...adh.proceso,
        ...personalAProceso(personal),
    };
    const proceso = sinComentarios({
        ...combinado,
        ...avanzadoAProceso(personal.avanzado, combinado, dispositivo),
        ...(soportes ? { sliceSupportType: 'automatic' } : {}),
        ...extras,
    });
    const avisos = [];

    const { hotendMax, camaMax } = imp.limites || {};
    for (const clave of ['outputTemp', 'firstLayerNozzleTemp']) {
        if (hotendMax && proceso[clave] > hotendMax) {
            avisos.push(`La boquilla se limitó a ${hotendMax} °C (máximo de la ${imp.nombre}).`);
            proceso[clave] = hotendMax;
        }
    }
    for (const clave of ['outputBedTemp', 'firstLayerBedTemp']) {
        if (camaMax && proceso[clave] > camaMax) {
            avisos.push(`La cama se limitó a ${camaMax} °C (máximo de la ${imp.nombre}).`);
            proceso[clave] = camaMax;
        }
    }

    proceso.processName = `${imp.nombre} · ${cal.nombre} · ${mat.nombre}`;
    return { dispositivo, proceso, avisos };
}
