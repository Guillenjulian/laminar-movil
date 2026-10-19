// Guardián del tamaño de los chunks del build (ADR 0006, T2).
//
// Uso (después de `npm run build`):
//   node scripts/verificar-chunks.mjs [carpeta=dist]
//
// Mirá el chunk principal de index.html y todo lo que se carga con él (imports
// estáticos, sin los import() dinámicos). Falla si el principal o esa clausura pesan
// demasiado, si three.js (WebGLRenderer) o jszip (generateAsync) están en la clausura, o si hay un
// chunk dinámico del visor o de jszip que el service worker no guarda para usar sin conexión.
// Textos (ADR 0008, I2): un chunk "de textos" es el que trae objetos con las claves de src/textos/<idioma>/*.json
// (`"area.clave":`, al menos 3 distintas; las llamadas t('area.clave') no cuentan). Falla si alguno está en la carga
// inicial (los diccionarios van en import() dinámico) o si el service worker no lo guarda. Si todavía no hay
// src/textos/ con claves, las reglas de textos no se aplican (se avisa).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOPE_PRINCIPAL = 100000;
const TOPE_CLAUSURA = 400000;
const MARCA_VISOR = 'WebGLRenderer';
const MARCA_JSZIP = 'generateAsync'; // API de jszip; no aparece en el código propio de la app
const MIN_CLAVES_TEXTOS = 3;
const MARCA_IDIOMA = /["'`]idioma["'`]/; // la clave de ajuste que lee src/ui/idioma.js: si está en la clausura, el módulo llegó
const CARPETA_TEXTOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'textos');

const carpeta = path.resolve(process.argv[2] ?? 'dist');
const relativa = ruta => path.relative(carpeta, ruta).split(path.sep).join('/');

// Mismo criterio que vite.config.js: las páginas de diagnóstico no van en el service worker.
const esDeDiagnostico = nombre =>
    nombre.startsWith('prueba-motor') ||
    nombre.includes('pruebaMotor') ||
    nombre.includes('prueba-piezas') ||
    nombre.includes('minions-prueba');

const esWorker = nombre => /\.worker-/.test(nombre);

// "/x" es relativo a dist/; "./x" y "../x" son relativos al archivo que importa.
const rutaDe = (desde, especificador) =>
    especificador.startsWith('/')
        ? path.join(carpeta, especificador)
        : path.resolve(path.dirname(desde), especificador);

// Imports estáticos minificados: `import{a}from"./x.js"`, `import"./x.js"`, `export*from"./x.js"`.
// No matchea import(...) porque después del import viene "(" y no una comilla o un from.
const RE_ESTATICO = /\b(?:import|export)\s*(?:[\w$*{},\s]{0,300}?\bfrom\s*)?(["'])([^"']+)\1/g;

const importsEstaticos = archivo => {
    const texto = fs.readFileSync(archivo, 'utf8');
    const rutas = [];
    for (const m of texto.matchAll(RE_ESTATICO)) {
        if (!m[2].startsWith('.') && !m[2].startsWith('/')) continue;
        const ruta = rutaDe(archivo, m[2]);
        if (!fs.existsSync(ruta)) throw new Error(`${relativa(archivo)} importa ${m[2]}, que no está en el build`);
        rutas.push(ruta);
    }
    return rutas;
};

// Clausura estática del chunk principal: él mismo y todo lo que importa estáticamente.
const clausura = raiz => {
    const visto = new Set();
    const pendientes = [raiz];
    while (pendientes.length > 0) {
        const archivo = pendientes.pop();
        if (visto.has(archivo)) continue;
        visto.add(archivo);
        pendientes.push(...importsEstaticos(archivo));
    }
    return visto;
};

const chunkPrincipal = html => {
    for (const etiqueta of html.match(/<script\b[^>]*>/g) ?? []) {
        const src = /src=["']([^"']+)["']/.exec(etiqueta);
        if (/type=["']module["']/.test(etiqueta) && src) return src[1];
    }
    return null;
};

const leerArchivosSw = () => {
    const sw = fs.readFileSync(path.join(carpeta, 'sw.js'), 'utf8');
    const m = /const ARCHIVOS = (\[[\s\S]*?\]);/.exec(sw);
    if (!m) throw new Error('no encuentro la lista ARCHIVOS en sw.js');
    return JSON.parse(m[1]);
};

// Claves de todos los .json de src/textos (recursivo), sin repetir (es y en comparten claves). [] si no hay ninguno.
const clavesDeTextos = (carpeta = CARPETA_TEXTOS) => {
    if (!fs.existsSync(carpeta)) return [];
    const claves = fs.readdirSync(carpeta, { withFileTypes: true }).flatMap(e => {
        const ruta = path.join(carpeta, e.name);
        if (e.isDirectory()) return clavesDeTextos(ruta);
        return e.name.endsWith('.json') ? Object.keys(JSON.parse(fs.readFileSync(ruta, 'utf8'))) : [];
    });
    return [...new Set(claves)];
};

// ¿El chunk trae los diccionarios? Vite los deja como objeto literal o como JSON.parse("…") con las comillas escapadas.
const trae = (texto, claves) => {
    const plano = texto.replaceAll('\\"', '"');
    const minimo = Math.min(MIN_CLAVES_TEXTOS, claves.length);
    let halladas = 0;
    for (const clave of claves) if (plano.includes(`"${clave}":`) && ++halladas >= minimo) return true;
    return false;
};

const medir = (ruta, enClausura, claves) => {
    const buf = fs.readFileSync(ruta);
    const nombre = relativa(ruta);
    return {
        ruta,
        nombre,
        bytes: buf.length,
        gzip: zlib.gzipSync(buf).length,
        clausura: enClausura.has(ruta),
        visor: buf.includes(MARCA_VISOR),
        jszip: buf.includes(MARCA_JSZIP),
        diagnostico: esDeDiagnostico(nombre),
        textos: trae(buf.toString('utf8'), claves),
        idioma: MARCA_IDIOMA.test(buf.toString('utf8')),
    };
};

const imprimirTabla = filas => {
    console.log('chunk'.padEnd(44) + 'bytes'.padStart(10) + 'gzip'.padStart(10) + '  en clausura');
    for (const f of filas) {
        const marca = f.clausura ? 'sí' : 'no';
        console.log(f.nombre.padEnd(44) + String(f.bytes).padStart(10) + String(f.gzip).padStart(10) + '  ' + marca);
    }
};

// Reglas de los diccionarios (ADR 0008): fuera de la carga inicial, en el service worker y reconocibles.
const evaluarTextos = (filas, enClausura, archivos, hayTextos) => {
    const fallas = [];
    for (const f of enClausura.filter(f => f.textos)) {
        fallas.push(
            `[textos-en-clausura] ${f.nombre} se carga con la app y trae los diccionarios de src/textos; deben ir en import() dinámico`,
        );
    }
    // idioma.js llegó a la carga inicial pero no se reconoce ningún chunk de diccionarios: o no se generaron
    // (las claves quedaron sin chunk es/en) o el detector quedó ciego (cambió el formato del build).
    if (hayTextos && enClausura.some(f => f.idioma) && !filas.some(f => f.textos)) {
        fallas.push(
            '[textos-sin-chunks] src/ui/idioma.js está en la carga inicial y no hay chunks es/en con los diccionarios',
        );
    }
    for (const f of filas.filter(f => f.textos && !archivos.includes(f.nombre))) {
        fallas.push(`[textos-fuera-sw] ${f.nombre} trae los diccionarios y no está en ARCHIVOS de sw.js`);
    }
    return fallas;
};

export const evaluar = (principal, filas, archivos, hayTextos = false) => {
    const fallas = [];
    if (principal.bytes >= TOPE_PRINCIPAL) {
        fallas.push(
            `[principal] ${principal.nombre} pesa ${principal.bytes} bytes; debe ser menor que ${TOPE_PRINCIPAL}`,
        );
    }
    const enClausura = filas.filter(f => f.clausura);
    const total = enClausura.reduce((suma, f) => suma + f.bytes, 0);
    if (total >= TOPE_CLAUSURA) {
        fallas.push(`[clausura] la carga inicial pesa ${total} bytes; debe ser menor que ${TOPE_CLAUSURA}`);
    }
    for (const f of enClausura.filter(f => f.visor)) {
        fallas.push(
            `[visor-en-clausura] ${f.nombre} se carga con la app y contiene ${MARCA_VISOR}; el visor debe ir en import() dinámico`,
        );
    }
    for (const f of enClausura.filter(f => f.jszip)) {
        fallas.push(
            `[jszip-en-clausura] ${f.nombre} se carga con la app y contiene ${MARCA_JSZIP}; jszip debe ir en import() dinámico`,
        );
    }
    fallas.push(...evaluarTextos(filas, enClausura, archivos, hayTextos));
    // Todo chunk con visor o jszip se pide recién cuando hace falta (import() dinámico), así que sin conexión
    // sólo anda si el service worker lo guardó. Los workers se cachean aparte y no entran en esta regla.
    for (const f of filas.filter(f => (f.visor || f.jszip) && !f.diagnostico && !esWorker(f.nombre))) {
        if (archivos.includes(f.nombre)) continue;
        const que = f.visor ? MARCA_VISOR : MARCA_JSZIP;
        fallas.push(`[dinamico-fuera-sw] ${f.nombre} contiene ${que} y no está en ARCHIVOS de sw.js`);
    }
    return fallas;
};

const main = () => {
    const indice = path.join(carpeta, 'index.html');
    const src = chunkPrincipal(fs.readFileSync(indice, 'utf8'));
    if (!src) throw new Error('index.html no tiene <script type="module" src=...>');
    const raiz = rutaDe(indice, src);
    const enClausura = clausura(raiz);
    const dirAssets = path.join(carpeta, 'assets');
    const archivos = leerArchivosSw();
    const claves = clavesDeTextos();
    const filas = fs
        .readdirSync(dirAssets)
        .filter(n => n.endsWith('.js'))
        .map(n => medir(path.join(dirAssets, n), enClausura, claves))
        .sort((a, b) => b.bytes - a.bytes);
    const principal = filas.find(f => f.ruta === raiz);
    if (!principal) throw new Error(`el principal ${src} no está en assets/`);
    imprimirTabla(filas);
    const deTextos = filas.filter(f => f.textos).map(f => f.nombre);
    if (claves.length === 0) console.log('· sin diccionarios en src/textos: no se aplican las reglas de textos');
    else console.log(`· diccionarios (${claves.length} claves) en: ${deTextos.join(', ') || 'ningún chunk'}`);
    const fallas = evaluar(principal, filas, archivos, claves.length > 0);
    if (fallas.length === 0) {
        console.log(`OK: principal ${principal.bytes} bytes, carga inicial de ${enClausura.size} chunks`);
        return;
    }
    for (const falla of fallas) console.error(`FALLA ${falla}`);
    process.exitCode = 1;
};

// Sólo como script: `scripts/textos/chunks.mjs` importa `evaluar` para probarlo con filas sintéticas.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        main();
    } catch (err) {
        console.error(`FALLA ${err.message}`);
        process.exitCode = 1;
    }
}
