// Cambios por altura (ADR 0002): modelo de datos, validación y conversión a rangos de Kiri.
// Responsabilidad: funciones puras, sin DOM y sin importar nada de src/ (las opciones llegan por parámetro).
// Flujo: la interfaz arma una lista de Cambio (mm) -> validarCambios la sanea y ordena -> cambiosARangos la
// convierte en `process.ranges` de Kiri (índices de capa); resumenCambios y avisosPostLaminado dan los textos.
// Cambio = { desdeMm, hastaMm?, relleno?, patron?, tempBoquilla?, velocidad?, ventilador?, retraccion? }

const MAX_CAMBIOS = 8;
const MAX_MM = 1000;
const HASTA_EL_FINAL = 1e9;
const EPS = 1e-6;
// Propiedad numérica -> [mínimo, máximo, nombre para el usuario]
export const LIMITES = {
    relleno: [0, 1, 'relleno'],
    tempBoquilla: [150, 300, 'temperatura'],
    velocidad: [50, 150, 'velocidad'],
    ventilador: [0, 100, 'ventilador'],
    retraccion: [0, 10, 'retracción'],
};
const num = n => String(+n.toFixed(2)).replace('.', ',');
const esNumero = v => typeof v === 'number' && Number.isFinite(v);
// Cómo se escribe cada propiedad en el resumen
const TEXTO = {
    relleno: v => `relleno ${num(v * 100)} %`,
    patron: v => `patrón ${v}`,
    tempBoquilla: v => `${num(v)} °C`,
    velocidad: v => `velocidad ${num(v)} %`,
    ventilador: v => `ventilador ${num(v)} %`,
    retraccion: v => `retracción ${num(v)} mm`,
};

// Devuelve { cambio } saneado o { error } con el motivo en castellano.
function sanear(c, patrones) {
    if (!esNumero(c.desdeMm) || c.desdeMm <= 0 || c.desdeMm > MAX_MM) {
        return { error: `La altura "desde" tiene que estar entre 0 y ${MAX_MM} mm.` };
    }
    const nuevo = { desdeMm: c.desdeMm };
    const donde = `El cambio desde ${num(c.desdeMm)} mm`;
    if (c.hastaMm != null) {
        if (!esNumero(c.hastaMm) || c.hastaMm <= c.desdeMm) return { error: `${donde}: "hasta" tiene que ser mayor.` };
        nuevo.hastaMm = c.hastaMm;
    }
    for (const [clave, [min, max, nombre]] of Object.entries(LIMITES)) {
        if (c[clave] == null) continue;
        if (!esNumero(c[clave]) || c[clave] < min || c[clave] > max) {
            return { error: `${donde}: ${nombre} fuera de rango (${min} a ${max}).` };
        }
        nuevo[clave] = c[clave];
    }
    if (c.patron != null) {
        if (typeof c.patron !== 'string' || !c.patron || (patrones && !patrones.includes(c.patron))) {
            return { error: `${donde}: patrón de relleno desconocido.` };
        }
        nuevo.patron = c.patron;
    }
    if (Object.keys(TEXTO).every(p => nuevo[p] === undefined)) return { error: `${donde} no cambia nada.` };
    return { cambio: nuevo };
}

/**
 * Sanea y ordena una lista de cambios. Descarta en silencio lo que no es un objeto; los problemas "de usuario"
 * (fuera de rango, sin propiedades, solapes, más de 8) se descartan y se informan en `errores`.
 * Un cambio sin `hastaMm` queda cortado en el `desdeMm` del siguiente. No lanza errores.
 * @param {unknown} lista cambios en mm (se espera un arreglo; otra cosa da resultado vacío)
 * @param {{ patrones?: string[] }} [contexto] claves de patrón válidas (si falta no se revisa la clave)
 * @returns {{ cambios: object[], errores: string[] }} cambios ordenados por `desdeMm` y avisos en castellano
 */
export function validarCambios(lista, contexto = {}) {
    const errores = [];
    const buenos = [];
    for (const c of Array.isArray(lista) ? lista : []) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        const r = sanear(c, contexto?.patrones);
        if (r.error) errores.push(r.error);
        else buenos.push(r.cambio);
    }
    buenos.sort((a, b) => a.desdeMm - b.desdeMm);
    if (buenos.length > MAX_CAMBIOS) {
        errores.push(`Hay demasiados cambios: el máximo es ${MAX_CAMBIOS}.`);
        buenos.length = MAX_CAMBIOS;
    }
    const cambios = [];
    for (const c of buenos) {
        const previo = cambios[cambios.length - 1];
        if (previo && (previo.desdeMm === c.desdeMm || (previo.hastaMm !== undefined && previo.hastaMm > c.desdeMm))) {
            errores.push(`El cambio desde ${num(c.desdeMm)} mm se solapa con el anterior.`);
            continue;
        }
        if (previo && previo.hastaMm === undefined) previo.hastaMm = c.desdeMm;
        cambios.push(c);
    }
    return { cambios, errores };
}

// Propiedades de un Cambio -> claves de proceso de Kiri.
function camposDe(c, base) {
    const f = {};
    if (c.relleno !== undefined) f.sliceFillSparse = c.relleno;
    if (c.patron !== undefined) f.sliceFillType = c.patron;
    if (c.tempBoquilla !== undefined) f.outputTemp = c.tempBoquilla;
    if (c.ventilador !== undefined) f.outputFanSpeed = Math.round((c.ventilador * 255) / 100);
    if (c.retraccion !== undefined) f.outputRetractDist = c.retraccion;
    for (const k of c.velocidad === undefined ? [] : ['outputFeedrate', 'outputFinishrate']) {
        if (esNumero(base[k])) f[k] = Math.round((base[k] * c.velocidad) / 100);
    }
    return f;
}

// Primera capa cuyo piso es >= desdeMm (nunca antes de la capa 1).
const capaDesde = (desdeMm, h, h0) => Math.max(1, Math.ceil((desdeMm - h0) / h - EPS) + 1);

/**
 * Convierte cambios (mm) en `process.ranges` de Kiri (índices de capa inclusivos). No valida.
 * Una capa pertenece a un cambio si su PISO cae en [desdeMm, hastaMm): `lo` es la primera capa con piso >= desdeMm
 * (nunca antes de la capa 1) y `hi` es la capa anterior a la primera con piso >= hastaMm. Así los rangos de
 * cambios consecutivos quedan contiguos (hi + 1 = lo siguiente) aunque la altura de capa no divida el borde.
 * Sin `hastaMm`, `hi` vale 1e9. Un rango sin capas o sin campos
 * (por ejemplo velocidad sin velocidad base) se omite en silencio, sin error ni aviso.
 * @param {object[]} cambios cambios ya validados
 * @param {{ sliceHeight:number, firstSliceHeight:number, outputFeedrate?:number, outputFinishrate?:number }} base
 *   proceso final: alturas de capa y velocidades que se escalan
 * @returns {{ lo:number, hi:number, fields:object }[]} rangos en el orden de entrada ([] si no hay nada)
 */
export function cambiosARangos(cambios, base) {
    const { sliceHeight: h, firstSliceHeight: h0 } = base;
    const rangos = [];
    for (const c of cambios || []) {
        const lo = capaDesde(c.desdeMm, h, h0);
        const hi = c.hastaMm === undefined ? HASTA_EL_FINAL : capaDesde(c.hastaMm, h, h0) - 1;
        const fields = camposDe(c, base);
        if (hi >= lo && Object.keys(fields).length) rangos.push({ lo, hi, fields });
    }
    return rangos;
}

/**
 * Resumen de los cambios para la interfaz, uno por cambio separados por "; "
 * (por ejemplo "desde 10 mm: relleno 10 %, 215 °C").
 * @param {object[]} cambios cambios validados
 * @returns {string} texto en castellano ('' si no hay cambios)
 */
export function resumenCambios(cambios) {
    return (cambios || [])
        .map(c => {
            const donde =
                c.hastaMm === undefined ? `desde ${num(c.desdeMm)}` : `de ${num(c.desdeMm)} a ${num(c.hastaMm)}`;
            const props = Object.keys(TEXTO).filter(k => c[k] !== undefined);
            return `${donde} mm: ${props.map(k => TEXTO[k](c[k])).join(', ')}`;
        })
        .join('; ');
}

/**
 * Avisos posteriores al laminado: un cambio que no cae en ninguna capa real de la pieza no hace nada.
 * Con `capa` usa el mismo criterio que `cambiosARangos` (primera capa del cambio vs. última capa de la pieza);
 * sin `capa` compara `desdeMm` con la altura. No lanza: si la altura no es un número devuelve [].
 * @param {object[]} cambios cambios validados
 * @param {number} alturaPiezaMm alto de la pieza laminada, en mm
 * @param {{ sliceHeight:number, firstSliceHeight:number }} [capa] alturas de capa (opcional)
 * @returns {string[]} un aviso por cambio inútil (vacío si todo aplica)
 */
export function avisosPostLaminado(cambios, alturaPiezaMm, capa) {
    if (!esNumero(alturaPiezaMm) || !Array.isArray(cambios)) return [];
    const alto = num(alturaPiezaMm);
    const { sliceHeight: h, firstSliceHeight: h0 } = capa || {};
    const conCapa = esNumero(h) && esNumero(h0) && h > 0;
    const ultima = conCapa ? Math.max(0, Math.ceil((alturaPiezaMm - h0) / h - EPS)) : 0;
    const inutil = c => (conCapa ? capaDesde(c.desdeMm, h, h0) > ultima : c.desdeMm >= alturaPiezaMm - EPS);
    return cambios
        .filter(inutil)
        .map(c => `El cambio desde ${num(c.desdeMm)} mm queda por encima de la pieza (${alto} mm): no se aplicó.`);
}
