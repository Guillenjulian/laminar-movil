// Paso 1: hoja "Placa QR". Una imagen con un código QR (la lámina de un punto de control, por ejemplo)
// se convierte en una placa de 10 × 15 cm para imprimir con un solo extrusor y dos cambios de filamento.
//
// Responsabilidad: decodificar la imagen (en el hilo principal: createImageBitmap + canvas), analizarla
// (placa-imagen.js), mostrar lo que se encontró y, al tocar "Generar placa", pedir la malla al worker
// (motor.placaAStl). Las pausas de color se ponen solas en la vista previa (ver pausas-ui.js).
// Flujo: paso1-modelo llama abrirSiTieneQr(nombre, buffer) con cada imagen; si no tiene QR devuelve
// false y la imagen sigue a la litofanía. Importarlo no toca el DOM: todo se cablea en prepararPlaca.

import { placaAStl } from '../motor/motor.js';
import { PLACA, PAUSAS_PLACA, COLORES_PLACA } from '../motor/placa-medidas.js';
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

/**
 * Arma la hoja. `abrir()`/`cerrar()` son abrirHoja/cerrarHojas; `cargar(nombre, generar)` carga el
 * modelo (generar() devuelve una promesa con el STL); `litofania(nombre, buffer)` manda la imagen a la
 * hoja de litofanía.
 * @returns {{abrirSiTieneQr: (nombre: string, buffer: ArrayBuffer) => Promise<boolean>}}
 */
export function prepararPlaca({ abrir, cerrar, cargar, litofania }) {
    let actual = null; // { nombre, buffer, analisis, url }

    $('generarPlaca').onclick = () => {
        if (!actual) return;
        const { nombre, analisis } = actual;
        cerrar();
        // Copias de las máscaras: se transfieren al worker y así se puede volver a generar.
        const bandas = analisis.bandas.map(b => ({ ...b, mascara: b.mascara.slice() }));
        cargar(nombrePlaca(nombre), async () => (await placaAStl({ ...analisis, bandas })).stl);
    };
    $('placaComoLitofania').onclick = () => {
        if (!actual) return;
        const { nombre, buffer } = actual;
        cerrar();
        litofania(nombre, buffer);
    };

    async function abrirSiTieneQr(nombre, buffer) {
        const pixeles = await leerPixeles(buffer);
        // El lector de QR (jsQR) se baja recién acá, la primera vez que se elige una imagen.
        const analisis = pixeles && (await import('./placa-imagen.js')).analizarLamina(pixeles);
        if (!analisis) return false;
        if (actual) URL.revokeObjectURL(actual.url);
        actual = { nombre, buffer, analisis, url: URL.createObjectURL(new Blob([buffer])) };
        $('fotoPlaca').src = actual.url;
        $('nombrePlaca').textContent = nombre;
        $('enlacePlaca').textContent = analisis.texto;
        $('resumenPlaca').innerHTML =
            `Encontramos ${escapar(resumen(analisis))}. Va a medir <b>${PLACA.ancho / 10} × ${PLACA.alto / 10} cm</b>.`;
        abrir();
        return true;
    }

    return { abrirSiTieneQr };
}
