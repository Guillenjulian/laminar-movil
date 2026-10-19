// Guardianes de los diccionarios es/en (ADR 0008, "Pruebas", puntos 2 a 9; el 1, `t`, es de nucleo.mjs).
// Lee src/textos/<idioma>/<area>.json con fs (sin Vite). Primero corre las autopruebas con datos sintéticos
// (autopruebas.mjs) y después los chequeos reales (chequeos.mjs). Si falta src/textos/, cada chequeo informa
// "✘ falta src/textos/…".
//
// Convención de "claves no usadas" (punto 5): el escáner busca usos LITERALES, con comillas, en todo `src/**/*.js`
// (menos src/textos/ y el Kiri vendorizado) y en index.html:
//   - JavaScript: t('a.b'), existe('a.b') y marcar('a.b') (también con "" o `` sin ${}); se ignoran los comentarios.
//   - HTML: data-t="a.b", data-t-html="a.b" y data-t-attr="atributo:a.b;otro:a.c" (sólo aria-label, placeholder, alt,
//     content y title).
// Una clave dinámica (t(variable), t(`a.${x}`), marcar(id)) falla: usá una tabla con marcar() y después t(TABLA[id]).
// existe(variable) se tolera (perfiles busca existe por id): sus claves se declaran por prefijo en CLAVES_RESERVADAS.
// Una reserva vence: si un prefijo reservado ya no tiene ninguna clave sin uso, el chequeo "reserva vencida" falla.
//
// Español suelto (punto 8): MIGRADOS lista los archivos de src/ ya migrados; en ellos ningún literal (tampoco los de
// dentro de ${…}) puede llevar áéíóúñ¿¡, empezar con mayúscula + 2 minúsculas ("Cancelar") ni, en textos de dos palabras
// o más, palabras vacías del español (el, la, los, las, de, del, al, en, un, una, mi, tu, se, por, y, sin, más, que,
// para, con, no), salvo `// t-ignorar` en la línea. 'AbortError' (sin espacios, mayúscula interna) no cuenta.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { inglesCopiado } from './detectores.mjs';
import { chequeos } from './chequeos.mjs';
import { autopruebas } from './autopruebas.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const TEXTOS = join(RAIZ, 'src', 'textos');
/** Prefijos de claves definidas que todavía no se usan o se usan sin literal. Cada reserva vence: cuando el prefijo
 *  ya no tiene claves sin uso, `reserva vencida` falla y hay que sacarlo. Uno por línea. */
export const CLAVES_RESERVADAS = [
    'comun.', // sin dueño todavía: la primera hoja que use aceptar/cancelar/cerrar/reintentar lo saca
    'formato.', // I4 (formato.js pasa a t())
];
/** Archivos de src/ ya migrados a t(), con ruta desde la raíz; uno por línea. Cada tarea de migración descomenta los
 *  suyos en el mismo commit (bloques separados para que las tareas en paralelo no choquen). */
export const MIGRADOS = [
    // I8
    // 'src/ui/paso1-modelo.js',
    // 'src/ui/ajuste-modelo.js',
    // 'src/ui/recientes.js',
    // 'src/ui/visor-carga.js',
    // I9
    // 'src/ui/piezas-ui.js',
    // 'src/ui/copias-ui.js',
    // 'src/ui/bloqueos-ui.js',
    // 'src/ui/torres.js',
    // 'src/ui/litofania.js',
    // I10
    // 'src/ui/paso2-config.js',
    // 'src/ui/soportes-tipo-ui.js',
    // 'src/ui/materiales.js',
    // 'src/ui/impresoras.js',
    // 'src/ui/formulario-impresora.js',
    // I11
    // 'src/ui/avanzado.js',
    // 'src/ui/cambios.js',
    // 'src/ui/iconos-relleno.js',
    // I12
    // 'src/ui/paso3-laminar.js',
    // 'src/ui/paso4-resultado.js',
    // 'src/ui/entrega-ui.js',
    // 'src/ui/vista-capas.js',
    // 'src/ui/pausas-ui.js',
    // 'src/ui/aviso-vista.js',
    // 'src/ui/actualizacion.js',
];
const SIN_ESCANEAR = ['src/textos', 'src/perfiles/impresoras/kiri'];

/** Lee src/textos/<idioma>/*.json. @returns {{dic: Record<string, any>, errores: string[]}|null} null si falta la carpeta */
function leerIdioma(idioma) {
    const carpeta = join(TEXTOS, idioma);
    if (!existsSync(carpeta)) return null;
    const dic = {};
    const errores = [];
    for (const f of readdirSync(carpeta).filter(n => n.endsWith('.json'))) {
        try {
            dic[f.slice(0, -5)] = JSON.parse(readFileSync(join(carpeta, f), 'utf8'));
        } catch (error) {
            errores.push(`JSON inválido en src/textos/${idioma}/${f}: ${error.message}`);
        }
    }
    return { dic, errores };
}

/** Archivos .js de src/ salvo SIN_ESCANEAR. @returns {string[]} rutas absolutas */
function archivosJs(carpeta = join(RAIZ, 'src')) {
    return readdirSync(carpeta, { withFileTypes: true }).flatMap(e => {
        const ruta = join(carpeta, e.name);
        if (SIN_ESCANEAR.includes(relative(RAIZ, ruta).split('\\').join('/'))) return [];
        if (e.isDirectory()) return archivosJs(ruta);
        return e.name.endsWith('.js') ? [ruta] : [];
    });
}

/** Informa un chequeo: ✔ si no hay mensajes; si no, ✘ con la lista (tope de 15 líneas). */
function informar(revisar, nombre, errores) {
    const resto = errores.length > 15 ? [`… y ${errores.length - 15} más`] : [];
    revisar(nombre, errores.length === 0, `\n      ${[...errores.slice(0, 15), ...resto].join('\n      ')}`);
}

/** @param {{revisar: Function, igual: Function}} ctx @returns {Promise<void>} */
export default async function (ctx) {
    autopruebas(ctx);
    console.log('-- diccionarios reales (src/textos)');
    const es = leerIdioma('es');
    const en = leerIdioma('en');
    const entrada = {
        es: es?.dic,
        en: en?.dic,
        js: archivosJs().map(r => ({ ruta: relative(RAIZ, r), texto: readFileSync(r, 'utf8') })),
        html: readFileSync(join(RAIZ, 'index.html'), 'utf8'),
        migrados: MIGRADOS.map(m => ({
            ruta: m,
            texto: existsSync(join(RAIZ, m)) ? readFileSync(join(RAIZ, m), 'utf8') : null,
        })),
        reservadas: CLAVES_RESERVADAS,
        lectura: [...(es?.errores ?? []), ...(en?.errores ?? [])],
    };
    if (!es || !en) {
        for (const [, nombre] of chequeos({ ...entrada, es: {}, en: {} })) {
            ctx.revisar(`falta src/textos/${es ? 'en' : 'es'}/ (${nombre})`, false);
        }
        return;
    }
    for (const [, nombre, errores] of chequeos(entrada)) informar(ctx.revisar, nombre, errores);
    const copias = inglesCopiado(es.dic, en.dic);
    if (copias.length) {
        console.log(
            `  ! aviso: ${copias.length} valores de en iguales a es:\n      ${copias.slice(0, 10).join('\n      ')}`,
        );
    }
}
