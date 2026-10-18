// Prueba de contrato de los módulos nuevos de src/ui/ (ADR 0001, T0): `npm run test:contratos`.
// Flujo: autoprueba del detector de ciclos; levanta Vite en middleware (sólo ssrLoadModule, sin puertos);
// por módulo del contrato: si no existe se saltea (CONTRATOS_ESTRICTO=1 lo hace error), si existe se
// importa con document/window "trampa" y se chequea que no los toque y que exports y aridades coincidan;
// luego el grafo real de imports de src/ui/ y src/main.js (aristas permitidas, sin ciclos); exit 0 o 1.
// La trampa detecta accesos a propiedades (document.x), no el uso suelto de `document`.
import { createServer } from 'vite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRATOS } from './lib/contratos-ui.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RAIZ, 'src');
const ESTRICTO = process.env.CONTRATOS_ESTRICTO === '1';
let fallos = 0;

/** Imprime una línea ✔/✘ y cuenta los fallos. @param {boolean} ok @param {string} texto @returns {void} */
function chequear(ok, texto) {
    if (!ok) fallos++;
    console.log(`  ${ok ? '✔' : '✘'} ${texto}`);
}

/** Busca un ciclo en un grafo por DFS (pila de visita). @param {Record<string,string[]>} grafo
 *  @returns {string[]|null} el ciclo (con el primer nodo repetido al final) o null si es acíclico */
function buscarCiclo(grafo) {
    const hechos = new Set();
    const visitar = (nodo, pila) => {
        if (pila.includes(nodo)) return [...pila.slice(pila.indexOf(nodo)), nodo];
        if (hechos.has(nodo)) return null;
        hechos.add(nodo);
        for (const hijo of grafo[nodo] ?? []) {
            const ciclo = visitar(hijo, [...pila, nodo]);
            if (ciclo) return ciclo;
        }
        return null;
    };
    return Object.keys(grafo).reduce((ciclo, nodo) => ciclo ?? visitar(nodo, []), null);
}

/** Autoprueba del detector: un grafo cíclico y uno acíclico. @returns {void} */
function autopruebaCiclos() {
    console.log('Detector de ciclos');
    chequear(buscarCiclo({ a: ['b'], b: ['c'], c: ['a'] })?.join('>') === 'a>b>c>a', 'detecta el ciclo a>b>c>a');
    chequear(buscarCiclo({ a: ['b', 'c'], b: ['c'], c: [] }) === null, 'un grafo acíclico no da ciclo');
}

/** Instala document/window que registran cada acceso a una propiedad. @returns {string[]} los accesos */
function instalarTrampas() {
    const accesos = [];
    const trampa = nombre => {
        const anotar = (prop, extra) => (accesos.push(`${nombre}.${String(prop)}${extra}`), undefined);
        return new Proxy(function () {}, {
            get: (_, prop) => anotar(prop, ''),
            set: (_, prop) => !anotar(prop, ' (escritura)'),
            has: (_, prop) => !!anotar(prop, ' (in)'),
        });
    };
    globalThis.document = trampa('document');
    globalThis.window = trampa('window');
    return accesos;
}

/** Compara los exports del módulo con el contrato.
 *  @param {object} modulo @param {Record<string,number|'valor'>} esperado @param {string} ruta @returns {void} */
function chequearExports(modulo, esperado, ruta) {
    const nombres = Object.keys(esperado).sort();
    chequear(String(Object.keys(modulo).sort()) === String(nombres), `${ruta}: exporta exactamente [${nombres}]`);
    for (const [nombre, aridad] of Object.entries(esperado)) {
        const esFn = typeof modulo[nombre] === 'function';
        const ok = aridad === 'valor' ? !esFn : esFn && modulo[nombre].length === aridad;
        chequear(ok, `${ruta}: ${nombre} ${aridad === 'valor' ? 'es un valor' : `tiene aridad ${aridad}`}`);
    }
}

/** Importa un módulo con las trampas puestas. @param {import('vite').ViteDevServer} vite @param {string} archivo
 *  @returns {Promise<{modulo?: object, accesos: string[]}>} */
async function importarConTrampas(vite, archivo) {
    const accesos = instalarTrampas();
    try {
        return { modulo: await vite.ssrLoadModule(archivo), accesos };
    } catch (error) {
        chequear(false, `no se pudo importar: ${error.message}`);
        return { accesos };
    } finally {
        delete globalThis.document;
        delete globalThis.window;
    }
}

/** Importa y chequea cada módulo del contrato. @param {import('vite').ViteDevServer} vite @returns {Promise<void>} */
async function chequearModulos(vite) {
    for (const [ruta, contrato] of Object.entries(CONTRATOS)) {
        console.log(ruta);
        const archivo = join(SRC, `${ruta}.js`);
        if (!existsSync(archivo)) {
            if (ESTRICTO) chequear(false, 'falta el módulo (modo estricto)');
            else console.log('  · salteado (todavía no existe)');
            continue;
        }
        const { modulo, accesos } = await importarConTrampas(vite, archivo);
        if (!modulo) continue;
        chequear(!accesos.length, `no toca el DOM al importarse${accesos.length ? `: ${accesos.join(', ')}` : ''}`);
        chequearExports(modulo, contrato.exports, ruta);
    }
}

/** Lee los imports relativos de un archivo, como rutas relativas a src/ sin .js.
 *  @param {string} archivo @returns {string[]} */
function leerImports(archivo) {
    return [...readFileSync(archivo, 'utf8').matchAll(/^\s*import\s[^'"]*?['"](\.[^'"]+)['"]/gm)].map(m =>
        relative(SRC, resolve(dirname(archivo), m[1])).replace(/\.js$/, ''),
    );
}

/** Arma el grafo real de imports de src/ui/*.js y src/main.js. @returns {Record<string,string[]>} */
function armarGrafo() {
    const archivos = readdirSync(join(SRC, 'ui')).filter(f => f.endsWith('.js'));
    const nodos = archivos.map(f => [`ui/${f.slice(0, -3)}`, leerImports(join(SRC, 'ui', f))]);
    return Object.fromEntries([['main', leerImports(join(SRC, 'main.js'))], ...nodos]);
}

/** Chequea que los módulos nuevos sólo importen lo permitido y que no haya ciclos. @returns {void} */
function chequearGrafo() {
    console.log('Grafo de imports (src/ui y src/main.js)');
    const grafo = armarGrafo();
    for (const [nodo, destinos] of Object.entries(grafo).filter(([nodo]) => CONTRATOS[nodo])) {
        const sobran = destinos.filter(d => !CONTRATOS[nodo].importa.includes(d));
        chequear(!sobran.length, `${nodo}: sólo importa lo permitido${sobran.length ? ` (sobran: ${sobran})` : ''}`);
    }
    const ciclo = buscarCiclo(grafo);
    chequear(ciclo === null, `sin ciclos${ciclo ? `: ${ciclo.join(' > ')}` : ''}`);
}

autopruebaCiclos();
const vite = await createServer({
    root: RAIZ,
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
});
try {
    await chequearModulos(vite);
    chequearGrafo();
} finally {
    await vite.close();
}
console.log(fallos ? `\n${fallos} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);
