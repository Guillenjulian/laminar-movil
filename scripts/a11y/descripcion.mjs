// Pruebas de textoDescripcionVisor (ADR 0008, A4) en Node, sin navegador ni DOM.
// Se llama desde probar-contratos.mjs (`npm run test:contratos`), que pasa el cargador de Vite (el módulo importa
// formato.js). También corre solo: `node scripts/a11y/descripcion.mjs`.
// Cubre: 0 piezas, 1 pieza con medida, 2 piezas con copias, "no entran", sin medida (visor cargando) y que el
// texto cambie con las copias.
import { readFileSync } from 'node:fs';

const CUBO = { x: 20, y: 20, z: 20 };

const CASOS = [
    ['0 piezas', { piezas: [], entra: true }, 'La cama está vacía.'],
    [
        '1 pieza con medidas',
        { piezas: [{ nombre: 'cubo-20mm.stl', tamano: CUBO, copias: 1 }], entra: true },
        'Vista 3D de la cama con 1 pieza: cubo-20mm.stl (20,0 × 20,0 × 20,0 mm).',
    ],
    [
        '1 pieza con copias',
        { piezas: [{ nombre: 'cubo-20mm.stl', tamano: CUBO, copias: 3 }], entra: true },
        'Vista 3D de la cama con 1 pieza: cubo-20mm.stl (20,0 × 20,0 × 20,0 mm, 3 copias).',
    ],
    [
        '2 piezas, una con copias',
        {
            piezas: [
                { nombre: 'a.stl', tamano: CUBO, copias: 1 },
                { nombre: 'b.stl', tamano: { x: 10.5, y: 1234.5, z: 5 }, copias: 2 },
            ],
            entra: true,
        },
        'Vista 3D de la cama con 2 piezas: a.stl (20,0 × 20,0 × 20,0 mm); b.stl (10,5 × 1.234,5 × 5,0 mm, 2 copias).',
    ],
    [
        'no entran en la cama',
        { piezas: [{ nombre: 'grande.stl', tamano: { x: 400, y: 20, z: 20 }, copias: 1 }], entra: false },
        'Vista 3D de la cama con 1 pieza: grande.stl (400,0 × 20,0 × 20,0 mm). No entra en la cama.',
    ],
    [
        'no entran (una pieza con copias)',
        { piezas: [{ nombre: 'g.stl', tamano: CUBO, copias: 5 }], entra: false },
        'Vista 3D de la cama con 1 pieza: g.stl (20,0 × 20,0 × 20,0 mm, 5 copias). No entran todas en la cama.',
    ],
    [
        'no entran (2 piezas)',
        {
            piezas: [
                { nombre: 'a.stl', tamano: CUBO, copias: 1 },
                { nombre: 'b.stl', tamano: CUBO, copias: 1 },
            ],
            entra: false,
        },
        'Vista 3D de la cama con 2 piezas: a.stl (20,0 × 20,0 × 20,0 mm); b.stl (20,0 × 20,0 × 20,0 mm). No entran todas en la cama.',
    ],
    [
        'sin medida todavía (visor cargando)',
        { piezas: [{ nombre: 'cubo-20mm.stl', tamano: null, copias: 1 }], entra: true },
        'Vista 3D de la cama con 1 pieza: cubo-20mm.stl (todavía sin medida).',
    ],
];

/**
 * @param {(ok: boolean, texto: string) => void} chequear imprime ✔/✘ y cuenta los fallos
 * @param {(ruta: string) => Promise<any>} cargar carga un módulo de src/ (Vite en `test:contratos`)
 * @returns {Promise<void>}
 */
export async function probarDescripcion(chequear, cargar) {
    console.log('Descripción del visor (ADR 0008, A4)');
    // formato.js pide sus textos a t(): se instala el diccionario de formato en español (misma instancia de idioma.js).
    const { ponerDiccionarios } = await cargar('/src/ui/idioma.js');
    const es = JSON.parse(readFileSync(new URL('../../src/textos/es/formato.json', import.meta.url), 'utf8'));
    ponerDiccionarios('es', es, es);
    const { textoDescripcionVisor } = await cargar('/src/ui/visor-descripcion.js');
    for (const [nombre, datos, esperado] of CASOS) {
        const texto = textoDescripcionVisor(datos);
        chequear(texto === esperado, `${nombre}: ${texto === esperado ? esperado : `"${texto}" ≠ "${esperado}"`}`);
    }
    const una = { piezas: [{ nombre: 'x.stl', tamano: CUBO, copias: 1 }], entra: true };
    const tres = { piezas: [{ nombre: 'x.stl', tamano: CUBO, copias: 3 }], entra: true };
    chequear(
        textoDescripcionVisor(una) !== textoDescripcionVisor(tres) && textoDescripcionVisor(tres).includes('3 copias'),
        'las copias cambian el texto',
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { createServer } = await import('vite');
    const vite = await createServer({
        logLevel: 'error',
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
    });
    let fallos = 0;
    try {
        await probarDescripcion(
            (ok, texto) => {
                if (!ok) fallos++;
                console.log(`  ${ok ? '✔' : '✘'} ${texto}`);
            },
            ruta => vite.ssrLoadModule(ruta),
        );
    } finally {
        await vite.close();
    }
    process.exit(fallos ? 1 : 0);
}
