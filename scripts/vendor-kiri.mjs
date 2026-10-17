// Copia al repo (en vendor/kiri/) sólo los archivos del motor de Kiri:Moto que
// necesita el worker de laminado, y escribe "shims" para las librerías que
// upstream genera con webpack o enlaza con symlinks a node_modules.
//
// Uso:
//   npm run vendor:kiri                     -> clona GridSpace/grid-apps (shallow)
//   npm run vendor:kiri -- /ruta/grid-apps  -> usa un clon que ya tengas
//
// Licencia de Kiri:Moto: MIT (se copia license.md a vendor/kiri/).

import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const DESTINO = path.join(RAIZ, 'vendor', 'kiri');
const REPO = 'https://github.com/GridSpace/grid-apps.git';

// 1. Conseguir el código fuente de grid-apps
let origen = process.argv[2];
if (!origen) {
    origen = path.join(RAIZ, 'node_modules', '.cache', 'grid-apps');
    if (!fs.existsSync(origen)) {
        console.log(`Clonando ${REPO} ...`);
        execSync(`git clone --depth 1 ${REPO} "${origen}"`, { stdio: 'inherit' });
    }
}
origen = path.resolve(origen);
const SRC = path.join(origen, 'src');
const commit = execSync('git rev-parse HEAD', { cwd: origen }).toString().trim();
const version = JSON.parse(fs.readFileSync(path.join(origen, 'package.json'))).version;

// 2. Librerías externas: upstream las genera con webpack o son symlinks.
//    Acá las reemplazamos por shims chicos (ver paso 5).
const SHIMS = {
    'ext/three.js': `// shim: upstream lo genera con webpack (bin/webpack-three-bundle.js)
import * as THREE_NS from 'three';
import * as SVGLoader from 'three/examples/jsm/loaders/SVGLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import * as MeshBVHLib from 'three-mesh-bvh';
// Kiri le agrega propiedades a THREE (add/three.js), así que tiene que ser un
// objeto común y no el namespace del módulo (que es inmutable).
const THREE = { ...THREE_NS };
export { THREE, SVGLoader, BufferGeometryUtils, LineMaterial, Line2, LineGeometry,
    LineSegments2, LineSegmentsGeometry, TrackballControls, MeshBVHLib };
`,
    'ext/jszip-esm.js': `// shim: upstream lo genera con webpack (bin/webpack-jszip-bundle.js)
import JSZip from 'jszip';
export default JSZip;
export { JSZip };
`,
    'ext/quickjs.js': `// shim: QuickJS (~2,5 MB de WASM) lo usa Kiri como sandbox para evaluar las
// macros del G-code ({temp}, {layer}, etc.). Si el VM devuelve undefined,
// Kiri cae a su propio eval() (kiri/core/print.js, constReplace). Este stub
// hace exactamente eso: un VM falso que nunca evalúa nada.
// Como las plantillas de G-code salen de nuestros propios JSON, no hace falta
// el sandbox.
const handle = () => ({ dispose() {} });
const vmFalso = new Proxy({}, {
    get(_, prop) {
        if (prop === 'evalCode') return () => ({ value: handle() });
        if (prop === 'dump') return () => undefined;
        if (prop === 'global' || prop === 'null' || prop === 'undefined' ||
            prop === 'true' || prop === 'false') return handle();
        return () => handle(); // setProp, newNumber, newObject, dispose, ...
    },
});
export async function getQuickJS() {
    return { newContext: () => vmFalso };
}
`,
    'ext/earcut.js': `// shim: upstream es un symlink a node_modules/earcut
export { default } from 'earcut';
`,
    'ext/tween.js': `// shim: upstream es un symlink a node_modules/@tweenjs/tween.js
export * from '@tweenjs/tween.js';
`,
    'ext/manifold.js': `// shim: manifold (booleanas de malla, ~1 MB de WASM) sólo se usa en CAM y
// en el editor de mallas, no en FDM. Devolvemos una promesa que nunca
// resuelve para que geo/csg.js no descargue el WASM.
export default function manifold() { return new Promise(() => {}); }
`,
    'gpu/raster.js': `// shim: RasterPath (WebGPU) sólo se usa en CAM. No aplica a FDM.
export class RasterPath {
    constructor() { throw new Error('RasterPath no está disponible en laminar-movil (sólo CAM)'); }
}
`,
};

// 3. Recorrer el grafo de imports del worker con esbuild (sin escribir nada)
const externos = Object.keys(SHIMS).map(s => '*' + s).concat(['*ext/jspoly.js']);
const res = await build({
    entryPoints: [path.join(SRC, 'kiri/run/worker.js')],
    bundle: true,
    write: false,
    format: 'esm',
    metafile: true,
    logLevel: 'error',
    external: externos,
});
const archivos = Object.keys(res.metafile.inputs)
    .map(f => path.resolve(f))
    .filter(f => f.startsWith(SRC));
// jspoly usa require() "a la CommonJS" protegido por typeof; esbuild no lo
// puede recorrer pero en el navegador funciona igual como módulo.
archivos.push(path.join(SRC, 'ext/jspoly.js'));
// Valores por defecto de dispositivo/proceso (no tiene imports; lo usa la UI de
// Kiri y lo necesitamos para partir de una configuración completa).
archivos.push(path.join(SRC, 'kiri/app/conf/defaults.js'));

// 4. Copiar
fs.rmSync(DESTINO, { recursive: true, force: true });
for (const f of archivos) {
    const rel = path.relative(SRC, f);
    const dst = path.join(DESTINO, 'src', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(fs.realpathSync(f), dst);
}

// 4b. Parche mínimo a jspoly.js: tiene require() de CommonJS en ramas que en
// el navegador nunca se ejecutan (están protegidas con `typeof require`), pero
// el bundler los ve e intenta resolverlos. Los apagamos.
const jspoly = path.join(DESTINO, 'src', 'ext', 'jspoly.js');
fs.writeFileSync(jspoly, '// PARCHE laminar-movil: require() deshabilitado (ver scripts/vendor-kiri.mjs)\n' +
    fs.readFileSync(jspoly, 'utf8')
        .replaceAll('typeof require !== "undefined" && require !== null', 'false')
        .replace(/\brequire\(/g, 'requireDeshabilitado('));

// 4c. Parches a bugs de Kiri que afectan al G-code. Si el texto no aparece
// (cambió upstream), se corta acá para revisarlo a mano.
function parchar(rel, buscar, reemplazo, motivo) {
    const archivo = path.join(DESTINO, 'src', rel);
    const codigo = fs.readFileSync(archivo, 'utf8');
    if (codigo.split(buscar).length !== 2) {
        throw new Error(`No se pudo aplicar el parche en ${rel} (${motivo}): revisar a mano`);
    }
    fs.writeFileSync(archivo, codigo.replace(buscar, reemplazo));
}
// El ventilador cambia por punto (capas puente) pero la macro {fan_speed}
// usaba el valor viejo: salía "M106 S0" en vez de prenderlo, y después no
// se volvía a mandar. Resultado: ventilador apagado casi toda la impresión.
parchar('kiri/mode/fdm/work/export.js',
    'fanSpeed = out.fan ?? fanSpeed;',
    'fanSpeed = out.fan ?? fanSpeed;\n                subst.fan_speed = fanSpeed; // PARCHE laminar-movil',
    'macro de ventilador desactualizada');
// La primera capa no es "puente" para el ventilador (igual que para la velocidad).
parchar('kiri/mode/fdm/work/prepare.js',
    'if (preout.length && slice.isBridgeLayer) {',
    'if (preout.length && slice.isBridgeLayer && slice.index > 0) { // PARCHE laminar-movil',
    'ventilador en la primera capa');
// Altura de capa variable (sliceAdaptive): el slicer redondea las Z de corte a 3
// decimales pero slice.js las busca sin redondear (indexOf da -1, la capa queda
// sin altura y el G-code no sube Z). Además cortaba en el borde de arriba de la
// capa en vez de en el medio (como en altura fija), así que cada capa salía media
// capa más alta. Guardamos la mitad de la capa, redondeada.
parchar('kiri/mode/fdm/work/slice.js',
    'zIndexes.push(zIncFirst);',
    'zIndexes.push((zIncFirst / 2).round(3)); // PARCHE laminar-movil: mitad de la capa, redondeado',
    'altura variable: primera capa');
parchar('kiri/mode/fdm/work/slice.js',
    'zIndexes.push(zPos + zStep);',
    'zIndexes.push((zPos + zStep / 2).round(3)); // PARCHE laminar-movil: mitad de la capa, redondeado',
    'altura variable: resto de las capas');

// 5. Escribir shims
for (const [rel, codigo] of Object.entries(SHIMS)) {
    const dst = path.join(DESTINO, 'src', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, codigo);
}

// 6. Licencia y procedencia
fs.copyFileSync(path.join(origen, 'license.md'), path.join(DESTINO, 'license.md'));
fs.writeFileSync(path.join(DESTINO, 'ORIGEN.md'), `# Motor Kiri:Moto (vendorizado)

- Repo: ${REPO}
- Versión: ${version}
- Commit: ${commit}
- Licencia: MIT (ver license.md). Se conservan los encabezados de copyright originales.

Generado por \`scripts/vendor-kiri.mjs\`: sólo se copian los ${archivos.length} archivos
que importa \`src/kiri/run/worker.js\`. Los archivos en \`src/ext/\` listados abajo
son shims propios (no vienen de upstream):

${Object.keys(SHIMS).map(s => '- `src/' + s + '`').join('\n')}

Parches (marcados con \`PARCHE laminar-movil\`):

- \`src/kiri/mode/fdm/work/export.js\`: la macro \`{fan_speed}\` no se actualizaba cuando el ventilador cambia a mitad de capa (salía \`M106 S0\` y el ventilador quedaba apagado casi toda la impresión).
- \`src/kiri/mode/fdm/work/prepare.js\`: el ventilador de "capa puente" no se aplica a la primera capa.
- \`src/kiri/mode/fdm/work/slice.js\`: con altura de capa variable las capas quedaban sin altura (no subía Z) y se cortaban en el borde de arriba en vez del medio.
- \`src/ext/jspoly.js\` tiene un parche mínimo (se apagan \`require()\` de CommonJS que nunca corren en el navegador).

No editar a mano: para actualizar, correr \`npm run vendor:kiri\`.
`);

console.log(`OK: ${archivos.length} archivos de Kiri:Moto ${version} (${commit.slice(0, 7)}) en vendor/kiri/`);
