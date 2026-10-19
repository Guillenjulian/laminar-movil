// Paso 1: tipos de archivo que acepta la app y la hoja "Litofanía desde una foto".
//
// La foto se decodifica acá, en el hilo principal (createImageBitmap + canvas,
// que en los workers no siempre está), y se pasa en escala de grises al worker
// que arma la malla (ver motor/litofania.js).

import { litofaniaAStl } from '../motor/motor.js';
import { resolucionLitofania, MARCO_MM } from '../motor/litofania.js';
import * as formato from './formato.js';
import { $, anunciar } from './util-dom.js';

// 'stl' | 'obj' | '3mf' | 'imagen' | null (no lo sabemos leer)
export function tipoArchivo(nombre) {
    const m = /\.([a-z0-9]+)$/i.exec(nombre || '');
    const ext = m ? m[1].toLowerCase() : '';
    if (ext === 'stl' || ext === 'obj' || ext === '3mf') return ext;
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'imagen';
    return null;
}

// Nombre del STL que sale de una foto: "gato.jpg" -> "gato-litofania.stl".
export function nombreLitofania(nombreFoto) {
    return nombreFoto.replace(/\.[a-z0-9]+$/i, '') + '-litofania.stl';
}

function leerOpciones(form) {
    const f = form.elements;
    return {
        tipo: f.tipo.value,
        anchoMm: Number(f.ancho.value),
        minMm: Number(f.minimo.value),
        maxMm: Number(f.maximo.value),
        marco: f.marco.checked,
    };
}

function validar(o) {
    if (!(o.anchoMm >= 10 && o.anchoMm <= 500)) return 'El ancho tiene que estar entre 10 y 500 mm.';
    if (!(o.minMm >= 0.2)) return 'El espesor mínimo tiene que ser de al menos 0,2 mm.';
    if (!(o.maxMm >= o.minMm)) return 'El espesor máximo tiene que ser mayor o igual que el mínimo.';
    if (o.maxMm > 50) return 'El espesor máximo no puede pasar de 50 mm.';
    return null;
}

// Muestra el alto que va a tener (sale de la proporción de la foto).
function mostrarMedidas(o, imagen) {
    const marco = o.marco ? 2 * MARCO_MM : 0;
    const alto = (o.anchoMm * imagen.height) / imagen.width;
    $('medidasLitofania').textContent =
        o.anchoMm > 0 ? formato.milimetros({ x: o.anchoMm + marco, y: alto + marco, z: o.maxMm || 0 }) : '';
}

// Decodifica la foto en el hilo principal; null si no se puede abrir.
async function decodificarFoto(buffer) {
    try {
        return await createImageBitmap(new Blob([buffer]));
    } catch {
        alert('No pudimos abrir esa imagen. Probá con una foto PNG, JPG o WebP.');
        return null;
    }
}

// Escala la foto a grises y pide el STL al worker.
async function generarStl(imagen, o) {
    const { ancho, alto } = resolucionLitofania(imagen.width, imagen.height, o.anchoMm);
    const grises = escalaDeGrises(imagen, ancho, alto);
    const { stl } = await litofaniaAStl({ ...o, grises, ancho, alto });
    return stl;
}

// Arma la hoja. `abrir()` y `cerrar()` son abrirHoja/cerrarHojas de navegacion.js (paso1-modelo las pasa);
// `cargar(nombre, generar)` carga el modelo, donde `generar()` devuelve una
// promesa con el STL. Devuelve { abrirFoto(nombre, buffer) }.
export function prepararLitofania({ abrir, cerrar, cargar }) {
    const form = $('formLitofania');
    let foto = null; // { nombre, imagen: ImageBitmap, url }

    function actualizarMedidas() {
        if (foto) mostrarMedidas(leerOpciones(form), foto.imagen);
    }

    form.addEventListener('input', actualizarMedidas);
    form.addEventListener('change', actualizarMedidas);

    form.addEventListener('submit', e => {
        e.preventDefault();
        const o = leerOpciones(form);
        const error = validar(o);
        anunciar($('errorLitofania'), error || '');
        if (error || !foto) return;
        const { nombre, imagen } = foto;
        cerrar();
        cargar(nombreLitofania(nombre), () => generarStl(imagen, o));
    });

    async function abrirFoto(nombre, buffer) {
        const imagen = await decodificarFoto(buffer);
        if (!imagen) return;
        if (foto) {
            foto.imagen.close?.();
            URL.revokeObjectURL(foto.url);
        }
        foto = { nombre, imagen, url: URL.createObjectURL(new Blob([buffer])) };
        $('fotoLitofania').src = foto.url;
        $('nombreFoto').textContent = nombre;
        $('errorLitofania').hidden = true;
        actualizarMedidas();
        abrir();
        form.parentElement.scrollTo?.(0, 0);
    }

    return { abrirFoto };
}

// Dibuja la imagen achicada en un canvas (sobre fondo blanco, por si tiene
// transparencias) y devuelve el gris de cada píxel (0 = negro, 255 = blanco).
function escalaDeGrises(imagen, ancho, alto) {
    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, ancho, alto);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imagen, 0, 0, ancho, alto);
    const d = ctx.getImageData(0, 0, ancho, alto).data;
    const grises = new Uint8Array(ancho * alto);
    for (let i = 0, p = 0; i < grises.length; i++, p += 4) {
        grises[i] = Math.round(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
    }
    return grises;
}
