// Mide el costo del lector de recorridos (src/motor/recorridos-lector.js) contra una versión de referencia.
// Cada muestra corre en un proceso de Node nuevo y se alternan base y nuevo (la variación dentro de un proceso
// y entre corridas seguidas es de ±50 % en máquinas compartidas). Ver ADR 0006, decisión 3.
//
// Uso: node scripts/medir-recorridos.mjs [--ref=18ba5d5] [--lineas=2000000] [--tandas=7] [--corridas=3] [--max=10]
// Sale con 1 si la razón nuevo/base del nivel 0 pasa de 1 + max/100. Los niveles 1 a 3 sólo se informan.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, def) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? def;

/** Modo hijo: una muestra en este proceso. Imprime JSON { ms, tramos, mb } (mínimo de las corridas). */
async function hijo(dir, lineas, corridas, nivel) {
    const { generarGcode } = await import(pathToFileURL(join(RAIZ, 'scripts/lib/gcode-sintetico.mjs')).href);
    const { leer } = await import(pathToFileURL(join(dir, 'src/motor/recorridos-lector.js')).href);
    const gcode = generarGcode(lineas);
    let mejor = Infinity;
    let r;
    for (let i = 0; i <= corridas; i++) {
        const t = performance.now();
        r = leer(gcode, Infinity, nivel ? { nivel } : undefined);
        const ms = performance.now() - t;
        if (i > 0) mejor = Math.min(mejor, ms); // la primera es de calentamiento
    }
    const mb = (r.posiciones.byteLength + r.colores.byteLength + r.tipos.byteLength) / 1048576;
    console.log(JSON.stringify({ ms: mejor, tramos: r.tipos.length, mb }));
}

function muestra(dir, lineas, corridas, nivel = 0) {
    const salida = execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), '--hijo', dir, String(lineas), String(corridas), String(nivel)],
        { encoding: 'utf8', maxBuffer: 1 << 20 },
    );
    return JSON.parse(salida);
}

const mediana = v => {
    const o = [...v].sort((a, b) => a - b);
    return o.length % 2 ? o[o.length >> 1] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};

/** Tiempo, tramos y memoria de cada nivel (sin tope, informativo). */
function informarNiveles(lineas) {
    console.log('\nNiveles (informativo):');
    for (let n = 0; n <= 3; n++) {
        const m = muestra(RAIZ, lineas, 1, n);
        console.log(`  nivel ${n}: ${m.ms.toFixed(0)} ms, ${m.tramos} tramos, ${m.mb.toFixed(1)} MB`);
    }
}

/** Imprime medianas, rangos y la razón nuevo/base; devuelve la razón de las medianas. */
function informar(base, nuevo) {
    const rango = v => `${Math.min(...v).toFixed(0)}-${Math.max(...v).toFixed(0)}`;
    const razones = base.map((b, i) => nuevo[i] / b);
    const razon = mediana(nuevo) / mediana(base);
    console.log(`\nMediana base ${mediana(base).toFixed(0)} ms (${rango(base)})`);
    console.log(`Mediana nuevo ${mediana(nuevo).toFixed(0)} ms (${rango(nuevo)})`);
    console.log(
        `Razón nuevo/base (nivel 0): ${razon.toFixed(3)}; por tanda ${Math.min(...razones).toFixed(2)}-${Math.max(...razones).toFixed(2)}`,
    );
    return razon;
}

async function main() {
    if (process.argv[2] === '--hijo') {
        const [, , , dir, lineas, corridas, nivel] = process.argv;
        return hijo(dir, +lineas, +corridas, +nivel);
    }
    const ref = arg('ref', '18ba5d5');
    const lineas = +arg('lineas', 2000000);
    const tandas = +arg('tandas', 7);
    const corridas = +arg('corridas', 3);
    const max = +arg('max', 10);
    const tmp = mkdtempSync(join(tmpdir(), 'medir-recorridos-'));
    try {
        const archivo = spawnSync('git', ['archive', ref, 'src/motor'], { cwd: RAIZ, maxBuffer: 1 << 28 });
        if (archivo.status !== 0) throw new Error(`git archive ${ref}: ${archivo.stderr}`);
        execFileSync('tar', ['-x', '-C', tmp], { input: archivo.stdout });
        console.log(
            `Base ${ref} contra el árbol actual: ${lineas} líneas, ${tandas} tandas alternadas, ${corridas} corridas`,
        );
        const base = [];
        const nuevo = [];
        for (let i = 0; i < tandas; i++) {
            base.push(muestra(tmp, lineas, corridas).ms);
            nuevo.push(muestra(RAIZ, lineas, corridas).ms);
            console.log(`  tanda ${i + 1}: base ${base[i].toFixed(0)} ms, nuevo ${nuevo[i].toFixed(0)} ms`);
        }
        const razon = informar(base, nuevo);
        informarNiveles(lineas);
        const ok = razon <= 1 + max / 100;
        console.log(ok ? `\n✔ nivel 0 dentro de +${max} %` : `\n✘ nivel 0 pasa de +${max} %`);
        process.exitCode = ok ? 0 : 1;
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

await main();
