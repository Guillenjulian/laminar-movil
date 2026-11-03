// Paso 1: hoja "Placa QR". Una imagen con un código QR (la lámina de un punto de control, por ejemplo)
// se convierte en una placa de 10 × 15 cm para imprimir con un solo extrusor y dos cambios de filamento.
// Con varias imágenes, van en la misma cama tantas placas como entren (lugaresEnCama). Formato "sólo QR":
// cuadrado de 10 × 10 cm con el QR adelante y los renglones de arriba de la lámina grabados atrás.
//
// Responsabilidad: decodificar las imágenes (en el hilo principal: createImageBitmap + canvas),
// analizarlas (placa-imagen.js), mostrar lo que se encontró y, al tocar "Generar placa", pedir la malla
// al worker (motor.placasAStl). Las pausas de color se ponen solas en la vista previa (ver pausas-ui.js).
// Flujo: paso1-modelo llama abrirImagenes([{ nombre, buffer }]); con una sola imagen sin QR devuelve
// false y la imagen sigue a la litofanía. Importarlo no toca el DOM: todo se cablea en prepararPlaca.

import { placasAStl } from '../motor/motor.js';
import { FORMATOS, lugaresEnCama } from '../motor/placa-medidas.js';
import { $, escapar } from './util-dom.js';

// Nombre del STL: "lamina 10.png" -> "lamina 10-placa.stl" (o "-qr.stl" con el formato sólo QR).
export function nombrePlaca(nombreImagen, formato = 'placa') {
    return nombreImagen.replace(/\.[a-z0-9]+$/i, '') + (formato === 'cuadrado' ? '-qr.stl' : '-placa.stl');
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

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Describe lo que se va a pasar a relieve (placa) o a grabar atrás (cuadrado).
function resumen(analisis, formato) {
    const { bandas } = analisis;
    if (formato === 'cuadrado') {
        const atras = bandas.filter(b => b.arriba).length;
        return `sólo el QR adelante y ${plural(atras, 'renglón grabado', 'renglones grabados')} atrás`;
    }
    const bordo = bandas.filter(b => b.destacado).length;
    const partes = [plural(bandas.length, 'renglón', 'renglones') + ' de texto'];
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

// Cuántas de las láminas van en la cama con el formato elegido.
function distribuir(laminas, formato, cama) {
    const lugares = lugaresEnCama(cama, FORMATOS[formato]);
    return { formato, lugares, usadas: laminas.slice(0, lugares.length), sobran: laminas.slice(lugares.length) };
}

// Llena la hoja: nombre, link (una) o lista de láminas (varias), resumen y avisos.
function mostrar({ formato, usadas, sobran }, { sinQr, cama }) {
    const una = usadas.length === 1;
    const f = FORMATOS[formato];
    const medida = `${f.ancho / 10} × ${f.alto / 10} cm`;
    $('nombrePlaca').textContent = una ? usadas[0].nombre : `${usadas.length} láminas`;
    $('lineaEnlace').hidden = !una;
    $('enlacePlaca').textContent = una ? usadas[0].analisis.texto : '';
    $('listaPlacas').hidden = una;
    $('listaPlacas').innerHTML = una
        ? ''
        : usadas.map(l => `<li><b>${escapar(l.nombre)}</b><br />${escapar(l.analisis.texto)}</li>`).join('');
    const pieza = formato === 'cuadrado' ? ['cuadrado', 'cuadrados'] : ['placa', 'placas'];
    $('resumenPlaca').innerHTML = una
        ? `Encontramos ${escapar(resumen(usadas[0].analisis, formato))}. Va a medir <b>${medida}</b>.`
        : `<b>${plural(usadas.length, ...pieza)}</b> de ${medida} en la misma cama.`;
    const avisos = [];
    if (!usadas.length) avisos.push(`No entra en la cama de tu impresora (${cama.x} × ${cama.y} mm).`);
    else if (sobran.length)
        avisos.push(
            `En la cama de tu impresora (${cama.x} × ${cama.y} mm) entran ${usadas.length}: quedan afuera ${sobran.map(l => l.nombre).join(', ')}. Hacelas en la próxima tanda.`,
        );
    if (sinQr.length) avisos.push(`No encontramos un QR en ${sinQr.join(', ')}: se saltean.`);
    $('avisoPlacas').textContent = avisos.join(' ');
    $('avisoPlacas').hidden = !avisos.length;
    $('generarPlaca').disabled = !usadas.length;
    $('placaComoLitofania').hidden = !una;
}

// Pide al worker la malla de las placas elegidas y la carga como modelo, con sus pausas y colores.
function generar({ formato, usadas, lugares }, cargar) {
    // Copias de las máscaras: se transfieren al worker y así se puede volver a generar.
    const placas = usadas.map(({ analisis: a }) => ({
        ...a,
        bandas: a.bandas.map(b => ({ ...b, mascara: b.mascara.slice() })),
    }));
    const prefijo = formato === 'cuadrado' ? 'qr' : 'placas';
    const nombre = usadas.length === 1 ? nombrePlaca(usadas[0].nombre, formato) : `${prefijo}-${usadas.length}.stl`;
    const { pausas, colores } = FORMATOS[formato];
    cargar(nombre, async () => (await placasAStl(placas, lugares, formato)).stl, { pausas, colores });
}

const formatoElegido = () => document.querySelector('#hojaPlaca [name=formatoPlaca]:checked')?.value || 'placa';

/**
 * Arma la hoja. `abrir()`/`cerrar()` son abrirHoja/cerrarHojas; `cargar(nombre, generar, datos)` carga el
 * modelo (generar() devuelve una promesa con el STL; `datos`: pausas y colores para `estado.placa`);
 * `litofania(nombre, buffer)` manda la imagen a la hoja de litofanía; `cama()` da la medida de la cama de
 * la impresora elegida ({ x, y } en mm).
 * @returns {{abrirImagenes: (lista: {nombre: string, buffer: ArrayBuffer}[]) => Promise<boolean>}}
 */
export function prepararPlaca({ abrir, cerrar, cargar, litofania, cama }) {
    let actual = null; // { laminas: [{ nombre, buffer, analisis }], sinQr, url }
    const ahora = () => distribuir(actual.laminas, formatoElegido(), cama());

    $('generarPlaca').onclick = () => {
        if (!actual || !ahora().usadas.length) return;
        cerrar();
        generar(ahora(), cargar);
    };
    $('placaComoLitofania').onclick = () => {
        if (!actual) return;
        const { nombre, buffer } = actual.laminas[0];
        cerrar();
        litofania(nombre, buffer);
    };
    $('formatoPlaca').onchange = () => actual && mostrar(ahora(), { sinQr: actual.sinQr, cama: cama() });

    async function abrirImagenes(lista) {
        const { laminas, sinQr } = await analizarTodas(lista);
        if (!laminas.length) {
            if (lista.length === 1) return false; // una foto común: va a la litofanía
            alert('Ninguna de esas imágenes tiene un código QR que podamos leer.');
            return true;
        }
        if (actual) URL.revokeObjectURL(actual.url);
        actual = { laminas, sinQr, url: URL.createObjectURL(new Blob([laminas[0].buffer])) };
        $('fotoPlaca').src = actual.url;
        mostrar(ahora(), { sinQr, cama: cama() });
        abrir();
        return true;
    }

    return { abrirImagenes };
}
