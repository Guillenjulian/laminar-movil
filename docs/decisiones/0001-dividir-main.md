# 0001. Dividir src/main.js en módulos chicos de src/ui/

- **Fecha:** 2026-10-18
- **Autor/a:** arquitecto
- **Base:** commit `62d5140`

## Estado

Aceptado (CTO, 2026-10-18)

## Contexto

`src/main.js` tiene ~1000 líneas y mezcla seis responsabilidades: estado y persistencia,
navegación/historial, los cuatro pasos de la interfaz, la selección y el formulario de impresoras,
la vista previa capa por capa y el registro del service worker. Todo comparte variables de módulo
(`estado`, `visor`, `visorCapas`, `capas`, `reproduccion`, `litofania`, `avanzado`, `form`) y
se llama entre sí sin fronteras (por ejemplo `mostrar` pausa los dos visores y para la reproducción;
`elegirImpresora` redibuja el paso 2, mueve la cama del visor y recalcula avisos del paso 1).
Eso vuelve lento revisar, probar y repartir trabajo entre devs. `docs/MAPA.md` (sección 6) ya lo
marca como deuda.

Restricciones:

- Es una app sin framework: el DOM se arma con ids de `index.html` y con `innerHTML`.
- Hay un solo punto de entrada (`index.html` carga `src/main.js` como módulo; tiene
  `await` de nivel superior).
- Refactor **sin cambio de comportamiento**: la red de seguridad es `npm run build` y
  `npm run test:app` (recorrido completo de la app en Chromium, emulando un Pixel 7, offline incluido).
- `src/ui/` ya tiene módulos del mismo estilo (`avanzado.js` recibe `{ estado, alCambiar }`;
  `litofania.js` recibe `{ abrir, cerrar, cargar }`): funciones `crearX`/`prepararX` con
  dependencias inyectadas. Este ADR sigue esa convención.
- `main.js` se va a reformatear con Prettier: todo se referencia por **nombre**, no por línea.

## Decisión

### 1. Mecanismo de comunicación: estado compartido + callbacks inyectados

Elegimos **un único objeto `estado` exportado por `estado.js`** (lo importan todos los módulos de UI;
`estado.js` no importa ningún módulo de UI salvo `avanzado.js`, que es una hoja) **más callbacks
inyectados** en `iniciarX({ ... })` para las llamadas "hacia el costado" entre pasos. Además,
`navegacion.js` ofrece un único gancho, `alMostrarPaso(fn)`, para que cada módulo reaccione al cambio
de paso sin que `navegacion.js` los importe.

Reglas:

1. **Hacia abajo: import directo.** Una función puede importar a un módulo que esté *más abajo* en el
   grafo (sección 2). Ejemplo: `paso4` importa `armarVistaPrevia` de `vista-capas`.
2. **Hacia arriba o al costado: callback.** Si A necesita llamar algo de B y B ya depende de A (o son
   pares que no deben conocerse), `main.js` le pasa el callback en `iniciarA({ alX })`.
3. **Cambio de paso:** `navegacion.js` llama a los suscriptores de `alMostrarPaso(fn)`.
4. **Estado de vista privado:** `visor` vive sólo en `paso1-modelo.js` y `visorCapas`, `capas`,
   `reproduccion` sólo en `vista-capas.js`. Nadie más los toca (ver riesgo del visor 3D, sección 6).
5. Los módulos **no tocan el DOM al importarse**: todo `addEventListener`/`onclick` ocurre dentro de
   `iniciarX`. Así se pueden importar en una prueba de contrato sin ejecutar nada.
6. `main.js` es el único que conoce a todos y es el único lugar donde se cablea.
7. Siempre se lee `estado.x` en el momento; prohibido cachear `estado.personal`, `estado.pausas`, etc.
   en variables de módulo (se reasignan, por ejemplo `estado.personal = {}`).

**Por qué no un bus de eventos:** hay sólo 4 llamadas cruzadas reales (tabla abajo); un bus las
escondería en strings (`emitir('impresora-elegida')`) que no se ven en el grafo ni valida el editor,
y agrega un orden de suscripción implícito (otro riesgo de inicialización). Con callbacks el cableado
queda explícito, documentado con JSDoc y concentrado en ~15 líneas de `main.js`. Si aparecen más de ~8
llamadas cruzadas, se revisa este ADR.

**Las llamadas cruzadas (completas):**

| # | Origen → destino | Hoy | Después |
|---|---|---|---|
| 1 | `mostrar` → pausar visores / parar reproducción | llamada directa | `alMostrarPaso` (lo registran `paso1` y `vista-capas`) |
| 2 | `elegirImpresora` → redibujar paso 2, cama del visor, aviso del modelo | llamada directa | callback `alElegir` de `iniciarImpresoras` (main: `() => { dibujarOpciones(); alCambiarImpresora(); }`) |
| 3 | `empezarLaminado` → `mostrarResultado` | llamada directa | callback `alTerminar` de `iniciarPaso3` |
| 4 | `$('otro').onclick` → `$('otroModelo').click()` | simula un clic | callback `alOtroModelo` de `iniciarPaso4` (main: `elegirOtroModelo`) |

Las demás relaciones son hacia abajo (import directo): todos → `estado`/`util-dom`; `paso1`,
`impresoras`, `vista-capas`, `paso3`, `paso4` → `navegacion`; `paso2` → `impresoras` (dibuja la tarjeta
de la impresora elegida); `paso4` → `vista-capas` y `paso2` (`resumenPersonal`).

### 2. Grafo de dependencias (acíclico)

`A → B` significa "A importa B". Cada módulo sólo apunta a niveles más bajos:

```
Nivel 5   main.js ──► (todos los de abajo)
Nivel 4   paso4-resultado ──► vista-capas, paso2-config
Nivel 3   paso2-config ──► impresoras
Nivel 2   paso1-modelo   impresoras   vista-capas   paso3-laminar   ──► navegacion
Nivel 1   navegacion ──► estado
Nivel 0   estado, util-dom, actualizacion  ──► hojas ya existentes (avanzado, formato, materiales,
                                              litofania, visor, motor/*, perfiles/*, almacen, config)
```

Lista exacta de aristas (la prueba de contrato de la tarea T0 las verifica y detecta ciclos):

```
util-dom        → (nada)
estado          → perfiles/perfiles, almacen, motor/transformar, motor/tipos-linea, ui/avanzado
navegacion      → estado, util-dom
paso1-modelo    → estado, navegacion, util-dom, ui/visor, ui/litofania, ui/formato, motor/motor,
                  motor/transformar, perfiles/perfiles, almacen, config
impresoras      → estado, navegacion, util-dom, perfiles/perfiles, perfiles/generico
paso2-config    → estado, impresoras, util-dom, ui/avanzado, ui/materiales, ui/iconos-relleno,
                  perfiles/perfiles
vista-capas     → estado, navegacion, util-dom, ui/visor, ui/formato, motor/motor, motor/tipos-linea,
                  perfiles/perfiles, config
paso3-laminar   → estado, navegacion, util-dom, motor/motor, perfiles/perfiles, config
paso4-resultado → estado, navegacion, util-dom, vista-capas, paso2-config, ui/formato, ui/materiales,
                  motor/pausas, perfiles/perfiles
actualizacion   → util-dom
main            → almacen y todos los módulos de arriba
```

Orden topológico que lo demuestra: `util-dom → avanzado → estado → navegacion → impresoras, vista-capas,
paso1, paso3 → paso2 → paso4 → main` (`actualizacion` en cualquier punto después de `util-dom`).
Nadie importa a `paso1`, `paso3`, `paso4` ni `actualizacion` salvo `main`.

### 3. Módulos: contratos exactos

Convenciones: nombres en español como el resto del código; JSDoc corto; ningún módulo toca `document`
al importarse (regla 5). `$` y `escapar` se importan de `util-dom.js`. Todos los módulos viven en
`src/ui/`. Los tamaños son estimaciones de líneas finales del archivo.

#### 3.0 `src/ui/util-dom.js` (módulo extra, justificado) — ~12 líneas

**Responsabilidad:** helpers mínimos de DOM y texto que usan todos los módulos.
**Justificación:** sin él, `$` y `escapar` se duplicarían en 8 archivos o habría que importarlos desde un
módulo de paso (creando ciclos: `escapar` hoy se usa en el paso 1, la lista de impresoras y las pausas).

```js
/** @param {string} id  id del elemento en index.html. @returns {HTMLElement} */
export const $ = id => document.getElementById(id);

/** Escapa & < > " ' como entidades numéricas, para meter texto del usuario en innerHTML.
 *  @param {string} texto @returns {string} */
export function escapar(texto) {}
```

- **Se mueve de main.js:** `$`, `escapar`.
- **Importa:** nada.

#### 3.1 `src/ui/estado.js` — ~110 líneas

**Responsabilidad:** ser la única fuente del estado de la app y persistir/recuperar las elecciones del usuario.

```js
/** Estado único de la app (claves documentadas en docs/MAPA.md, sección 3).
 *  Mismas claves y valores iniciales que el objeto `estado` actual de main.js. */
export const estado = { paso: 1, nombre: '', stl: null, vista: null, rotacion, escala: 1,
    eligiendoCara: false, impresoraId, propias: [], calidad: 'normal', material: 'pla',
    soportes: false, personal: {}, avanzado: {}, resultado: null, pausas: new Map(),
    coloresFilamento: [...COLORES_FILAMENTO], modoColor: 'tipo', cancelar: null };

/** Matriz 3×3 final del modelo: primero las rotaciones, después la escala.
 *  @returns {number[][]} (la que devuelve transformar.multiplicar) */
export function matrizModelo() {}

/** Valores de relleno/paredes/adhesión actuales: los de la calidad pisados por `estado.personal`.
 *  @returns {{patron:string, densidad:number, paredes:number, arriba:number, abajo:number, adhesion:string}} */
export function valoresActuales() {}

/** Guarda en IndexedDB (sin esperar, errores ignorados) impresoraId, calidad, material, soportes,
 *  personal y avanzado. @returns {void} */
export function guardarPreferencias() {}

/** Publica `estado.propias` en perfiles (ponerImpresorasPropias) y las guarda en IndexedDB.
 *  @returns {Promise<void>} */
export async function guardarPropias() {}

/** Lee impresoras propias y preferencias; descarta lo que ya no existe (impresora, calidad,
 *  material, patrón, adhesión) y valida `avanzado` con validarAvanzado. @returns {Promise<void>} */
export async function cargarPreferencias() {}
```

- **Se mueve de main.js:** constante `estado`, `matrizModelo`, `valoresActuales`, `guardarPropias`,
  `guardarPreferencias`, `cargarPreferencias`.
- **Importa:** `motor/transformar` (`identidad`, `multiplicar`, `escala`), `motor/tipos-linea`
  (`COLORES_FILAMENTO`), `perfiles/perfiles` (`IMPRESORA_INICIAL`, `buscarImpresora`, `existeImpresora`,
  `ponerImpresorasPropias`, `materiales`, `opciones`, `valoresDeCalidad`), `almacen`, `ui/avanzado`
  (`validarAvanzado`).
- **Nota:** `yaMostrado` (hoy una propiedad suelta que `mostrar` agrega a `estado`) pasa a variable
  privada de `navegacion.js`.

#### 3.2 `src/ui/navegacion.js` — ~85 líneas

**Responsabilidad:** mostrar el paso y la hoja correctos y mantener el historial del navegador para que "atrás" funcione.

```js
/** Registra popstate, [data-cerrar], #atras y deja el historial en {paso:1}. Llamar una vez. @returns {void} */
export function iniciarNavegacion() {}

/** Muestra un paso y (opcional) una hoja encima. Si el paso no cambió sólo ajusta las hojas.
 *  Al cambiar de paso: actualiza .pantalla/.acciones/.pasos, #atras, scroll de #main y avisa a los
 *  suscriptores de alMostrarPaso.
 *  @param {1|2|3|4} paso @param {'impresoras'|'mi'|'litofania'|null} [hoja] @returns {void} */
export function mostrar(paso, hoja = null) {}

/** Va a un paso agregando (o reemplazando) una entrada de historial.
 *  @param {1|2|3|4} paso @param {{reemplazar?: boolean}} [opciones] @returns {void} */
export function irA(paso, { reemplazar = false } = {}) {}

/** Abre una hoja encima del paso actual (nivel de historial +1).
 *  @param {'impresoras'|'mi'|'litofania'} hoja @returns {void} */
export function abrirHoja(hoja) {}

/** Cierra todas las hojas abiertas volviendo en el historial. @returns {void} */
export function cerrarHojas() {}

/** Suscribe `fn` a los cambios de paso (se llama sólo cuando el paso realmente cambia, después de
 *  actualizar el DOM). @param {(paso:number) => void} fn @returns {void} */
export function alMostrarPaso(fn) {}
```

- **Se mueve de main.js:** `mostrar`, `irA`, `abrirHoja`, `cerrarHojas`, y los manejadores de
  `popstate`, de `[data-cerrar]` y de `#atras`, más el `history.replaceState` inicial (todo dentro de `iniciarNavegacion`).
- **Cambio de forma (sin cambio de comportamiento):** las líneas `visor?.pausar(paso !== 1)`,
  `visorCapas?.pausar(paso !== 4)` y `if (paso !== 4) pararReproduccion()` salen de `mostrar` y pasan a
  ser suscriptores registrados por `paso1` y `vista-capas`. El `popstate` sigue haciendo
  `if (estado.paso === 3) estado.cancelar?.abort()`.
- **Importa:** `estado`, `util-dom`.

#### 3.3 `src/ui/paso1-modelo.js` — ~250 líneas

**Responsabilidad:** subir/abrir un modelo, mostrarlo en el visor y dejarlo bien puesto en la cama (escala, rotación, apoyar cara, avisos).
**Dueño exclusivo de `visor`** (la instancia de `crearVisor` del paso 1).

```js
/** Cablea #archivo, #foto, #otroModelo, #ejemplo, #siguiente, la lista de recientes, escala,
 *  rotaciones, "ajustar a la cama", "restablecer" y "apoyar cara"; crea la hoja de litofanía
 *  (prepararLitofania) y se suscribe a alMostrarPaso para pausar el visor fuera del paso 1.
 *  Llamar una vez, después de iniciarNavegacion(). @returns {void} */
export function iniciarPaso1() {}

/** Pone la cama del visor con la impresora elegida y recalcula los avisos del modelo.
 *  Callback de impresoras ("alElegir"). No hace nada si el visor aún no existe. @returns {void} */
export function alCambiarImpresora() {}

/** Vuelve a la pantalla inicial del paso 1 (olvida el modelo, quita el modelo del visor,
 *  deshabilita #siguiente y relista recientes). Equivale a tocar #otroModelo. @returns {void} */
export function elegirOtroModelo() {}

/** Relee los modelos guardados y dibuja la lista de recientes. @returns {Promise<void>} */
export async function mostrarRecientes() {}
```

Privadas (no exportadas):

| Función privada | Qué hace | Notas |
|---|---|---|
| `cargarArchivo(nombre, buffer, { guardar, esStl, generar })` | orquesta la carga | se parte (sección 4) |
| `leerModelo(nombre, buffer, tipo, generar)` | **nueva**: convierte (OBJ/3MF/litofanía) y llama `leerParaVista` | extraída de `cargarArchivo` |
| `montarModelo(nombre, datos)` | **nueva**: llena `estado`, crea visor, cama, modelo, textos | extraída de `cargarArchivo` |
| `actualizarAvisoModelo` | avisos de "no entra" y "modelo pesado" | |
| `alElegirArchivo` | handler de #archivo y #foto | |
| `tamanoActual`, `aplicarTransformacion`, `ponerEscala`, `activarElegirCara` | transformación del modelo | |

- **Se mueve de main.js (por nombre):** `cargarArchivo`, `actualizarAvisoModelo`, `alElegirArchivo`,
  `mostrarRecientes`, `tamanoActual`, `aplicarTransformacion`, `ponerEscala`, `activarElegirCara`; la
  variable `visor` y la constante `litofania`; los manejadores de `#archivo`, `#foto`, `#otroModelo`
  (pasa a ser `elegirOtroModelo`), `#listaRecientes`, `#ejemplo`, `#siguiente`, `#escalaMenos`,
  `#escalaMas`, `#escala`, `[data-rotar]`, `#ajustarCama`, `#restablecerModelo`, `#apoyarCara`.
- **Importa:** `estado` (`estado`, `matrizModelo`), `navegacion` (`irA`, `abrirHoja`, `cerrarHojas`,
  `alMostrarPaso`), `util-dom` (`$`, `escapar`), `ui/visor` (`crearVisor`), `ui/litofania`
  (`tipoArchivo`, `prepararLitofania`), `ui/formato`, `motor/motor` (`leerParaVista`, `convertirAStl`),
  `motor/transformar`, `perfiles/perfiles` (`buscarImpresora`), `almacen`, `config` (`maxTriangulos`).

#### 3.4 `src/ui/paso2-config.js` — ~190 líneas

**Responsabilidad:** pantalla única del paso 2: calidad, material, soportes y "Personalizar" (relleno, paredes, adhesión), más la sección Avanzado.

```js
/** Cablea los cambios de calidad/material/soportes/patrón/adhesión/densidad, los contadores,
 *  los atajos de densidad y #restablecer; crea la sección Avanzado (crearAvanzado con
 *  { estado, alCambiar: guardarPreferencias }). Llamar una vez. @returns {void} */
export function iniciarPaso2() {}

/** Redibuja todo el paso 2 desde `estado`: tarjeta de impresora, calidades, materiales,
 *  tarjeta del material, soportes, Personalizar y Avanzado. @returns {void} */
export function dibujarOpciones() {}

/** Texto corto del relleno y la adhesión ("Cúbico 15 % · 3 paredes · Borde").
 *  @param {{patron:string, densidad:number, paredes:number, adhesion:string}} v
 *  @returns {string} */
export function resumenPersonal(v) {}
```

Privadas: `opcion(grupo, valor, titulo, detalle, marcado)`, `dibujarMaterial`, `cambiarPersonal(clave, valor)`,
`dibujarPersonalizar`, la variable `avanzado`.

- **Se mueve de main.js:** `opcion`, `dibujarOpciones`, `dibujarMaterial`, `cambiarPersonal`,
  `dibujarPersonalizar`, `resumenPersonal`, la constante `avanzado`, y los manejadores de `#densidad`
  (`input` y `change`), `#atajosDensidad`, `#personalizar .contador`, `#restablecer` y el `change` de
  `[data-paso="2"].pantalla`.
- **Cambio de forma:** la parte de `dibujarOpciones` que arma `#impresoraElegida` pasa a
  `impresoras.dibujarImpresoraElegida()`, que `dibujarOpciones` llama.
- **Importa:** `estado` (`estado`, `valoresActuales`, `guardarPreferencias`), `impresoras`
  (`dibujarImpresoraElegida`), `util-dom`, `ui/avanzado` (`crearAvanzado`), `ui/materiales`,
  `ui/iconos-relleno`, `perfiles/perfiles` (`opciones`, `valoresDeCalidad`).

#### 3.5 `src/ui/impresoras.js` — ~250 líneas

**Responsabilidad:** elegir la impresora (hoja con búsqueda), mostrar la tarjeta de la elegida y administrar "Mi impresora" (formulario, copiar, editar, borrar).

```js
/** Cablea #cambiarImpresora, #buscarImpresora, #listaImpresoras, #nuevaImpresora, #impresoraElegida,
 *  #borrarImpresora y el formulario #formImpresora (submit, firmware, extrusor, campos de G-code).
 *  @param {{ alElegir: () => void }} callbacks
 *  `alElegir` se llama al elegir/guardar/borrar una impresora, DESPUÉS de actualizar
 *  `estado.impresoraId`/`estado.calidad` y ANTES de guardar preferencias. @returns {void} */
export function iniciarImpresoras({ alElegir }) {}

/** Dibuja en #impresoraElegida la tarjeta de la impresora elegida (nombre, etiqueta de estado,
 *  medidas, aviso y botón Editar/Copiar). @returns {void} */
export function dibujarImpresoraElegida() {}
```

Privadas: `ETIQUETAS`, `detalleImpresora(i)`, `elegirImpresora(id)`, `dibujarListaImpresoras`, `form` (se
obtiene dentro de `iniciarImpresoras`, no al importar), `abrirFormulario(datos, titulo)`, `datosNuevos`,
`datosDesde(imp)`, y las nuevas `leerFormulario()` y `mostrarErrorFormulario(campo)` (sección 4).

- **Se mueve de main.js:** `ETIQUETAS`, `detalleImpresora`, `elegirImpresora`, `dibujarListaImpresoras`,
  `abrirFormulario`, `datosNuevos`, `datosDesde`, la constante `form`, y los manejadores de
  `#cambiarImpresora`, `#buscarImpresora`, `#listaImpresoras`, `#nuevaImpresora`, `#impresoraElegida`,
  el `input` de `inicio/fin/pausa`, el `change` de `firmware` y `extrusor`, el `submit` del formulario y
  `#borrarImpresora`. La parte "tarjeta" de `dibujarOpciones` se mueve acá como `dibujarImpresoraElegida`.
- **Importa:** `estado` (`estado`, `guardarPropias`, `guardarPreferencias`), `navegacion` (`abrirHoja`,
  `cerrarHojas`), `util-dom`, `perfiles/perfiles` (`listaImpresoras`, `buscarImpresora`, `existeImpresora`,
  `IMPRESORA_INICIAL`, `lineasPausa`), `perfiles/generico` (`PLANTILLAS_GCODE`).

#### 3.6 `src/ui/paso3-laminar.js` — ~90 líneas

**Responsabilidad:** lanzar el laminado, mostrar el progreso, permitir cancelarlo y manejar el error.

```js
/** Cablea #laminar y #cancelar.
 *  @param {{ alTerminar: () => void }} callbacks
 *  `alTerminar` se llama con `estado.resultado` ya cargado (main: mostrarResultado del paso 4);
 *  después este módulo hace irA(4, { reemplazar: true }). @returns {void} */
export function iniciarPaso3({ alTerminar }) {}
```

Privadas: `ETAPAS`, `ponerProgreso(etapa, valor)`, `mantenerPantalla`, `empezarLaminado` y las nuevas
`configuracionActual()`, `prepararPantallaLaminado()`, `ejecutarLaminado(config)` (sección 4).

- **Se mueve de main.js:** `ETAPAS`, `ponerProgreso`, `mantenerPantalla`, `empezarLaminado`, manejadores de `#laminar` y `#cancelar`.
- **Importa:** `estado` (`estado`, `matrizModelo`), `navegacion` (`irA`), `util-dom`, `motor/motor`
  (`laminar`), `perfiles/perfiles` (`armarConfiguracion`), `config` (`maxTriangulos`).

#### 3.7 `src/ui/paso4-resultado.js` — ~90 líneas

**Responsabilidad:** resumen del resultado, avisos y entrega del G-code (compartir/descargar/otro modelo).

```js
/** Cablea #compartir, #descargar y #otro.
 *  @param {{ alOtroModelo: () => void }} callbacks
 *  `alOtroModelo`: vuelve al inicio del paso 1 (main: elegirOtroModelo). #otro hace
 *  `estado.resultado = null`, llama a `alOtroModelo()` y después `irA(1)`. @returns {void} */
export function iniciarPaso4({ alOtroModelo }) {}

/** Llena el resumen, los avisos y el botón Compartir/Descargar con `estado.resultado` y arma la
 *  vista previa (armarVistaPrevia). @returns {void} */
export function mostrarResultado() {}
```

Privada: `archivoGcode()` (File text/plain con las pausas insertadas; sólo la usan `#compartir`,
`#descargar` y `mostrarResultado`).

- **Se mueve de main.js:** `mostrarResultado`, `archivoGcode`, manejadores de `#compartir`, `#descargar`, `#otro`.
- **Importa:** `estado` (`estado`, `valoresActuales`), `navegacion` (`irA`), `util-dom`, `vista-capas`
  (`armarVistaPrevia`), `paso2-config` (`resumenPersonal`), `ui/formato`, `ui/materiales`
  (`filasResumen`), `motor/pausas` (`insertarPausas`), `perfiles/perfiles` (`buscarImpresora`,
  `materiales`, `lineasPausa`).

#### 3.8 `src/ui/vista-capas.js` — ~250 líneas

**Responsabilidad:** vista previa capa por capa (visor, deslizador, reproducción) y pausas de filamento con sus colores.
**Dueño exclusivo de `visorCapas`, `capas` y `reproduccion`.**

```js
/** Cablea #capa, #capaMenos, #capaMas, #soloCapa, #reproducir, #pausarCapa, #listaPausas y
 *  #modoColor; se suscribe a alMostrarPaso (pausa el visor si paso ≠ 4 y para la reproducción).
 *  Llamar una vez, después de iniciarNavegacion(). @returns {void} */
export function iniciarVistaCapas() {}

/** Lee los recorridos de `estado.resultado.gcode` en un worker, arma el visor y deja la última capa
 *  visible. Reinicia pausas y modo de color. Si mientras tanto se laminó otra cosa, se descarta.
 *  Nunca lanza: los errores se muestran en #cargandoCapas. @returns {Promise<void>} */
export async function armarVistaPrevia() {}
```

Privadas: `capas`, `reproduccion`, `visorCapas`, `irACapa(n)`, `pararReproduccion`, `colorFilamento(i)`,
`dibujarPausas`, `actualizarModoColor`, `pintarRecorridos`, y las nuevas `mostrarRecorridos(r, resultado)`
y `tablaColores(cortes, porFilamento)` (sección 4).

- **Se mueve de main.js:** `armarVistaPrevia`, `irACapa`, `colorFilamento`, `dibujarPausas`,
  `actualizarModoColor`, `pintarRecorridos`, `pararReproduccion`; las variables `visorCapas`, `capas`,
  `reproduccion`; manejadores de `#pausarCapa`, `#listaPausas` (`click` e `input`), `#modoColor`,
  `#capa`, `#capaMenos`, `#capaMas`, `#soloCapa`, `#reproducir`.
- **Importa:** `estado`, `navegacion` (`alMostrarPaso`), `util-dom` (`$`, `escapar`), `ui/visor`
  (`crearVisor`), `ui/formato`, `motor/motor` (`leerRecorridos`), `motor/tipos-linea` (`TIPOS`,
  `COLORES_FILAMENTO`), `perfiles/perfiles` (`buscarImpresora`, `lineasPausa`), `config`
  (`maxSegmentosVista`).

#### 3.9 `src/ui/actualizacion.js` (módulo extra, justificado) — ~35 líneas

**Responsabilidad:** registrar el service worker y ofrecer "Actualizar" cuando hay una versión nueva.
**Justificación:** es la única parte de `main.js` ajena a los pasos (usa `import.meta.env.PROD`, un aviso
propio y una recarga). Dejarla en `main.js` lo llevaría a unas 70-80 líneas y se perdería margen frente al tope de 80.

```js
/** Registra ./sw.js (sólo en el build, no en `npm run dev`). Cuando hay una versión nueva
 *  esperando, muestra #actualizacion y, al tocar #actualizar, la activa y recarga cuando cambia
 *  el controlador. @returns {void} */
export function registrarServiceWorker() {}
```

- **Se mueve de main.js:** `registrarServiceWorker`.
- **Importa:** `util-dom`.

#### 3.10 `src/main.js` — menos de 80 líneas (objetivo ~45)

**Responsabilidad:** punto de entrada: importa, inicializa en orden y cablea los callbacks.

```js
// Punto de entrada: cablea los módulos de src/ui/ (ver docs/decisiones/0001-dividir-main.md).
import * as almacen from './almacen.js';
import { cargarPreferencias } from './ui/estado.js';
import { iniciarNavegacion, mostrar } from './ui/navegacion.js';
import { iniciarPaso1, alCambiarImpresora, elegirOtroModelo, mostrarRecientes } from './ui/paso1-modelo.js';
import { iniciarImpresoras } from './ui/impresoras.js';
import { iniciarPaso2, dibujarOpciones } from './ui/paso2-config.js';
import { iniciarPaso3 } from './ui/paso3-laminar.js';
import { iniciarPaso4, mostrarResultado } from './ui/paso4-resultado.js';
import { iniciarVistaCapas } from './ui/vista-capas.js';
import { registrarServiceWorker } from './ui/actualizacion.js';

// 1. Listeners (antes del await, como hoy: los controles responden aunque la carga tarde).
iniciarNavegacion();
iniciarPaso1();
iniciarImpresoras({ alElegir: () => { dibujarOpciones(); alCambiarImpresora(); } });
iniciarPaso2();
iniciarPaso3({ alTerminar: mostrarResultado });
iniciarPaso4({ alOtroModelo: elegirOtroModelo });
iniciarVistaCapas();

// 2. Datos y primer dibujo.
await cargarPreferencias();
dibujarOpciones();
mostrar(1);
mostrarRecientes();
almacen.pedirAlmacenamientoPersistente();
registrarServiceWorker();
```

- **Queda en main.js:** sólo el bloque final (`await cargarPreferencias()` … `registrarServiceWorker()`).

### 4. Funciones de más de 40 líneas hoy y cómo partirlas

Medidas por nombre (de la firma al cierre). Sólo dos pasan de 40; las siguientes están en el borde o son
densas y se parten igual. Además, **las `iniciarX` nuevas no pueden pasar de 40 líneas**: si cablear todos
los manejadores las supera, se parten en `conectarX()` privadas.

| Función | Líneas hoy | Cómo partirla |
|---|---|---|
| `cargarArchivo` | ~42 | (a) `leerModelo(nombre, buffer, tipo, generar)`: convierte con `convertirAStl`/`generar` y llama `leerParaVista(buffer.slice(0))`, devuelve `{ buffer, vertices, triangulos, tamano }`; (b) `montarModelo(nombre, datos)`: asigna `estado.*`, crea el visor, `ponerCama`, `ponerModelo`, textos, `activarElegirCara(false)`, `aplicarTransformacion()` y habilita `#siguiente`; (c) `cargarArchivo` queda con: despacho por tipo (`imagen` → litofanía, desconocido → alert), spinner con `try/catch/finally` y guardado en recientes. |
| `empezarLaminado` | ~41 | (a) `configuracionActual()` devuelve `armarConfiguracion({...})` desde `estado`; (b) `prepararPantallaLaminado()`: `irA(3)`, títulos, error oculto, `ponerProgreso('leyendo', 0)`; (c) `ejecutarLaminado(config)`: el `laminar({...})` que devuelve el resultado con `archivo` armado. `empezarLaminado` compone (a), (b), el `AbortController`, el wake lock, (c), `alTerminar()`, `irA(4, { reemplazar: true })` y el `catch/finally`. |
| `armarVistaPrevia` (~37, borde) | 37 | extraer `mostrarRecorridos(r, resultado)`: crea el visor, cama, `ponerRecorridos`, `capas`, leyenda, aviso de vista incompleta y `irACapa(total - 1)`. |
| `pintarRecorridos` (~23, densa) | 23 | extraer `tablaColores(cortes, porFilamento)` que devuelve la tabla `[filamento][tipo] -> [r,g,b]`. |
| Handler `submit` del formulario (~24) | 24 | extraer `leerFormulario()` (arma `datos` desde `form.elements`) y `mostrarErrorFormulario(campo)`. |
| `iniciarPaso1`, `iniciarPaso2`, `iniciarImpresoras`, `iniciarVistaCapas` | (nuevas) | cada una delega en 2-3 `conectarX()` privadas de ≤ 40 líneas (por ejemplo `conectarSubida` y `conectarTransformacion`; `conectarPersonalizar` y `conectarEleccion`; `conectarLista` y `conectarFormulario`; `conectarCapas` y `conectarPausas`). |

Ninguna otra función actual supera 40 líneas (`dibujarPausas` y `dibujarPersonalizar` rondan las 22).

### 5. Plan de ejecución

**Métrica de tamaño:** cada tarea suma **menos de 200 líneas agregadas** (`git diff --numstat`, columna
de agregadas). Las líneas eliminadas de `main.js` son borrado mecánico y cada tarea declara cuántas borra.
Un módulo estimado en 250 se reparte entre dos tareas.

**Estrategia anti-conflictos: "crear en paralelo, recablear en serie".** Todas las tareas tocarían
`main.js` (encabezado de imports y cola de inicialización), así que:

- **Ola 0 (serie, base):** T0 → T1 → T2. Crean lo que todos necesitan y rearman el encabezado de `main.js` una sola vez.
- **Ola 1 (paralelo):** cada dev **sólo crea su archivo nuevo en `src/ui/`** (copia el código desde `main.js` por nombre y lo adapta al contrato de la sección 3). **No toca `main.js`.** Archivos distintos, cero conflictos. Como la app todavía no importa estos módulos, sigue funcionando con el código viejo y no hay listeners duplicados.
- **Ola 2 (serie, recableado):** R1 → R2 → R3 → R4. Cada tarea borra de `main.js` los bloques ya movidos, agrega el `import` y la llamada a `iniciarX`, y corre las suites. Agregan poco y borran mucho; como van una tras otra, no hay conflictos. Si algo se rompe, el culpable es el último recableado.

Durante la ola 2 `main.js` conserva "puentes" temporales marcados `// PUENTE Rn` que se quitan en la tarea indicada.

**Prueba de contrato (T0):** `scripts/probar-contratos.mjs` (+ `"test:contratos"` en `package.json`). Con
`vite.createServer({ server: { middlewareMode: true } }).ssrLoadModule(...)` (maneja JSON e
`import.meta.env`) importa cada módulo de la sección 3 que exista, sin llamar a `iniciarX`, y verifica:
(1) que exporta exactamente los nombres y `fn.length` del contrato; (2) que importarlo no toca `document`;
(3) que el grafo de imports entre `src/ui/*.js` (regex sobre `import ... from`) no tiene ciclos y sólo
usa las aristas de la sección 2. Los módulos que aún no existen se saltean; en R4 se exige que existan los diez.

| Tarea | Ola | Depende de | Archivos a tocar | Criterio de aceptación verificable |
|---|---|---|---|---|
| **T0** prueba de contrato | 0 | — | `scripts/probar-contratos.mjs`, `package.json` | `npm run test:contratos` pasa sin módulos nuevos (chequea los existentes y que el detector de ciclos falla con un grafo cíclico de prueba). < 80 agregadas. |
| **T1** `util-dom.js` + `estado.js` | 0 | T0 | `src/ui/util-dom.js`, `src/ui/estado.js`, `src/main.js` (borra `$`, `escapar`, `estado`, `matrizModelo`, `valoresActuales`, `guardarPropias`, `guardarPreferencias`, `cargarPreferencias`; los importa) | `npm run build` y `npm run test:app` verdes; `test:contratos` verde con estos dos. ~130 agregadas, ~100 borradas. |
| **T2** `navegacion.js` | 0 | T1 | `src/ui/navegacion.js`, `src/main.js` (borra `mostrar`, `irA`, `abrirHoja`, `cerrarHojas`, popstate, `[data-cerrar]`, `#atras`, replaceState; invoca `iniciarNavegacion()` al principio). **PUENTE R1/R3**: en `main.js` queda `alMostrarPaso(p => { visor?.pausar(p !== 1); visorCapas?.pausar(p !== 4); if (p !== 4) pararReproduccion(); })` | `build` + `test:app` verdes (incluye "atrás" desde el resultado y cerrar hojas). ~90 agregadas. |
| **A1** `paso1-modelo.js`, parte 1: `iniciarPaso1` (subida), `cargarArchivo` partida, `leerModelo`, `montarModelo`, `actualizarAvisoModelo`, `alElegirArchivo`, recientes, `elegirOtroModelo`, `mostrarRecientes` | 1 | T2 | `src/ui/paso1-modelo.js` | `node --check` del archivo y `test:contratos` sin errores de ciclo ni de DOM al importar (los exports de A2 aún pueden faltar). ~150 agregadas. |
| **A2** `paso1-modelo.js`, parte 2: `tamanoActual`, `aplicarTransformacion`, `ponerEscala`, `activarElegirCara`, `alCambiarImpresora`, `conectarTransformacion` | 1 | A1 (mismo archivo) | `src/ui/paso1-modelo.js` | `test:contratos` verde del módulo completo (4 exports exactos). ≤ 110 agregadas. |
| **B1** `impresoras.js`, parte 1: `ETIQUETAS`, `detalleImpresora`, `dibujarImpresoraElegida`, `elegirImpresora`, `dibujarListaImpresoras`, parte selector de `iniciarImpresoras` | 1 | T2 | `src/ui/impresoras.js` | `test:contratos` sin errores de ciclo ni de DOM. ~110 agregadas. |
| **B2** `impresoras.js`, parte 2: `abrirFormulario`, `datosNuevos`, `datosDesde`, `leerFormulario`, `mostrarErrorFormulario`, manejadores del formulario | 1 | B1 | `src/ui/impresoras.js` | `test:contratos` verde (2 exports: `iniciarImpresoras` con `length` 1 y `dibujarImpresoraElegida`). ≤ 140 agregadas. |
| **C** `paso2-config.js` | 1 | T2 | `src/ui/paso2-config.js` | `test:contratos` verde (3 exports). ~170 agregadas. |
| **D** `paso3-laminar.js` | 1 | T2 | `src/ui/paso3-laminar.js` | `test:contratos` verde (1 export). ~90 agregadas. |
| **E** `paso4-resultado.js` | 1 | T2 | `src/ui/paso4-resultado.js` | `test:contratos` verde (2 exports). ~90 agregadas. |
| **F1** `vista-capas.js`, parte 1: `armarVistaPrevia`, `mostrarRecorridos`, `irACapa`, reproducción, `pararReproduccion`, controles de capa | 1 | T2 | `src/ui/vista-capas.js` | `test:contratos` sin errores de ciclo ni de DOM. ~130 agregadas. |
| **F2** `vista-capas.js`, parte 2: `colorFilamento`, `dibujarPausas`, `actualizarModoColor`, `pintarRecorridos`, `tablaColores`, manejadores de pausas y modo | 1 | F1 | `src/ui/vista-capas.js` | `test:contratos` verde (2 exports). ≤ 130 agregadas. |
| **G** `actualizacion.js` | 1 | T2 | `src/ui/actualizacion.js` | `test:contratos` verde (1 export). ~35 agregadas. |
| **R1** recablear paso 1 | 2 | A1, A2 | `src/main.js` | Borra lo listado en 3.3 e invoca `iniciarPaso1()`. `elegirImpresora` (viejo) pasa a llamar `alCambiarImpresora()`; `$('otro')` (viejo) llama `elegirOtroModelo()`; del PUENTE de T2 se quita `visor?.pausar`. `build` + `test:app` verdes. ≤ 30 agregadas. |
| **R2** recablear impresoras + paso 2 | 2 | B1, B2, C, R1 | `src/main.js` | Borra 3.4 y 3.5, agrega `iniciarImpresoras({ alElegir })` e `iniciarPaso2()`. Van juntas porque `dibujarOpciones` y `elegirImpresora` se referencian. `build` + `test:app` verdes. ≤ 30 agregadas. |
| **R3** recablear pasos 3 y 4 + vista previa | 2 | D, E, F1, F2, R2 | `src/main.js` | Borra 3.6, 3.7, 3.8 y el PUENTE; agrega `iniciarPaso3`, `iniciarPaso4`, `iniciarVistaCapas`. `build` + `test:app` verdes. ≤ 30 agregadas. |
| **R4** final | 2 | G, R3 | `src/main.js`, `docs/MAPA.md` | `main.js` < 80 líneas (`wc -l`); `test:contratos` exige los 10 módulos; `MAPA.md` actualizado en el mismo commit (tabla de interfaz, sección 3 "Estado" apunta a `ui/estado.js`, sección 6 sin la deuda de main.js); `npm run build` y todas las suites (`test:transformar`, `test:formatos`, `test:motor`, `test:app`) verdes. ≤ 60 agregadas. |

Orden de merge: T0 → T1 → T2 → (ola 1 en cualquier orden; A1 antes de A2, B1 antes de B2, F1 antes de
F2) → R1 → R2 → R3 → R4. En la ola 1 corren en paralelo cinco carriles de un solo archivo (C, D, E, G) o
de dos tareas encadenadas (A, B, F): siete carriles independientes en total.

### 6. Riesgos y cobertura

| Riesgo | Por qué importa | Mitigación en el diseño | Cobertura |
|---|---|---|---|
| **Orden de inicialización** | Hoy `mostrar(1)` corre con `visor`/`visorCapas` sin crear y los listeners se registran antes del `await cargarPreferencias()`. Un cambio de orden deja controles sin respuesta o dibuja con preferencias sin leer. | `main.js` conserva el orden: primero todos los `iniciarX`, después `await cargarPreferencias()`, `dibujarOpciones()`, `mostrar(1)`, `mostrarRecientes()`. `iniciarNavegacion` va primero. Los módulos no tocan el DOM al importarse. `dibujarOpciones` usa `avanzado` (creado en `iniciarPaso2`), por eso éste va antes del `await`. | `test:app` arranca la app desde cero y recorre los 4 pasos; falla si algo no responde. `test:contratos` (punto 2) verifica que importar no toca `document`. |
| **Listeners duplicados o perdidos** | Se registran con `onclick`/`addEventListener` sobre ids de `index.html`; un bloque en dos lugares dispara doble; uno que falta deja el control muerto. | Ola 1 no importa nada desde la app (sin doble registro); en ola 2 cada recableado borra el bloque viejo en el mismo commit. La tabla de la sección 7 asigna **cada manejador** a un solo módulo. | `test:app` toca los controles de cada paso. Este ADR **no leyó** `scripts/probar-app.mjs`: antes de R1 el dev lista qué ids no toca; los que falten (candidatos: borrar reciente, `#borrarImpresora`, `#modoColor`, `#compartir`) se agregan como aserciones dentro del tope de la tarea. |
| **Visor 3D compartido** | `visor` (paso 1) y `visorCapas` (paso 4) son dos instancias de `crearVisor` con su canvas y su ciclo de dibujo; hoy `mostrar`, `elegirImpresora` y `armarVistaPrevia` las tocan desde distintos lugares. Pausar mal agota batería o deja el canvas negro. | Cada instancia tiene **un solo dueño** (`paso1-modelo` / `vista-capas`); nadie más recibe la instancia. El pausado por paso queda en el suscriptor de cada dueño. La cama del visor del paso 1 al cambiar de impresora se hace con `alCambiarImpresora()`; la del visor de capas la fija `armarVistaPrevia` con `resultado.impresoraId` (sin cambios). | `test:app` llega al paso 4, mueve el deslizador de capas y vuelve al paso 1. Verificación manual adicional en R3: desde el paso 4 volver atrás y confirmar en DevTools que el visor del paso 4 dejó de dibujar. |
| **Imports circulares** | Divisiones así suelen terminar con A↔B. | Grafo de la sección 2, 4 callbacks y el gancho `alMostrarPaso`. | `test:contratos` (punto 3) falla ante un ciclo o una arista no listada. |
| **Estado mutado desde varios módulos** | `estado.personal` se reasigna en `paso2` (`estado.personal = {}`) y se lee en otros: una referencia cacheada queda desactualizada. | Regla 7: siempre `estado.x` en el momento. `avanzado.js` ya recibe `estado` por referencia y no se toca. | Revisión de código en cada tarea (buscar `= estado.` a nivel de módulo). `test:app` cambia la personalización y relamina. |
| **`litofania` y `avanzado` se crean al importar** | Hoy `prepararLitofania(...)` y `crearAvanzado(...)` corren al evaluar `main.js`. | Pasan a crearse dentro de `iniciarPaso1`/`iniciarPaso2` y se guardan en `let` privados del módulo. | `test:app` (carga de foto y paso 2). |
| **`await` de nivel superior** | Debe seguir en `main.js`; en un módulo importado bloquearía a los demás. | Sólo `main.js` lo tiene. | `npm run build`. |
| **Reformateo con Prettier a mitad de camino** | Los números de línea cambian. | El ADR y las tareas referencian por nombre. | — |
| **Service worker y lista de archivos** | `vite.config.js` inyecta la lista de archivos en `sw.js`; módulos nuevos cambian el build. | Es automático para lo que Vite empaqueta; se verifica en R4. | `test:app` incluye el modo offline: debe seguir abriendo sin red tras el build. |

### 7. Tabla función → módulo (100 % de `src/main.js`)

**Funciones, constantes y variables de nivel superior**

| Nombre en `main.js` | Módulo destino | Visibilidad |
|---|---|---|
| `$` | `util-dom.js` | export |
| `escapar` | `util-dom.js` | export |
| `estado` | `estado.js` | export |
| `matrizModelo` | `estado.js` | export |
| `valoresActuales` | `estado.js` | export |
| `guardarPropias` | `estado.js` | export |
| `guardarPreferencias` | `estado.js` | export |
| `cargarPreferencias` | `estado.js` | export |
| `mostrar` | `navegacion.js` | export |
| `irA` | `navegacion.js` | export |
| `abrirHoja` | `navegacion.js` | export |
| `cerrarHojas` | `navegacion.js` | export |
| `visor` (variable) | `paso1-modelo.js` | privada |
| `litofania` (constante) | `paso1-modelo.js` | privada |
| `cargarArchivo` | `paso1-modelo.js` | privada (partida en `leerModelo`, `montarModelo`) |
| `actualizarAvisoModelo` | `paso1-modelo.js` | privada |
| `alElegirArchivo` | `paso1-modelo.js` | privada |
| `mostrarRecientes` | `paso1-modelo.js` | export |
| `tamanoActual` | `paso1-modelo.js` | privada |
| `aplicarTransformacion` | `paso1-modelo.js` | privada |
| `ponerEscala` | `paso1-modelo.js` | privada |
| `activarElegirCara` | `paso1-modelo.js` | privada |
| `opcion` | `paso2-config.js` | privada |
| `dibujarOpciones` | `paso2-config.js` | export (la tarjeta de impresora va a `dibujarImpresoraElegida`) |
| `dibujarMaterial` | `paso2-config.js` | privada |
| `cambiarPersonal` | `paso2-config.js` | privada |
| `dibujarPersonalizar` | `paso2-config.js` | privada |
| `resumenPersonal` | `paso2-config.js` | export |
| `avanzado` (constante) | `paso2-config.js` | privada |
| `ETIQUETAS` | `impresoras.js` | privada |
| `detalleImpresora` | `impresoras.js` | privada |
| `elegirImpresora` | `impresoras.js` | privada |
| `dibujarListaImpresoras` | `impresoras.js` | privada |
| `form` (constante) | `impresoras.js` | privada (se obtiene en `iniciarImpresoras`) |
| `abrirFormulario` | `impresoras.js` | privada |
| `datosNuevos` | `impresoras.js` | privada |
| `datosDesde` | `impresoras.js` | privada |
| `ETAPAS` | `paso3-laminar.js` | privada |
| `ponerProgreso` | `paso3-laminar.js` | privada |
| `mantenerPantalla` | `paso3-laminar.js` | privada |
| `empezarLaminado` | `paso3-laminar.js` | privada (partida en `configuracionActual`, `prepararPantallaLaminado`, `ejecutarLaminado`) |
| `mostrarResultado` | `paso4-resultado.js` | export |
| `archivoGcode` | `paso4-resultado.js` | privada |
| `visorCapas` (variable) | `vista-capas.js` | privada |
| `capas` (variable) | `vista-capas.js` | privada |
| `reproduccion` (variable) | `vista-capas.js` | privada |
| `armarVistaPrevia` | `vista-capas.js` | export |
| `irACapa` | `vista-capas.js` | privada |
| `colorFilamento` | `vista-capas.js` | privada |
| `dibujarPausas` | `vista-capas.js` | privada |
| `actualizarModoColor` | `vista-capas.js` | privada |
| `pintarRecorridos` | `vista-capas.js` | privada |
| `pararReproduccion` | `vista-capas.js` | privada |
| `registrarServiceWorker` | `actualizacion.js` | export |

**Manejadores anónimos y código suelto de nivel superior** (cada uno en un solo módulo)

| Código en `main.js` | Módulo destino |
|---|---|
| `popstate`, `[data-cerrar]`, `#atras`, `history.replaceState` inicial | `navegacion.js` (`iniciarNavegacion`) |
| `#archivo.onchange`, `#foto.onchange` | `paso1-modelo.js` |
| `prepararLitofania({...})` | `paso1-modelo.js` (`iniciarPaso1`) |
| `#otroModelo.onclick` | `paso1-modelo.js` (`elegirOtroModelo`) |
| `#listaRecientes.onclick`, `#ejemplo.onclick`, `#siguiente.onclick` | `paso1-modelo.js` |
| `#escalaMenos`, `#escalaMas`, `#escala`, `[data-rotar]`, `#ajustarCama`, `#restablecerModelo`, `#apoyarCara` | `paso1-modelo.js` |
| `crearAvanzado({...})` | `paso2-config.js` (`iniciarPaso2`) |
| `#densidad` (`input`), `#atajosDensidad`, `#personalizar .contador`, `#restablecer`, `change` de `[data-paso="2"].pantalla` | `paso2-config.js` |
| `#cambiarImpresora`, `#buscarImpresora`, `#listaImpresoras`, `#nuevaImpresora`, `#impresoraElegida` | `impresoras.js` |
| `input` de inicio/fin/pausa, `change` de `firmware` y `extrusor`, `submit` del formulario, `#borrarImpresora` | `impresoras.js` |
| `#laminar.onclick`, `#cancelar.onclick` | `paso3-laminar.js` |
| `#compartir.onclick`, `#descargar.onclick`, `#otro.onclick` | `paso4-resultado.js` |
| `#pausarCapa`, `#listaPausas` (`click`, `input`), `#modoColor`, `#capa` (`input`), `#capaMenos`, `#capaMas`, `#soloCapa`, `#reproducir` | `vista-capas.js` |
| Bloque final: `await cargarPreferencias()`, `dibujarOpciones()`, `mostrar(1)`, `mostrarRecientes()`, `almacen.pedirAlmacenamientoPersistente()`, `registrarServiceWorker()` | `main.js` |

**Tamaños estimados (todos bajo el tope de 300):** `util-dom` 12 · `estado` 110 · `navegacion` 85 ·
`paso1-modelo` 250 · `paso2-config` 190 · `impresoras` 250 · `paso3-laminar` 90 · `paso4-resultado` 90 ·
`vista-capas` 250 · `actualizacion` 35 · `main` 45. Suma ≈ 1.400 líneas contra las 1.007 de hoy: la
diferencia son imports, JSDoc de contrato y funciones extraídas. Si `paso1-modelo`, `impresoras` o
`vista-capas` superan 300 al implementarse, la salida prevista es extraer `recientes.js` (de `paso1`),
`formulario-impresora.js` (de `impresoras`) o `pausas-ui.js` (de `vista-capas`), con un ADR nuevo.

## Consecuencias

**Más fácil**

- Cada paso se puede revisar, probar y asignar por separado; los errores se ubican por el nombre del módulo.
- Las dependencias son explícitas y las valida una prueba (`test:contratos`) en vez de depender de la disciplina.
- Los módulos se pueden importar sin tocar el DOM, lo que abre la puerta a pruebas unitarias en Node.
- `docs/MAPA.md` puede describir cada módulo en una fila.

**Más difícil**

- Hay un archivo más por cada responsabilidad y 4 callbacks que seguir leyendo en `main.js`.
- Un objeto `estado` global mutable sigue siendo estado global: este ADR lo ordena pero no lo elimina.
  Cambiar esa regla (por ejemplo, dejar de mutar `estado` desde varios módulos) necesita otro ADR.
- El total de líneas crece ~40 % por imports y JSDoc.

**Riesgos que quedan abiertos**

- La cobertura de `test:app` sobre cada control no se auditó acá (no se leyó `scripts/probar-app.mjs`):
  la auditoría es el primer paso de R1.
- La métrica "< 200 líneas" se define sobre líneas agregadas; las recableadas de la ola 2 borran más de
  200 líneas de `main.js` (borrado mecánico).
- `scripts/probar-app.mjs` (~530 líneas) sigue sin dividir: es deuda aparte (MAPA, sección 6).

**Reversa:** cada tarea de la ola 2 es un commit independiente; revertir R*n* restaura el código viejo en
`main.js` (los módulos nuevos quedan sin uso, sin efectos).
