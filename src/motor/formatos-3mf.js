// Lector de 3MF: un ZIP con el modelo en XML (normalmente 3D/3dmodel.model).
// Devuelve lo mismo que leerSTL: un Float32Array con los vértices de cada
// triángulo en orden [x1,y1,z1, x2,y2,z2, x3,y3,z3, ...], en milímetros.
//
// Corre dentro de un worker (convertir.worker.js), así que no usamos DOMParser
// (no existe en los workers): el XML se lee con expresiones regulares.
// Sin efectos al importarse. Lo re-exporta formatos.js.
//
//   <model unit="millimeter">
//     <resources>
//       <object id="1"><mesh>
//         <vertices><vertex x="0" y="0" z="0"/>...</vertices>
//         <triangles><triangle v1="0" v2="1" v3="2"/>...</triangles>
//       </mesh></object>
//       <object id="3"><components><component objectid="1" transform="..."/></components></object>
//     </resources>
//     <build><item objectid="1" transform="m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32"/></build>
//   </model>
//
// La matriz es de 3×4 y se aplica como fila: x' = x·m00 + y·m10 + z·m20 + m30.

import JSZip from 'jszip';

// Cuántos milímetros mide cada unidad posible de un 3MF.
const UNIDADES = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

/**
 * Lee un 3MF (ZIP) y devuelve los triángulos de todo lo que hay en <build>.
 * @param {ArrayBuffer|Uint8Array} buffer Contenido del archivo.
 * @returns {Promise<Float32Array>} Vértices de cada triángulo, en mm.
 */
export async function leer3MF(buffer) {
    let zip;
    try {
        zip = await JSZip.loadAsync(buffer);
    } catch {
        throw new Error('El archivo no parece un 3MF válido (no se pudo abrir como ZIP).');
    }
    const xml = await buscarModelo3MF(zip);
    if (!xml) throw new Error('El 3MF no tiene un modelo 3D adentro (falta 3D/3dmodel.model).');
    return leerXML3MF(xml);
}

// Busca el archivo del modelo: el que indica _rels/.rels, o 3D/3dmodel.model, o cualquier .model.
async function buscarModelo3MF(zip) {
    const rels = zip.file('_rels/.rels');
    if (rels) {
        const texto = await rels.async('string');
        for (const m of texto.matchAll(/<Relationship\b([^>]*)>/g)) {
            const a = atributos(m[1]);
            if (/3dmodel$/i.test(a.Type || '') && a.Target) {
                const archivo = zip.file(a.Target.replace(/^\//, ''));
                if (archivo) return archivo.async('string');
            }
        }
    }
    const archivo = zip.file('3D/3dmodel.model') || zip.file(/\.model$/i)[0];
    return archivo ? archivo.async('string') : null;
}

/**
 * Lee el XML de un modelo 3MF y devuelve los triángulos de todo lo que hay en <build>.
 * @param {string} xml Contenido del archivo .model.
 * @returns {Float32Array} Vértices de cada triángulo, en mm.
 */
export function leerXML3MF(xml) {
    const modelo = /<(?:\w+:)?model\b([^>]*)>/.exec(xml);
    if (!modelo) throw new Error('El 3MF no tiene un modelo válido (falta <model>).');
    const unidad = atributos(modelo[1]).unit || 'millimeter';
    const factor = UNIDADES[unidad];
    if (!factor) throw new Error(`El 3MF usa una unidad que no conocemos: "${unidad}".`);

    const objetos = leerObjetos3MF(xml);
    const items = leerItems3MF(xml, objetos);
    return juntar(reunirPartes3MF(items, objetos, factor));
}

// Objetos: cada uno tiene una malla o una lista de componentes (otros objetos movidos).
function leerObjetos3MF(xml) {
    const objetos = new Map();
    for (const m of xml.matchAll(/<(?:\w+:)?object\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?object>)/g)) {
        const id = atributos(m[1]).id;
        const cuerpo = m[2] || '';
        objetos.set(id, {
            malla: leerMalla3MF(cuerpo, id),
            componentes: [...cuerpo.matchAll(/<(?:\w+:)?component\b([^>]*)>/g)].map(c => {
                const a = atributos(c[1]);
                return { objeto: a.objectid, matriz: leerMatriz(a.transform) };
            }),
        });
    }
    if (objetos.size === 0) throw new Error('El 3MF no tiene ningún objeto.');
    return objetos;
}

// Qué se imprime: los <item> de <build>. Si no hay, todos los objetos con malla.
function leerItems3MF(xml, objetos) {
    const build = /<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build>/.exec(xml);
    const items = build
        ? [...build[1].matchAll(/<(?:\w+:)?item\b([^>]*)>/g)].map(m => {
              const a = atributos(m[1]);
              return { objeto: a.objectid, matriz: leerMatriz(a.transform) };
          })
        : [];
    if (items.length > 0) return items;
    return [...objetos.entries()].filter(([, o]) => o.malla).map(([id]) => ({ objeto: id, matriz: null }));
}

// Triángulos ya transformados (en mm) de cada item, siguiendo los componentes.
function reunirPartes3MF(items, objetos, factor) {
    const partes = [];
    const agregar = (id, matriz, profundidad) => {
        const obj = objetos.get(id);
        if (!obj) throw new Error(`El 3MF hace referencia a un objeto que no existe (id ${id}).`);
        if (profundidad > 16) throw new Error('El 3MF tiene componentes anidados en círculo.');
        if (obj.malla) partes.push(transformar(obj.malla, matriz, factor));
        for (const c of obj.componentes) {
            // Primero la matriz del componente, después la de afuera.
            agregar(c.objeto, componer(c.matriz, matriz), profundidad + 1);
        }
    };
    for (const it of items) agregar(it.objeto, it.matriz, 0);
    return partes;
}

// Concatena las partes en un solo Float32Array.
function juntar(partes) {
    const total = partes.reduce((suma, p) => suma + p.length, 0);
    if (total === 0) throw new Error('El 3MF no tiene triángulos.');
    const salida = new Float32Array(total);
    let o = 0;
    for (const p of partes) {
        salida.set(p, o);
        o += p.length;
    }
    return salida;
}

// Lee <vertices> y <triangles> de un objeto. Devuelve un Float64Array de
// triángulos sin transformar, o null si el objeto no tiene malla.
function leerMalla3MF(cuerpo, id) {
    if (!/<(?:\w+:)?mesh\b/.test(cuerpo)) return null;
    const vertices = [];
    for (const m of cuerpo.matchAll(/<(?:\w+:)?vertex\b([^>]*)>/g)) {
        const a = atributos(m[1]);
        const x = +a.x,
            y = +a.y,
            z = +a.z;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            throw new Error(`El 3MF tiene un vértice inválido en el objeto ${id}.`);
        }
        vertices.push(x, y, z);
    }
    const n = vertices.length / 3;
    const salida = [];
    for (const m of cuerpo.matchAll(/<(?:\w+:)?triangle\b([^>]*)>/g)) {
        const a = atributos(m[1]);
        for (const v of [a.v1, a.v2, a.v3]) {
            const i = Number(v);
            if (!Number.isInteger(i) || i < 0 || i >= n) {
                throw new Error(`El 3MF tiene un triángulo que apunta a un vértice que no existe (objeto ${id}).`);
            }
            salida.push(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
        }
    }
    return new Float64Array(salida);
}

// "m00 m01 ... m32" -> 12 números (o null si no hay transformación).
function leerMatriz(texto) {
    if (!texto) return null;
    const m = texto.trim().split(/\s+/).map(Number);
    if (m.length !== 12 || m.some(x => !Number.isFinite(x))) {
        throw new Error('El 3MF tiene una transformación inválida.');
    }
    return m;
}

// Aplica primero `a` y después `b` (cualquiera puede ser null = identidad).
function componer(a, b) {
    if (!a) return b;
    if (!b) return a;
    const r = new Array(12);
    for (let f = 0; f < 4; f++) {
        for (let c = 0; c < 3; c++) {
            r[f * 3 + c] =
                a[f * 3] * b[c] + a[f * 3 + 1] * b[3 + c] + a[f * 3 + 2] * b[6 + c] + (f === 3 ? b[9 + c] : 0);
        }
    }
    return r;
}

function transformar(v, m, factor) {
    const salida = new Float32Array(v.length);
    for (let i = 0; i < v.length; i += 3) {
        let x = v[i],
            y = v[i + 1],
            z = v[i + 2];
        if (m) {
            [x, y, z] = [
                x * m[0] + y * m[3] + z * m[6] + m[9],
                x * m[1] + y * m[4] + z * m[7] + m[10],
                x * m[2] + y * m[5] + z * m[8] + m[11],
            ];
        }
        salida[i] = x * factor;
        salida[i + 1] = y * factor;
        salida[i + 2] = z * factor;
    }
    return salida;
}

// 'x="1" y=\'2\'' -> { x: '1', y: '2' }. Ignora el prefijo de espacio de nombres (p:path -> path).
function atributos(texto) {
    const a = {};
    for (const m of texto.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        a[m[1].replace(/^\w+:/, '')] = m[2] ?? m[3];
    }
    return a;
}
