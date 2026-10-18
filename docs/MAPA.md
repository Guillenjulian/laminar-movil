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

En el paso 1 puede haber varias piezas y varias copias de cada una (ADR 0003): `piezas-ui.js` maneja las piezas
(chips, agregar, quitar, pieza activa) y `copias-ui.js` el stepper de copias. `acomodo.js` (`acomodarPiezas`) las
acomoda en la cama con `motor/piezas.js`, y el visor muestra en rojo las copias que no entran. El paso 3 vuelve a
acomodar y lamina `piezasParaMotor()`; el worker arma un widget de Kiri por copia (`preparar-piezas.js`). Con una
sola pieza y una copia, el flujo es el de antes.

Todo lo pesado corre en Web Workers. Cada tarea abre un worker y lo cierra al terminar (`motor.js`).

## 2. Módulos

### Interfaz (`src/`, `src/ui/`)

| Archivo | Responsabilidad | Depende de |
|---|---|---|
| `index.html` | Estructura de los 4 pasos, las hojas (pantallas encima) y las acciones de abajo | — |
| `src/main.js` | Punto de entrada: inicializa los módulos de `src/ui/` en orden (ver ADR 0001) | `almacen` y los módulos de `src/ui/` que inicializa (ver grafo abajo) |
| `src/ui/util-dom.js` | `$` (getElementById) y `escapar` (texto del usuario a entidades para `innerHTML`) | — |
| `src/ui/estado.js` | Objeto `estado` único (con `piezas`, ADR 0003), `crearPieza`, `piezaActiva`, `matrizPieza`, `matrizModelo`, `copiasTotales`, `piezasParaMotor`, `valoresActuales` y la persistencia de preferencias e impresoras propias | `perfiles`, `almacen`, `motor/transformar`, `motor/tipos-linea`, `avanzado` |
| `src/ui/navegacion.js` | Muestra el paso y la hoja correctos y mantiene el historial para que "atrás" funcione; `alMostrarPaso` avisa los cambios de paso | `ui/estado`, `ui/util-dom` |
| `src/ui/paso1-modelo.js` | Sube el modelo (STL, OBJ, 3MF, foto, ejemplo o reciente), crea la pieza en `estado.piezas` y lo muestra en el visor; el ajuste lo hace `ajuste-modelo` y las piezas extra `piezas-ui` | `estado`, `navegacion`, `util-dom`, `visor`, `litofania`, `torres`, `ajuste-modelo`, `piezas-ui`, `motor/motor`, `perfiles/perfiles`, `almacen`, `recientes` |
| `src/ui/ajuste-modelo.js` | Ajuste de la pieza activa (ADR 0003): escala, rotaciones de 90°, apoyar cara, ajustar a la cama, restablecer y avisos (no entra, modelo pesado); en cada `aplicar` guarda en la pieza su medida real (`p.tamano`, desde `visor.tamanoModelo`); `crearAjuste` | `estado`, `util-dom`, `formato`, `motor/transformar`, `perfiles/perfiles`, `config` |
| `src/ui/piezas-ui.js` | Varias piezas en el paso 1 (ADR 0003, T8 y T10): chips de `#listaPiezas` (desde 2 piezas, con `×copias`), "Agregar pieza" (archivo o cubo de ejemplo; no con torre ni litofanía; tope de piezas y de copias; las agregadas van a recientes con `ctx.guardar`), quitar y elegir la pieza activa (chip o toque en el visor). `reacomodar()`: `acomodarPiezas()`, `visor.ponerCopias` por pieza (las que no entran, en rojo), aviso `#avisoEntran` "No entran todas en la cama" y "Siguiente" deshabilitado (con una pieza y una copia no cambia nada: sigue el aviso de `ajuste-modelo`); expone `data-copias` en `#listaPiezas`; `crearPiezas` | `estado`, `util-dom`, `config`, `motor/piezas`, `acomodo`, `copias-ui` |
| `src/ui/copias-ui.js` | Stepper de copias de la pieza activa (ADR 0003, T10): `#copiasPieza` con − / + y el número; mínimo 1, máximo según `validarCantidad` (`MAX_PIEZAS`, `maxCopias()`), con texto que explica el tope; oculto con torre o litofanía; `crearCopias` | `estado`, `util-dom`, `config`, `motor/piezas` |
| `src/ui/acomodo.js` | `acomodarPiezas(medir?)` (ADR 0003, T9), sin DOM (`medir` opcional: tamaño real transformado; sin él, caja de 8 esquinas): huella de cada copia (`vista.tamano` × `matrizPieza`), `motor/piezas.acomodar` con la cama de la impresora elegida y `SEPARACION_PIEZAS_MM`; escribe `p.posiciones` y `estado.entra` y devuelve `{ entra, fuera }` (índices de copia global). Sin `medir` usa `p.tamano` (la medida real que guardan `ajuste-modelo` y `piezas-ui` desde `visor.tamanoModelo`) y, si falta, la caja de 8 esquinas. Lo llaman `piezas-ui` (`reacomodar`) y el paso 3 | `estado`, `motor/piezas`, `motor/transformar`, `perfiles/perfiles`, `config` |
| `src/ui/recientes.js` | Lista de recientes (abrir, borrar) y guardado de escala y rotación de las piezas cargadas como modelo (las agregadas, en T10; las copias no): 500 ms tras el último cambio, o de inmediato al salir del paso 1 / `pagehide` | `estado`, `navegacion`, `util-dom`, `formato`, `almacen` |
| `src/ui/impresoras.js` | Elegir impresora (hoja con búsqueda) y su tarjeta; cablea el formulario de "Mi impresora" | `estado`, `navegacion`, `util-dom`, `formulario-impresora`, `perfiles/perfiles` |
| `src/ui/formulario-impresora.js` | Formulario de "Mi impresora": crear, copiar un perfil como propio, editar y borrar (`iniciarFormularioImpresora`); avisa con el callback `elegir(id)` | `estado`, `navegacion`, `util-dom`, `perfiles/perfiles`, `perfiles/generico` |
| `src/ui/paso2-config.js` | Pantalla del paso 2: calidad, material, soportes, Personalizar y Avanzado (`iniciarPaso2`, `dibujarOpciones`) | `estado`, `impresoras`, `util-dom`, `avanzado`, `cambios`, `materiales`, `iconos-relleno`, `perfiles/perfiles` |
| `src/ui/paso3-laminar.js` | Acomoda las piezas (`acomodarPiezas`; si no entran muestra el error y no lamina), lanza el laminado de `piezasParaMotor()` (con la configuración de la torre si hay una), muestra el progreso, permite cancelar y muestra el error; al terminar llama `alTerminar` | `estado`, `navegacion`, `util-dom`, `motor/motor`, `perfiles/perfiles`, `perfiles/torres`, `config`, `acomodo` |
| `src/ui/paso4-resultado.js` | Resumen del resultado (con "N piezas" si hay copias), avisos (incluye los de cambios por altura fuera de la pieza, `avisosPostLaminado`) y entrega del G-code (compartir, descargar, elegir otro modelo) | `estado`, `navegacion`, `util-dom`, `vista-capas`, `paso2-config`, `formato`, `materiales`, `motor/pausas`, `perfiles/perfiles`, `perfiles/cambios` |
| `src/ui/vista-capas.js` | Vista previa capa por capa (visor, deslizador, reproducción); le inyecta a `pausas-ui` el visor y las capas | `estado`, `navegacion`, `util-dom`, `visor`, `formato`, `motor/motor`, `motor/tipos-linea`, `perfiles/perfiles`, `config`, `pausas-ui` |
| `src/ui/pausas-ui.js` | Pausas de filamento de la vista previa: lista de filamentos, marcas sobre el deslizador, modo y colores de los recorridos | `estado`, `util-dom`, `formato`, `motor/tipos-linea`, `perfiles/perfiles` |
| `src/ui/actualizacion.js` | Registra el service worker y ofrece "Actualizar" cuando hay una versión nueva. Lo llama `main.js` al final del arranque | `util-dom` |
| `src/ui/visor.js` | Visor three.js: cama, una malla por pieza (por `id`, 0 si no se dice: `ponerModelo`, `ponerTransformacion`, `ponerCopias`, `tamanoModelo`, `quitarModelo`, `resaltarPieza`), ciclo de dibujo (sólo cuando algo cambia). Delega en `visor-cara` y `visor-recorridos` (ADR 0003, T5) | three, `visor-cara`, `visor-recorridos`, `visor-cama` |
| `src/ui/visor-cara.js` | Elegir cara con un toque ("apoyar cara"): detección del toque, triángulo resaltado, avisa normal e `id` de la pieza (`elegirCara`, `alTocarPieza`) | three |
| `src/ui/visor-cama.js` | La cama del visor: plano, grilla cada 10 mm y marca del origen; `reemplazarCama` libera la anterior | three |
| `src/ui/visor-recorridos.js` | Recorridos del G-code capa por capa: `ponerRecorridos`, `mostrarCapa`, `pintarRecorridos`, `atenuarAbajo`, `quitarRecorridos`, `esfera` | three, `motor/tipos-linea.js` |
| `src/ui/formato.js` | Números, medidas, duración, gramos y pesos en formato es-AR | — |
| `src/ui/iconos-relleno.js` | SVG de cada patrón de relleno | — |
| `src/ui/torres.js` | Hoja "Torre de calibración" del paso 1 (ADR 0002): tipo, cantidad de bloques, valor de cada uno (sugeridos según impresora y material), avisos y carga como modelo con `estado.torre`. Con torre se ocultan escala y rotación y no entra en recientes | `perfiles/torres`, `perfiles/perfiles`, `motor/motor`, `util-dom`, `formato` |
| `src/ui/litofania.js` | Hoja de opciones de litofanía y decodificación de la foto a grises | `motor/motor`, `motor/litofania`, `formato` |
| `src/ui/materiales.js` | Tarjeta del material, precio del rollo y filas de filamento/costo del resumen. `iniciarMateriales()` registra el listener de "Poné el precio" y devuelve la promesa de carga de precios (la llama `main.js`, que la espera antes del primer dibujo) | `perfiles`, `almacen`, `formato` |
| `src/ui/avanzado.js` | Sección "Avanzado" del paso 2 (jarrón, altura variable, costura, retracción, z-hop, coasting, wipe, compensación, velocidad, temperaturas, ventilador) | `perfiles` |
| `src/ui/cambios.js` | Sección "Cambios por altura" del paso 2 (ADR 0002): agregar, editar y quitar cambios (relleno, temperatura, velocidad, ventilador desde cierta altura en mm), errores de `validarCambios`, ayuda de Velocidad, aviso "sin valor: se ignora" y resumen en el `<summary>`. Deshabilitada con altura variable | `perfiles/cambios`, `util-dom` |
| `src/almacen.js` | IndexedDB: ajustes (`preferencias`, `impresorasPropias`, `precios`), modelos y archivos recientes | — |
| `src/config.js` | Límites que dependen de la memoria del equipo (`maxTriangulos`, `maxSegmentosVista`, `maxCopias`) y de piezas (`MAX_PIEZAS`, `SEPARACION_PIEZAS_MM`, ADR 0003) | — |
| `src/sw.js` | Service worker (offline). `vite.config.js` le inyecta la lista de archivos | — |
| `src/estilos*.css` | Estilos: base + uno por área (formatos, materiales, avanzado) | — |

Grafo de dependencias de `src/ui/` (ADR 0001, sección 2; `A → B` = A importa B):

```
Nivel 6   main.js ──► (todos los de abajo)
Nivel 5   paso4-resultado ──► vista-capas, paso2-config
Nivel 4   paso2-config ──► impresoras
Nivel 3   impresoras ──► formulario-impresora
Nivel 3   paso1-modelo ──► ajuste-modelo, piezas-ui, recientes, navegacion
Nivel 2   piezas-ui ──► acomodo, copias-ui
Nivel 2   paso3-laminar ──► acomodo
Nivel 1   acomodo ──► estado, config, motor/piezas, motor/transformar, perfiles
Nivel 2   formulario-impresora   vista-capas   paso3-laminar   ──► navegacion
          vista-capas ──► pausas-ui
Nivel 1   pausas-ui ──► estado, util-dom
Nivel 1   copias-ui ──► estado, util-dom, config, motor/piezas
Nivel 1   ajuste-modelo ──► estado, util-dom, formato, motor/transformar, perfiles, config
Nivel 1   visor ──► visor-cara, visor-recorridos, visor-cama (hojas, nivel 0)
Nivel 1   navegacion ──► estado
          pausas-ui ──► estado, util-dom
Nivel 0   estado, util-dom, actualizacion, cambios, torres ──► hojas ya existentes (avanzado, formato, materiales,
                                              litofania, visor, motor/*, perfiles/*, almacen, config)
```

La lista exacta de aristas está en el ADR 0001, sección 2; `npm run test:contratos` la verifica y detecta ciclos.

### Motor (`src/motor/`)

| Archivo | Responsabilidad |
|---|---|
| `motor.js` | API para la interfaz: `laminar` (una pieza o varias con `piezas`, ADR 0003), `leerParaVista`, `leerRecorridos`, `convertirAStl`, `litofaniaAStl`, `torreAStl`. Un worker por tarea, cancelable con `AbortSignal` |
| `laminador.worker.js` | `prepararPiezas` → un widget de Kiri por copia (cada uno con su `track.pos`) → slice por widget, un solo prepare y export → G-code. `info.copias` y `info.tamano` del conjunto |
| `vista.worker.js` | Lee el STL para mostrarlo (cuenta, mide y simplifica sólo para dibujar) |
| `convertir.worker.js` | OBJ/3MF/litofanía/torres de calibración → STL binario |
| `recorridos.worker.js` | G-code → tramos por capa (Uint16), colores, tipos, inicio de capa y offset de cada pausa |
| `stl.js` · `formatos.js` · `litofania.js` | Lectores y generadores de mallas (Float32Array de triángulos) |
| `formatos-3mf.js` | Lector de 3MF (`leer3MF`, `leerXML3MF`); `formatos.js` lo re-exporta |
| `torres.js` | Mallas puras de las torres de calibración (`generarTorreTemperatura`, `generarTorreRetraccion`) y `bloquesDeTorre`; sin imports (ADR 0002) |
| `piezas.js` | Varias piezas o copias (ADR 0003): `acomodar` (estantes en la cama), `repartirTriangulos` y `validarCantidad`; funciones puras, sin imports |
| `preparar-piezas.js` | `prepararPiezas` (ADR 0003): lee, transforma, decima (tope repartido), centra y replica por copia; valida la cama. Exporta `centrar` (la usa el worker). No importa Kiri |
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
| `impresoras/kiri/*.json` | 50 importadas de Kiri (`estado: importado`; la K1 y la Kobra 2 las tapa su perfil revisado, así que la app lista 48). **Generados**: no editar a mano |
| `materiales.json` · `opciones.json` | Materiales (temperaturas, densidad, avisos) · patrones, densidades, adhesiones |
| `perfiles.js` | `armarConfiguracion()`: combina impresora → calidad → material → adhesión → personalizado → avanzado → soportes, y recorta las temperaturas. `COSTURAS` (`avanzadoAProceso` es interna). Re-exporta la API pública de `catalogo.js` y `valores.js` (`procesoDeCalidad` queda interna de `valores.js`); los demás módulos siguen importando de acá |
| `catalogo.js` | Catálogo de impresoras: glob de los JSON, `reemplaza`/`idVigente`, `listaImpresoras`, `ponerImpresorasPropias`, `existeImpresora`, `buscarImpresora`, `IMPRESORA_INICIAL`. Importa sólo `generico` (no `perfiles`) |
| `valores.js` | Lo que se lee de un perfil: `lineasPausa`, `procesoDeCalidad`, `valoresDeCalidad`, `valoresDeAvanzado`, `esBowden`. Importa `catalogo` y `materiales.json` |
| `cambios.js` | Cambios por altura (ADR 0002), funciones puras sin imports: `validarCambios`, `cambiosARangos` (mm → `process.ranges` de Kiri), `resumenCambios`, `avisosPostLaminado` |
| `torres.js` | Configuración de las torres de calibración (ADR 0002): `valoresSugeridos` (según `hotendMax` y Bowden), `armarTorre`, `configuracionDeTorre` (bloque 0 en Avanzado, el resto como `cambios`). Importa `motor/torres`, `cambios` y `perfiles` |
| `generico.js` | Calidades a partir de boquilla y velocidad, plantillas Marlin/Klipper, perfil de "Mi impresora" |
| `LEEME.md` | Referencia de todas las claves |

### Motor externo: `vendor/kiri/`
Kiri:Moto 4.7.0 (MIT), copiado por `scripts/vendor-kiri.mjs`. **No editar a mano.** Los parches están en el script y marcados `PARCHE laminar-movil`. Detalle en `vendor/kiri/ORIGEN.md`.

## 3. Estado (`estado` en src/ui/estado.js)

`estado` vive en `src/ui/estado.js`. Los módulos de la interfaz lo importan (un solo objeto, por referencia) y lo leen en el momento; `cargarPreferencias` lo rellena al arrancar y `guardarPreferencias` / `guardarPropias` lo envían a IndexedDB.

| Clave | Qué guarda | Se persiste |
|---|---|---|
| `piezas`, `activa`, `entra` | `Pieza[]` (id, nombre, stl, vista, rotacion, escala, copias, origen, posiciones y `tamano`; ADR 0003), id de la pieza activa (`null` = la primera) y si entran en la cama. `tamano` es la medida real ya transformada (`{x,y,z}`): la guarda `ajuste-modelo` y `piezas-ui` desde `visor.tamanoModelo`, y `acomodarPiezas` la usa. Se carga con `estado.piezas = [crearPieza({...})]; estado.activa = id` | recientes guarda nombre, stl, rotación y escala (no las copias) |
| `nombre`, `stl`, `vista`, `rotacion`, `escala` | Accesores de la pieza activa (sin pieza: `''`, `null`, `null`, identidad, `1`, y el setter no hace nada: cargar un modelo exige crear la pieza antes) | sí, en recientes (500 ms o al salir) |
| `impresoraId`, `calidad`, `material`, `soportes`, `personal`, `avanzado` | Elecciones del paso 2 (sólo lo cambiado) | sí, en `preferencias` |
| `propias` | Impresoras del usuario | sí, en `impresorasPropias` |
| `resultado` | `{ gcode, info, archivo, impresoraId, capas, cambios }` del último laminado (`capas`: alturas de capa usadas; `cambios`: los efectivos y validados, o los de la torre) | no |
| `cambios` | Cambios por altura (`Cambio[]`, ADR 0002); se pasan a `armarConfiguracion`; tras laminar, los efectivos y validados van a `estado.resultado.cambios` y a `avisosPostLaminado` (paso 4). Se vacían al cargar un modelo | no |
| `torre` | Torre de calibración cargada (`Torre` + `aviso` + `resumen`, ADR 0002) o `null`; si existe, `paso3-laminar` usa `configuracionDeTorre` por encima de Avanzado, Personalizar, soportes y cambios | no |
| `pausas`, `coloresFilamento`, `modoColor` | Pausas y colores de la vista previa | no |

## 4. Pruebas

| Comando | Qué prueba | Dónde |
|---|---|---|
| `npm run test:transformar` | Matrices (Node) | `scripts/probar-transformar.mjs` |
| `npm run test:formatos` | OBJ, 3MF y litofanía (Node) | `scripts/probar-formatos.mjs` |
| `npm run test:torres` | Mallas de las torres de calibración: cerradas, medidas, `bloquesDeTorre` (Node) | `scripts/probar-torres.mjs` |
| `npm run test:piezas` | Acomodo de piezas en la cama (Node): posiciones exactas, separación, `fuera`, reparto de triángulos y límites de cantidad; y `prepararPiezas`: vértices, copias, decimación repartida, borde de la cama y posiciones inválidas | `scripts/probar-piezas.mjs` + `scripts/piezas/preparar.mjs` |
| `npm run test:cambios` | Cambios por altura (Node): validación, mapeo mm → capa, campos de Kiri, resumen y avisos | `scripts/probar-cambios.mjs` |
| `npm run test:contratos` | Contratos de los módulos nuevos de `src/ui/` (ADR 0001): exports y aridad, que importarlos no toque el DOM, aristas permitidas y ciclos. Los que no existen se saltean; `CONTRATOS_ESTRICTO=1` los exige. También corre las pruebas de los accesores de `estado.piezas` (Node) | `scripts/probar-contratos.mjs` + `scripts/lib/contratos-ui.js` + `scripts/probar-estado.mjs` |
| `npm run test:motor` | Laminado real en Chromium: perfil, calidades, relleno, adhesión, materiales, soportes, pausas, transformaciones, todas las impresoras importadas, malla pesada, cambios por altura (ADR 0002: relleno, temperatura, velocidad, ventilador, retracción, balsa, jarrón, pausa), torres de calibración (casos 10-11: M104 y retracción por bloque), los 8 perfiles revisados (tabla fija de datos de fábrica, macros sin reemplazar, temperaturas, X/Y dentro de la cama, retracción esperada, orden de arranque, G29 sólo donde corresponde, `reemplaza` e `idVigente`) y varias piezas con `track.pos` (ADR 0003: T0 con falda, borde, balsa y soportes; T6 con equivalencia con una pieza, 4 copias, alturas distintas, cambio por altura, fuera de la cama) | `scripts/probar-motor.mjs` + `prueba-motor.html` + `scripts/motor/cambios.mjs` + `scripts/motor/torres.mjs` + `scripts/motor/perfiles-revisados.mjs` + `scripts/motor/piezas-kiri.mjs` + `scripts/motor/piezas.mjs` |
| `npm run test:app` | La app de punta a punta emulando un Pixel 7, offline incluido | `scripts/probar-app.mjs` (orquestador) + `scripts/app/*.mjs` + `scripts/lib/` |
| `npm run lint` | ESLint (recomendado + límites de tamaño como aviso: 300 líneas por archivo, 40 por función); `npm run lint:fix` aplica los arreglos automáticos | `eslint.config.js` |
| `npm run format:check` | Prettier (4 espacios, comillas simples, 120 columnas); `npm run format` lo aplica | `.prettierrc.json` |

### `test:app` por área

`scripts/probar-app.mjs` sólo arma el contexto (`scripts/lib/app.mjs`: servidor de `dist/`, Chromium como Pixel 7, `ok`) y llama a las áreas en orden. Es un recorrido con estado: cada archivo de `scripts/app/` declara en su cabecera qué espera y cómo deja la app, así que el orden importa. Helpers compartidos en `scripts/lib/` (`chromium.mjs` también lo usa `test:motor`).

| Área | Archivo |
|---|---|
| Paso 1: modelo pesado, cubo, gesto en el visor | `scripts/app/paso1-modelo.mjs` |
| Paso 1: OBJ, 3MF, litofanía | `scripts/app/paso1-formatos.mjs` |
| Paso 1: varias piezas (agregar, activar, escalar, quitar, laminar dos cubos, tope, torre) | `scripts/app/piezas.mjs` |
| Paso 1: copias (stepper, acomodo, aviso "no entran", recientes) | `scripts/app/copias.mjs` |
| Paso 2: calidad, atrás/adelante | `scripts/app/paso2-config.mjs` |
| Paso 3: cancelar, personalizar, laminar el cubo | `scripts/app/paso3-laminar.mjs` |
| Materiales y costo | `scripts/app/materiales.mjs` |
| Avanzado (jarrón, costura, velocidad) | `scripts/app/avanzado.mjs` |
| Cambios por altura (agregar, quitar, altura variable, aviso en el paso 4) | `scripts/app/cambios.mjs` |
| Vista previa por capas | `scripts/app/vista-capas.mjs` |
| Pausas / filamentos | `scripts/app/pausas.mjs` |
| Descarga del G-code | `scripts/app/descarga.mjs` |
| Cambios por altura en el G-code (M104 a 10 mm) | `scripts/app/cambios-gcode.mjs` |
| Impresoras (buscar, propia, copiar) | `scripts/app/impresoras.mjs` |
| Recientes y ajustes guardados | `scripts/app/recientes.mjs` |
| Escala, rotar, apoyar cara | `scripts/app/transformar.mjs` |
| Torres de calibración (hoja, paso 2, M104 por bloque) | `scripts/app/torres.mjs` |
| PWA y sin conexión | `scripts/app/offline.mjs` |

Antes de cualquier commit: `npm run build` y las suites que toquen el área cambiada. Antes de integrar, todas.

### CI

`.github/workflows/ci.yml` corre en cada PR y en cada push a `main` (Node de `.node-version`): `npm ci`, lint, format:check, build, instala Chromium (`playwright-core install --with-deps chromium`) y pasa su ruta en `CHROMIUM_PATH`, y corre `test:transformar`, `test:formatos`, `test:torres`, `test:cambios`, `test:piezas`, `test:motor`, `test:app` y `test:contratos`. Un push nuevo al mismo PR cancela la corrida anterior.

## 5. Dónde buscar si algo falla

| Síntoma | Mirar primero |
|---|---|
| El laminado se cuelga | `laminador.worker.js`: ¿se usa algo del pool de minions? (`minions-locales.js`) |
| G-code con temperatura, ventilador o velocidad mal | `perfiles.js` → `armarConfiguracion` y el orden de combinación; `materiales.json` |
| Macros `{...}` sin reemplazar | `dispositivo.gcodePre/Post` del perfil y el shim de QuickJS en `vendor-kiri.mjs` |
| No abre offline | `src/sw.js` (lista de archivos, `ignoreVary`), `vite.config.js` |
| La vista previa no coincide con las capas | `recorridos.worker.js` (detección de capa por cambio de Z en extrusión) |
| Modo jarrón sin espiral o capas raras | `espiral.js` y el comentario `; capa en espiral` que lee `recorridos.worker.js` |
| La sección "Cambios por altura" no responde o no marca errores | `crearCambios()` en `src/ui/cambios.js` |
| Un cambio por altura no se aplicó y no hay aviso en el paso 4 | `avisosDeCambios()` en `src/ui/paso4-resultado.js` y `avisosPostLaminado` en `src/perfiles/cambios.js` |
| Altura variable sin subir Z | parche de `slice.js` en `vendor-kiri.mjs` |
| La pausa cae en un lugar raro | `recorridos.worker.js` (`pausaCapa`) y `pausas.js` |
| El modelo aparece corrido | `visor.js` (`ponerTransformacion`), `preparar-piezas.js` (`centrar`) |
| Un archivo no abre | `formatos.js` y `formatos-3mf.js` (mensajes de error) y `convertir.worker.js` |
| Un botón del paso 1 no responde | `iniciarPaso1()` en `src/ui/paso1-modelo.js` |
| Escala, rotación, apoyar cara o los avisos del modelo fallan | `crearAjuste()` en `src/ui/ajuste-modelo.js` |
| Un modelo cargado no aparece en `estado` (los accesores no escriben) | `montarModelo()` en `src/ui/paso1-modelo.js` y `crearPieza()` en `src/ui/estado.js` |
| Las copias no se acomodan o el visor no coincide con el G-code | `acomodarPiezas()` en `src/ui/acomodo.js` (posiciones) y `reacomodar()` en `src/ui/piezas-ui.js` (lo que se ve); `prepararPiezas()` en `src/motor/preparar-piezas.js` (cada copia con su `pos`) |
| No se puede agregar una pieza | `dibujar()` y `botonesAgregar()` en `src/ui/piezas-ui.js` (se oculta con torre o litofanía; se deshabilita en el tope de `validarCantidad` en `src/motor/piezas.js`, con `MAX_PIEZAS` y `maxCopias()` de `src/config.js`) |
| Un botón del paso 2 no responde o una opción no se redibuja | `iniciarPaso2()` y `dibujarOpciones()` en `src/ui/paso2-config.js` |
| Laminar, cancelar o el error no se muestran bien | `iniciarPaso3()` en `src/ui/paso3-laminar.js` |
| Compartir, descargar o "Elegir otro modelo" no responden | `iniciarPaso4()` en `src/ui/paso4-resultado.js` |
| La vista previa por capas no responde | `iniciarVistaCapas()` en `src/ui/vista-capas.js` |
| La lista de filamentos, las marcas de pausa o los colores de la vista previa fallan | `dibujarPausas()` y `conectarPausas()` en `src/ui/pausas-ui.js` |
| No se puede elegir una impresora | `iniciarImpresoras()` en `src/ui/impresoras.js` |
| "Mi impresora" (crear, copiar, editar, borrar) no guarda o no abre | `iniciarFormularioImpresora()` en `src/ui/formulario-impresora.js` |
| "Atrás" sale de la app o no cierra la hoja; el paso no cambia | `iniciarNavegacion()` y `mostrar()` en `src/ui/navegacion.js` |
| Las preferencias o "Mi impresora" no se guardan o no vuelven al abrir | `cargarPreferencias`, `guardarPreferencias` y `guardarPropias` en `src/ui/estado.js` |
| El precio del rollo no se guarda | `iniciarMateriales()` en `src/ui/materiales.js` |
| El aviso "Hay una versión nueva" no aparece | `src/ui/actualizacion.js` |

## 6. Deuda técnica conocida
- El chunk principal pesa más de 500 kB (three.js): evaluar importar three dinámicamente.
- ESLint 9.x está deprecado: migrar a ESLint 10.
- Warnings de `npm run lint` (5, 0 errores; no bloquean). Funciones: `espiralar` y `vueltaDesde` (`src/motor/espiral.js`), `leer` (`src/motor/recorridos.worker.js`). Archivos: `scripts/probar-motor.mjs` (549 líneas) y `scripts/probar-formatos.mjs` (320).
- Piezas y copias (ADR 0003):
  - H2: no hay prueba de `p.tamano` con giros que no sean de 90° (`acomodarPiezas` sin `medir`, con la caja de 8 esquinas).
  - H4: en el paso 2 no se avisa si al cambiar de impresora dejan de entrar las piezas; el error recién aparece al laminar (paso 3).
  - En recientes, dos piezas con el mismo nombre y peso guardan sólo la activa (la clave es nombre y bytes; limitación de v1).
  - No hay prueba de piezas con impresoras `originCenter` ni de cama de cinta (R1 del ADR 0003 lo deja pendiente).
  - `progreso` y `cancelación` con más de un widget (N > 1) no tienen prueba propia.
