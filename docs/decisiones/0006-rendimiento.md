# 0006. Cargar three.js bajo demanda y simplificar la vista previa de G-codes enormes

- **Fecha:** 2026-10-18
- **Autor/a:** arquitecto
- **Base:** commit `d0f3de0`

## Estado

Aceptado por el CTO el 2026-10-18, con estas decisiones:

- `chunkSizeWarningLimit: 600`; el control real es `test:chunks` en la CI.
- **T0 y T4 van juntas** (la medición es la aceptación de T4). Los niveles se calibran con un G-code grande que
  genera la propia prueba (laminado por Kiri o sintético realista); no se commitea un G-code de decenas de MB.
- El aviso de "vista simplificada" tiene una prueba de punta a punta en T6, forzando `navigator.deviceMemory` con
  `addInitScript` de Playwright (sin ganchos de prueba en el código de producción).
- Confirmado: mientras el visor carga, el acomodo usa la caja de 8 esquinas y `alListo` reacomoda.
- El chunk `motor` (205 kB) queda fuera de v1 y pasa a la deuda del MAPA.

## Contexto

Dos problemas de rendimiento, medidos sobre `d0f3de0` con `npm run build` (Vite, `target: es2022`):

**1. El chunk principal pesa 594 kB.** Contiene la app entera más three.js, porque `src/ui/visor.js`,
`visor-cara.js`, `visor-cama.js` y `visor-recorridos.js` importan `three` (y `OrbitControls`) de forma estática,
y `paso1-modelo.js` y `vista-capas.js` importan `visor.js`. Vite avisa "Some chunks are larger than 500 kB".

| Archivo de `dist/` | Sin gzip | gzip | Nota |
|---|---|---|---|
| `assets/main-*.js` | 594,07 kB | 157,74 kB | punto de entrada (app + three) |
| `assets/motor-*.js` | 205,74 kB | 28,52 kB | chunk compartido con `prueba-motor.html` (`motor.js`, perfiles) |
| `assets/pruebaMotor-*.js` | 27,17 kB | 9,36 kB | página de diagnóstico, no se precachea |
| `assets/main-*.css` | 17,64 kB | 4,12 kB | |
| `index.html` | 35,33 kB | 6,56 kB | |
| `assets/laminador.worker-*.js` | 1.943,07 kB | 542,19 kB | Kiri:Moto; sólo corre en el worker |
| `assets/convertir.worker-*.js` | 107,07 kB | n/d | OBJ, 3MF, litofanía, torres |
| `assets/recorridos.worker-*.js` | 5,02 kB | n/d | |
| `assets/vista.worker-*.js` | 2,78 kB | n/d | |
| `assets/prueba-piezas.worker-*.js` | 1.916,46 kB | n/d | sólo para pruebas, no se precachea |

Medido aparte con esbuild, `visor.js` con todo lo que arrastra (three incluido) da 529,0 kB y 138 kB de gzip. Entonces
sacar el visor del chunk principal lo deja en unos 70 a 110 kB (estimación; se mide en T3). Al arrancar la app se baja el
chunk principal más el chunk `motor` (205,74 kB): hoy ~800 kB sin gzip antes de que el usuario haga nada.

El **service worker** (`src/sw.js`) recibe la lista de archivos de `vite.config.js` (plugin `serviceWorker`, en
`writeBundle`): recorre TODO `dist/` (menos `sw.js`, `prueba-motor*`, `pruebaMotor*` y `prueba-piezas*`) y `install` hace
`cache.addAll(ARCHIVOS)`. Un chunk nuevo que salga de un `import()` también queda en la lista sin tocar nada, porque se
genera antes de `writeBundle`; offline se sirve de la copia guardada (`ignoreSearch`, `ignoreVary`). Hoy no hay ningún
`import()` en `src/`. Lo que hay que agregar es una prueba que lo confirme, no código.

**Quién usa el visor** (`crearVisor` se llama en sólo dos lugares, cada uno con su instancia):

| Llamador | Cómo lo usa | ¿Necesita el valor de vuelta? |
|---|---|---|
| `paso1-modelo.js` (`montarModelo`) | `crearVisor($('visor'))`, `ponerCama`, `ponerModelo`, `quitarModelo`, `pausar`; se lo pasa a `ajuste-modelo` y `piezas-ui` con `visor: () => visor` | no |
| `ajuste-modelo.js` | `ponerTransformacion`, `elegirCara`, **`tamanoModelo(id)`** (guarda `p.tamano`) | sí, `tamanoModelo` |
| `piezas-ui.js` | `ponerModelo`, `quitarModelo`, `resaltarPieza`, `alTocarPieza`, `ponerCopias`, **`tamanoModelo(id)`** | sí, `tamanoModelo` |
| `vista-capas.js` (`mostrarRecorridos`) | `crearVisor($('visorCapas'))`, `ponerCama`, `ponerRecorridos`, `pausar`, `mostrarCapa`, `quitarRecorridos` | no |
| `pausas-ui.js` | `atenuarAbajo`, `pintarRecorridos`, con el visor que le inyecta `vista-capas` (`deps.visor()`) | no |

Todos los métodos son órdenes que no devuelven nada, salvo `tamanoModelo`. Y `acomodo.js` ya sabe arreglarse sin él: usa
`p.tamano` y, si falta, la caja de 8 esquinas (`vista.tamano` × `matrizPieza`).

**2. La vista previa de un G-code enorme se corta.** `maxSegmentosVista()` (`src/config.js`: 1 M, 2 M, 3 M o 6 M de
tramos según la RAM; 18 bytes por tramo) es un tope duro: `leer` (`src/motor/recorridos-lector.js`) deja de leer al
llenarse y devuelve `incompleta: true`, así que se ven sólo las primeras capas ("la vista llega hasta la capa N") y se
pierde justo lo de arriba de la pieza. `Tramos.puedeUnir` (`recorridos-tramos.js`) ya une tramos alineados con dos
constantes fijas: `DESVIO = 0.02` mm y `LARGO_CURVA = 3` mm. El bucle por línea no arma objetos ni closures (ver la
cabecera del lector) y es el camino más caliente de la app: un G-code de 2 M de líneas (63 MB) tarda entre 0,75 y 1,8 s
en una misma sesión de Node 22 (5 corridas seguidas en este sandbox: 1022, 1799, 1714, 1479 y 746 ms). Esa variación del
±50 % obliga a medir de otra forma que "correr dos veces" (decisión 3).

Restricciones: castellano rioplatense; sin dependencias nuevas; no se toca `vendor/kiri`; archivos < 300 líneas y
funciones < 40 (`visor.js` ya tiene 280 líneas: no se le suma ninguna); los módulos de `src/ui/` no tocan el DOM al
importarse (ADR 0001); las aristas del grafo están en `scripts/lib/contratos-ui.js` y `npm run test:contratos` las
verifica, y su lector de imports ya cuenta los `import('x')` como aristas.

## Decisión

### 1. `three` bajo demanda con una fachada sincrónica: `src/ui/visor-carga.js`

Vamos a cortar en **un solo módulo nuevo**, `visor-carga.js`, que exporta una `crearVisor(contenedor, opciones)` con la
MISMA forma que la de `visor.js` pero sincrónica: devuelve enseguida un objeto con los mismos métodos. Mientras three no
llegó, las órdenes se **encolan**; cuando llega, se crea el visor real, se reproduce la cola en orden y se avisa con
`opciones.alListo`. Es el único módulo que importa `ui/visor` y lo hace con `import('./visor.js')`. Vite saca ese import
y todo lo que arrastra (three, `OrbitControls`, `visor-cara`, `visor-cama`, `visor-recorridos`) a un chunk aparte.

**Por qué esta y no `cargarVisor(): Promise<...>`.** Con una promesa hay que volver asíncronos `montarModelo`,
`ajuste-modelo`, `piezas-ui` y `vista-capas`, que hoy leen `ctx.visor().algo()` en cualquier momento (incluido el valor de
`tamanoModelo`) y cuyo orden de ejecución ya cubren `test:app` y `test:contratos`. La fachada deja a los llamadores
**exactamente como están**: sólo cambia la línea `import { crearVisor } from './visor.js'` por `'./visor-carga.js'` en
`paso1-modelo.js` y `vista-capas.js`; `ajuste-modelo`, `piezas-ui` y `pausas-ui` no se tocan (reciben el visor por
inyección). La fachada tampoco puede vivir dentro de `visor.js`: ese módulo importa three de forma estática, así que
nunca saldría del chunk principal.

Tabla de llamadores y cambios:

| Llamador | Cambio |
|---|---|
| `src/ui/paso1-modelo.js` | el `import` de `crearVisor` apunta a `visor-carga.js`; `crearVisor($('visor'), { alListo })` con `alListo = () => { ajuste.aplicar(); piezas.reacomodar(); }` (rehace `p.tamano` con la medida real, ver abajo) |
| `src/ui/vista-capas.js` | sólo el `import`; `crearVisor($('visorCapas'))` sin `alListo` |
| `src/ui/ajuste-modelo.js`, `piezas-ui.js`, `pausas-ui.js` | sin cambios |
| `src/main.js` | llama `precargarVisor()` en las tareas de fondo (paso 4 del arranque), después del primer dibujo |
| `src/ui/visor.js` y sus tres hojas | sin cambios (ni una línea) |

**Reglas de la cola.**

1. Los métodos son órdenes: se guardan `[nombre, argumentos]` y se reproducen en orden. Los argumentos se guardan por
   referencia (el `Float32Array` del modelo no se copia).
2. Para que la cola no crezca ni repita trabajo, de `ponerCama`, `pausar`, `mostrarCapa`, `atenuarAbajo` y `vistaInicial`
   sólo se conserva la última orden. `quitarModelo()` y `quitarRecorridos()` NO borran órdenes anteriores (se reproducen
   en orden y el resultado es el mismo; es más simple y obviamente correcto).
3. **`tamanoModelo(id)` es la única consulta.** Antes de que el visor esté listo devuelve `null` (así ya lo prevé
   `ajuste-modelo`: `... || estado.vista.tamano`, y `acomodo` usa la caja de 8 esquinas si `p.tamano` falta). Al quedar
   listo, `alListo` hace que `paso1-modelo` vuelva a correr `ajuste.aplicar()` (que guarda `p.tamano` real) y
   `piezas.reacomodar()`. Resultado: nada queda con la medida aproximada.
4. Si el módulo ya estaba cargado (`precargarVisor` o un uso anterior), `crearVisor` crea el visor real en el mismo turno
   y no encola nada.

**Qué se ve mientras carga.** `crearVisor` agrega dentro del contenedor un `<div class="visor-estado" role="status">`
con el texto "Cargando el visor 3D…" (se muestra a los 200 ms, para no parpadear cuando viene del caché) y deja
`contenedor.dataset.visor = 'cargando' | 'listo' | 'error'`. Al terminar saca el aviso. **El resto del paso 1 sigue
andando**: escala, rotaciones, copias, "Siguiente" y el laminado no dependen del visor (usan `estado` y `acomodo`). Si
`import()` falla, el aviso pasa a "No se pudo cargar el visor 3D. Tocá acá para reintentar." y un toque vuelve a pedir el
módulo (la promesa cacheada se descarta al fallar; la cola se conserva). Eso cubre también el caso de una pestaña vieja
cuyo chunk ya no existe tras una actualización.

**Precarga.** `main.js` llama `precargarVisor()` al final del arranque (`requestIdleCallback`, o `setTimeout(…, 1)` si
no existe). Así, cuando el usuario elige un modelo, el chunk casi siempre ya está y el aviso nunca aparece. La carga
inicial de la app no se alarga (el chunk principal pierde ~500 kB); el costo total de red es el mismo que hoy, repartido.

**Offline.** No hace falta código: el plugin del SW ya recorre `dist/`. Se agrega la verificación (decisión 5):
`verificar-chunks.mjs` confirma que el chunk del visor está en `ARCHIVOS` de `dist/sw.js`, y `scripts/app/offline.mjs`
recarga sin conexión y espera `#visor[data-visor="listo"]` antes de laminar.

**Tope.** El chunk principal, **menos de 250.000 bytes sin gzip** (hoy 594.07 kB), y el arranque estático (principal más
sus dependencias estáticas, hoy ~800 kB) menos de **400.000 bytes**; además ningún chunk del arranque estático puede
contener `WebGLRenderer`. Como el chunk del visor seguirá pasando 500 kB, se sube `build.chunkSizeWarningLimit` a 600 en
`vite.config.js` para que el aviso de Vite no se vuelva ruido permanente; el guardián real es `verificar-chunks.mjs`.

Alternativas descartadas: (a) `cargarVisor(): Promise` (arriba); (b) `manualChunks` para separar three sin hacerlo
dinámico: no baja lo que se descarga ni se parsea al arrancar; (c) hacer el visor asíncrono desde adentro: toca
`visor.js` (280 líneas) y sus tres hojas, sin ganar nada.

### 2. Menos detalle: un nivel de simplificación en el lector, elegido por reintento

Vamos a **unir más tramos** en vez de cortar la vista. Hoy el lector ya une tramos alineados; con un `nivel` se afloja
cuánto se puede apartar de la recta el punto que se saca (`DESVIO`) y cuán largo puede ser un tramo unido que no es recto
(`LARGO_CURVA`). A mayor nivel, menos tramos y un dibujo que a escala de celu no se distingue. Las capas, sus Z, los
tipos, la caja y los offsets de pausa **no cambian nunca** (se calculan por línea, no por tramo), así que pausas, deslizador
y colores siguen idénticos. Es todo función pura y vive en Node.

| Nivel | `DESVIO` (mm) | `LARGO_CURVA` (mm) | Tramos respecto del nivel 0 (medido) | `REDUCCION` | Uso |
|---|---|---|---|---|---|
| 0 | 0,02 | 3 | 100 % | 1 | hoy, **idéntico bit a bit** |
| 1 | 0,08 | 10 | 76 a 88 % (media 83 %) | 0,88 | |
| 2 | 0,15 | 20 | 59 a 69 % (media 65 %) | 0,70 | |
| 3 | 0,30 | 40 | 44 a 52 % (media 49 %) | 0,52 | último recurso |

Calibrado en T4 (valores finales) con 5 G-codes de `scripts/lib/gcode-sintetico.mjs` de 600.000 líneas (círculos de
segmentos de 0,15 a 0,35 mm, rectas, zigzag, retracciones, cambios de `; feature`, 3 piezas): rango por nivel de los 5
G-codes; `REDUCCION` toma el peor caso (prudente). A diferencia del nivel 0, los niveles 1 a 3 comprueban **todos** los
puntos que sacan contra el tramo unido (el error máximo medido punto a punto es `DESVIO`, más 0,015 mm de cuantizado),
así que el error no se acumula; por eso `DESVIO` sube más que en la propuesta inicial. Con la regla estricta, la propuesta
(0,05/0,10/0,20) sólo llegaba a 90/70/54 %.

Los valores de la tabla son los finales de T4 (los de la propuesta eran provisorios); la prueba de error máximo está en `scripts/recorridos/niveles.mjs`.

**El nivel se elige sin adivinar** (no se cuentan líneas ni se estima por tamaño de texto): se lee con el nivel pedido y,
si se llena `maxSegmentos`, se proyecta cuánto faltaba y se reintenta con un nivel más alto. Como mucho 3 lecturas, y la
primera se corta apenas se llena el tope, así que cuesta lo que costaría hoy:

```
nivel = 0
repetir:
    r = leer(gcode, maxSegmentos, { nivel })
    si no r.incompleta o nivel == 3: devolver r      // r.simplificado: se unió algo que el nivel 0 no habría unido
    proyectado = maxSegmentos * gcode.length / r.leidoHasta       // tramos que daría el nivel actual
    nivel = menor n > nivel tal que proyectado * REDUCCION[n] / REDUCCION[nivel] <= 0,9 * maxSegmentos
            (si no hay ninguno, 3)
```

`REDUCCION = [1, 0.88, 0.70, 0.52]` (fracción de tramos que queda respecto del nivel 0, la del peor caso medido en T4;
ver la tabla y `recorridos-niveles.js`).

**Contrato de `leer`** (`src/motor/recorridos-lector.js`):

```js
/**
 * @param {string} gcode
 * @param {number} maxSegmentos tope de tramos (Infinity para no limitar)
 * @param {{ nivel?: 0|1|2|3 }} [opciones] nivel de simplificación; omitido = 0 (igual que antes)
 * @returns {{ posiciones: Uint16Array, colores: Uint8Array, tipos: Uint8Array, inicioCapa: Uint32Array,
 *   pausaCapa: Float64Array, zCapa: Float32Array, caja: {min: number[], max: number[]}, incompleta: boolean,
 *   nivel: 0|1|2|3, simplificado: boolean, leidoHasta: number }}
 *   `nivel`: el usado; `simplificado`: se unió algo que el nivel 0 no habría unido; `leidoHasta`: posición en el texto de la primera línea no leída
 *   (`gcode.length` si se leyó todo). Los campos anteriores significan lo mismo que antes.
 */
export function leer(gcode, maxSegmentos, opciones) {}
```

```js
// src/motor/recorridos-auto.js (puro, sin imports de DOM ni de self)
/**
 * Lee con el nivel mínimo que entra en `maxSegmentos` (reintenta con niveles más altos, hasta 3 lecturas).
 * @param {string} gcode
 * @param {number} maxSegmentos
 * @returns {ReturnType<typeof import('./recorridos-lector.js').leer>} el resultado de la última lectura;
 *   `incompleta` sólo es true si ni el nivel 3 entra
 */
export function leerAuto(gcode, maxSegmentos) {}

// src/motor/recorridos-niveles.js (puro, sin imports)
/** @type {ReadonlyArray<{desvio: number, largoCurva: number}>} un elemento por nivel (0 a 3) */
export const NIVELES = [];
/** @type {ReadonlyArray<number>} fracción de tramos que deja cada nivel respecto del 0 */
export const REDUCCION = [];
/**
 * Nivel más bajo, mayor que `desde`, con el que se espera que entren `proyectado` tramos en `maxSegmentos`.
 * @param {number} proyectado tramos que daría el nivel `desde`
 * @param {number} maxSegmentos
 * @param {0|1|2} desde
 * @returns {1|2|3}
 */
export function siguienteNivel(proyectado, maxSegmentos, desde) {}
```

`Tramos` recibe el nivel (`new Tramos(maxSegmentos, nivel = 0)`), guarda `this.desvio` y `this.largoCurva` y `puedeUnir`
los lee en vez de las constantes de módulo. Es el único cambio en el bucle caliente (dos lecturas de campo, ninguna rama
nueva, ningún objeto por línea); por eso se mide (decisión 3). `Lector` guarda `leidoHasta` al cortar.

**Cableado.** `recorridos.worker.js` recibe `{ gcode, maxSegmentos, auto }` y llama `auto ? leerAuto(...) : leer(...)`
(manda también `nivel`, `simplificado` y `leidoHasta`; el resto igual). `motor.leerRecorridos(gcode, maxSegmentos, opciones)`
pasa `opciones.auto`. `vista-capas.js` pide `{ auto: true }` y muestra el aviso.

**Aviso al usuario** (`#avisoVista`, que hoy sólo avisa de `incompleta`). Nuevo módulo puro `src/ui/aviso-vista.js`:

```js
/**
 * Texto del aviso de la vista previa, o '' si no hace falta.
 * @param {{ simplificado: boolean, incompleta: boolean }} r resultado de leer
 * @param {number} capas capas que se pueden ver
 * @returns {string}
 */
export function textoAvisoVista(r, capas) {}
```

- `simplificado` y no `incompleta`: "Para que entre en este equipo, la vista previa está simplificada: se unen tramos
  cortos. El G-code está completo y no cambia."
- `incompleta` (con o sin `simplificado`): el texto de hoy, "El archivo es muy grande para mostrarlo entero en este equipo:
  la vista llega hasta la capa N. El G-code está completo.".
- ninguno: ''.

Alternativa descartada: dibujar con detalle sólo la capa actual y las de abajo simplificadas. Exige dos versiones de los
datos en el visor (el doble de memoria de GPU o recomputar al mover el deslizador) y tocar `visor-recorridos.js`; se
deja para después (fuera de v1). Otra descartada: estimar el nivel contando líneas; la proporción de líneas que se funden
depende de la pieza y habría que calibrarla, y un error de estimación devuelve una vista cortada o simplificada de más.

### 3. Medición de los bucles calientes

Todo cambio en `recorridos-lector.js` o `recorridos-tramos.js` se mide contra la base `d0f3de0` y **no puede pasar de
+10 %** en el nivel 0. Por la variación vista (±50 % en corridas seguidas dentro de un proceso), cada muestra corre en un
proceso de Node nuevo y se alternan base y nuevo. Script permanente `scripts/medir-recorridos.mjs`
(más `scripts/lib/gcode-sintetico.mjs`, un generador determinista de G-code: círculos y zigzag por capa):

```
node scripts/medir-recorridos.mjs [--ref=d0f3de0] [--lineas=2000000] [--tandas=7] [--corridas=3] [--max=10]
```

- Extrae la base con `git archive <ref> src/motor | tar -x -C <tmp>`; "nuevo" es el árbol actual.
- Alterna procesos hijos: base, nuevo, base, nuevo… (`--tandas` de cada uno). Cada hijo hace 1 corrida de calentamiento
  descartada y `--corridas` medidas, y devuelve el mínimo.
- Reporta la mediana de los mínimos de cada lado, la razón nuevo/base y las tandas crudas; sale con 1 si la razón pasa de
  `1 + max/100` en el nivel 0 (para los niveles 1 a 3 sólo imprime tiempo, tramos y memoria, sin tope).
- Es la prueba de aceptación de T4 (y de T5 para `leerAuto`: el costo de dos lecturas se informa, no se compara).

No entra en CI (es lento y depende de la máquina); se corre a mano en las tareas que tocan el lector.

### 4. Contratos y grafo

Aristas nuevas y cambiadas en `scripts/lib/contratos-ui.js` (`importa` es exacto: lo que no está, no se permite):

```js
'ui/visor-carga': { exports: { crearVisor: 2, precargarVisor: 0, armarVisorCarga: 1 }, importa: ['ui/visor'] }, // import() dinámico
'ui/aviso-vista': { exports: { textoAvisoVista: 2 }, importa: [] },
// cambian:
'ui/paso1-modelo': importa: VISOR -> 'ui/visor-carga'
'ui/vista-capas':  importa: VISOR -> 'ui/visor-carga', + 'ui/aviso-vista'
```

`main.js` también importa `ui/visor-carga` (hoy `main` no figura en `CONTRATOS`; el grafo real lo cubre el chequeo de
`src/main.js`). Nadie más puede importar `ui/visor`: la lista exacta de `importa` lo impide.

Firmas de la fachada (JSDoc completo en el código):

```js
/**
 * Visor con la misma API que `crearVisor` de visor.js, pero que se puede usar enseguida: las órdenes se encolan hasta
 * que three.js llega (import dinámico). Ver ADR 0006, sección 1.
 * @param {HTMLElement} contenedor
 * @param {{ alListo?: () => void }} [opciones] alListo: se llama una vez, después de reproducir la cola
 * @returns {Record<string, Function>} el visor (mismos métodos que visor.js; `tamanoModelo` da null hasta estar listo)
 */
export function crearVisor(contenedor, opciones) {}

/**
 * Empieza a bajar el chunk del visor (si no se pidió ya). Nunca lanza; si falla, se reintenta al crear un visor.
 * @returns {void}
 */
export function precargarVisor() {}
```

Para poder probarla en Node, el cargador se inyecta: `armarVisorCarga(cargar)` es la implementación y `crearVisor` la
llama con `() => import('./visor.js')`. La lista de métodos (`ORDENES`, `CONSULTAS`) se mantiene sincronizada con `armarApi`
de `visor.js` mediante una prueba que lee los dos archivos y compara los nombres.

```js
/**
 * Igual que `crearVisor`, pero con el cargador del módulo del visor inyectado (para las pruebas).
 * @param {() => Promise<{ crearVisor: (contenedor: HTMLElement) => Record<string, Function> }>} cargar
 * @returns {(contenedor: HTMLElement, opciones?: { alListo?: () => void }) => Record<string, Function>}
 */
export function armarVisorCarga(cargar) {}
```

**Cambios en el MAPA** (`docs/MAPA.md`, mismo commit que cada módulo): filas nuevas `src/ui/visor-carga.js` y
`src/ui/aviso-vista.js` y `src/motor/recorridos-niveles.js` · `recorridos-auto.js`; `visor.js` y `paso1-modelo`/`vista-capas`
dependen de `visor-carga`; en el grafo, `visor-carga ──► visor` (import dinámico) en el nivel 1 y `paso1-modelo`,
`vista-capas`, `main` ──► `visor-carga`; la fila de `leer` documenta `opciones.nivel`, `nivel`, `simplificado`,
`leidoHasta`; sección 4: `test:visor-carga`, `test:chunks`, `medir-recorridos` y los archivos nuevos de `test:recorridos`;
sección 5: "El visor no aparece / dice Cargando el visor 3D" -> `src/ui/visor-carga.js`; "La vista previa dice que está
simplificada" -> `recorridos-auto.js` y `recorridos-niveles.js`.

### 5. Tareas

Cada una ≤ 200 líneas de producción, con su prueba en archivo propio. "Crear en paralelo, recablear en serie": las
tareas del grupo A sólo crean archivos nuevos o tocan archivos que ninguna otra del grupo toca; las del grupo B tocan
archivos compartidos (`contratos-ui.js`, `MAPA.md`, `vista-capas.js`, `package.json`, CI) y van una por vez.

**Grupo A (en paralelo, no se pisan archivos):**

- **T0. Medición.** Crea `scripts/medir-recorridos.mjs` y `scripts/lib/gcode-sintetico.mjs` (~120 líneas). Corre la base
  contra sí misma (razón ~1,00) y anota el resultado en el PR. Prueba: la propia corrida.
- **T1. Fachada del visor.** Crea `src/ui/visor-carga.js` (~110 líneas) y `scripts/probar-visor-carga.mjs` (+
  `npm run test:visor-carga`, que se agrega en T3). No toca nada existente. Prueba: cola en orden, `quitar` + `poner`,
  última orden de `ponerCama`/`pausar`, `tamanoModelo` null y luego real, `alListo` una sola vez, fallo del cargador y
  reintento, carga ya hecha sin cola, y nombres de métodos iguales a los de `armarApi` en `visor.js`.
- **T2. Guardián de chunks.** Crea `scripts/verificar-chunks.mjs` (~90 líneas). Lee `dist/index.html`, saca el chunk
  principal del `<script type="module">`, calcula su clausura estática (los `import … from "./x.js"` de cada chunk, sin los
  `import()`), y falla si: el principal ≥ 250.000 bytes; la clausura ≥ 400.000; algún chunk de la clausura contiene
  `WebGLRenderer`; o hay un chunk con `WebGLRenderer` que no figura en `ARCHIVOS` de `dist/sw.js`. Imprime la tabla de
  tamaños (sin gzip y gzip). Hasta que T3 no esté, falla a propósito (594 kB): se engancha a CI en T3.
- **T4. Niveles en el lector.** Crea `recorridos-niveles.js` (~35 líneas); toca `recorridos-tramos.js` (`nivel` en el
  constructor, `desvio` y `largoCurva` como campos) y `recorridos-lector.js` (`opciones`, `leidoHasta`, campos `nivel` y
  `simplificado`; sin sumar más de ~25 líneas, hoy 204). Prueba: `scripts/recorridos/niveles.mjs`, registrada en
  `probar-recorridos.mjs`. **Aceptación: `medir-recorridos` ≤ +10 % en el nivel 0.**

**Grupo B (en serie, en este orden):**

- **T5. `leerAuto`.** Crea `recorridos-auto.js` (~50 líneas). Prueba: `scripts/recorridos/auto.mjs` (registrar en
  `probar-recorridos.mjs`). Depende de T4.
- **T3. Cablear el visor (production).** `paso1-modelo.js` y `vista-capas.js` (import y `alListo`, ~6 líneas), `main.js`
  (`precargarVisor()`), `vite.config.js` (`chunkSizeWarningLimit: 600`), `src/estilos.css` (`.visor-estado`, ~10 líneas),
  `contratos-ui.js`, `package.json` (`test:visor-carga`, `test:chunks`), `.github/workflows/ci.yml` (corre `test:chunks`
  después del build), `MAPA.md`. Tarea aparte **T3b** (sólo pruebas de `test:app`): nueva `scripts/lib/visor.mjs`
  (`esperarVisor(pagina, '#visor' | '#visorCapas')`: espera `dataset.visor === 'listo'` y que exista el `canvas`), usada en
  las áreas que hoy leen `#visor canvas` sin esperar (`paso1-modelo`, `piezas`, `copias`, `piezas-extra`, `transformar`,
  `pausas`, `vista-capas`) y un tramo nuevo en `offline.mjs`. **Aceptación: `npm run build` muestra el chunk principal
  < 250 kB y `test:chunks`, `test:app`, `test:contratos` en verde.**
- **T6. Cablear la simplificación.** `recorridos.worker.js`, `motor.js` (`leerRecorridos` con `opciones`), `aviso-vista.js`
  (nuevo), `vista-capas.js` (`{ auto: true }` y el aviso), `contratos-ui.js`, `MAPA.md`. Prueba: `scripts/recorridos/aviso.mjs`
  (Node) para `textoAvisoVista` y `scripts/app/vista-capas.mjs` (un cubo no muestra aviso).

T4 es independiente de T3 y T1; sólo T5 y T6 dependen de él. Mientras T3 y T6 se hacen en serie, T0, T1, T2 y T4 pueden
salir juntas, cada una en su rama y con su PR chico.

## Pruebas

- **`npm run test:recorridos`** (Node; `scripts/recorridos/niveles.mjs`, `auto.mjs`, `aviso.mjs`):
  nivel 0 da exactamente los mismos arrays que `d0f3de0` para cada G-code de las pruebas existentes (`deepStrictEqual`);
  para los niveles 1 a 3, `inicioCapa`, `zCapa`, `pausaCapa`, `caja` y los tipos de las capas son idénticos a los del
  nivel 0 y la cantidad de tramos baja de forma monótona; un círculo de 20 mm de radio y un zigzag no se aplanan más de 2×
  `desvio` del recorrido original; `leidoHasta` es `gcode.length` cuando se lee todo y está en un salto de línea cuando se
  corta; `leerAuto` devuelve el nivel 0 si entra, sube hasta el menor nivel que entra, marca `simplificado`, y
  `incompleta` sólo si ni el 3 entra; y `textoAvisoVista` para las cuatro combinaciones de `simplificado`/`incompleta`.
- **`npm run test:visor-carga`** (Node, ver T1).
- **`npm run test:chunks`** (después de `npm run build`, en CI): el guardián de T2. Es la prueba de que el principal no
  supera el tope y de que el chunk del visor está en el service worker.
- **`npm run test:contratos`**: las aristas nuevas (`visor-carga → visor` dinámica, `aviso-vista`) y que nadie más importe
  `ui/visor`.
- **`npm run test:app`**: con `esperarVisor`, el recorrido existente sigue andando (las áreas son un recorrido con estado:
  cada una declara "Precondición" y "Deja"; `esperarVisor` no cambia lo que dejan). `scripts/app/offline.mjs` agrega:
  tras recargar sin conexión, cargar el cubo y esperar `#visor[data-visor="listo"]` (el chunk sale del caché del SW), y
  actualiza su "Deja" sin cambios. El aviso de "simplificada" en el celu real **no** tiene prueba de punta a punta (el tope
  depende de `navigator.deviceMemory` y un G-code que lo pase tarda demasiado): lo cubren las pruebas de Node.
- **`node scripts/medir-recorridos.mjs`**: manual, antes de integrar T4 y T5, razón ≤ 1,10 en el nivel 0.
- Antes de cada commit: `npm run build`, `npm run lint`, `npm run format:check` y las suites del área tocada.

## Riesgos

- **Fachada fuera de sincronía con `visor.js`.** Si `armarApi` suma un método y la fachada no, falla en silencio (se
  ignora o se rompe al usarlo). Se cubre con la prueba que compara los nombres de ambos archivos.
- **Medida inexacta mientras carga (`tamanoModelo` null).** Cubierta por `alListo` (re-aplica y re-acomoda); queda una
  ventana donde el acomodo usa la caja de 8 esquinas (más grande, nunca más chica, así que no hay falsos "entra").
- **Chunk viejo tras actualizar.** Una pestaña abierta con el chunk anterior puede pedir un archivo que ya no existe: el
  aviso con reintento lo cubre (y la actualización recarga la página). Se vigila en `offline.mjs` y en una prueba manual.
- **Instalación del SW más grande o fallida.** Es el mismo peso total que hoy (el chunk del visor pasa de un archivo a
  otro), pero `cache.addAll` falla entero si falta uno: `test:chunks` verifica que el chunk del visor esté en la lista.
- **Pruebas `test:app` más frágiles** por el canvas que aparece después: por eso `esperarVisor` en todas las áreas que lo
  leen; si falta alguna, falla con un error claro y no a veces.
- **Los niveles son una hipótesis calibrada con G-codes sintéticos.** `DESVIO`/`LARGO_CURVA`/`REDUCCION` se calibraron en T4
  con `gcode-sintetico.mjs`, no con G-codes reales de Kiri (cubo, vaso en espiral, modelo orgánico): conviene
  recalibrar con esos antes de confiar en `REDUCCION`. Un nivel que se note a simple vista se baja. Cota de error:
  las uniones que el nivel 0 ya haría se aceptan sin la comprobación completa (así un nivel mayor nunca da más tramos),
  y el nivel 0 acumula error (medido hasta ~0,06 mm); el resto de las uniones queda a menos de `DESVIO` de todos los
  puntos que reemplaza.
- **Reintentos.** En el peor caso son 3 lecturas, y las dos primeras se cortan al llenarse el tope; el costo extra queda en
  el worker y sólo cuando el G-code ya no entra. Se informa con `medir-recorridos` y no se acepta si el nivel 0 de un
  G-code que entra tarda más que hoy (el reintento no corre si no se llenó el tope).
- **Variación de la medición.** ±50 % dentro de un proceso en este sandbox; el diseño de `medir-recorridos` (procesos
  alternados, mínimo y mediana) la acota, pero en la máquina de CI o en el celu los números absolutos serán otros.

Fuera de v1:

- Dos niveles de detalle en el visor (capa actual con todo el detalle, las de abajo simplificadas).
- Sacar el chunk `motor` (205,74 kB: perfiles y lógica compartida con `prueba-motor.html`) del arranque.
- Un indicador de progreso de la lectura del G-code y lectura incremental en el worker.
- Un tope de peso en CI para los workers (Kiri pesa 1,9 MB y no se toca).
- Prueba de punta a punta del aviso "simplificada" con un G-code real grande.

## Consecuencias

- **Más fácil:** el arranque baja de ~800 kB a ~300 kB sin gzip (principal ~100 kB + `motor`); el visor se baja en
  segundo plano y suele estar antes de usarlo; la vista previa de un G-code grande se ve completa (de la primera a la última
  capa) en vez de cortada; las pausas y el deslizador no cambian. Un tope de tamaño en CI evita volver a engordar el
  principal sin que nadie lo note.
- **Más difícil:** hay una capa más (la fachada) que mantener alineada con `visor.js`; las pruebas de `test:app` esperan al
  visor; hay una prueba más de rendimiento que correr a mano al tocar el lector.
- **Queda abierto:** el chunk del visor sigue pasando 500 kB (se sube el límite del aviso de Vite); la vista simplificada
  puede ocultar detalles finos (se avisa al usuario); las constantes de los niveles se afinan con datos reales.
- **Reversa:** T3 es reversible cambiando dos líneas de `import` (volver a `./visor.js`); T4 y T6 se desactivan pidiendo
  siempre nivel 0 (el comportamiento de hoy, idéntico bit a bit).
