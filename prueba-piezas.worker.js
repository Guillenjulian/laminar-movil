// SOLO PARA test:motor (página de diagnóstico prueba-motor.html). No es parte de la app: vite.config.js lo deja fuera de la lista del service worker.
// Worker de la página de pruebas (ADR 0003, T0): es el worker original de Kiri con su propio protocolo
// ({ task, data, seq }), más los minions locales que usa también laminador.worker.js. Así prueba-motor.html puede
// mandarle clear / sync (uno por widget) / slice por id / prepare / export, cosa que laminador.worker.js no expone.
import './vendor/kiri/src/kiri/run/worker.js';
import { usarMinionsLocales } from './src/motor/minions-locales.js';

usarMinionsLocales(globalThis.kiri_worker.minions);
