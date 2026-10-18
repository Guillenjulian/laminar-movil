// Punto de entrada: sólo cablea los módulos de src/ui/ y arranca la app (ver docs/decisiones/0001-dividir-main.md).
//
// Flujo de arranque, en este orden:
// 1. Listeners: cada iniciarX() engancha sus controles. Van ANTES del await para que los botones
//    respondan aunque la lectura de preferencias tarde.
// 2. Preferencias y precios: un solo await. Todo lo que depende de ellos (incluido el costo) se dibuja después.
// 3. Primer dibujo: opciones, pantalla 1 y modelos recientes.
// 4. Tareas de fondo: pedir almacenamiento persistente, registrar el service worker (sólo en el build) y
//    precargar el chunk del visor 3D (three.js) cuando el navegador está libre (ADR 0006).

import * as almacen from './almacen.js';
import * as materialesUI from './ui/materiales.js';
import { cargarPreferencias } from './ui/estado.js';
import { iniciarNavegacion, mostrar, alMostrarPaso, irAPaso1 } from './ui/navegacion.js';
import { iniciarImpresoras } from './ui/impresoras.js';
import { iniciarPaso2, dibujarOpciones } from './ui/paso2-config.js';
import { iniciarPaso1, alCambiarImpresora, elegirOtroModelo, mostrarRecientes } from './ui/paso1-modelo.js';
import { iniciarPaso3 } from './ui/paso3-laminar.js';
import { iniciarPaso4, mostrarResultado } from './ui/paso4-resultado.js';
import { iniciarVistaCapas } from './ui/vista-capas.js';
import { programarPrecarga } from './ui/entrega-ui.js';
import { registrarServiceWorker } from './ui/actualizacion.js';
import { precargarVisor } from './ui/visor-carga.js';

// 1. Listeners.
iniciarNavegacion();
iniciarPaso1();
const preciosListos = materialesUI.iniciarMateriales();
iniciarImpresoras({
    alElegir: () => {
        dibujarOpciones();
        alCambiarImpresora();
    },
});
iniciarPaso2({ irAPaso1 });
// Al entrar al paso 2 se redibuja: el modelo nuevo (y su torre, si es una) cambia lo que muestra.
alMostrarPaso(paso => paso === 2 && dibujarOpciones());
iniciarPaso3({ alTerminar: mostrarResultado });
iniciarPaso4({ alOtroModelo: elegirOtroModelo });
iniciarVistaCapas({ alCambiarPausas: programarPrecarga });

// 2. Preferencias.
await Promise.all([cargarPreferencias(), preciosListos]);

// 3. Primer dibujo.
dibujarOpciones();
mostrar(1);
mostrarRecientes();

// 4. Tareas de fondo.
almacen.pedirAlmacenamientoPersistente();
registrarServiceWorker();
(window.requestIdleCallback ?? (f => setTimeout(f, 1)))(precargarVisor);
