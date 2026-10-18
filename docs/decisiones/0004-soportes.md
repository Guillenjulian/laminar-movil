# 0004. Soportes tipo árbol y bloqueo de soportes por zona

- **Fecha:** 2026-10-18
- **Autor/a:** arquitecto
- **Base:** commit `d0f3de0`

## Estado

Aceptado por el CTO el 2026-10-18, con estas decisiones:

- **Opción (a)** (árbol propio simplificado), con el plan B (c) por el mismo contrato si T4 no converge.
- **Sólo esfera en v1**; la caja entra después por `forma` sin romper el contrato.
- **Panel de zonas en el paso 1** (donde está el visor) y **selector de tipo en el paso 2**.
- **Las zonas se vacían con aviso** al cambiar escala, rotación o "apoyar cara". Queda como deuda: la escala de la
  app es uniforme, así que más adelante se pueden transformar con `matrizPieza` en vez de vaciarlas.
- **T0 es un spike que puede frenar todo:** si (b) o (d) fallan, se vuelve a este ADR antes de la ola 1.

## Contexto

Hoy el paso 2 tiene un interruptor `#soportes` (boolean). Prendido, `armarConfiguracion` pone
`sliceSupportType: 'automatic'` y Kiri genera columnas bajo cada voladizo. Se piden dos cosas:

1. **Soportes tipo árbol**: menos material y menos marcas en la pieza que las columnas.
2. **Bloqueo por zona**: que el usuario, desde el celu, marque un lugar donde **no** quiere soportes.

Hechos verificados (CTO y lectura de código):

- En Kiri 4.7, `process.sliceSupportTree` existe como opción (`defaults.js`, `false`), pero en `processSupports`
  (`vendor/kiri/src/kiri/mode/fdm/work/slice.js`) es un stub vacío: `if (process.sliceSupportTree) { // console.log('TREE OUTPUT') }`.
  **No hay soportes árbol en el motor**: hay que decidir cómo darlos.
- Los soportes automáticos ya andan sin el pool de minions gracias a `src/motor/minions-locales.js`
  (`cam_shadow_stack` / `cam_shadow_z`). Todo corre en el mismo Web Worker (`laminador.worker.js`).
- `processSupports` hace: (1) calcula `slice.shadow` por capa (la zona de cada capa que queda en voladizo, recortada
  al "puente" entre la capa y la de arriba); (2) en un bucle **de arriba hacia abajo** acumula las sombras en
  `shadowSum`, les resta `slice.topPolys()` (el cuerpo) y las deja en `slice.supports`; (3) recorta con `slice.clips`
  según `sliceSupportGap`. Después `prepare` rellena `slice.supports`.
- Kiri tiene soportes manuales (`sliceSupportType: 'manual'` + `widget.anno.paint`, puntos con radio). Es lo contrario
  de lo que necesitamos (marca dónde **sí**), pero confirma que `widget.anno` viaja desde `sync` hasta
  `processSupports` y que ahí se lo lee con `widget.anno`.
- Los cortes de cada widget están en coordenadas **locales** del widget (centrado en X/Y, base en Z=0); la posición en
  la cama es `track.pos` y se aplica recién en `prepare` (ADR 0003). Por eso una zona expresada en el marco de la pieza
  vale igual para todas sus copias.
- No se edita `vendor/kiri` a mano: los cambios van como parches en `scripts/vendor-kiri.mjs` (`parchar`, marcados
  `PARCHE laminar-movil`), con un gancho mínimo que llame a código nuestro en `src/motor/`.
- Estándares: archivos < 300 líneas, funciones < 40. `paso2-config.js` (237) y `visor.js` (280) están cerca del tope:
  no se les suma lógica. Módulos de UI según el ADR 0001 (nada toca el DOM al importarse, `estado.x` se lee en el
  momento, callbacks inyectados).
- La torre de calibración sigue sin soportes (`configuracionDeTorre` devuelve `soportes: false`).
- El visor (con `visor-cara.js`, que detecta toques con un `Raycaster`) vive en el **paso 1**; el interruptor de
  soportes, en el **paso 2**.

## Decisión

### 1. Soportes árbol: algoritmo propio simplificado

Opciones evaluadas:

| Opción | Costo | Riesgo | Veredicto |
|---|---|---|---|
| **(a)** Módulo propio y puro `src/motor/soportes-arbol.js` + parche chico en `processSupports` | ~260 líneas de producción (árbol 190 + geometría 2D 70) más ~25 de parche/puente | Medio: la calidad de impresión depende de afinar parámetros; el cálculo es nuestro | **Recomendada** |
| **(b)** No ofrecerlo y documentarlo | 0 | Ninguno técnico; no cumple el pedido | Descartada (queda como plan de reversa, ver R1) |
| **(c)** "Postes ralos": intersectar la sombra acumulada con una grilla de postes | ~60 líneas | Bajo, pero no es un árbol: los postes se apoyan en toda la sombra y la marca en la pieza es parecida a la de `automatic` (que ya es ralo con `sliceSupportDensity`) | Plan B si (a) no cumple la meta de material (ver R1); comparte el contrato de `planificarArbol` con `separacion` grande |
| **(d)** Portar el árbol de Cura/Orca | Miles de líneas, mallas 3D y optimización de ramas | Alto en celu de gama baja | Descartada |
| **(e)** Dependencia nueva (wasm, librería) | — | Va contra "sin dependencias nuevas" | Descartada |

**Recomendación: (a).** Es un árbol simplificado, no el de Cura: **troncos verticales con deriva lateral limitada**
que nacen en puntas chicas bajo los voladizos, esquivan el cuerpo, se unen cuando se tocan y engordan al bajar.
Todo es 2D por capa, sin mallas 3D, y devuelve polígonos que **reemplazan** a la sombra acumulada.

Algoritmo (de arriba hacia abajo, una capa por vez, sólo se guarda la capa actual):

1. En cada capa con voladizo se siembran puntas en una grilla de `separacion` mm (3 por defecto) dentro de cada
   polígono de voladizo, saltando las que ya están cubiertas por un tronco que viene de arriba o están dentro de un
   bloqueo (ver sección 2). Radio de la punta: `1,2 × ancho de línea` (así no cae bajo `minArea`).
2. Al bajar una capa, cada nodo se mueve en horizontal como máximo `altoCapa × tan(sliceSupportAngle)`: se aparta del
   cuerpo si lo pisa (prueba de 8 direcciones), se acerca al nodo vecino más cercano si está a menos de `6 × radio`
   y, si no, baja recto. El radio crece de a poco hasta `radioMax` (2,5 mm).
3. Si dos nodos quedan a menos de `r1 + r2`, se **fusionan** (posición ponderada por área, radio `√(r1² + r2²)` con
   tope). Invariante: en una capa, ningún par de círculos se pisa; por eso la salida no necesita unión de polígonos.
4. Cada nodo sale como un círculo de 8 lados. Un nodo que toca la cama o el cuerpo termina ahí.
5. Tope de memoria: `maxNodos` (150) activos a la vez; si se pasa, se duplica `separacion` y se vuelve a empezar
   (una vez, hasta 3 veces).

Costo en celu de gama baja: los nodos activos son O(150) y la fusión O(n²) por capa (22 mil operaciones × 300 capas,
despreciable). La salida es ≤ capas × nodos × 8 puntos: caso típico (40 nodos, 300 capas) ≈ 2 MB, peor caso con
150 nodos ≈ 6 MB de objetos `{x, y}` más lo que Kiri convierta a `Polygon` (< 25 MB). Es del orden de la pila de
sombras que ya existe y no suma un pico nuevo por encima de la decimación (ADR 0003, tope de triángulos).

**Cómo se engancha** (tres parches chicos en `processSupports`, más un puente nuestro):

- La lógica vive en `src/motor/soportes-arbol.js` (pura) y `src/motor/soportes-kiri.js` (puente: convierte entre
  polígonos de Kiri y `Poligono[]`, y lo instala en `globalThis.laminarMovil`). El parche **no importa** nada (evita
  atarse a rutas relativas dentro de `vendor/`): llama a `globalThis.laminarMovil?.…`. Si el puente no está instalado,
  el motor se comporta exactamente como Kiri.
- Parche A (reemplaza el stub): calcula `arbolListo`; si es `true`, el puente ya dejó `slice.supports` en cada capa.
- Parche B (cabecera del bucle de acumulación): con `arbolListo` el bucle no itera, así que queda intacto el recorte
  final por `sliceSupportGap`/`clips`, que corre igual para el árbol.
- Parche C (bloqueo, ver sección 2): una línea dentro del bucle.
- El tipo se elige con `proceso.sliceSupportType = 'automatic'` y `proceso.sliceSupportTree = true`
  (opción que Kiri ya define; no inventamos claves).

Texto de los parches (anclas a verificar en T0; `parchar` falla fuerte si no encuentra el texto):

```js
// A. Reemplaza el stub vacío
if (process.sliceSupportTree) {
    // console.log('TREE OUTPUT');
}
// ->
// PARCHE laminar-movil: soportes árbol (ADR 0004)
const arbolListo = !!process.sliceSupportTree && !!globalThis.laminarMovil?.arbol?.(stack, widget.anno?.bloqueos, {
    lineWidth, sliceHeight, angulo: process.sliceSupportAngle, cama: widget.anno?.cama,
});

// B. Cabecera del bucle de acumulación
for (let slice of stack.slice().reverse()) {
// ->
for (let slice of arbolListo ? [] : stack.slice().reverse()) { // PARCHE laminar-movil

// C. Antes de "// pump shadow to clean to clean it up"
shadow = globalThis.laminarMovil?.sinBloqueos?.(shadow, slice.z, widget.anno?.bloqueos, minArea) ?? shadow; // PARCHE laminar-movil
```

### 2. Bloqueo de soportes por zona

**Qué es.** Una *zona sin soporte* es una **esfera** (v1) en el marco de la pieza: centro `(x, y, z)` y `radio`, en mm.
El soporte no se genera dentro de la esfera. Semántica igual a la de los "bloqueadores" de otros laminadores: se
quita el soporte dentro del volumen; lo que queda por encima se imprime igual (si el voladizo mismo cae dentro de la
esfera, queda sin apoyo y se imprime "en el aire": la UI lo avisa).

**Cómo la marca el usuario.** En el **paso 1**, junto a "Apoyar cara", un botón **"Zona sin soporte"** abre un panel
chico con el radio (stepper 2 a 40 mm, 8 por defecto) y la lista de zonas de la pieza activa. Con el modo activo,
un toque sobre la pieza en el visor agrega una esfera con centro en el punto tocado (`Raycaster`, ya usado por
`visor-cara.js`). Cada zona se ve en el visor como una esfera translúcida (una por copia, en la posición de la copia)
y se puede cambiar el radio o quitar desde la lista (chip "Zona 1 · 8 mm ×"). El panel es visible siempre que haya
una pieza de origen `'modelo'` (la torre y la litofanía no llevan soportes), pero el paso 2 y el paso 4 avisan
"N zonas sin soporte" sólo si el tipo no es `'no'`.

**Estado.** Por pieza, en el marco de la pieza (ya transformada y centrada: origen en el centro de la caja en X/Y,
Z=0 en la cama, igual que `centrar()`), así vale para cada copia sin trasladar:

```js
Pieza.bloqueos: Bloqueo[]          // [] por defecto; no se persiste (las piezas tampoco, salvo recientes)
Pieza.firmaBloqueos: string|null   // JSON de [rotacion, escala] con que se marcaron
```

Un id por entidad: `Bloqueo.id` es secuencial de sesión (`++ultimoIdBloqueo` en `estado.js`, nunca se reutiliza,
igual que `Pieza.id`). La zona **no** guarda el id de su pieza: vive dentro de ella. No hay ids paralelos, ni
índices que haya que mantener sincronizados.

**Cambios de la pieza.** Si el usuario cambia escala, rotación o "apoyar cara" después de marcar, las zonas ya no
coinciden con la pieza. `bloqueos-ui.js` compara `firmaBloqueos` con la firma actual en el callback `alCambiar` del
ajuste y, si difiere, **vacía la lista** y muestra "Se quitaron las zonas sin soporte porque cambió la pieza".
(Alternativa descartada: transformar las esferas con la matriz; con escala no uniforme sería un elipsoide y con
"apoyar cara" no hay una transformación simple de recuperar. Simple y explícito gana.)

**Cómo viaja al worker.** `piezasParaMotor()` agrega `bloqueos` (copia profunda) a cada pieza; `prepararPiezas`
los copia a cada widget; `subirWidgets` los manda en `anno: { bloqueos }` del `sync` de Kiri. Con el formato viejo
(una pieza sin `piezas`) no hay bloqueos. `validarBloqueos` (pura) limpia y acota lo que llega.

**Cómo se aplica.** Parche C (sección 1): en el bucle de acumulación, justo después de restar el cuerpo y **antes** de
que `shadowSum = shadow`, se le resta al `shadow` de la capa la sección de cada esfera a la altura `slice.z` (círculo
de radio `√(R² − dz²)`). Como lo restado no entra en `shadowSum`, el bloqueo se propaga hacia abajo (el hueco no se
vuelve a llenar con la sombra de capas superiores). La resta la hace el puente con `POLY.subtract` de Kiri; la
geometría del círculo y el filtro de esferas por altura son puros (`seccionBloqueos`). Con árbol, `planificarArbol`
no siembra puntas dentro de una esfera y empuja los nodos fuera de ella (`bloqueaPunto`), y además el puente recorta
cada capa de salida con la misma resta.

### 3. Tipo de soporte en `estado`

`estado.soportes` pasa de `boolean` a `'no' | 'normal' | 'arbol'`. El interruptor `#soportes` del paso 2 se reemplaza
por un selector de tres opciones (`#tipoSoportes`, botones tipo "radio" como calidad y material) con una línea de
ayuda por opción.

Migración: `normalizarSoportes(v)` (puro, en `src/perfiles/soportes.js`) acepta lo viejo (`true` → `'normal'`,
`false`/`undefined`/cualquier otra cosa → `'no'`) y lo nuevo (los tres textos). La usan `cargarPreferencias`
(preferencias guardadas), `armarConfiguracion` y `configuracionDeTorre` (que sigue devolviendo `false` sin tocarse).
`guardarPreferencias` ya guarda el valor tal cual: guardará el texto. Una app vieja que lea un `'no'` guardado lo
interpretaría como verdadero (`!!'no'`); se acepta, porque no hay downgrade en una PWA que se actualiza sola.

### 4. Módulos y aristas

Nuevos (todos < 300 líneas; funciones < 40):

| Archivo | Capa | Responsabilidad | Depende de |
|---|---|---|---|
| `src/motor/geometria-2d.js` | motor, puro | `puntoEnPoligono`, `distanciaAPoligono`, `circulo`, `areaPoligono` | — |
| `src/motor/soportes-arbol.js` | motor, puro | `planificarArbol` | `geometria-2d`, `bloqueos` |
| `src/motor/bloqueos.js` | motor, puro | `validarBloqueos`, `seccionBloqueos`, `bloqueaPunto`, constantes | `geometria-2d` |
| `src/motor/soportes-kiri.js` | motor, puente (importa Kiri) | `instalarGanchosSoportes`: arma `globalThis.laminarMovil.{arbol, sinBloqueos}` | `soportes-arbol`, `bloqueos`, vendor Kiri (`geo/polygon.js`, `geo/point.js`, polys) |
| `src/perfiles/soportes.js` | perfiles, puro | `normalizarSoportes`, `procesoDeSoportes`, `etiquetaSoportes` | — |
| `src/ui/soportes-tipo-ui.js` | UI nivel 1 | Selector `#tipoSoportes` del paso 2 | `estado`, `util-dom`, `perfiles/soportes` |
| `src/ui/bloqueos-ui.js` | UI nivel 2 | Panel "Zona sin soporte" del paso 1: agregar, radio, quitar, firma | `estado`, `util-dom`, `motor/bloqueos`, `visor-bloqueos` (inyectado) |
| `src/ui/visor-bloqueos.js` | UI nivel 0 (hoja) | Esferas translúcidas en la escena; `crearMarcasBloqueo` | three |

Aristas permitidas: `bloqueos-ui` → `estado`, `util-dom`, `motor/bloqueos`; el visor y las marcas llegan por
`ctx` (se leen en el momento, porque el visor se crea al cargar el primer modelo, igual que en `piezas-ui`).
`visor-bloqueos` es una hoja (sólo three, como `visor-cama`). `soportes-tipo-ui` no conoce a `bloqueos-ui`: el paso 2
los muestra juntos leyendo `estado`. `src/motor/soportes-*.js` **no** importan nada de `ui/`. Los módulos puros no
importan Kiri: eso los hace probables en Node. El único que importa Kiri es `soportes-kiri.js`, como ya hace
`minions-locales.js`.

Cambios a archivos existentes (sólo recableado, sin lógica nueva): `visor-cara.js` (+~15 líneas: `alTocarPunto`),
`visor.js` (+2 líneas: exponer `alTocarPunto` y las marcas; queda ≤ 285), `paso2-config.js` (−3 líneas: se va el
interruptor), `paso1-modelo.js` (cablear `bloqueos-ui`), `estado.js`, `perfiles.js`, `paso3-laminar.js`,
`paso4-resultado.js`, `preparar-piezas.js`, `laminador.worker.js`, `scripts/vendor-kiri.mjs`, `index.html`,
`docs/MAPA.md`.

## Contratos

### Tipos

```js
/** @typedef {{x:number, y:number}} Punto  mm */
/** @typedef {Punto[]} Poligono  anillo cerrado implícito (el último punto no repite el primero) */

/**
 * Zona sin soporte, en el marco de la pieza (transformada y centrada; ver `centrar` en preparar-piezas.js).
 * @typedef {object} Bloqueo
 * @property {number} id  secuencial de sesión, nunca se reutiliza
 * @property {'esfera'} forma  único valor de la v1
 * @property {{x:number, y:number, z:number}} centro  mm
 * @property {number} radio  mm, RADIO_MIN_MM..RADIO_MAX_MM
 */

/**
 * @typedef {object} CapaArbol
 * @property {number} z  altura del corte (mm, marco local de la pieza)
 * @property {Poligono[]} voladizos  zonas de la capa que necesitan apoyo (el `slice.shadow` ya recortado al puente)
 * @property {Poligono[]} cuerpo  la pieza en esa capa (`slice.topPolys()`), para esquivarla
 */

/**
 * @typedef {object} OpcionesArbol
 * @property {number} ancho  ancho de línea (mm)
 * @property {number} altoCapa  mm
 * @property {number} angulo  ángulo de voladizo de Kiri (`sliceSupportAngle`, grados): limita la deriva por capa
 * @property {number} [separacion=3]  mm entre puntas
 * @property {number} [radioPunta]  mm; por defecto `1,2 × ancho`
 * @property {number} [radioMax=2.5]  mm
 * @property {number} [maxNodos=150]  tope de nodos activos
 * @property {Bloqueo[]} [bloqueos=[]]
 * @property {{x0:number, y0:number, x1:number, y1:number}} [cama]  rectángulo de la cama en el marco local del widget
 *   (T4: `anno.cama`); ningún círculo sale de él
 */
```

### Funciones nuevas

```js
// src/motor/soportes-arbol.js
/**
 * Planifica los troncos de un soporte árbol, capa por capa, de arriba hacia abajo. Pura y determinista.
 * Invariantes de la salida: ningún par de círculos de una misma capa se pisa; ningún círculo cae dentro de un
 * bloqueo; ningún centro cae dentro de `cuerpo`; `|salida| === capas.length`.
 * @param {CapaArbol[]} capas  ordenadas de abajo hacia arriba (índice 0 = primera capa)
 * @param {OpcionesArbol} opciones
 * @returns {Poligono[][]}  `salida[i]` = polígonos de soporte de `capas[i]` (vacío si no hay)
 */
export function planificarArbol(capas, opciones) {}

// src/motor/bloqueos.js
export const RADIO_MIN_MM = 2;
export const RADIO_MAX_MM = 40;
export const RADIO_INICIAL_MM = 8;
export const MAX_BLOQUEOS = 20; // por pieza

/**
 * Limpia lo que llega de la UI o del mensaje al worker: descarta formas desconocidas, números no finitos, radios
 * fuera de rango (se acotan) y todo lo que pase de MAX_BLOQUEOS.
 * @param {unknown} datos
 * @returns {Bloqueo[]}
 */
export function validarBloqueos(datos) {}

/**
 * Secciones de los bloqueos a la altura `z`: un círculo de radio √(R² − dz²) por esfera que la cruza.
 * @param {Bloqueo[]|undefined} bloqueos
 * @param {number} z  mm
 * @param {number} [lados=16]
 * @returns {Poligono[]}  vacío si ninguna esfera cruza esa altura
 */
export function seccionBloqueos(bloqueos, z, lados = 16) {}

/**
 * ¿El punto está dentro de alguna esfera (con `margen` mm de más)?
 * @param {Bloqueo[]|undefined} bloqueos
 * @param {{x:number, y:number, z:number}} p
 * @param {number} [margen=0]
 * @returns {boolean}
 */
export function bloqueaPunto(bloqueos, p, margen = 0) {}

// src/motor/geometria-2d.js
/** @returns {boolean} */ export function puntoEnPoligono(p, poligono) {}
/** @returns {number} distancia (mm) de `p` al borde del polígono más cercano; negativa si está adentro */
export function distanciaAPoligono(p, poligonos) {}
/** @returns {Poligono} círculo de `lados` vértices, antihorario */
export function circulo(centro, radio, lados = 8) {}
/** @returns {number} área con signo (positiva si es antihoraria) */
export function areaPoligono(poligono) {}

// src/motor/soportes-kiri.js
/**
 * Instala en `globalThis.laminarMovil` los ganchos que llaman los parches de scripts/vendor-kiri.mjs.
 * Lo llama laminador.worker.js una vez, al arrancar.
 * @returns {void}
 */
export function instalarGanchosSoportes() {}
// globalThis.laminarMovil.arbol(stack, bloqueos, op) -> boolean
//   stack: slices de Kiri de abajo hacia arriba; usa slice.z, slice.shadow y slice.topPolys().
//   op: { lineWidth, sliceHeight, angulo, cama }. `cama` = widget.anno.cama, el rectángulo de la cama en el marco
//   local del widget: x0 = −bedWidth/2 − pos.x, x1 = bedWidth/2 − pos.x, ídem y (el worker la arma en subirWidgets;
//   cama redonda: su caja).
//   Escribe slice.supports en cada una y devuelve true; si no hay voladizos devuelve true igual
//   (todas las capas con supports = []). Devuelve false sólo si falló, y entonces Kiri sigue con 'automatic'.
//   Cuando devuelve true, el bucle de Kiri no corre y `sinBloqueos` NO se llama: el árbol respeta las zonas por su
//   cuenta (no siembra ni pasa por ellas, y poda lo que queda colgado). Los dos ganchos se llaman con `?.`.
// globalThis.laminarMovil.sinBloqueos(shadow, z, bloqueos, minArea) -> Polygon[]
//   Resta seccionBloqueos(bloqueos, z) a `shadow` (con POLY.subtract y el `minArea` = lineWidth² del bucle de Kiri,
//   que el parche pasa como cuarto argumento). Sin bloqueos devuelve `shadow` tal cual.
// Registro de llamadas: en producción no se registra nada. Sólo con `proceso.laminarDiagnostico` (que pone solamente
//   prueba-motor.html; el worker la quita del proceso antes de Kiri) se guardan y viajan en `info.ganchos`.
// src/motor/bloqueos.js (T4): + `radioSeccion(bloqueo, z) -> number` (√(R²−dz²), 0 si |dz| ≥ R), `LADOS_SECCION = 16` y
//   `FACTOR_SECCION` (1/cos(π/16)); la sección es el `circulo` de geometria-2d (único dueño) con el radio agrandado
//   (circunscripto). El árbol (`tocaBloqueo`) usa `radioSeccion × FACTOR_SECCION`: ningún círculo suyo cae en la sección.

// src/perfiles/soportes.js
/** @typedef {'no'|'normal'|'arbol'} TipoSoporte */
export const TIPOS_SOPORTE = ['no', 'normal', 'arbol'];
/** @param {unknown} v  boolean viejo o texto  @returns {TipoSoporte} */
export function normalizarSoportes(v) {}
/** @param {unknown} tipo  @returns {object} {} | {sliceSupportType:'automatic'} | {sliceSupportType:'automatic', sliceSupportTree:true} */
export function procesoDeSoportes(tipo) {}
/** @param {unknown} tipo  @returns {string} '' | ' · con soportes' | ' · soportes árbol' (para el resumen del paso 4) */
export function etiquetaSoportes(tipo) {}

// src/ui/bloqueos-ui.js
/**
 * Panel "Zona sin soporte" del paso 1. No toca el DOM hasta `conectar()`.
 * @param {object} ctx
 * @param {() => (object|null)} ctx.visor  visor del paso 1 (null si todavía no se creó)
 * @param {(msg: string) => void} ctx.avisar  muestra un aviso en la pantalla
 * @returns {{conectar: () => void, dibujar: () => void, sincronizar: () => void}}
 *   `conectar()` cablea botón, stepper de radio, lista y toques (una vez);
 *   `dibujar()` redibuja lista y marcas de la pieza activa (llamar al cambiar de pieza activa o cargar un modelo);
 *   `sincronizar()` compara `firmaBloqueos` con la actual y vacía las zonas si cambió la pieza
 *   (paso1 lo engancha en el `alCambiar` del ajuste).
 */
export function crearBloqueosUI(ctx) {}

// src/ui/soportes-tipo-ui.js
/**
 * Selector de tipo de soporte del paso 2.
 * @param {object} ctx
 * @param {() => void} ctx.alCambiar  se llama tras cambiar `estado.soportes` (paso2 guarda preferencias)
 * @returns {{conectar: () => void, dibujar: () => void}}  `dibujar()` marca el tipo de `estado.soportes`
 *   y muestra "N zonas sin soporte" si el tipo no es 'no' y hay zonas
 */
export function crearTipoSoportes(ctx) {}

// src/ui/visor-bloqueos.js
/**
 * Esferas translúcidas de las zonas sin soporte, una por copia.
 * @param {{escena: object, redibujar: () => void}} ctx
 * @returns {{poner: (bloqueos: Bloqueo[], posiciones: {x:number, y:number}[]) => void, quitar: () => void}}
 */
export function crearMarcasBloqueo(ctx) {}

// src/ui/visor-cara.js (extensión; se mantiene todo lo anterior)
//   alTocarPunto(fn|null): fn({ id: number, punto: {x,y,z} }) en cada toque sobre una pieza. `punto` está en el
//   marco de la pieza: coordenada del mundo menos la posición de la malla tocada (copia), es decir, el mismo
//   marco que usa `centrar()`. visor.js lo expone igual que `alTocarPieza`.
```

### Formatos que viajan

Mensaje al worker (extiende el de ADR 0003; el campo es opcional y su ausencia significa "sin zonas"):

```json
{
  "tipo": "laminar",
  "dispositivo": {},
  "proceso": { "sliceSupportType": "automatic", "sliceSupportTree": true },
  "maxTriangulos": 200000,
  "piezas": [
    {
      "stl": "<ArrayBuffer>",
      "transformacion": [1, 0, 0, 0, 1, 0, 0, 0, 1],
      "posiciones": [{ "x": -30, "y": 0 }, { "x": 30, "y": 0 }],
      "bloqueos": [{ "id": 3, "forma": "esfera", "centro": { "x": 4.2, "y": -1.5, "z": 12 }, "radio": 8 }]
    }
  ]
}
```

`prepararPiezas` devuelve `widgets[i].bloqueos` (copia por widget, `validarBloqueos`) y `subirWidgets` lo manda como
`anno: { bloqueos, cama }` (T4: `cama` en marco local del widget). Preferencia guardada: `{ …, "soportes": "arbol" }` (antes `true`/`false`).

## Tareas

Regla: **crear en paralelo, recablear en serie**. Cada tarea tiene ≤ 200 líneas de producción. Las olas se
corren en orden; dentro de una ola, las tareas no comparten archivos.

| Ola | Tarea | Tipo | Líneas prod. | Archivos (crea → C, toca → T) | Prueba propia |
|---|---|---|---|---|---|
| 0 | **T0** Ganchos mínimos y parches | motor | ~70 | C `src/motor/soportes-kiri.js` (puente de mentira: `arbol` devuelve `false`, `sinBloqueos` devuelve `shadow`; cuenta llamadas); T `scripts/vendor-kiri.mjs` (3 `parchar`), `laminador.worker.js` (instalar ganchos; `anno: { bloqueos: w.bloqueos ?? [] }`; el `listo` suma `info.ganchos`), `scripts/probar-motor.mjs` (registrar); regenerar `vendor/kiri` | `scripts/motor/soportes-ganchos.mjs` |
| 1 | **T1** Árbol puro | motor | ~190 + 70 | C `src/motor/geometria-2d.js`, `src/motor/soportes-arbol.js`; T `package.json` (script `test:soportes`) | `scripts/soportes/arbol.mjs`, `scripts/probar-soportes.mjs` (el runner recorre `scripts/soportes/*.mjs`) |
| 1 | **T2** Bloqueos y tipo | motor + perfiles | ~90 + 40 | C `src/motor/bloqueos.js`, `src/perfiles/soportes.js` | `scripts/soportes/bloqueos.mjs`, `scripts/soportes/tipo.mjs` |
| 1 | **T3** Marcas y toque en el visor | UI | ~60 + 15 | C `src/ui/visor-bloqueos.js`; T `src/ui/visor-cara.js` (`alTocarPunto`) | `scripts/app/visor-bloqueos.mjs` (falta registrarlo: T6) |
| 2 | **T4** Puente real | motor | ~90 | T `src/motor/soportes-kiri.js` (reemplaza el de mentira por `arbol` y `sinBloqueos` reales) | `scripts/motor/soportes-kiri.mjs` (registrar en T6) |
| 2 | **T5** Panel de zonas y selector de tipo | UI | ~150 + 60 | C `src/ui/bloqueos-ui.js`, `src/ui/soportes-tipo-ui.js` | `scripts/app/bloqueos.mjs`, `scripts/app/soportes-tipo.mjs` (registrar en T6) |
| 3 | **T6** Recableado (serie, una sola mano) | recableado | ~80 | T `src/ui/estado.js` (`soportes` migrado, `Pieza.bloqueos`, `firmaBloqueos`, `ultimoIdBloqueo`, `piezasParaMotor`), `src/perfiles/perfiles.js` (`...procesoDeSoportes(normalizarSoportes(soportes))`), `index.html` (selector y panel), `src/ui/paso2-config.js`, `src/ui/paso1-modelo.js`, `src/ui/visor.js`, `src/ui/paso3-laminar.js`, `src/ui/paso4-resultado.js`, `src/motor/preparar-piezas.js` (`bloqueos` por widget), `src/almacen.js` (comentario), `scripts/probar-app.mjs`, `scripts/probar-motor.mjs`, `scripts/lib/contratos-ui.js` (aristas) | Las de T3/T4/T5 ya registradas + `scripts/app/soportes-estado.mjs` (migración y mensaje) |
| 4 | **T7** Pruebas de punta a punta y mapa | prueba + doc | ~0 prod. | C `scripts/motor/soportes-arbol-kiri.mjs`, `scripts/lib/malla-voladizo.mjs`; T `docs/MAPA.md` | Ver "Pruebas" |

Qué se puede hacer en paralelo: **T1, T2 y T3** (ola 1) no comparten archivos; T0 va antes porque es un *spike*
que mide el riesgo R5 (los ganchos disparan donde creemos) antes de construir nada más, igual que T0 en el ADR 0003.
**T4 y T5** (ola 2) tampoco comparten archivos (motor vs UI) y pueden ir juntas; T4 depende de T1+T2 (ola 1) y T5
de T2+T3. **T6 es siempre en serie** y es la única que toca `estado.js`, `perfiles.js`, `index.html`, `paso*.js`,
`visor.js`, `preparar-piezas.js` y los registradores de pruebas. Hasta T6, el comportamiento de la app no cambia
(`estado.soportes` sigue siendo el boolean de hoy).

Detalle de T0 (spike): imprimir una "T" invertida con `sliceSupportType: 'automatic'` y comprobar (a) que
`parchar` aplica sobre el vendor actual; (b) que el gancho `sinBloqueos` se llama una vez por capa, con `z` creciente
hacia abajo en el bucle, y que `widget.anno.bloqueos` llegó con el contenido que mandó el test; (c) que el G-code es
**idéntico** al de antes con ganchos de mentira (sin regresión); (d) que dos copias en `track.pos` distintos reciben las
mismas zonas en coordenadas locales. Si (b) o (d) fallan, se frena y se vuelve a este ADR (ver R5).

## Pruebas

**Node, sin navegador** (`npm run test:soportes`, runner `scripts/probar-soportes.mjs`, un archivo por tema en
`scripts/soportes/`):

- `arbol.mjs` sobre polígonos sintéticos: (1) un voladizo cuadrado de 20×20 sobre cama libre → hay troncos en
  todas las capas bajo él, todo círculo dentro de la caja del voladizo ampliada por la deriva máxima y de la cama;
  (2) invariantes por capa: ningún par de círculos se pisa; ningún centro dentro de `cuerpo`; (3) fusión: dos
  voladizos a 8 mm entre sí terminan en menos troncos abajo que arriba; (4) un `cuerpo` que bloquea el paso
  hace que el tronco lo esquive (sin centros dentro) o termine apoyado; (5) `maxNodos` se respeta con un voladizo
  de 200×200; (6) determinismo (misma entrada, misma salida); (7) un bloqueo que cubre todo el voladizo → salida
  vacía; (8) 300 capas × 150 nodos corre en < 1 s (cota floja, sólo para cazar O(n³)).
- `bloqueos.mjs`: `validarBloqueos` descarta basura (`null`, `NaN`, forma `'caja'`, radio negativo), acota radios,
  corta en `MAX_BLOQUEOS`; `seccionBloqueos` da radio `√(R²−dz²)` y vacío fuera de rango; `bloqueaPunto` con margen.
- `tipo.mjs`: `normalizarSoportes(true)` → `'normal'`, `(false)` → `'no'`, `('arbol')` → `'arbol'`, `(7)` → `'no'`;
  `procesoDeSoportes` de cada tipo; `armarConfiguracion({ soportes: true })` sigue dando `sliceSupportType:'automatic'`
  (compatibilidad), `'arbol'` suma `sliceSupportTree: true`, `'no'` no pone nada.

**Navegador** (`npm run test:motor`, con Kiri real; modelo de prueba "T invertida" generado en
`scripts/lib/malla-voladizo.mjs`: pilar de 10×10 y una tapa de 40×40 a 15 mm de altura). Se mide la longitud
extruida de las líneas de soporte con `analizar` de `scripts/motor/ayudas.mjs` (se extiende para separar el tipo
`support` si todavía no lo hace; los tipos están en `motor/tipos-linea.js`):

1. Con `'normal'` hay material de soporte bajo la tapa (> 0).
2. **Con `'arbol'` hay material de soporte bajo la tapa y menos que con `'normal'`** (meta: ≤ 70 % de la longitud
   extruida de soporte; si el umbral real resulta distinto se fija con la primera medición y se anota en la prueba).
3. Con `'arbol'` el soporte está **bajo el voladizo**: hay extrusiones de soporte a Z < 15 mm con (X, Y) dentro de la
   huella de la tapa, y ninguna con Z por encima de la tapa.
4. **Nada fuera de la cama**: todas las coordenadas del G-code están dentro de `[0, bedWidth] × [0, bedDepth]`
   (o centradas, según la impresora de prueba).
5. Con una zona esférica de radio 30 centrada bajo la tapa: el soporte baja a < 5 % del de `'normal'`
   y no hay extrusiones de soporte dentro de la esfera (control: sin zona sí las hay).
6. Dos copias en `posiciones` distintas con la misma zona: cada copia respeta la zona en **su** posición
   (comprobación por copia de las coordenadas absolutas = local + `pos`).
7. `'no'` no deja líneas de soporte (regresión), y la torre de calibración sigue sin soportes (regresión).
8. Regresión de memoria/tiempo: el laminado de la "T" con `'arbol'` no tarda más de 2× el de `'normal'` en la misma
   máquina.

**App** (`npm run test:app`): migración de `preferencias` viejas (`true`/`false`) y nuevas; el selector guarda el
texto; agregar una zona con un toque, cambiar el radio, quitarla; cambiar escala o rotación vacía las zonas con el
aviso; `piezasParaMotor()` lleva `bloqueos`; el panel de zonas no aparece con torre o litofanía; el visor sigue con
`apoyar cara` sin romperse (`alTocarPieza` intacto). **Contratos** (`npm run test:contratos`): las aristas de
la tabla de módulos (ningún módulo de `src/motor/` importa `ui/`; los puros no importan Kiri). **Formato**:
`npm run format:check` (Prettier también formatea los `.md`).

## Riesgos

| # | Riesgo | Cómo se cubre |
|---|---|---|
| R1 | El árbol propio es demasiado rústico: marcas feas, troncos que no llegan, voladizos mal apoyados | Límite conocido de v1 (T4, medido por el revisor): cuando dos troncos se funden el radio del fusionado está acotado y el absorbido puede quedar tangente al de abajo (~0,5 % de los círculos), un puente corto de 4 a 5 mm; no se mitiga en v1 (decisión del CTO). La meta es medible (prueba 2 y 3). Si no se alcanza en T1/T4, plan B (c): `planificarArbol` con `separacion` grande es de hecho "postes ralos", sin cambiar contrato. Plan de reversa: la opción `'arbol'` se oculta del selector (una línea) y `normalizarSoportes('arbol')` devuelve `'normal'`; el resto queda inerte. |
| R2 | Menos material pero más tiempo de impresión (muchos troncos finos, muchas retracciones) | Se mide el tiempo en la prueba 8 y se muestra en el resumen del paso 4; `separacion` y `radioMax` son parámetros ajustables. |
| R3 | Los parches se rompen con una actualización de Kiri (anclas de texto) | `parchar` falla fuerte si no encuentra el texto; T0 los prueba; el puente, si no está instalado o devuelve `false`, deja a Kiri con `'automatic'` (degradación suave). |
| R4 | Memoria en celu de gama baja con modelos altos | Tope `maxNodos`, círculos de 8 lados y sin unión de polígonos; salida estimada < 25 MB. El tope de triángulos (ADR 0003) sigue mandando. Se mide en T7 (pico del worker con la malla pesada). |
| R5 | `widget.anno` no llega a `processSupports` en el flujo `sync` → `slice`, o `slice.z` no es local | T0 lo comprueba en la prueba (b) y (d) antes de construir. Plan B: pasar los bloqueos por `settings.process.laminarBloqueos` por widget (`process` sí llega), con el mismo contrato de datos. |
| R6 | Un voladizo dentro de una zona sin soporte se imprime en el aire y falla | **T6:** el panel de zonas lo avisa siempre (`#bloqueoNota`: "Ojo: una zona debajo de un voladizo puede dejarlo sin ningún soporte"): una zona bajo el centro del voladizo puede dejarlo sin soporte, es lo que se pide. T4: con 'normal' el voladizo queda sin soporte dentro de la esfera (probado por coordenadas); con 'arbol' los troncos sin camino se podan (el límite de los troncos absorbidos tangentes de R1 aplica igual: ~0,5 % de los círculos, puente de 4 a 5 mm, no se mitiga en v1). Aviso en la UI cuando la esfera toca el cuerpo: "Si el voladizo queda dentro, esa parte se imprime sin apoyo." (la UI conoce el centro y el radio; no calcula contra la malla). |
| R7 | (T4: el motor aplica las zonas en el marco local de cada copia; probado con dos copias, en coordenadas absolutas = centro + posición + local.) El punto tocado no está en el marco de la pieza que esperamos (la malla del visor no está centrada como `centrar()`) | T3 lo prueba con una pieza girada y copias en dos posiciones; si difiere, `alTocarPunto` corrige restando el centro de la caja de la malla. **Medido en T6:** el visor centra la malla sin decimar y el motor centra la decimada, así que sus marcos pueden diferir en lo que la decimación mueva la caja. Con los cuatro topes reales (`maxTriangulos()`: 100 000, 200 000, 250 000 y 500 000) sobre una esfera de 1,21 M de triángulos, versiones recortadas y un cono, el desfase del centro en X e Y y de la base en Z es **≤ 0,001 mm** (la celda llega a 0,76 mm, pero la caja casi no se mueve): muy por debajo de los 0,2 mm que aceptamos. No hace falta corregirlo. |
| R8 | `soportes` quedó como boolean en algún consumidor no listado (`'no'` es verdadero en JS) | T6 recorre `grep -rn soportes src scripts`; la prueba de `tipo.mjs` y la de estado cubren los consumidores conocidos (`paso2-config`, `paso3`, `paso4`, `estado`, `perfiles`, tarjeta del material). |
| R9 | Cancelar durante `planificarArbol` | Es sincrónico y corto (< 1 s con los topes); el cancelar del laminado ya corta entre capas de Kiri. Si midiéramos más, se parte el trabajo y se cede al worker cada N capas. |

**Queda fuera de la v1:** ramas que se abren hacia arriba para repartir la carga; troncos inclinados que sortean
huecos del cuerpo (sólo deriva limitada y esquive local); apoyo sobre el modelo con puntas dedicadas y "techo" fino
(interfaz); bloqueos con forma de caja o cilindro (el contrato tiene `forma` para sumarlos); bloqueos que se
adapten a un cambio de escala/rotación (se vacían); **forzar** soportes en una zona (el contrario del bloqueo);
persistir las zonas en recientes; soportes sólo desde la cama ("touching buildplate") o "sólo en cara elegida";
soportes árbol en modo cinta (belt) y en jarrón; soportes en la torre de calibración (siguen sin).

## Consecuencias

- **Más fácil:** el usuario elige entre sin soportes, normales y árbol; puede proteger una cara con un toque.
  El árbol y los bloqueos son lógica pura probable en Node, sin navegador. Los parches a Kiri son tres líneas,
  con un único punto de entrada (`globalThis.laminarMovil`) que, si falta, deja el motor igual que hoy.
- **Más difícil:** hay un algoritmo propio que mantener y afinar; `processSupports` ahora tiene tres parches que
  hay que revisar en cada actualización de Kiri; `estado.soportes` deja de ser boolean (toda comparación nueva debe
  usar `!== 'no'`, no verdad/falsedad).
- **Archivos que quedan cerca del tope:** `visor.js` (≈ 285) y `paso2-config.js` (≈ 235) no crecen; la lógica nueva
  vive en módulos aparte (`bloqueos-ui`, `soportes-tipo-ui`, `visor-bloqueos`).
- **Plan de reversa:** ocultar la opción `'arbol'` (R1) y/o no instalar los ganchos (`instalarGanchosSoportes`
  no se llama): el motor vuelve al comportamiento de Kiri sin tocar el vendor. Los datos guardados siguen siendo
  válidos (`'arbol'` se lee como `'normal'`).
- **Documentación:** al terminar T6/T7 se actualiza `docs/MAPA.md` (módulos nuevos, `estado.soportes` y
  `Pieza.bloqueos`, parches nuevos de `scripts/vendor-kiri.mjs`, dónde mirar si "el soporte árbol sale raro" o
  "la zona no se respeta").
