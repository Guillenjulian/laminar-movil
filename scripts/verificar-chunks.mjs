// Guardián del tamaño de los chunks del build (ADR 0006, T2).
//
// Uso (después de `npm run build`):
//   node scripts/verificar-chunks.mjs [carpeta=dist]
//
// Mirá el chunk principal de index.html y todo lo que se carga con él (imports
// estáticos, sin los import() dinámicos). Falla si el principal o esa clausura pesan
// demasiado, si three.js (WebGLRenderer) o jszip (generateAsync) están en la clausura, o si hay un
// chunk dinámico del visor o de jszip que el service worker no guarda para usar sin conexión.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TOPE_PRINCIPAL = 100000;
const TOPE_CLAUSURA = 400000;
const MARCA_VISOR = 'WebGLRenderer';
const MARCA_JSZIP = 'generateAsync'; // API de jszip; no aparece en el código propio de la app

const carpeta = path.resolve(process.argv[2] ?? 'dist');
const relativa = ruta => path.relative(carpeta, ruta).split(path.sep).join('/');

// Mismo criterio que vite.config.js: las páginas de diagnóstico no van en el service worker.
const esDeDiagnostico = nombre =>
    nombre.startsWith('prueba-motor') || nombre.includes('pruebaMotor') || nombre.includes('prueba-piezas');

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

const medir = (ruta, enClausura) => {
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
    };
};

const imprimirTabla = filas => {
    console.log('chunk'.padEnd(44) + 'bytes'.padStart(10) + 'gzip'.padStart(10) + '  en clausura');
    for (const f of filas) {
        const marca = f.clausura ? 'sí' : 'no';
        console.log(f.nombre.padEnd(44) + String(f.bytes).padStart(10) + String(f.gzip).padStart(10) + '  ' + marca);
    }
};

const evaluar = (principal, filas, archivos) => {
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
    const filas = fs
        .readdirSync(dirAssets)
        .filter(n => n.endsWith('.js'))
        .map(n => medir(path.join(dirAssets, n), enClausura))
        .sort((a, b) => b.bytes - a.bytes);
    const principal = filas.find(f => f.ruta === raiz);
    if (!principal) throw new Error(`el principal ${src} no está en assets/`);
    imprimirTabla(filas);
    const fallas = evaluar(principal, filas, archivos);
    if (fallas.length === 0) {
        console.log(`OK: principal ${principal.bytes} bytes, carga inicial de ${enClausura.size} chunks`);
        return;
    }
    for (const falla of fallas) console.error(`FALLA ${falla}`);
    process.exitCode = 1;
};

try {
    main();
} catch (err) {
    console.error(`FALLA ${err.message}`);
    process.exitCode = 1;
}
