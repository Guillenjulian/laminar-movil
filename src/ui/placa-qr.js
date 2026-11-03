// Paso 1: hoja "Placa QR". Una imagen con un código QR (la lámina de un punto de control, por ejemplo)
// se convierte en una placa de 10 × 15 cm para imprimir con un solo extrusor y dos cambios de filamento.
// Con varias imágenes, van en la misma cama tantas placas como entren (lugaresEnCama).
//
// Responsabilidad: decodificar las imágenes (en el hilo principal: createImageBitmap + canvas),
// analizarlas (placa-imagen.js), mostrar lo que se encontró y, al tocar "Generar placa", pedir la malla
// al worker (motor.placasAStl). Las pausas de color se ponen solas en la vista previa (ver pausas-ui.js).
// Flujo: paso1-modelo llama abrirImagenes([{ nombre, buffer }]); con una sola imagen sin QR devuelve
// false y la imagen sigue a la litofanía. Importarlo no toca el DOM: todo se cablea en prepararPlaca.

import { placasAStl } from '../motor/motor.js';
import { PLACA, PAUSAS_PLACA, COLORES_PLACA, lugaresEnCama } from '../motor/placa-medidas.js';
import { $, escapar } from './util-dom.js';

/** Lo que paso1 guarda en `estado.placa` para que la vista previa ponga las pausas solas. */
export const DATOS_PLACA = { pausas: PAUSAS_PLACA, colores: COLORES_PLACA };

// Nombre del STL: "lamina 10.png" -> "lamina 10-placa.stl".
export function nombrePlaca(nombreImagen) {
    return nombreImagen.replace(/\.[a-z0-9]+$/i, '') + '-placa.stl';
}

// Píxeles RGBA de la imagen (a su tamaño, sobre blanco); null si no se puede abrir.
async function leerPixeles(buffer) {
    let imagen;
    try {
        imagen = await createImageBitmap(new Blob([buffer]));
    } catch {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = imagen.width;
    canvas.height = imagen.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imagen, 0, 0);
    imagen.close?.();
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Describe lo que se va a pasar a relieve: cuántos renglones y cuáles salen en bordó.
function resumen(analisis) {
    const n = analisis.bandas.length;
    const bordo = analisis.bandas.filter(b => b.destacado).length;
    const partes = [`${n} ${n === 1 ? 'renglón' : 'renglones'} de texto`];
    if (bordo) partes.push(`${bordo} en bordó`);
    if (analisis.marco) partes.push('marco');
    return partes.join(' · ');
}

// Analiza cada imagen; devuelve las que tienen QR (con su análisis) y los nombres de las que no.
async function analizarTodas(lista) {
    // El lector de QR (jsQR) se baja recién acá, la primera vez que se elige una imagen.
    const { analizarLamina } = await import('./placa-imagen.js');
    const laminas = [],
        sinQr = [];
    for (const { nombre, buffer } of lista) {
        const pixeles = await leerPixeles(buffer);
        const analisis = pixeles && analizarLamina(pixeles);
        if (analisis) laminas.push({ nombre, buffer, analisis });
        else sinQr.push(nombre);
    }
    return { laminas, sinQr };
}

// Llena la hoja: foto de la primera lámina, link (una) o lista de láminas (varias), resumen y avisos.
function mostrar(usadas, { sobran, sinQr, cama }) {
    const una = usadas.length === 1;
    $('nombrePlaca').textContent = una ? usadas[0].nombre : `${usadas.length} láminas`;
    $('lineaEnlace').hidden = !una;
    $('enlacePlaca').textContent = una ? usadas[0].analisis.texto : '';
    $('listaPlacas').hidden = una;
    $('listaPlacas').innerHTML = una
        ? ''
        : usadas.map(l => `<li><b>${escapar(l.nombre)}</b><br />${escapar(l.analisis.texto)}</li>`).join('');
    const medida = `${PLACA.ancho / 10} × ${PLACA.alto / 10} cm`;
    $('resumenPlaca').innerHTML = una
        ? `Encontramos ${escapar(resumen(usadas[0].analisis))}. Va a medir <b>${medida}</b>.`
        : `<b>${usadas.length} placas</b> de ${medida} en la misma cama.`;
    const avisos = [];
    if (sobran.length)
        avisos.push(
            `En la cama de tu impresora (${cama.x} × ${cama.y} mm) entran ${usadas.length}: quedan afuera ${sobran.join(', ')}. Hacelas en la próxima tanda.`,
        );
    if (sinQr.length) avisos.push(`No encontramos un QR en ${sinQr.join(', ')}: se saltean.`);
    $('avisoPlacas').textContent = avisos.join(' ');
    $('avisoPlacas').hidden = !avisos.length;
    $('placaComoLitofania').hidden = !una;
}

// Pide al worker la malla de las placas elegidas y la carga como modelo.
function generar({ usadas, lugares }, cargar) {
    // Copias de las máscaras: se transfieren al worker y así se puede volver a generar.
    const placas = usadas.map(({ analisis: a }) => ({
        ...a,
        bandas: a.bandas.map(b => ({ ...b, mascara: b.mascara.slice() })),
    }));
    const nombre = usadas.length === 1 ? nombrePlaca(usadas[0].nombre) : `placas-${usadas.length}.stl`;
    cargar(nombre, async () => (await placasAStl(placas, lugares)).stl);
}

/**
 * Arma la hoja. `abrir()`/`cerrar()` son abrirHoja/cerrarHojas; `cargar(nombre, generar)` carga el
 * modelo (generar() devuelve una promesa con el STL); `litofania(nombre, buffer)` manda la imagen a la
 * hoja de litofanía; `cama()` da la medida de la cama de la impresora elegida ({ x, y } en mm).
 * @returns {{abrirImagenes: (lista: {nombre: string, buffer: ArrayBuffer}[]) => Promise<boolean>}}
 */
export function prepararPlaca({ abrir, cerrar, cargar, litofania, cama }) {
    let actual = null; // { usadas: [{ nombre, buffer, analisis }], lugares, url }

    $('generarPlaca').onclick = () => {
        if (!actual) return;
        cerrar();
        generar(actual, cargar);
    };
    $('placaComoLitofania').onclick = () => {
        if (!actual) return;
        const { nombre, buffer } = actual.usadas[0];
        cerrar();
        litofania(nombre, buffer);
    };

    async function abrirImagenes(lista) {
        const { laminas, sinQr } = await analizarTodas(lista);
        if (!laminas.length) {
            if (lista.length === 1) return false; // una foto común: va a la litofanía
            alert('Ninguna de esas imágenes tiene un código QR que podamos leer.');
            return true;
        }
        const medida = cama();
        const lugares = lugaresEnCama(medida);
        if (!lugares.length) {
            alert(
                `La placa (${PLACA.ancho} × ${PLACA.alto} mm) no entra en la cama de tu impresora (${medida.x} × ${medida.y} mm).`,
            );
            return true;
        }
        const usadas = laminas.slice(0, lugares.length);
        if (actual) URL.revokeObjectURL(actual.url);
        actual = { usadas, lugares, url: URL.createObjectURL(new Blob([usadas[0].buffer])) };
        $('fotoPlaca').src = actual.url;
        mostrar(usadas, { sobran: laminas.slice(lugares.length).map(l => l.nombre), sinQr, cama: medida });
        abrir();
        return true;
    }

    return { abrirImagenes };
}
