# Mapa de la app

> **Para qué sirve:** ubicar rápido dónde está cada cosa sin leer todo el código.
> **Regla:** todo cambio que agregue, mueva o borre un módulo actualiza este mapa en el mismo commit.

## 1. Flujo general

```
Paso 1: Subir         Paso 2: Configurar        Paso 3: Laminar            Paso 4: Listo
─────────────         ──────────────────        ───────────────            ─────────────
archivo STL/OBJ/3MF   impresora · calidad       laminador.worker.js        vista capa por capa
o foto (litofanía)    material · soportes       (Kiri:Moto en 1 hilo)      pausas de filamento
   │                  personalizar · avanzado          │                   descargar / compartir
   ▼                         │                         ▼                          ▲
convertir.worker.js          ▼                  G-code (string) ─► recorridos.worker.js
vista.worker.js       perfiles.js ─► { dispositivo, proceso } ─────────────────────┘
visor.js (3D)         armarConfiguracion()
transformar.js (escala/rotación/apoyar cara)
```

Todo lo pesado corre en Web Workers. Cada tarea abre un worker y lo cierra al terminar (`motor.js`).

## 2. Módulos

### Interfaz (`src/`, `src/ui/`)

| Archivo | Responsabilidad | Depende de |
|---|---|---|
| `index.html` | Estructura de los 4 pasos, las hojas (pantallas encima) y las acciones de abajo | — |
| `src/main.js` | Punto de entrada (~70 líneas): inicializa en orden los módulos de `src/ui/`, cablea sus callbacks y registra el service worker (ADR 0001) | `ui/*` (todos los módulos de pasos, `estado`, `navegacion`, `util-dom`, `materiales`), `almacen` |
| `src/ui/util-dom.js` | `$` (getElementById) y `escapar` (texto del usuario a entidades para `innerHTML`) | — |
| `src/ui/estado.js` | Objeto `estado` único, `matrizModelo`, `valoresActuales` y la persistencia de preferencias e impresoras propias | `perfiles`, `almacen`, `motor/transformar`, `motor/tipos-linea`, `avanzado` |
| `src/ui/navegacion.js` | Muestra el paso y la hoja correctos y mantiene el historial para que "atrás" funcione; `alMostrarPaso` avisa los cambios de paso | `ui/estado`, `ui/util-dom` |
| `src/ui/visor.js` | Visor three.js: cama, modelo con su transformación, elegir cara, recorridos del G-code. Dibuja sólo cuando algo cambia | three, `motor/tipos-linea.js` |
| `src/ui/formato.js` | Números, medidas, duración, gramos y pesos en formato es-AR | — |
| `src/ui/iconos-relleno.js` | SVG de cada patrón de relleno | — |
| `src/ui/litofania.js` | Hoja de opciones de litofanía y decodificación de la foto a grises | `motor/motor.js` |
| `src/ui/materiales.js` | Tarjeta del material, precio del rollo y filas de filamento/costo del resumen. `iniciarMateriales()` registra el listener de "Poné el precio" (lo llama `main.js`) | `perfiles`, `almacen`, `formato` |
| `src/ui/avanzado.js` | Sección "Avanzado" del paso 2 (jarrón, altura variable, costura, retracción, z-hop, coasting, wipe, compensación, velocidad, temperaturas, ventilador) | `perfiles` |
| `src/almacen.js` | IndexedDB: ajustes (`preferencias`, `impresorasPropias`, `precios`), modelos y archivos recientes | — |
| `src/config.js` | Límites que dependen de la memoria del equipo (triángulos, tramos de la vista previa) | — |
| `src/sw.js` | Service worker (offline). `vite.config.js` le inyecta la lista de archivos | — |
| `src/estilos*.css` | Estilos: base + uno por área (formatos, materiales, avanzado) | — |

### Motor (`src/motor/`)

| Archivo | Responsabilidad |
|---|---|
| `motor.js` | API para la interfaz: `laminar`, `leerParaVista`, `leerRecorridos`, `convertirAStl`, `litofaniaAStl`. Un worker por tarea, cancelable con `AbortSignal` |
| `laminador.worker.js` | STL → transformación → decimación → centrado → Kiri (slice, prepare, export) → G-code |
| `vista.worker.js` | Lee el STL para mostrarlo (cuenta, mide y simplifica sólo para dibujar) |
| `convertir.worker.js` | OBJ/3MF/litofanía → STL binario |
| `recorridos.worker.js` | G-code → tramos por capa (Uint16), colores, tipos, inicio de capa y offset de cada pausa |
| `stl.js` · `formatos.js` · `litofania.js` | Lectores y generadores de mallas (Float32Array de triángulos) |
| `transformar.js` | Matrices 3×3: identidad, multiplicar, rotacion90, escala, rotacionQueApoya, aplicar, medir |
| `decimar.js` | Simplificación por agrupamiento en grilla |
| `pausas.js` | Inserta las pausas (M600/PAUSE) en el G-code al descargar |
| `espiral.js` | Modo jarrón: convierte cada vuelta en rampa de Z (Kiri lo hace en capas planas) |
| `minions-locales.js` | Reemplaza el pool de sub-workers de Kiri (soportes) por cálculo local |
| `tipos-linea.js` | Tipos de línea de Kiri, sus colores, paleta de filamentos, cuantizado |

### Perfiles (`src/perfiles/`): datos, no código

| Archivo | Contenido |
|---|---|
| `impresoras/*.json` | Perfiles armados a mano (`estado: revisado`) |
| `impresoras/kiri/*.json` | 50 importadas de Kiri (`estado: importado`). **Generados**: no editar a mano |
| `materiales.json` · `opciones.json` | Materiales (temperaturas, densidad, avisos) · patrones, densidades, adhesiones |
| `perfiles.js` | `armarConfiguracion()`: combina impresora → calidad → material → adhesión → personalizado → avanzado → soportes, y recorta las temperaturas. `valoresDeAvanzado()`, `avanzadoAProceso()`, `COSTURAS` |
| `generico.js` | Calidades a partir de boquilla y velocidad, plantillas Marlin/Klipper, perfil de "Mi impresora" |
| `LEEME.md` | Referencia de todas las claves |

### Motor externo: `vendor/kiri/`
Kiri:Moto 4.7.0 (MIT), copiado por `scripts/vendor-kiri.mjs`. **No editar a mano.** Los parches están en el script y marcados `PARCHE laminar-movil`. Detalle en `vendor/kiri/ORIGEN.md`.

## 3. Estado (`estado` en src/ui/estado.js)

| Clave | Qué guarda | Se persiste |
|---|---|---|
| `nombre`, `stl`, `vista` | Modelo cargado (ArrayBuffer original y tamaño) | sí, en recientes |
| `rotacion`, `escala` | Transformación del modelo | no |
| `impresoraId`, `calidad`, `material`, `soportes`, `personal`, `avanzado` | Elecciones del paso 2 (sólo lo cambiado) | sí, en `preferencias` |
| `propias` | Impresoras del usuario | sí, en `impresorasPropias` |
| `resultado` | `{ gcode, info, archivo, impresoraId }` del último laminado | no |
| `pausas`, `coloresFilamento`, `modoColor` | Pausas y colores de la vista previa | no |

## 4. Pruebas

| Comando | Qué prueba | Dónde |
|---|---|---|
| `npm run test:transformar` | Matrices (Node) | `scripts/probar-transformar.mjs` |
| `npm run test:formatos` | OBJ, 3MF y litofanía (Node) | `scripts/probar-formatos.mjs` |
| `npm run test:contratos` | Contratos de los módulos nuevos de `src/ui/` (ADR 0001): exports y aridad, que importarlos no toque el DOM, aristas permitidas y ciclos. Los que no existen se saltean; `CONTRATOS_ESTRICTO=1` los exige (Node) | `scripts/probar-contratos.mjs` + `scripts/lib/contratos-ui.js` |
| `npm run test:motor` | Laminado real en Chromium: perfil, calidades, relleno, adhesión, materiales, soportes, pausas, transformaciones, 50 impresoras, malla pesada | `scripts/probar-motor.mjs` + `prueba-motor.html` |
| `npm run test:app` | La app de punta a punta emulando un Pixel 7, offline incluido | `scripts/probar-app.mjs` (orquestador) + `scripts/app/*.mjs` + `scripts/lib/` |
| `npm run lint` | ESLint (recomendado + límites de tamaño como aviso: 300 líneas por archivo, 40 por función); `npm run lint:fix` aplica los arreglos automáticos | `eslint.config.js` |
| `npm run format:check` | Prettier (4 espacios, comillas simples, 120 columnas); `npm run format` lo aplica | `.prettierrc.json` |

### `test:app` por área

`scripts/probar-app.mjs` sólo arma el contexto (`scripts/lib/app.mjs`: servidor de `dist/`, Chromium como Pixel 7, `ok`) y llama a las áreas en orden. Es un recorrido con estado: cada archivo de `scripts/app/` declara en su cabecera qué espera y cómo deja la app, así que el orden importa. Helpers compartidos en `scripts/lib/` (`chromium.mjs` también lo usa `test:motor`).

| Área | Archivo |
|---|---|
| Paso 1: modelo pesado, cubo, gesto en el visor | `scripts/app/paso1-modelo.mjs` |
| Paso 1: OBJ, 3MF, litofanía | `scripts/app/paso1-formatos.mjs` |
| Paso 2: calidad, atrás/adelante | `scripts/app/paso2-config.mjs` |
| Paso 3: cancelar, personalizar, laminar el cubo | `scripts/app/paso3-laminar.mjs` |
| Materiales y costo | `scripts/app/materiales.mjs` |
| Avanzado (jarrón, costura, velocidad) | `scripts/app/avanzado.mjs` |
| Vista previa por capas | `scripts/app/vista-capas.mjs` |
| Pausas / filamentos | `scripts/app/pausas.mjs` |
| Descarga del G-code | `scripts/app/descarga.mjs` |
| Impresoras (buscar, propia, copiar) | `scripts/app/impresoras.mjs` |
| Recientes y ajustes guardados | `scripts/app/recientes.mjs` |
| Escala, rotar, apoyar cara | `scripts/app/transformar.mjs` |
| PWA y sin conexión | `scripts/app/offline.mjs` |

Antes de cualquier commit: `npm run build` y las suites que toquen el área cambiada. Antes de integrar, todas.

### CI

`.github/workflows/ci.yml` corre en cada PR y en cada push a `main` (Node de `.node-version`): `npm ci`, lint, format:check, build, instala Chromium (`playwright-core install --with-deps chromium`) y pasa su ruta en `CHROMIUM_PATH`, y corre `test:transformar`, `test:formatos`, `test:motor`, `test:app` y `test:contratos` (si existe). Un push nuevo al mismo PR cancela la corrida anterior.

## 5. Dónde buscar si algo falla

| Síntoma | Mirar primero |
|---|---|
| El laminado se cuelga | `laminador.worker.js`: ¿se usa algo del pool de minions? (`minions-locales.js`) |
| G-code con temperatura, ventilador o velocidad mal | `perfiles.js` → `armarConfiguracion` y el orden de combinación; `materiales.json` |
| Macros `{...}` sin reemplazar | `dispositivo.gcodePre/Post` del perfil y el shim de QuickJS en `vendor-kiri.mjs` |
| No abre offline | `src/sw.js` (lista de archivos, `ignoreVary`), `vite.config.js` |
| La vista previa no coincide con las capas | `recorridos.worker.js` (detección de capa por cambio de Z en extrusión) |
| Modo jarrón sin espiral o capas raras | `espiral.js` y el comentario `; capa en espiral` que lee `recorridos.worker.js` |
| Altura variable sin subir Z | parche de `slice.js` en `vendor-kiri.mjs` |
| La pausa cae en un lugar raro | `recorridos.worker.js` (`pausaCapa`) y `pausas.js` |
| El modelo aparece corrido | `visor.js` (`ponerTransformacion`), `laminador.worker.js` (`centrar`) |
| Un archivo no abre | `formatos.js` (mensajes de error) y `convertir.worker.js` |

## 6. Deuda técnica conocida
- La división de `src/main.js` (ADR 0001) va casi terminada: ya están todos los módulos de `src/ui/` salvo `actualizacion` (R4); `registrarServiceWorker` sigue en `main.js` (~70 líneas).
- `scripts/probar-app.mjs` (~530 líneas) es un solo recorrido largo: dividir por área con helpers compartidos.
- El chunk principal pesa más de 500 kB (three.js): evaluar importar three dinámicamente.
