# 0003. Varias piezas o copias en la cama

- **Fecha:** 2026-10-18
- **Autor/a:** arquitecto
- **Base:** commit `2d258ac`

## Estado

Implementado (T0–T11; T11 se hizo dentro de T10). Aceptado por el CTO el 2026-10-18.

Cambio del CTO sobre T0: el riesgo R1 se mide **antes** de construir la UI. Se suma
**T0** (dev motor, ola 1, en paralelo con T1–T3): prueba en el Kiri real con dos widgets en `track.pos` distintos y
falda, borde, balsa y soportes, que verifica en el G-code que cada pieza y sus extras caen en su posición. Si falla,
T4 desplaza los vértices en `prepararPiezas` y los widgets van con `pos` en cero (plan B de R1); el contrato del
mensaje al worker no cambia.

## Contexto

Hoy la app lamina **un** modelo por vez: `estado` guarda `nombre`, `stl`, `vista`, `rotacion` y `escala` de una sola
pieza, `paso1-modelo.js` tiene un único `visor.ponerModelo`, y `laminador.worker.js` recibe un solo `stl`, lo
transforma, lo decima, lo centra con `centrar` y lo manda a Kiri como un único widget en `(0,0,0)`. Quien quiere
imprimir cuatro copias de una pieza chica, o dos piezas distintas, tiene que laminar varias veces y gastar varias
camas. Pedido: poder sumar piezas y copias, que la app las acomode sola y que salga **un** G-code.

Hechos que condicionan el diseño:

- **Kiri ya soporta varios widgets.** En `vendor/kiri/src/kiri/run/worker.js`, `sync` guarda cada widget en
  `wcache[id]` con su `track.pos`; `slice` se llama una vez por `id`; `prepare` hace `Object.values(wcache)` y
  `fdm_prepare` (`mode/fdm/work/prepare.js`) toma el `widget.track.pos` como `offset` de cada widget (también para
  falda/borde, que usan la unión de cajas más `pos`, y para los soportes, que heredan el offset del padre). Entre
  widgets de una misma capa Kiri fuerza la retracción. No hace falta tocar el vendor.
- `centrar()` deja cada malla con el centro de su caja en X/Y en 0 y la base en Z=0; el widget ya está pensado para
  eso, y la posición en la cama se expresa con `track.pos` (mm, relativa al centro de la cama).
- La decimación (`decimar`) y el tope de triángulos (`maxTriangulos()` en `src/config.js`: 100k a 500k según RAM)
  existen para que el celu no se quede sin memoria. Con varias piezas el tope tiene que ser **del conjunto**.
- `paso1-modelo.js` (275 líneas) y `visor.js` (381; `crearVisor` sola tiene unas 310) están al límite de los
  estándares (archivos < 300 líneas, funciones < 40). Sumarles lógica sin dividirlos antes rompe el estándar.
- Fuera de `paso1-modelo.js` sólo `paso3-laminar.js` lee `estado.stl`, `estado.nombre` y `matrizModelo` (para armar la
  llamada a `laminar`). `recientes.js` lee `estado.nombre/stl/rotacion/escala` al guardar.
- Convenciones del ADR 0001: módulos de UI que no tocan el DOM al importarse, `estado.x` leído en el momento,
  comunicación entre pasos por callbacks, contratos verificados por `scripts/lib/contratos-ui.js`.

## Decisión

### 1. Modelo de datos: `estado.piezas`

```js
/** @typedef {object} Pieza
 *  @property {number} id            secuencial desde 1, nunca se reutiliza en la sesión
 *  @property {string} nombre        nombre del archivo
 *  @property {ArrayBuffer} stl      STL original (se copia en cada laminado)
 *  @property {{triangulos:number, tamano:{x:number,y:number,z:number}}} vista
 *  @property {number[][]} rotacion  matriz 3×3 (como hoy)
 *  @property {number} escala        uniforme, 0,01 a 20 (como hoy)
 *  @property {number} copias        entero 1..maxCopias()
 *  @property {'modelo'|'litofania'|'torre'} origen  sólo 'modelo' admite agregar piezas
 *  @property {{x:number,y:number}[]} posiciones     centro de cada copia en mm, relativo al centro de la cama
 *                                                   (calculado por `acomodar`, no se persiste; length === copias)
 */
```

Claves nuevas de `estado`: `piezas: Pieza[]` (vacío = sin modelo), `activa: number | null` (id de la pieza que
editan escala, rotación y "apoyar cara") y `entra: boolean` (resultado del último acomodo; `true` si no hay piezas).

**Compatibilidad: `nombre`, `stl`, `vista`, `rotacion` y `escala` pasan a ser accesores de la pieza activa.**
`estado.js` los define con `Object.defineProperties`: el getter lee de `piezaActiva()` (si no hay, devuelve el valor
inicial de hoy: `''`, `null`, `null`, identidad, `1`) y el setter escribe en la pieza activa (si no hay, no hace
nada). Así `ajuste-modelo`, `recientes` y todo lo que hoy hace `estado.escala = 1` siguen igual, y **con una sola
pieza el comportamiento es el de hoy** (posición `{0,0}`, mismo mensaje de "no entra", mismo G-code). Quien cargue un
modelo "de cero" (`montarModelo` con un archivo nuevo, un reciente, la torre o la litofanía) hace
`estado.piezas = [crearPieza(...)]`; "agregar pieza" hace `estado.piezas.push(...)`. Las claves `cambios`, `torre`,
`resultado`, etc. no cambian. `estado.torre` sigue siendo la fuente de verdad de "hay una torre" (su pieza lleva
`origen: 'torre'`).

Funciones nuevas de `estado.js` (todas sin DOM):

```js
/** @param {{nombre:string, stl:ArrayBuffer, vista:object, transformacion?:{rotacion:number[][], escala:number}, origen?:string}} d @returns {Pieza} */
export function crearPieza(d) {}
/** @returns {Pieza|null} la pieza de `estado.activa` (o la primera) */
export function piezaActiva() {}
/** @param {Pieza} p @returns {number[][]} escala × rotación de esa pieza */
export function matrizPieza(p) {}
/** @returns {number} suma de `copias` de todas las piezas */
export function copiasTotales() {}
/** Arma el argumento `piezas` de `laminar` (copia cada `stl`, matrices de 9 números, posiciones).
 *  @returns {{stl:ArrayBuffer, transformacion:number[], posiciones:{x:number,y:number}[]}[]} */
export function piezasParaMotor() {}
```

`matrizModelo()` se conserva: es `matrizPieza(piezaActiva())`.

### 2. Acomodo automático: función pura `acomodar`

Módulo nuevo `src/motor/piezas.js`, **sin imports** (se prueba en Node y lo usan igual la UI y el worker):

```js
/**
 * Acomoda huellas rectangulares en la cama con el método de estantes (filas).
 * @param {{x:number, y:number}[]} huellas  ancho y fondo (mm) de cada copia YA transformada, en el orden de entrada
 * @param {{x:number, y:number}} cama       ancho y fondo de la cama (mm)
 * @param {number} separacion               mm libres entre huellas (y, si hay más de una, entre el bloque y el borde)
 * @returns {{posiciones: {x:number,y:number}[], entra: boolean, fuera: number[]}}
 *   `posiciones[i]` es el CENTRO de `huellas[i]` en mm, relativo al centro de la cama (mismo orden que la entrada);
 *   `entra` es true si todas caben; `fuera` son los índices de las que se pasan de la cama (vacío si `entra`).
 */
export function acomodar(huellas, cama, separacion) {}
```

Algoritmo (determinista, sin azar):

1. **Una sola huella:** `posiciones = [{x:0,y:0}]` y `entra = huella.x <= cama.x && huella.y <= cama.y`. Es exactamente la
   validación de hoy (sin margen).
2. **Varias:** se ordenan los índices por fondo `y` descendente (empate: ancho `x` descendente, luego índice original).
   Estantes a lo largo de X: se pone cada huella en el estante abierto si `ancho usado + separacion + x <= cama.x -
   separacion`; si no, se abre un estante nuevo en `y_estante + alto_del_estante + separacion`. Las huellas **no se
   rotan** (la rotación es del usuario). Se hace lo mismo con los ejes intercambiados (estantes a lo largo de Y) y se
   queda con la variante que deje menos huellas afuera y, a igual cantidad, la de menor altura de bloque.
3. Un estante nuevo que se pasa de la cama **no se descarta**: las huellas siguen colocándose fuera, así el visor puede
   mostrarlas en rojo; esas son las de `fuera`. Una huella más ancha que la cama va igual a su estante y queda en `fuera`.
4. El bloque resultante se **centra** en la cama (se resta el centro de su caja), y las posiciones salen en mm
   relativos al centro. La condición de `entra` con varias piezas es `bloque <= cama - separacion` en ambos ejes
   (deja lugar a la falda).

La separación por defecto es `SEPARACION_PIEZAS_MM = 10` (constante en `src/config.js`, la tarea T6): alcanza para la
falda (`outputBrimOffset`/falda de Kiri) y para que la retracción entre piezas no raspe. Ordenar por fondo
descendente no tiene que ver con la altura en Z: sólo mejora el empaque de las filas.

**Si no entra:** `estado.entra = false`; `ajuste-modelo` muestra el aviso "No entran todas en la cama" con las medidas,
el visor pinta las copias de `fuera` en rojo, "Siguiente" queda deshabilitado y el usuario puede achicar (escala),
rotar, bajar las copias o quitar piezas. Nunca se lamina con `entra === false`: el worker lo revalida (sección 3) y
devuelve el error "Las piezas no entran en la cama".

Otras funciones puras del mismo módulo:

```js
/** Tope de triángulos de CADA pieza para que el conjunto (con copias) no pase de `maximo`. Reparto proporcional:
 *  cada pieza conserva `min(triangulos[i], floor(maximo * triangulos[i] / total) / copias[i])`, siendo
 *  total = Σ triangulos[k] × copias[k]; nunca menos de 500 por pieza. Devuelve `Infinity` si el total ya entra.
 *  @param {number[]} triangulos @param {number[]} copias @param {number} maximo @returns {number[]} */
export function repartirTriangulos(triangulos, copias, maximo) {}

/** Texto de error (en español) si hay demasiadas piezas o copias; `null` si está bien.
 *  @returns {string|null} */
export function validarCantidad(piezas, copias, maxPiezas, maxCopias) {}
```

### 3. Cómo se pasan a Kiri: **varios widgets**

Elegimos **un widget por copia** (cada uno en su `track.pos`) y descartamos la malla unida.

| Criterio | Varios widgets (elegido) | Una malla unida (descartada) |
|---|---|---|
| Memoria | Vértices totales ≤ `maxTriangulos()` por el reparto global: copiar el `Float32Array` por widget cuesta `36 B × triángulos` en total, es decir ≈ 9 MB en 250k. Los `slices` de cada widget conviven hasta `prepare` (igual que una pieza de ese tamaño) | Una sola malla, pero hay que fusionar y trasladar vértices a mano |
| `centrar` | Se usa tal cual por pieza; la posición va en `track.pos` | Habría que centrar el **conjunto** y repetir la lógica de cama |
| Soportes | Kiri los genera por widget y hereda el offset: soportan cada pieza por separado | Un soporte "puente" entre piezas cercanas; se pierden las zonas libres |
| Decimación | Por pieza, con tope repartido (`repartirTriangulos`); las copias se decimaron una sola vez | Decimar la malla unida mezcla grillas y rompe detalles de las chicas |
| Capas / retracción | Kiri intercala widgets por capa y retrae al cambiar de widget | Cruces de relleno y pared entre piezas separadas: stringing |

Riesgo conocido: `moveMesh` de Kiri escribe sobre el array de vértices si se mueve el centro. Como cada widget va en
su propio `group` y ya llega centrado, no debería moverlo; igual **no se comparte** el `Float32Array` entre copias
(`vertices.slice()` por copia: ya cabe en el presupuesto global).

**Contrato del mensaje al worker** (`src/motor/motor.js` → `laminador.worker.js`):

```js
// Antes (sigue valiendo; equivale a una pieza, una copia, en {0,0}):
{ tipo: 'laminar', stl, dispositivo, proceso, maxTriangulos, transformacion? }
// Ahora (si viene `piezas`, se ignoran `stl` y `transformacion`):
{
    tipo: 'laminar', dispositivo, proceso, maxTriangulos,
    piezas: [{
        stl: ArrayBuffer,            // se transfiere
        transformacion?: number[9],  // escala × rotación, fila por fila; falta = identidad
        posiciones: {x:number, y:number}[],  // una por copia: centro en mm, relativo al centro de la cama
    }],
}
```

`motor.laminar({ stl, ..., piezas, ... })` arma `[{ stl, transformacion, posiciones: [{x:0,y:0}] }]` si no viene
`piezas`, y transfiere el `stl` de cada pieza. El worker (nuevo módulo `src/motor/preparar-piezas.js`, que no importa
Kiri y se prueba en Node):

```js
/**
 * Lee, transforma, decima y centra cada pieza y la replica por copia.
 * @param {{stl:ArrayBuffer, transformacion?:number[], posiciones:{x:number,y:number}[]}[]} piezas
 * @param {object} dispositivo  perfil (bedWidth, bedDepth, maxHeight)
 * @param {number} maxTriangulos  tope del conjunto, copias incluidas
 * @param {(valor:number)=>void} [alReducir]
 * @returns {{widgets: {vertices:Float32Array, pos:{x:number,y:number,z:number}, tamano:{x:number,y:number,z:number}}[],
 *           triangulos:number, tamano:{x:number,y:number,z:number}, decimado:object|null}}
 *   `tamano`: x e y de la caja que abarca todo (con posiciones), z la altura de la más alta.
 *   Lanza Error con mensaje en español si una pieza no entra sola o si las posiciones se salen de la cama.
 */
export function prepararPiezas(piezas, dispositivo, maxTriangulos, alReducir) {}
```

Después, `laminar()` del worker hace `kiri('clear')`; por cada widget `kiri('sync', { id: 'p'+i, group: 'p'+i, vertices,
track: { ..., pos } })`, `rotate`, `slicePre`, `slice` por cada id (el progreso de `'laminando'` es
`(k + update) / N`), y un solo `slicePost`, `prepare`, `export`. `info.triangulos` pasa a ser el total con copias;
`info.tamano` la caja del conjunto (su `z` es el de la más alta: lo que usa `avisosPostLaminado`); se agrega
`info.copias` (total de widgets). La validación del worker: cada pieza entra sola (como hoy) y cada copia, con su caja
ya decimada y centrada, queda dentro de la cama con 0,5 mm de tolerancia. No se vuelve a correr `acomodar` en el
worker: las posiciones las decide la UI, para que lo que se ve sea lo que se imprime.

### 4. Visor: varias mallas y pieza activa

`visor.js` mantiene una malla por pieza (`Map<id, {malla, copias:Mesh[], tamano}>`); las copias comparten
`geometry` y `material` (sólo cambia la matriz), así que cuestan casi nada en GPU. `ponerTransformacion` deja de
reencuadrar la cámara cuando hay más de una malla (sólo `ponerCama` y la primera carga reencuadran). Contrato del
visor (lo que cambia; el resto de las funciones no cambia):

```js
ponerModelo(vertices /* Float32Array */, id = 0)        // agrega o reemplaza la malla de `id`; id 0 = el de hoy
ponerTransformacion(m /* number[9]|null */, id = 0)     // transforma, centra en X/Y y apoya en Z=0 la malla `id`
ponerCopias(id, posiciones /* {x,y}[] */, fuera = [])   // una instancia por posición; `fuera`: índices a pintar rojos
tamanoModelo(id = 0)                                    // {x,y,z} transformado, o null
quitarModelo(id)                                        // con id quita esa pieza; sin id, todas
resaltarPieza(id /* number|null */)                     // tinte suave a la activa (con una sola pieza no tiñe)
elegirCara(activo, alElegir /* (normal:number[], id:number) => void */)  // ahora informa también la pieza tocada
alTocarPieza(fn /* (id:number) => void */)              // un toque (misma detección que "apoyar cara") elige la activa
```

Con un solo `id` (0) todo se comporta como hoy. **Pieza activa:** la elige el usuario (a) tocando la pieza en el visor,
(b) con las "chips" de `#listaPiezas` (una por pieza, con su nombre y `× copias`), o (c) automáticamente: la última
agregada. Escala, rotaciones, "apoyar cara" y "restablecer" operan sólo sobre `estado.activa`; "Achicar para que
entre" achica la activa. En modo "apoyar cara", tocar otra pieza la vuelve activa **y** aplica la cara a esa (el
callback trae el `id`). Cada cambio de transformación llama a `reacomodar()` (módulo `piezas-ui`, sección 6), que
vuelve a correr `acomodar` con `visor.tamanoModelo(id)` de cada pieza repetido `copias` veces.

### 5. Interacciones

- **Recientes.** `recientes.js` sigue guardando **escala y rotación por modelo** (clave nombre+bytes): al cambiar
  cualquier pieza, `programarGuardado` capta todas (`estado.piezas` con `origen: 'modelo'`), con el mismo debounce de
  500 ms y las mismas salidas (paso, `pagehide`). Abrir un reciente **reemplaza** todas las piezas por esa (como hoy);
  las copias y la composición **no se persisten** en v1. "Agregar pieza" ofrece archivo (STL/OBJ/3MF) y "Ejemplo"; los
  recientes no se agregan a una composición (v1). Las piezas agregadas también se guardan en recientes.
- **Torre de calibración.** `origen: 'torre'` ⇒ **no se permiten más piezas**: `#agregarPieza` y las copias se
  ocultan, igual que hoy se ocultan escala y rotación. Es lo más simple y evita mezclar `configuracionDeTorre` (que
  manda Avanzado y los bloques en mm) con otras piezas. Cargar otra cosa con la torre puesta la reemplaza (como hoy).
- **Litofanía.** Idem: `origen: 'litofania'` no admite piezas extra. La foto sólo se elige con la cama vacía
  (`#sinModelo`), así que siempre es la primera y única.
- **Cambios por altura (ADR 0002).** Son **globales**: la altura de capa es una sola para todo el trabajo y Kiri
  aplica `process.ranges` por índice de capa a todos los widgets. `estado.cambios` se vacía sólo al cargar un modelo
  "de cero" (no al agregar piezas). `avisosPostLaminado` recibe como altura `info.tamano.z` (la de la más alta); una
  pieza más baja simplemente termina antes del cambio. La sección de cambios sigue deshabilitada con altura variable.
- **Soportes y balsa.** Valen para todas: Kiri soporta cada widget; la balsa y la falda salen de la unión de cajas.
- **Pausas de filamento.** No cambian (operan sobre capas del G-code).

### 6. Límites

`src/config.js` suma, con el mismo criterio que `maxTriangulos()` (según `navigator.deviceMemory`):

```js
export const MAX_PIEZAS = 8;                // piezas distintas
export const SEPARACION_PIEZAS_MM = 10;
export function maxCopias()                 // copias totales: <=2 GB: 6 · <=4 GB: 12 · >=8 GB: 24 · otro: 16
```

- **Triángulos:** el límite sigue siendo `maxTriangulos()` pero del **conjunto con copias**
  (`Σ triángulos × copias`); `repartirTriangulos` decide a cuánto decima cada pieza. `actualizarAvisoModelo` compara
  contra el total y avisa "Modelo pesado" con el total.
- **Cantidad:** `piezas.length <= MAX_PIEZAS` y `copiasTotales() <= maxCopias()`. Al pasarse, `validarCantidad` da el
  mensaje y los botones de agregar / "+ copia" se deshabilitan (no se tira error en medio del laminado).
- **Tiempo:** cada widget se lamina en serie en un solo hilo; con 24 copias el laminado tarda ~N veces lo de una. Se
  muestra el progreso global (`'laminando'` = `(k + update) / N`) y se puede cancelar como hoy.

### 7. Estándares: dividir ANTES de agregar

El orden de tareas (sección 9) es **crear módulos nuevos en paralelo, recablear en serie** y siempre dividir antes de
sumar lógica. Cada archivo termina en < 300 líneas y cada función en < 40 (`crearVisor` se parte por completo).

| Módulo (nuevo, `src/ui/`) | Sale de | Contenido | Líneas est. |
|---|---|---|---|
| `visor-cara.js` | `visor.js` | `elegirCara`, `tocarModelo`, `resaltar`, `quitarResaltado`, detección de toque; agrega `alTocarPieza` | ~110 |
| `visor-recorridos.js` | `visor.js` | `ponerRecorridos`, `mostrarCapa`, `pintarRecorridos`, `atenuarAbajo`, `quitarRecorridos` | ~90 |
| `ajuste-modelo.js` | `paso1-modelo.js` | escala, rotaciones, "apoyar cara", "ajustar a la cama", "restablecer", avisos del modelo | ~140 |
| `piezas-ui.js` | (nuevo) | chips de piezas, agregar, quitar, copias, `reacomodar` | ~150 |

`visor.js` queda en ~230 (cámara, cama, mallas, ciclo de dibujo) y `paso1-modelo.js` en ~190 (subida, carga,
cableado). `visor-cara` y `visor-recorridos` son fábricas con dependencias inyectadas (como `crearAvanzado`):
`crearSelectorCara(ctx)` y `crearRecorridos(ctx)`, donde `ctx` es `{ escena, camara, dom, redibujar, mallas }` (lo que
cada una usa hoy de la clausura de `crearVisor`; el detalle fino lo cierra T2 sin cambiar comportamiento).

Contratos para `scripts/lib/contratos-ui.js` (exports: nombre → aridad; `importa`: rutas de `src/` sin `.js`; los
módulos de UI no tocan el DOM al importarse y leen `estado.x` en el momento):

```js
'ui/visor-cara':       { exports: { crearSelectorCara: 1 }, importa: [] },
'ui/visor-recorridos': { exports: { crearRecorridos: 1 },   importa: ['motor/tipos-linea'] }, // sólo lo que use hoy
'ui/ajuste-modelo': {
    exports: { crearAjuste: 1 },   // ({ visor: () => Visor|null, alCambiar: () => void, torres: () => object|null })
    importa: ['ui/estado', 'ui/util-dom', 'ui/formato', 'motor/transformar', 'perfiles/perfiles', 'config'],
},
'ui/piezas-ui': {
    exports: { crearPiezas: 1 },   // ({ visor: () => Visor|null, agregar: () => void, alCambiar: () => void })
    importa: ['ui/estado', 'ui/util-dom', 'ui/formato', 'motor/piezas', 'config'],
},
// 'ui/estado' mantiene su `importa`; se le suman los exports crearPieza:1, piezaActiva:0, matrizPieza:1,
//   copiasTotales:0, piezasParaMotor:0.
// 'ui/paso1-modelo' suma a `importa`: 'ui/ajuste-modelo', 'ui/piezas-ui'.
// 'ui/recientes' y 'ui/paso3-laminar' no cambian sus aristas.
```

Aristas nuevas y grafo: `ajuste-modelo` y `piezas-ui` son **nivel 1** (importan `estado` y hojas, no `navegacion`);
`paso1-modelo` (nivel 2) las importa; nadie más. `visor-cara` y `visor-recorridos` son hojas (nivel 0) que sólo
importa `visor`. `motor/piezas` y `motor/preparar-piezas` están fuera de `src/ui/` (módulos de motor puros: el primero
sin imports, el segundo importa `stl`, `decimar`, `transformar` y `piezas`). No hay ciclos. La comunicación entre
`piezas-ui` y `ajuste-modelo` es **por callbacks** que cablea `paso1-modelo` (`alCambiar` de uno es `reacomodar` del otro).

### 8. Pruebas

- **`npm run test:piezas`** (Node, `scripts/probar-piezas.mjs`, se suma al CI y a `MAPA.md`): `acomodar` con una huella
  (`{0,0}`, `entra` según la cama), 4 cuadrados de 40 mm en 220×220 (una fila de cuatro con 10 mm), seis huellas
  desparejas sin superposición (ninguna caja se cruza ni invade la separación) y todas dentro, determinismo (misma
  entrada ⇒ misma salida), el orden de `posiciones` igual al de la entrada, el centrado del bloque, una huella más
  ancha que la cama (`entra:false`, `fuera:[i]`), muchas que no caben (`fuera` correcto) y la variante con ejes
  intercambiados; `repartirTriangulos` (suma ≤ máximo, mínimo 500, `Infinity` si ya entra); `validarCantidad`; que
  `src/motor/piezas.js` no tenga `import`; `prepararPiezas` con mallas sintéticas (cubos): un cubo = comportamiento de
  hoy (`pos` en 0, tamaño medido), tres copias = tres widgets con sus `pos`, decimación repartida, error si no entra.
- **`test:motor`** (`scripts/motor/piezas.mjs`, enganchado en `probar-motor.mjs` con 1 import y 1 llamada): cubo de
  20 mm × 4 copias en una Ender 3 V3 SE: el G-code tiene las 4 islas (el movimiento de extrusión de una capa cubre 4
  zonas XY separadas); **regresión:** una pieza con `piezas` da el mismo G-code que con `stl` (hash); dos piezas
  distintas (cubo y esfera) con soportes; cambio por altura (`M104` desde 10 mm) aparece **una sola vez** aunque haya
  varias piezas; copia fuera de la cama ⇒ error en castellano; Σ triángulos con tope menor ⇒ `info.decimado`.
- **`test:app`** (`scripts/app/piezas.mjs`, con **Precondición/Deja** en la cabecera como el resto): cargar el cubo,
  "Agregar pieza", subir una segunda, activar una y escalarla (la otra no cambia), poner 3 copias, ver "Siguiente"
  habilitado; subir la escala hasta que no entre ⇒ aviso y "Siguiente" deshabilitado; quitar una pieza; laminar y ver
  el resultado; con torre cargada no hay "Agregar pieza". Con una pieza, todo `test:app` actual sigue verde.
- `test:contratos` (con `CONTRATOS_ESTRICTO=1`) verifica exports, aridad y aristas de los cuatro módulos nuevos.

### 9. Plan de tareas

Cada tarea es **< 200 líneas de producción** (sin contar pruebas), un commit, y deja `lint`, `format:check`, `build`
y las suites de su área en verde. **Dentro de una ola los archivos no se pisan**; `docs/MAPA.md`,
`scripts/lib/contratos-ui.js`, `package.json` y `.github/workflows/ci.yml` los toca una sola tarea por ola.

| Ola | Tarea | Rol | Qué | Archivos | Depende de |
|---|---|---|---|---|---|
| 1 | **T1** | dev motor | `acomodar`, `repartirTriangulos`, `validarCantidad` + suite Node | `src/motor/piezas.js`, `scripts/probar-piezas.mjs`, `package.json` (`test:piezas`), `.github/workflows/ci.yml`, `docs/MAPA.md` | — |
| 1 | **T2** | dev interfaz | **Crear** `visor-cara.js` y `visor-recorridos.js` copiando el código de `visor.js` (sin tocar `visor.js`); `alTocarPieza` | `src/ui/visor-cara.js`, `src/ui/visor-recorridos.js` | — |
| 1 | **T3** | dev interfaz | **Crear** `ajuste-modelo.js` copiando de `paso1-modelo.js` (sin tocarlo) | `src/ui/ajuste-modelo.js` | — |
| 2 | **T4** | dev motor | `prepararPiezas` + sus pruebas en Node | `src/motor/preparar-piezas.js`, `scripts/probar-piezas.mjs` | T1 |
| 2 | **T5** | dev interfaz | **Recablear `visor.js`**: usa T2, borra lo duplicado, mallas por `id` y la API de la sección 4; registra contratos de `visor-cara`/`visor-recorridos` | `src/ui/visor.js`, `scripts/lib/contratos-ui.js`, `docs/MAPA.md` | T2 |
| 3 | **T6** | dev motor | Worker y `motor.laminar` con `piezas`; límites en `config.js`; prueba contra el Kiri real | `src/motor/laminador.worker.js`, `src/motor/motor.js`, `src/config.js`, `scripts/motor/piezas.mjs`, `scripts/probar-motor.mjs` | T4 |
| 3 | **T7** | dev interfaz | `estado.piezas` + accesores; **recablear `paso1-modelo.js`** con T3 y la API nueva del visor (una pieza, `id` 0); contratos de `ajuste-modelo` | `src/ui/estado.js`, `src/ui/paso1-modelo.js`, `scripts/lib/contratos-ui.js`, `docs/MAPA.md` | T3, T5 |
| 4 | **T8** | dev interfaz | `piezas-ui.js`: chips, agregar (archivo/ejemplo), quitar, pieza activa (toque y chips); sin copias aún | `src/ui/piezas-ui.js`, `index.html` (`#listaPiezas`, `#agregarPieza`), `src/estilos.css`, `src/ui/paso1-modelo.js` (≤ 12 líneas), `scripts/lib/contratos-ui.js`, `docs/MAPA.md` | T7 |
| 4 | **T9** | dev interfaz | Laminar y entregar: `paso3-laminar` arma `piezas` con `piezasParaMotor` (y no lamina si `!entra`), recientes guarda todas, paso 4 muestra copias | `src/ui/paso3-laminar.js`, `src/ui/recientes.js`, `src/ui/paso4-resultado.js` | T6, T7 |
| 5 | **T10** | dev interfaz | Copias + acomodo en la UI: stepper de copias, `reacomodar`, aviso "no entran", "Siguiente" deshabilitado, límites, torre/litofanía sin extras | `src/ui/piezas-ui.js`, `src/ui/ajuste-modelo.js`, `index.html`, `src/estilos.css` | T8, T9, T1 |
| 6 | **T11** | dev interfaz | Prueba de la app | `scripts/app/piezas.mjs`, `scripts/probar-app.mjs` | T10 |
| 6 | **T12** | arquitecto | Cierre: `MAPA.md` (flujo, estado, pruebas, "dónde buscar"), `CHANGELOG.md`, este ADR a Aceptado | `docs/MAPA.md`, `CHANGELOG.md`, `docs/decisiones/0003-varias-piezas.md` | T10 |

Pruebas por tarea: **T1** `test:piezas` (acomodar, repartir, validar, sin imports). **T2/T3** sin comportamiento
nuevo: sólo `build` y `lint` (los archivos todavía no los importa nadie). **T4** `test:piezas` (`prepararPiezas`).
**T5** `test:contratos` estricto + `test:app` completo (el visor con una pieza se ve igual: gestos, apoyar cara).
**T6** `test:motor` con `scripts/motor/piezas.mjs` (regresión idéntica con una pieza, 4 copias, dos piezas, cambio
por altura una sola vez). **T7** `test:contratos` + `test:app` completo sin cambios (compatibilidad: una pieza = hoy).
**T8** `test:app` completo + una verificación manual de las chips. **T9** `test:app` completo (laminar el cubo,
recientes). **T10** `test:app` completo y la suite nueva en borrador. **T11** `test:app` con `piezas.mjs` incluido.

Paralelismo: **T1 ∥ T2 ∥ T3** (olas de "crear": nadie toca archivos existentes de los otros); **T4 ∥ T5**
(`motor/` contra `ui/visor.js`); **T6 ∥ T7** (motor contra `estado.js`/`paso1`); **T8 ∥ T9** (`piezas-ui`/`index.html`
contra `paso3`/`recientes`/`paso4`; las dos usan `estado.piezas` ya hecho en T7). T10 va en serie porque comparte
`piezas-ui.js` e `index.html` con T8. **Primer entregable de valor:** hasta T9 la app funciona igual que hoy pero con
el motor listo; T10 activa las copias y las piezas para el usuario.

## Consecuencias

**Más fácil.** El acomodo es una función pura con su suite rápida y la usan igual la UI y las pruebas. Usar varios
widgets reaprovecha lo que Kiri ya hace (soportes, falda, retracción entre piezas) sin parsear G-code. Dividir
`visor.js` y `paso1-modelo.js` baja la deuda técnica (la de `crearVisor` de 310 líneas desaparece) y deja módulos
de UI chicos que se reparten entre devs. Con una pieza nada cambia para el usuario ni para el G-code.

**Más difícil / costo.** `estado` tiene accesores (una indirección que hay que recordar al depurar: `estado.escala`
es de la pieza activa). El visor suma una dimensión (`id`) en cuatro funciones. El laminado de varias copias es
proporcionalmente más lento y el progreso mezcla piezas. Tres suites cambian (`test:piezas` nueva, `test:motor` y
`test:app` ampliadas).

### Riesgos

| # | Riesgo | Cómo se cubre |
|---|---|---|
| R1 | El `track.pos` de Kiri no se aplica igual a falda, balsa o soportes | **Cerrado por T0:** `scripts/motor/piezas-kiri.mjs` lo mide en el Kiri real (2 copias en (±40, ±30) con falda, borde, balsa, soportes y retracción) y pasa: se usa `pos` y no hace falta el plan B. Pendiente: no hay prueba con `originCenter` ni cama de cinta |
| R2 | Memoria y tiempo con muchas copias | Presupuesto global de triángulos, `maxCopias()` por RAM, cancelar como hoy, progreso global; el celu más flojo queda en 6 copias |
| R3 | Los estantes dejan mal aprovechada la cama con piezas muy desparejas | Es un acomodo "razonable", no óptimo; el usuario puede rotar/escalar o quitar. Si molesta, se cambia el algoritmo detrás de la misma firma de `acomodar` |
| R4 | La decimación achica la huella y el visor mostraba otra posición | La separación de 10 mm lo absorbe (la celda de decimado es de décimas de mm); el worker valida contra la cama con tolerancia |
| R5 | Cambios por altura mal interpretados con piezas de distinta altura | Se documenta como global; `avisosPostLaminado` usa la más alta; `test:motor` verifica un solo `M104` |
| R6 | Dividir `visor.js` y `paso1-modelo.js` rompe gestos o "apoyar cara" | Recablear va en serie (T5, T7), con `test:app` completo como red de seguridad y comportamiento idéntico con una pieza |
| R7 | Los accesores de `estado` ocultan errores si no hay pieza activa | Los setters no hacen nada sin pieza y `test:piezas`/`test:app` cubren cama vacía; `piezaActiva()` cae en la primera |

### Dudas abiertas

- ¿La torre admite piezas extra en una versión futura (p. ej. dos torres en la misma cama)? Hoy no.
- ¿Conviene persistir la composición (piezas y copias) como "proyecto"? Hoy se guardan sólo escala y rotación por modelo.
- ¿Acomodo manual (arrastrar piezas en el visor)? Fuera de alcance de v1; la firma de `acomodar` ya admite reemplazarlo.
- Rotar automáticamente 90° las huellas para empaquetar mejor: no se hace para respetar la orientación elegida.

---
Reglas de uso: un ADR por decisión; numeración correlativa; no se editan los aceptados (se reemplazan con otro ADR).

## Enmiendas de la implementación

Lo que cambió al construir, respecto del texto de arriba. Cada punto se verificó contra el código en `1eaad66`.

- **`crearAjuste`** (`src/ui/ajuste-modelo.js`) devuelve `{conectar, aplicar, actualizarAviso, cancelarCara}`. `cancelarCara` sale del modo "apoyar cara" al montar un modelo.
- **`visor-cara`** recibe `mallas: () => Mesh[]` (todas las mallas tocables, copias incluidas). El id de la pieza sale de `malla.userData.idPieza` (0 si falta). La sección 4 no lo mencionaba en el contexto.
- **`src/ui/visor-cama.js`** es un módulo nuevo que no está en la sección 7: `reemplazarCama(escena, anterior, medidas)` pone la cama, la grilla cada 10 mm y la marca del origen. Sale de `visor.js`.
- **Un solo id por pieza.** `crearPieza` (`src/ui/estado.js`) asigna `id` secuencial desde 1 y no lo reutiliza. No hay una pieza con id 0 fijo: el `0` de las funciones del visor es sólo el default de las llamadas sin id.
- **Ganchos para las pruebas.** El canvas expone `data-piezas` (cantidad de mallas, `visor.js`). `#listaPiezas` expone `data-copias` (copias totales) y `data-fuera` (`idPieza:copia` de las que no entran), en `piezas-ui.js`. No cambian lo que ve el usuario.
- **`src/ui/acomodo.js`** exporta `acomodarPiezas(medir?)`, sin DOM. Escribe `p.posiciones` y `estado.entra`. Usa `p.tamano` (la medida real que guarda `ajuste-modelo`) si no viene `medir`; si falta, la caja de 8 esquinas. La sección 2 no lo listaba como módulo de UI.
- **`copias-ui.js` está separado de `piezas-ui.js`.** El stepper de copias (`crearCopias`) es su módulo; `piezas-ui` lo importa.
- **Contrato real de `piezas-ui`.** `crearPiezas(ctx)` recibe `{visor, ajuste, leer, ejemplo, elegirOtro, guardar}` (no `agregar` ni `alCambiar`) y devuelve `{conectar, dibujar, reacomodar}`. Importa `estado`, `util-dom`, `config`, `motor/piezas`, `ui/acomodo` y `ui/copias-ui`; no importa `ui/formato`. `scripts/lib/contratos-ui.js` verifica esa lista.
- **`prepararPiezas` consume `p.stl`** (lo suelta al leerlo) y ya no tiene la opción `desplazar`: T0 confirmó que Kiri aplica `track.pos` a falda, balsa y soportes, así que no hizo falta el plan B.
- **Paso 3 con una sola pieza y una copia** no bloquea con `acomodarPiezas` (`sola` en `paso3-laminar.js`). Deja decidir al worker, que valida con `prepararPiezas` y da el mensaje detallado ("El modelo mide … no entra en la cama"). Con más de una pieza o copia, el paso 3 no lamina si `estado.entra` es false.
- **`rotacion` es `number[]` de 9 elementos** (matriz 3×3 aplanada), no `number[][]`. `piezasParaMotor()` manda `transformacion` con el mismo formato.
- **Archivos de prueba.** `scripts/probar-piezas.mjs` (con `scripts/piezas/preparar.mjs`) corre en `test:piezas`. `scripts/probar-estado.mjs` lo llama `scripts/probar-contratos.mjs`, así que corre en `test:contratos`. `scripts/motor/piezas-kiri.mjs` y `scripts/motor/piezas.mjs` corren desde `test:motor`. `scripts/app/piezas.mjs` y `scripts/app/copias.mjs` corren desde `test:app`.
