// Prueba de contrato de los módulos nuevos de src/ui/ (ADR 0001, T0): `npm run test:contratos`.
// Al final también corren las pruebas de estado (accesores de `estado.piezas`, scripts/probar-estado.mjs).
// Flujo: autoprueba del detector de ciclos; levanta Vite en middleware (sólo ssrLoadModule, sin puertos);
// por módulo del contrato: si no existe se saltea (CONTRATOS_ESTRICTO=1 lo hace error), si existe se
// importa con document/window "trampa" y se chequea que no los toque y que exports y aridades coincidan;
// luego el grafo real de imports de src/ui/ y src/main.js (aristas permitidas, sin ciclos); exit 0 o 1.
// Trampas: document, window, navigator, location, localStorage, history. Sólo cuentan los accesos cuyo frame
// llamador está en src/ (los de node_modules, como `window.__THREE__` de three, se ignoran). Se invalida el grafo de Vite entre
// módulos para atribuir bien cada acceso. Límites: no ve `typeof document`, ni el uso suelto del global sin tocar
// una propiedad, ni accesos diferidos (dentro de funciones que corren después del import, o en un setTimeout).
import { createServer } from 'vite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRATOS } from './lib/contratos-ui.js';
import { probarEstado } from './probar-estado.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RAIZ, 'src');
const ESTRICTO = process.env.CONTRATOS_ESTRICTO === '1';
const GLOBALES = ['document', 'window', 'navigator', 'location', 'localStorage', 'history'];
const ORIGINALES = new Map();
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

/** Instala los globales de GLOBALES como Proxy que registran los accesos hechos desde src/ (por el stack).
 *  @returns {string[]} los accesos */
function instalarTrampas() {
    const accesos = [];
    const trampa = nombre => {
        const anotar = (prop, extra) => {
            const llamador = new Error().stack.split('\n')[3] ?? ''; // [0] Error, [1] anotar, [2] trampa, [3] quien accede
            if (llamador.includes(SRC) && !llamador.includes('node_modules')) {
                accesos.push(`${nombre}.${String(prop)}${extra}`);
            }
        };
        return new Proxy(function () {}, {
            get: (_, prop) => anotar(prop, ''),
            set: (_, prop) => anotar(prop, ' (escritura)') ?? true,
            has: (_, prop) => anotar(prop, ' (in)') ?? false,
        });
    };
    for (const nombre of GLOBALES) {
        ORIGINALES.set(nombre, Object.getOwnPropertyDescriptor(globalThis, nombre)); // navigator es de sólo lectura
        Object.defineProperty(globalThis, nombre, { value: trampa(nombre), configurable: true, writable: true });
    }
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
    (vite.environments?.ssr?.moduleGraph ?? vite.moduleGraph).invalidateAll();
    const accesos = instalarTrampas();
    try {
        return { modulo: await vite.ssrLoadModule(archivo), accesos };
    } catch (error) {
        chequear(false, `no se pudo importar: ${error.message}`);
        return { accesos };
    } finally {
        for (const nombre of GLOBALES) {
            if (ORIGINALES.get(nombre)) Object.defineProperty(globalThis, nombre, ORIGINALES.get(nombre));
            else delete globalThis[nombre];
        }
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

/** Extrae las rutas relativas de import/export ... from, import 'x' e import('x'), ignorando comentarios.
 *  @param {string} texto @returns {string[]} */
function extraerRutas(texto) {
    const limpio = texto.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const regex = /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*\(?\s*['"](\.[^'"]+)['"]/g;
    return [...limpio.matchAll(regex)].map(m => m[1] ?? m[2]);
}

/** Autoprueba de extraerRutas: cada forma de import y comentarios que no deben contarse. @returns {void} */
function autopruebaImports() {
    console.log('Lector de imports');
    const texto = `import { a } from './a.js';\nimport * as b from "./b.js";\nimport './c.js';
export { d } from './d.js';\nexport * from './e.js';\nconst f = await import('./f.js');
import {\n  g,\n} from './g.js'; // import x from './mentira1.js'\n/* import y from './mentira2.js' */`;
    const rutas = extraerRutas(texto).join(' ');
    chequear(rutas === './a.js ./b.js ./c.js ./d.js ./e.js ./f.js ./g.js', `lee todas las formas, sin comentarios`);
}

/** Rutas de import de un archivo, relativas a src/ y sin .js. @param {string} archivo @returns {string[]} */
function leerImports(archivo) {
    return extraerRutas(readFileSync(archivo, 'utf8')).map(r =>
        relative(SRC, resolve(dirname(archivo), r)).replace(/\.js$/, ''),
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
autopruebaImports();
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
    await probarEstado(chequear, ruta => vite.ssrLoadModule(ruta));
} finally {
    await vite.close();
}
console.log(fallos ? `\n${fallos} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS OK');
process.exit(fallos ? 1 : 0);
