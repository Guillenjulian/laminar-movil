# Mapa de la app

> **Para qué sirve:** ubicar rápido dónde está cada cosa sin leer todo el código.
> **Regla:** todo cambio que agregue, mueva o borre un módulo actualiza este mapa en el mismo commit.
> **Decisiones de arquitectura:** están en [`docs/decisiones/`](decisiones/). La división de `src/main.js` es el [ADR 0001](decisiones/0001-dividir-main.md).

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
| `src/main.js` | Punto de entrada: inicializa los módulos de `src/ui/` en orden (ver ADR 0001) | `almacen` y los módulos de `src/ui/` que inicializa (ver grafo abajo) |
| `src/ui/util-dom.js` | `$` (getElementById) y `escapar` (texto del usuario a entidades para `innerHTML`) | — |
| `src/ui/estado.js` | Objeto `estado` único, `matrizModelo`, `valoresActuales` y la persistencia de preferencias e impresoras propias | `perfiles`, `almacen`, `motor/transformar`, `motor/tipos-linea`, `avanzado` |
| `src/ui/navegacion.js` | Muestra el paso y la hoja correctos y mantiene el historial para que "atrás" funcione; `alMostrarPaso` avisa los cambios de paso | `ui/estado`, `ui/util-dom` |
| `src/ui/paso1-modelo.js` | Sube y ajusta el modelo en el visor (STL, OBJ, 3MF, foto, ejemplo o reciente): escala, rotación, apoyar cara | `estado`, `navegacion`, `util-dom`, `visor`, `litofania`, `formato`, `motor/motor`, `motor/transformar`, `perfiles/perfiles`, `almacen`, `config` |
| `src/ui/impresoras.js` | Elegir impresora (hoja con búsqueda), su tarjeta y "Mi impresora" (formulario, copiar, editar, borrar) | `estado`, `navegacion`, `util-dom`, `perfiles/perfiles`, `perfiles/generico` |
| `src/ui/paso2-config.js` | Pantalla del paso 2: calidad, material, soportes, Personalizar y Avanzado (`iniciarPaso2`, `dibujarOpciones`) | `estado`, `impresoras`, `util-dom`, `avanzado`, `materiales`, `iconos-relleno`, `perfiles/perfiles` |
| `src/ui/paso3-laminar.js` | Lanza el laminado, muestra el progreso, permite cancelar y muestra el error; al terminar llama `alTerminar` | `estado`, `navegacion`, `util-dom`, `motor/motor`, `perfiles/perfiles`, `config` |
| `src/ui/paso4-resultado.js` | Resumen del resultado, avisos y entrega del G-code (compartir, descargar, elegir otro modelo) | `estado`, `navegacion`, `util-dom`, `vista-capas`, `paso2-config`, `formato`, `materiales`, `motor/pausas`, `perfiles/perfiles` |
| `src/ui/vista-capas.js` | Vista previa capa por capa (visor, deslizador, reproducción) y pausas de filamento | `estado`, `navegacion`, `util-dom`, `visor`, `formato`, `motor/motor`, `motor/tipos-linea`, `perfiles/perfiles`, `config` |
| `src/ui/actualizacion.js` | Registra el service worker y ofrece "Actualizar" cuando hay una versión nueva. Lo llama `main.js` al final del arranque | `util-dom` |
| `src/ui/visor.js` | Visor three.js: cama, modelo con su transformación, elegir cara, recorridos del G-code. Dibuja sólo cuando algo cambia | three, `motor/tipos-linea.js` |
| `src/ui/formato.js` | Números, medidas, duración, gramos y pesos en formato es-AR | — |
| `src/ui/iconos-relleno.js` | SVG de cada patrón de relleno | — |
| `src/ui/litofania.js` | Hoja de opciones de litofanía y decodificación de la foto a grises | `motor/motor`, `motor/litofania`, `formato` |
| `src/ui/materiales.js` | Tarjeta del material, precio del rollo y filas de filamento/costo del resumen. `iniciarMateriales()` registra el listener de "Poné el precio" (lo llama `main.js`) | `perfiles`, `almacen`, `formato` |
| `src/ui/avanzado.js` | Sección "Avanzado" del paso 2 (jarrón, altura variable, costura, retracción, z-hop, coasting, wipe, compensación, velocidad, temperaturas, ventilador) | `perfiles` |
| `src/almacen.js` | IndexedDB: ajustes (`preferencias`, `impresorasPropias`, `precios`), modelos y archivos recientes | — |
| `src/config.js` | Límites que dependen de la memoria del equipo (triángulos, tramos de la vista previa) | — |
| `src/sw.js` | Service worker (offline). `vite.config.js` le inyecta la lista de archivos | — |
| `src/estilos*.css` | Estilos: base + uno por área (formatos, materiales, avanzado) | — |

Grafo de dependencias de `src/ui/` (ADR 0001, sección 2; `A → B` = A importa B):

```
Nivel 5   main.js ──► (todos los de abajo)
Nivel 4   paso4-resultado ──► vista-capas, paso2-config
Nivel 3   paso2-config ──► impresoras
Nivel 2   paso1-modelo   impresoras   vista-capas   paso3-laminar   ──► navegacion
Nivel 1   navegacion ──► estado
Nivel 0   estado, util-dom, actualizacion  ──► hojas ya existentes (avanzado, formato, materiales,
                                              litofania, visor, motor/*, perfiles/*, almacen, config)
```

La lista exacta de aristas está en el ADR 0001, sección 2; `npm run test:contratos` la verifica y detecta ciclos.

### Motor (`src/motor/`)

| Archivo | Responsabilidad |
|---|---|
| `motor.js` | API para la interfaz: `laminar`, `leerParaVista`, `leerRecorridos`, `convertirAStl`, `litofaniaAStl`. Un worker por tarea, cancelable con `AbortSignal` |
| `laminador.worker.js` | STL → transformación → decimación → centrado → Kiri (slice, prepare, export) → G-code |
| `vista.worker.js` | Lee el STL para mostrarlo (cuenta, mide y simplifica sólo para dibujar) |
| `convertir.worker.js` | OBJ/3MF/litofanía → STL binario |
| `recorridos.worker.js` | G-code → tramos por capa (Uint16), colores, tipos, inicio de capa y offset de cada pausa |
| `stl.js` · `formatos.js` · `litofania.js` | Lectores y generadores de mallas (Float32Array de triángulos) |
| `torres.js` | Mallas puras de las torres de calibración (`generarTorreTemperatura`, `generarTorreRetraccion`) y `bloquesDeTorre`; sin imports (ADR 0002) |
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
| `cambios.js` | Cambios por altura (ADR 0002), funciones puras sin imports: `validarCambios`, `cambiosARangos` (mm → `process.ranges` de Kiri), `resumenCambios`, `avisosPostLaminado` |
| `generico.js` | Calidades a partir de boquilla y velocidad, plantillas Marlin/Klipper, perfil de "Mi impresora" |
| `LEEME.md` | Referencia de todas las claves |

### Motor externo: `vendor/kiri/`
Kiri:Moto 4.7.0 (MIT), copiado por `scripts/vendor-kiri.mjs`. **No editar a mano.** Los parches están en el script y marcados `PARCHE laminar-movil`. Detalle en `vendor/kiri/ORIGEN.md`.

## 3. Estado (`estado` en src/ui/estado.js)

`estado` vive en `src/ui/estado.js`. Los módulos de la interfaz lo importan (un solo objeto, por referencia) y lo leen en el momento; `cargarPreferencias` lo rellena al arrancar y `guardarPreferencias` / `guardarPropias` lo envían a IndexedDB.

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
| `npm run test:torres` | Mallas de las torres de calibración: cerradas, medidas, `bloquesDeTorre` (Node) | `scripts/probar-torres.mjs` |
| `npm run test:cambios` | Cambios por altura (Node): validación, mapeo mm → capa, campos de Kiri, resumen y avisos | `scripts/probar-cambios.mjs` |
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

`.github/workflows/ci.yml` corre en cada PR y en cada push a `main` (Node de `.node-version`): `npm ci`, lint, format:check, build, instala Chromium (`playwright-core install --with-deps chromium`) y pasa su ruta en `CHROMIUM_PATH`, y corre `test:transformar`, `test:formatos`, `test:torres`, `test:cambios`, `test:motor`, `test:app` y `test:contratos`. Un push nuevo al mismo PR cancela la corrida anterior.

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
| Un botón del paso 1 no responde | `iniciarPaso1()` en `src/ui/paso1-modelo.js` |
| Un botón del paso 2 no responde o una opción no se redibuja | `iniciarPaso2()` y `dibujarOpciones()` en `src/ui/paso2-config.js` |
| Laminar, cancelar o el error no se muestran bien | `iniciarPaso3()` en `src/ui/paso3-laminar.js` |
| Compartir, descargar o "Elegir otro modelo" no responden | `iniciarPaso4()` en `src/ui/paso4-resultado.js` |
| La vista previa por capas no responde | `iniciarVistaCapas()` en `src/ui/vista-capas.js` |
| No se puede elegir o guardar una impresora | `iniciarImpresoras()` en `src/ui/impresoras.js` |
| "Atrás" sale de la app o no cierra la hoja; el paso no cambia | `iniciarNavegacion()` y `mostrar()` en `src/ui/navegacion.js` |
| Las preferencias o "Mi impresora" no se guardan o no vuelven al abrir | `cargarPreferencias`, `guardarPreferencias` y `guardarPropias` en `src/ui/estado.js` |
| El precio del rollo no se guarda | `iniciarMateriales()` en `src/ui/materiales.js` |
| El aviso "Hay una versión nueva" no aparece | `src/ui/actualizacion.js` |

## 6. Deuda técnica conocida
- El chunk principal pesa más de 500 kB (three.js): evaluar importar three dinámicamente.
- `src/ui/vista-capas.js` supera las 300 líneas físicas (317); el lint no lo marca porque no cuenta blancos ni comentarios. Plan B: `pausas-ui.js` (ADR 0001).
- `src/ui/impresoras.js` (288 líneas) está cerca del límite: plan B = `formulario-impresora.js` (ADR 0001).
- ESLint 9.x está deprecado: migrar a ESLint 10.
- `src/ui/materiales.js` usa top-level await para cargar los precios: revisar su efecto en el arranque.
- Funciones y archivos largos marcados por `npm run lint` (warnings, no bloquean): `visor.js` (`crearVisor`, 310 líneas; el archivo, 313), `crearAvanzado`, `prepararLitofania`, `armarConfiguracion`, `espiral.js` (`espiralar`, `vueltaDesde`), `recorridos.worker.js` (`leer`), `laminador.worker.js` (`laminar`), `litofania.js` (`generarLitofania`), `decimar.js` (`agrupar`), `formatos.js` (`leerOBJ`, `leerXML3MF`), y los archivos `scripts/probar-motor.mjs` (539 líneas) y `scripts/probar-formatos.mjs` (320).
