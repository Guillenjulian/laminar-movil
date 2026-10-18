# 0002. Cambios por altura y torres de calibración

- **Fecha:** 2026-10-18
- **Autor/a:** arquitecto
- **Base:** commit `2ca094f`

## Estado

Aceptado (CTO, 2026-10-18). Decisiones del CTO: la torre oculta escala y rotación (v1); se suma la suite `test:cambios`.

## Contexto

El usuario quiere "desde X mm cambiar relleno, temperatura o velocidad" y, encima de eso, que la app
genere sola torres de calibración (temperatura y retracción). Hoy `armarConfiguracion`
(`src/perfiles/perfiles.js`) devuelve un único `proceso` para toda la pieza; `src/motor/pausas.js` es el
único mecanismo "por capa", y trabaja sobre el G-code ya generado, usando offsets que salen de la vista
previa (`recorridos.worker.js`).

Kiri:Moto 4.7.0 (en `vendor/kiri/`, sin parches sobre esta zona) ya tiene un mecanismo de **rangos por
capa**. Lo verifiqué leyendo el código (números de línea de `vendor/kiri/src/kiri/`, versión 4.7.0; si el
vendor se actualiza hay que revalidarlos, por eso la tarea T3 es una prueba contra el Kiri real).

### 1. Cómo soporta Kiri los rangos

**Forma.** `process.ranges` es un arreglo de `{ lo, hi, fields }` (`app/conf/defaults.js:322`, valor por
defecto `[]`). `lo` y `hi` son **índices de capa, inclusivos** (no milímetros), y `fields` es un objeto
`{ claveDeProceso: valor }` que pisa esas claves en esas capas (`mode/fdm/core/params.js:4-22`;
`params._range = true` marca la copia). Si varios rangos cubren una capa, se aplican en orden y el último
gana. Kiri:Moto 4.7.0 no trae UI para esto en lo que copiamos: la conversión mm → capa es nuestra.

**Dónde se lee cada clave** (esto define qué se puede cambiar por altura):

| Qué cambia | Clave en `fields` | Quién la lee | Cómo llega al G-code |
|---|---|---|---|
| Relleno (densidad, patrón) | `sliceFillSparse`, `sliceFillType` | `mode/fdm/work/slice.js:947` (`slice.params`), usados en `:774-789` (el caché de relleno se saltea si `_range`) y `:683` (densidad → sólido/denso) | Cambia la geometría de la capa; no emite nada especial |
| Paredes y capas sólidas | `sliceShells`, `sliceTopLayers`, `sliceBottomLayers` | `slice.js:723-725` y `post.js:68` (`sliceShells`) | Geometría (fuera de alcance v1, pero gratis) |
| Velocidad | `outputFeedrate`, `outputFinishrate` | `prepare.js:677,717` pasa `params` a `slicePrintPath`, que hace `process = opt.params` (`:989`) y usa `:1007-1009` | Cambia el `F` de cada movimiento de esa capa |
| Temperatura de boquilla | `outputTemp` (la capa 0 usa `firstLayerNozzleTemp`) | `export.js:158-168` (`updateParams`, llamada en `:523`) | **Kiri emite `M104 S<t> T<n>` al empezar la capa** (`export.js:584-589`), sólo si cambió respecto de la capa anterior |
| Temperatura de cama | `outputBedTemp` | igual | `M140 S<t> T0` (`export.js:579-582`). No lo exponemos en v1 |
| Ventilador | `outputFanSpeed` (0-255), `outputFanLayer` | `export.js:170-172` | Re-emite `gcodeFan` con `{fan_speed}` (`export.js:575-578`). Requiere `dispositivo.gcodeFan` (ya es obligatorio, LEEME) |
| Retracción | `outputRetractDist`, `outputRetractSpeed`, `zHopDistance` | `export.js:159-162` | Cambia las longitudes de las retracciones de esa capa |

**Qué NO soporta o no sirve para nosotros:**

- **Milímetros.** Sólo índices de capa. Hay que convertir mm → capa con la altura de capa y de primera
  capa (sección 2.3). Con **altura de capa variable** (`sliceAdaptive`) el índice no se corresponde con
  una Z fija: no se puede.
- **Capa 0.** Usa `firstLayerNozzleTemp`/`firstLayerBedTemp`/`firstLayerFanSpeed`/`firstLayerRate`. Un rango
  que cubra la capa 0 con `outputTemp` no cambia nada. Regla nuestra: ningún cambio empieza antes de la
  capa 1 (`lo >= 1`).
- **`M104` no espera.** Kiri emite `M104` (no `M109`): la boquilla tarda unos segundos en llegar a la
  temperatura nueva y las primeras capas del bloque salen "a medias". Es el comportamiento normal de una
  torre de temperatura cortada con Cura/PrusaSlicer (`TEMP` en script de capa), pero hay que decirlo en la UI.
- `outputSeekrate` (viaje) y `outputMaxFlowrate` no están en la lista que se lee con `params`; no los
  ofrecemos.
- `outputLoops` por rango sólo aplica a cintas (`export.js:203-212`, `isBelt`); no nos interesa.
- **Modo jarrón** (`sliceFillType = 'vase'`): relleno y capas sólidas no tienen efecto (no hay relleno).
  Temperatura, velocidad y ventilador sí funcionan (el índice de capa existe; `espiral.js` sólo reescribe Z).
- **Balsa/raft:** no verifiqué si las capas de la balsa cuentan en `slice.index`. Si cuentan, el mapeo
  mm → capa se corre. Lo resuelve la prueba T3 (sección 6, riesgo R2).

### 2. Mecanismo elegido por tipo de cambio (decisión)

| Cambio | Mecanismo | Por qué |
|---|---|---|
| Relleno | `ranges[].fields.sliceFillSparse` (y `sliceFillType`) | Tiene que cambiar la geometría; sólo se puede hacer dentro de Kiri |
| Velocidad | `fields.outputFeedrate` y `outputFinishrate` (valor absoluto = base final × %) | Kiri la lee por capa; inyectar `M220`/`F` al descargar rompería el cálculo de tiempo y el límite de caudal |
| Temperatura | `fields.outputTemp` → **Kiri emite el `M104`** | Ya lo hace, en el lugar correcto (inicio de capa, antes de subir Z), y mantiene `{temp}` coherente. Inyectar `M104` por Z como `pausas.js` duplicaría lo que Kiri hace y obligaría a parsear el G-code (la vista previa ni siquiera mira `M104`) |
| Ventilador | `fields.outputFanSpeed` (0-255) | Igual que temperatura; Kiri re-emite `gcodeFan` |
| Retracción (sólo torres, y modelo de datos listo para UI futura) | `fields.outputRetractDist` | Lo lee `export.js:161`; igual que arriba |

**Alternativa descartada: post-proceso del G-code por Z** (estilo `pausas.js`, insertar
`M104`/`M106`/`M220` en el offset de la capa). Ventajas: funciona con altura variable y no depende de
cómo cuenta Kiri la balsa. Desventajas: no cambia relleno (la mitad del pedido), exige conocer la Z de
cada capa desde el G-code y no se ve en el tiempo estimado. Queda como **plan B** si la prueba T3 muestra
que Kiri cuenta mal las capas con balsa (se limitaría a temperatura/ventilador/velocidad con una función
pura `inyectarPorZ(gcode, cambios)` en `src/motor/pausas.js` o un módulo hermano). No se implementa ahora.

### 3. Mapeo mm → capa

Con capa uniforme `h` y primera capa `h0`, la capa `i` (desde 0) ocupa `[h0 + (i-1)h, h0 + i·h]` para
`i >= 1` y `[0, h0]` para `i = 0` (Kiri pone la Z de corte a la mitad de cada capa, parches en
`vendor-kiri.mjs`). "Desde X mm" = primera capa cuyo **piso** es >= X:

```
lo = max(1, ceil((X - h0) / h - 1e-6) + 1)
hi = hastaMm === undefined ? 1e9 : capaDesde(Y) - 1               // última capa cuyo piso < Y
```

**Regla (corregida por el CTO al integrar T1):** una capa pertenece a un cambio si su **piso** cae en
`[desdeMm, hastaMm)`. La versión original (`hi` = última capa cuyo techo <= Y) dejaba sin cubrir la capa
que cruza el borde cuando `h` no divide a Y (ej. capas de 0,12 o 0,28 mm), y esa capa salía con el valor
base. Con esta regla los rangos consecutivos son contiguos (`hi(k) + 1 = lo(k+1)`).

Si X no cae justo en el piso de una capa, el cambio ocurre en la capa que empieza arriba de X (la
diferencia es menor a una altura de capa). `1e9` en lugar de `Infinity` porque el `proceso` viaja por
`postMessage` y por `Object.clone` de Kiri; un número finito es más seguro.

## Decisión

### 4. Modelo de datos y validación

```js
// estado.cambios: Cambio[]   (vacío = sin cambios; NO se persiste: depende del modelo, igual que `pausas`)
// Cambio = {
//   desdeMm: number,        // > 0, <= 1000. El cambio vale desde esta altura (Z)
//   hastaMm?: number,       // > desdeMm. Si falta: hasta el siguiente cambio, o hasta el final
//   relleno?: number,       // 0..1 (misma escala que personal.densidad / sliceFillSparse)
//   patron?: string,        // una clave de opciones.patrones (opcional)
//   tempBoquilla?: number,  // 150..300 °C (mismos límites que Avanzado)
//   velocidad?: number,     // 50..150 %  (mismos límites que Avanzado; se aplica sobre la velocidad final)
//   ventilador?: number,    // 0..100 %
//   retraccion?: number,    // 0..10 mm (en v1 sólo lo usan las torres; la UI no lo muestra)
// }
```

Reglas de semántica (importantes, para que no haya sorpresas):

1. **Cada cambio es absoluto respecto de la configuración final base**, no acumulativo: el cambio 2 no
   hereda lo del cambio 1. Fuera de los cambios vale la configuración normal.
2. Un cambio sin `hastaMm` dura hasta el `desdeMm` del siguiente (ordenados por `desdeMm`) o hasta el
   final. Así no hay solapes salvo que el usuario ponga `hastaMm` explícito.
3. Cada cambio debe traer **al menos una** propiedad además de `desdeMm`/`hastaMm`.
4. Máximo 8 cambios (la lista es de celular; evita rangos absurdos).

**Dónde se valida** (función pura, sin DOM, testeable en Node): `src/perfiles/cambios.js`.

```js
// src/perfiles/cambios.js  (importa: nada, o a lo sumo ./perfiles.js -> NO: para evitar ciclo recibe opciones por parámetro)

/** Sanea y ordena. Descarta lo roto; los problemas "de usuario" van a `errores` (castellano).
 *  @param {unknown} lista
 *  @param {{ patrones?: string[] }} [contexto]
 *  @returns {{ cambios: Cambio[], errores: string[] }} */
export function validarCambios(lista, contexto) {}

/** Convierte cambios (mm) en `process.ranges` de Kiri (índices de capa). No valida: recibe lo ya validado.
 *  `base` es el proceso final (para escalar la velocidad). Devuelve [] si no hay nada que aplicar.
 *  @param {Cambio[]} cambios
 *  @param {{ sliceHeight:number, firstSliceHeight:number, outputFeedrate?:number, outputFinishrate?:number }} base
 *  @returns {{ lo:number, hi:number, fields:object }[]} */
export function cambiosARangos(cambios, base) {}

/** Texto de resumen para la UI ("desde 10 mm: relleno 10 %, 215 °C"). @returns {string} */
export function resumenCambios(cambios) {}

/** Avisos posteriores al laminado (un cambio por encima de la pieza no hace nada).
 *  @param {Cambio[]} cambios @param {number} alturaPiezaMm @returns {string[]} */
export function avisosPostLaminado(cambios, alturaPiezaMm) {}
```

Se pone en `src/perfiles/` (no en `src/motor/`) porque forma parte de "cómo se arma la configuración" y
tiene que poder importarse desde `perfiles.js` sin que el motor dependa de perfiles.

**Cómo entra a `armarConfiguracion`** (cambio mínimo en `perfiles.js`): nuevo parámetro `cambios = []`,
aplicado **al final de todo**: la regla del LEEME pasa a

```
… → personalizado → avanzado → soportes → extras → cambios por altura (ranges)
```

Los rangos no reemplazan `proceso`: se agregan como `proceso.ranges`, y Kiri los superpone por capa sobre
lo ya combinado. Pasos dentro de `armarConfiguracion`, después de calcular `proceso` y **antes** de recortar
temperaturas:

1. `const { cambios: ok, errores } = validarCambios(cambios)`; los `errores` se suman a `avisos`.
2. Si `avanzado.alturaVariable && !avanzado.jarron` (Kiri no usa capa uniforme): no se emiten rangos y se
   agrega el aviso "Los cambios por altura no funcionan con altura de capa variable: se ignoraron."
   (defensa; la UI ya lo evita).
3. Si es jarrón: se descartan `relleno`/`patron` de cada cambio (si queda vacío, el cambio se descarta) y
   se avisa.
4. `proceso.ranges = cambiosARangos(ok, proceso)`.
5. El recorte a `hotendMax` (y su aviso) recorre también `proceso.ranges[].fields.outputTemp`.
6. `sinComentarios` ya recorre arreglos: no hay que tocarlo (la clave `fields` no empieza con `_`).

Efecto colateral buscado: sin `cambios` (o vacío) el `proceso` queda **idéntico** al de hoy (con
`ranges: []` de Kiri, o sin la clave); hay prueba de regresión.

### 5. UI de cambios por altura

Una sección nueva dentro del paso 2, como "Avanzado": `<details class="personalizar" id="cambiosAltura">`
justo debajo de `#avanzado` en `index.html` ("Cambios por altura", resumen en el `<summary>`). Es lo más
barato y coherente con la pantalla actual; una hoja nueva agrega navegación e historial sin necesidad.

Contenido: lista de filas (una por cambio) con "Desde [ ] mm", y por fila contadores ± opcionales para
relleno (%), temperatura, velocidad, ventilador (cada uno con casilla "cambiar" para saber qué entra en
el cambio), botón "Quitar", y abajo "Agregar cambio". Muestra los `errores` de `validarCambios` en rojo y
un cartel si Altura variable está activada ("No se puede combinar con altura de capa variable") —
en ese caso la lista queda deshabilitada. Avisa en una línea que la temperatura nueva tarda unos
segundos en alcanzarse (no espera).

**Módulo nuevo `src/ui/cambios.js`** (~170 líneas; mismo patrón que `avanzado.js`: dependencias
inyectadas, no toca el DOM al importarse):

```js
/** @param {{ estado: object, alCambiar: () => void }} deps
 *  @returns {{ dibujar: () => void }}  redibuja la sección con estado.cambios y estado.avanzado */
export function crearCambios({ estado, alCambiar }) {}

/** Texto para el <summary> ("2 cambios" / "Sin cambios"). @param {Cambio[]} cambios @returns {string} */
export function resumenCambios(cambios) {}   // delega en perfiles/cambios.js
```

Entrada para `scripts/lib/contratos-ui.js`:

```js
'ui/cambios': {
    exports: { crearCambios: 1, resumenCambios: 1 },
    importa: ['perfiles/cambios', 'ui/util-dom', 'ui/formato'],
},
// y se agrega 'ui/cambios' a la lista `importa` de 'ui/paso2-config' (nivel 0, hoja, como avanzado).
```

Cableado:

- `estado.js`: `cambios: []` y `torre: null` (sección 6) en `estado`; **no** se agregan a `guardarPreferencias`.
  Se reinician en `montarModelo` (`paso1-modelo.js`), igual que `resultado`.
- `paso2-config.js`: `cambios = crearCambios({ estado, alCambiar })`, donde `alCambiar` sólo actualiza el resumen
  (no hay nada que guardar); se llama `cambios.dibujar()` junto a `avanzado?.dibujar()` en
  `dibujarOpciones`. Menos de 10 líneas nuevas (el archivo está en 174).
- `paso3-laminar.js` (`configuracionActual`): pasa `cambios: estado.cambios`.
- `paso4-resultado.js`: suma `avisosPostLaminado(estado.cambios, resultado.info.tamano.z)` a los avisos
  (agrega `perfiles/cambios` a su `importa` en el contrato).

### 6. Torres de calibración

**Mallas** (funciones puras, `Float32Array` de triángulos `[x,y,z ×3]` como `leerSTL`/`generarLitofania`,
mm, caras hacia afuera en sentido antihorario). Archivo nuevo `src/motor/torres.js` (~140 líneas), sin
imports:

```js
/** Bloques de una torre: [{ desdeMm, hastaMm }] de abajo hacia arriba. Pura y barata (la usa perfiles). */
export function bloquesDeTorre({ bloques, altoBloqueMm }) {}

/** Torre de temperatura: UNA sola silueta extruida en Y (sin cuerpos que se pisen, Kiri corta mejor un
 *  sólido único). La cara izquierda es lisa; la derecha, por bloque: vertical hasta (alto - voladizo),
 *  luego 45° hacia afuera `voladizoMm` (prueba de voladizo) y un escalón plano de vuelta. La silueta es
 *  monótona en Z: se triangula por franjas, sin ear-clipping.
 *  @param {{ bloques?:number(3..8, def 5), altoBloqueMm?:number(6..15, def 10), anchoMm?:number(def 20),
 *            profundidadMm?:number(def 15), voladizoMm?:number(def 5) }} [op]
 *  @returns {{ vertices: Float32Array, alturaMm: number, bloques: {desdeMm:number,hastaMm:number}[] }} */
export function generarTorreTemperatura(op) {}

/** Torre de retracción: DOS columnas cuadradas (`ladoMm`, def 10) separadas `separacionMm` (def 35) y
 *  de altura bloques × altoBloqueMm: el viaje entre columnas en cada capa es lo que provoca los hilitos.
 *  @param {{ bloques?, altoBloqueMm?, ladoMm?, separacionMm? }} [op]
 *  @returns {{ vertices: Float32Array, alturaMm: number, bloques: {desdeMm:number,hastaMm:number}[] }} */
export function generarTorreRetraccion(op) {}
```

Ambas lanzan `Error` en castellano con parámetros fuera de rango (como `generarLitofania`). Como
`escribirSTL` está en `formatos.js` (que importa JSZip), las torres se generan en el worker liviano:
`convertir.worker.js` suma `tipo: 'torre'` (`{ tipoTorre, ...opciones }`) y `motor.js` exporta
`torreAStl(op)` → `{ stl: ArrayBuffer }`, igual que `litofaniaAStl`. La UI no necesita la malla: los
bloques los calcula `bloquesDeTorre` (misma fórmula que el generador, y una prueba lo verifica).

**Configuración de la torre** (`src/perfiles/torres.js`, ~110 líneas, puro; importa `motor/torres.js` y
`perfiles.js`):

```js
/** @typedef {{ tipo:'temperatura'|'retraccion', altoBloqueMm:number,
 *              bloques:{ desdeMm:number, hastaMm:number, valor:number }[] }} Torre */

/** Valores de partida según material e impresora: temperatura = [t+10, t+5, t, t-5, t-10] (el más
 *  caliente abajo, recortado a limites.hotendMax y >= 150); retracción = 0,5..4,5 mm de a 1 (directa) o
 *  2..6 mm (Bowden: retracción base > 2 mm). @returns {{ bloques:number, altoBloqueMm:number, valores:number[] }} */
export function valoresSugeridos(tipo, { impresoraId, material }) {}

/** Arma y valida la torre. Lanza Error (castellano) si hay <3 o >8 valores o valores fuera de rango.
 *  @param {{ tipo:string, valores:number[], altoBloqueMm?:number }} op @returns {Torre} */
export function armarTorre(op) {}

/** Lo que la torre le impone a la configuración. El bloque 0 va por la vía normal (Avanzado) para no
 *  tocar la capa 0; los bloques 1..N-1 son `cambios` (sección 4).
 *  @param {Torre} torre
 *  @returns {{ avanzado: object, personal: object, soportes: false, cambios: Cambio[] }} */
export function configuracionDeTorre(torre) {}
```

`configuracionDeTorre` devuelve, para temperatura: `avanzado = { tempBoquilla: bloques[0].valor,
alturaVariable: false, jarron: false, costura: 'ultima' }`, `personal = { paredes: 2, densidad: 0.1 }`
(menos filamento, torre rápida) y `cambios = bloques.slice(1).map(b => ({ desdeMm: b.desdeMm, hastaMm:
b.hastaMm, tempBoquilla: b.valor }))`. Para retracción: igual con `retraccion` en lugar de `tempBoquilla`
(`avanzado.retraccion = bloques[0].valor`). Encadenamiento en `paso3-laminar.js` (`configuracionActual`):

```js
const t = estado.torre ? configuracionDeTorre(estado.torre) : null;
armarConfiguracion({ impresoraId, calidad, material,
    soportes: t ? false : estado.soportes,
    personal: { ...estado.personal, ...t?.personal, avanzado: { ...estado.avanzado, ...t?.avanzado } },
    cambios: t ? t.cambios : estado.cambios });
```

(La torre pisa Avanzado/Personalizar sólo en lo que necesita; el resto —impresora, calidad, material—
sigue siendo del usuario.) Una torre no se mezcla con cambios manuales: si hay `estado.torre`, la sección
"Cambios por altura" se muestra deshabilitada con "Los define la torre".

**Cómo se ofrece en la UI:**

- Botón "Torre de calibración" en el paso 1 (pantalla sin modelo, junto a "Hacer una litofanía"), que abre
  la hoja nueva `#hojaTorre` ("Torre de calibración"): elegir tipo (Temperatura / Retracción), cantidad de
  bloques (3-8), valor inicial y paso (precargados con `valoresSugeridos` para la impresora y el material
  elegidos), vista de la tabla "Bloque 1 (abajo): 225 °C …" y el botón "Crear torre".
- "Crear torre" llama a `cargar(nombre, generar, torre)`; `paso1-modelo.js` hace
  `cargarArchivo('Torre de temperatura', null, { generar, guardar: false, torre })` (no entra en
  "recientes") y `montarModelo` copia `estado.torre = torre ?? null`.
- Con `estado.torre` activo se **ocultan** escala, rotación y "apoyar cara" (si no, las alturas de los
  bloques dejan de coincidir con la pieza). La alternativa —escalar los `mm` de la torre— se descarta
  porque la rotación la rompe; es un ajuste simple si más adelante se quiere.
- En el paso 2 aparece una línea "Torre de temperatura: 225, 220, 215 … °C (de abajo hacia arriba)".

**Módulo nuevo `src/ui/torres.js`** (~150 líneas, mismo patrón que `ui/litofania.js`):

```js
/** @param {{ abrir: () => void, cerrar: () => void,
 *            cargar: (nombre:string, generar:() => Promise<ArrayBuffer>, torre:Torre) => void,
 *            contexto: () => { impresoraId:string, material:string } }} deps
 *  @returns {{ abrir: () => void }}  conecta la hoja #hojaTorre */
export function prepararTorre({ abrir, cerrar, cargar, contexto }) {}
```

Contrato para `scripts/lib/contratos-ui.js`:

```js
'ui/torres': {
    exports: { prepararTorre: 1 },
    importa: ['perfiles/torres', 'motor/motor', 'ui/util-dom', 'ui/formato'],
},
// y se agrega 'ui/torres' a la lista `importa` de 'ui/paso1-modelo'.
```

`paso1-modelo.js` está en 284 líneas: el cableado ahí se limita a ≤ 12 líneas (crear `torres` en
`iniciarPaso1`, la opción `torre` en `cargarArchivo`/`montarModelo`, ocultar los ajustes). Todo lo demás
vive en `ui/torres.js`. Si el archivo pasa de 300 físicas, T8 no se acepta (el lint ya avisa a las 300
lógicas; este ADR pide 300 físicas para no agravar la deuda de `vista-capas.js`).

Grafo: `ui/cambios` y `ui/torres` son hojas de nivel 0 (como `avanzado`/`litofania`); `perfiles/torres` →
`motor/torres` y `perfiles/perfiles` (nueva arista permitida: perfiles → motor/torres, un módulo puro sin
imports). Nadie importa a `ui/torres` salvo `paso1-modelo`, ni a `ui/cambios` salvo `paso2-config`.
`docs/MAPA.md` se actualiza en cada tarea que agrega un módulo (regla del propio mapa).

### 7. Pruebas

**Nueva suite Node, `npm run test:cambios`** (`scripts/probar-cambios.mjs`, se suma al CI y a la tabla de
`MAPA.md`; sin navegador, corre en segundos):

- `validarCambios`: descarta basura (`null`, strings, NaN), ordena, rechaza `hastaMm <= desdeMm`, cambio
  sin propiedades, más de 8, `desdeMm <= 0`, valores fuera de rango; un cambio sin `hastaMm` se corta en el
  siguiente.
- `cambiosARangos`: tabla de mapeo con `h=0.2,h0=0.2`, `h=0.2,h0=0.3`, `h=0.12,h0=0.24`; nunca `lo < 1`;
  `hi = 1e9` si falta `hastaMm`; `velocidad 80 %` → `outputFeedrate = round(base × 0.8)` y lo mismo para
  `outputFinishrate`; `ventilador 50` → `outputFanSpeed 128`; `relleno` → `sliceFillSparse`.
- `armarConfiguracion` con `cambios`: sin cambios el `proceso` es idéntico al actual (regresión); con
  cambios aparece `proceso.ranges`; la temperatura del rango se recorta a `hotendMax` con aviso; altura
  variable sin jarrón → sin `ranges` y con aviso; jarrón → los cambios de relleno se descartan con aviso.
- Mallas: `length % 9 === 0`, sin NaN, **cerrada** (cada arista aparece exactamente 2 veces con
  orientación opuesta), volumen positivo, caja `z ∈ [0, bloques × alto]`, y `bloques` de la malla ==
  `bloquesDeTorre`. Argumentos fuera de rango lanzan error.
- `configuracionDeTorre`: bloque 0 en `avanzado`, el resto en `cambios`, `soportes: false`; `valoresSugeridos`
  respeta `hotendMax` y Bowden.

**`test:motor`** (nueva sección en `scripts/motor/cambios.mjs`, enganchada desde `probar-motor.mjs`, que ya
tiene 539 líneas; usa el `laminar()` y `analizar()` existentes). Lamina el cubo de 20 mm con la Ender 3 V3
SE en PLA (capa 0,2) y revisa sobre el G-code real:

1. **Regresión:** `cambios: []` → G-code idéntico al de hoy.
2. **Temperatura:** base 200 °C, cambio `{ desdeMm: 10, tempBoquilla: 215 }` → aparece `M104 S215`
   **exactamente una vez**, después de la última extrusión con Z <= 10,0 y antes de la primera con Z > 10,0;
   no hay otro `M104 S215` antes; el `M104 S200` inicial se mantiene.
3. **Relleno:** `{ desdeMm: 10, relleno: 0 }` (con base 20 %) → el filamento extruido por encima de 10 mm
   es menor que en la corrida base y el de abajo es igual (compara por capa con `analizar`). El mismo cubo
   con relleno 0,6 por encima: mayor.
4. **Velocidad:** `{ desdeMm: 10, velocidad: 50 }` → los `F` de los movimientos con extrusión por encima de
   10 mm son ≈ la mitad de los de abajo (el relleno y la pared exterior por separado).
5. **Ventilador:** `{ desdeMm: 10, ventilador: 0 }` → aparece el `M106` con el valor nuevo en esa capa.
6. **Rango acotado:** `{ desdeMm: 6, hastaMm: 12, tempBoquilla: 215 }` → `M104 S215` al entrar y `M104 S200`
   al salir.
7. **Mapa mm → capa con balsa** (`adhesion: 'balsa'`): el `M104` cae a Z ≈ 10 + espesor de la balsa o a
   Z ≈ 10, según cuente Kiri; la prueba **documenta el resultado** y si se descuadra la tarea T3 corrige
   `cambiosARangos` (offset de balsa) o activa el plan B.
8. **Jarrón** con cambio de temperatura → `M104` presente (y el G-code sigue siendo espiral).
9. **Pausa en la misma capa que un cambio:** `insertarPausas` en esa capa → el `M104` queda antes del
   `M600`/`PAUSE` y no se duplica ninguna línea.
10. **Torre de temperatura** (5 bloques, `[230,225,220,215,210]`): `M109/M104 S230` antes de la primera capa y
    luego `M104 S225`, `S220`, `S215`, `S210` en ese orden, cada uno en Z ≈ 10, 20, 30, 40 (± una capa).
11. **Torre de retracción** (`[0.5,1.5,2.5,3.5,4.5]`): el movimiento de retracción más frecuente
    (`G1 E-<d>`) de cada franja de 10 mm coincide con su valor (±0,05).

**`test:app`** (`scripts/app/cambios.mjs` y `scripts/app/torres.mjs`, registrados en
`scripts/probar-app.mjs` y listados en `MAPA.md`; cada uno con cabecera de precondición/postcondición como
el resto):

- *Cambios:* con el cubo cargado, en el paso 2 se abre "Cambios por altura", se agrega un cambio desde
  10 mm con temperatura 215 y se lamina; el G-code descargado contiene `M104 S215`. Un valor inválido
  (desde 0) muestra el error y no se lamina con él. Con "Altura variable" activada la sección queda
  deshabilitada. Al cargar otro modelo la lista vuelve vacía. El resumen del `<summary>` cambia.
- *Torres:* en el paso 1 sin modelo, "Torre de calibración" abre la hoja con valores sugeridos; "Crear torre"
  carga el modelo, oculta escala/rotación y muestra la línea de la torre en el paso 2; laminar; el G-code
  descargado tiene los `M104` esperados (temperatura) y la torre no aparece en "recientes". Offline y SW
  siguen pasando (los archivos nuevos entran solos en la lista de `vite.config.js`).
- `test:contratos` (con `CONTRATOS_ESTRICTO=1`) verifica exports, aridad y aristas de `ui/cambios` y
  `ui/torres`.

### 8. Plan de tareas

Cada tarea es **< 200 líneas netas** (código + pruebas), un commit, y deja `npm run lint`, `format:check`,
`build` y las suites de su área en verde. Toda tarea que suma un módulo actualiza `docs/MAPA.md` en el mismo
commit. Orden de olas; lo de una misma ola es paralelizable.

| Ola | Tarea | Qué | Archivos | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| 1 | **T1** | `validarCambios`, `cambiosARangos`, `resumenCambios`, `avisosPostLaminado` + suite Node | `src/perfiles/cambios.js`, `scripts/probar-cambios.mjs`, `package.json` (`test:cambios`), `.github/workflows/ci.yml`, `docs/MAPA.md` | — | `npm run test:cambios` pasa con la tabla de mapeo y la validación de la sección 7; el módulo no importa nada de `src/` |
| 1 | **T5** | Mallas de torres + `bloquesDeTorre` | `src/motor/torres.js`, `scripts/probar-cambios.mjs` (sección mallas), `docs/MAPA.md` | — | Mallas cerradas (aristas pareadas), `z` máx = bloques × alto, `bloquesDeTorre` coincide; `test:cambios` pasa |
| 2 | **T2** | `armarConfiguracion({ cambios })` | `src/perfiles/perfiles.js`, `src/perfiles/LEEME.md` (orden de combinación), `scripts/probar-cambios.mjs` | T1 | Regresión idéntica sin cambios; `ranges` presentes; recorte de temperatura con aviso; altura variable y jarrón según la sección 4; `test:cambios` |
| 2 | **T6** | `valoresSugeridos`, `armarTorre`, `configuracionDeTorre` | `src/perfiles/torres.js`, `scripts/probar-cambios.mjs`, `docs/MAPA.md` | T1, T5 | Valores sugeridos respetan `hotendMax`/Bowden; bloque 0 va en `avanzado`; `test:cambios` |
| 3 | **T3** | **Prueba contra el Kiri real** (es el "spike" que valida el diseño) | `scripts/motor/cambios.mjs`, `scripts/probar-motor.mjs` (1 `import` + 1 llamada) | T2 | Casos 1-9 de la sección 7 pasan con `npm run build && npm run test:motor`. Si el caso 7 (balsa) muestra desvío, esta tarea corrige `cambiosARangos` o abre el plan B **antes** de seguir con la UI |
| 3 | **T4** | UI de cambios por altura | `src/ui/cambios.js`, `index.html` (`#cambiosAltura`), `src/estilos-avanzado.css`, `src/ui/estado.js` (`cambios`), `src/ui/paso2-config.js`, `src/ui/paso3-laminar.js`, `scripts/lib/contratos-ui.js`, `docs/MAPA.md` | T2 | `test:contratos` y `test:app` actuales siguen verdes; `ui/cambios.js` < 200 líneas; agregar, editar y quitar un cambio se ve en el `<summary>`; con altura variable queda deshabilitada |
| 3 | **T7** | Worker y API de torres + prueba de torres en el motor | `src/motor/convertir.worker.js`, `src/motor/motor.js` (`torreAStl`), `scripts/motor/cambios.mjs` (casos 10-11) | T2, T5, T6 (y el esqueleto de `scripts/motor/cambios.mjs` de T3) | Casos 10 y 11 pasan en `test:motor`; `torreAStl` devuelve un STL de `triangulos × 50 + 84` bytes |
| 4 | **T8** | UI de torres | `src/ui/torres.js`, `index.html` (`#hojaTorre`, botón en paso 1, línea en paso 2), `src/ui/paso1-modelo.js` (≤ 12 líneas), `src/ui/estado.js` (`torre`), `src/ui/paso3-laminar.js` (`configuracionActual`), `src/ui/paso2-config.js`, `scripts/lib/contratos-ui.js`, `docs/MAPA.md` | T4, T6, T7 | `test:contratos` verde; `paso1-modelo.js` <= 300 líneas físicas; la torre se carga, oculta escala/rotación y no entra en recientes (verificado en T9) |
| 5 | **T9** | Pruebas de la app | `scripts/app/cambios.mjs`, `scripts/app/torres.mjs`, `scripts/probar-app.mjs`, `docs/MAPA.md` (tabla de áreas) | T4, T8 | `npm run test:app` verde, incluidos offline y las dos áreas nuevas |
| 5 | **T10** | Avisos y cierre | `src/ui/paso4-resultado.js` (`avisosPostLaminado`), `scripts/lib/contratos-ui.js`, `CHANGELOG.md`, `docs/MAPA.md` (flujo, estado, "dónde buscar si falla"), este ADR → Aceptado | T4 | Un cambio por encima de la pieza muestra el aviso en el paso 4; MAPA al día; CI completo verde |

Caminos paralelos: **T1 ∥ T5** (ola 1), **T2 ∥ T6** (ola 2), **T3 ∥ T4 ∥ T7** (ola 3: T4 sólo toca UI, T3 y T7
sólo scripts/motor, no comparten archivos salvo `scripts/motor/cambios.mjs`, que T3 crea primero y T7 amplía:
T7 arranca cuando T3 sube el esqueleto). T8 va **después** de T4 porque ambas tocan `index.html`, `estado.js`,
`paso2-config.js` y `paso3-laminar.js`. Primer entregable de valor para el usuario: T1+T2+T3+T4 (cambios
por altura, sin torres).

## Consecuencias

**Más fácil.** El mecanismo reutiliza lo que Kiri ya hace (rangos y `M104` por capa): no se parsea ni se
reescribe G-code, el tiempo y el filamento estimados quedan coherentes, y la torre es "un caso particular"
de los cambios por altura (sin lógica propia en el motor). La validación y el mapeo son funciones puras
con suite Node rápida. Los módulos de UI nuevos son hojas del grafo y no tocan los límites del ADR 0001.

**Más difícil / costo.** `armarConfiguracion` suma un parámetro y un paso (ya figura entre las funciones
largas de la deuda: se mantiene corta delegando todo en `perfiles/cambios.js`). La UI de paso 2 crece una
sección. Tres suites cambian (`test:cambios` nueva, `test:motor` y `test:app` ampliadas).

### Riesgos

| # | Riesgo | Cómo se cubre |
|---|---|---|
| R1 | **Altura de capa variable:** el índice de capa no es una Z fija, los rangos caerían en cualquier lado | No se combinan: `armarConfiguracion` no emite rangos y avisa; la UI deshabilita la sección; las torres fuerzan `alturaVariable: false`. Si se quisiera soportarlo, es el plan B (`inyectarPorZ`) |
| R2 | **Balsa (raft):** puede que sus capas cuenten en `slice.index` y desplacen el mapeo | Caso 7 de `test:motor` lo mide antes de construir la UI (T3). Si cuenta, `cambiosARangos` recibe `capasBalsa` (la adhesión elegida y su espesor) y suma el offset; si no se puede, plan B |
| R3 | **Modo jarrón:** relleno y capas sólidas no existen; `espiral.js` reescribe Z | Se descartan `relleno`/`patron` con aviso; temperatura/velocidad/ventilador se prueban en el caso 8 |
| R4 | **Pausa en la misma capa que un cambio:** `pausas.js` inserta antes de subir Z; Kiri emite `M104`/`M106` al empezar la capa | Caso 9 fija el orden (`M104` antes de la pausa, así la pausa de filamento recalienta al objetivo nuevo). Si algún firmware reinicia el objetivo en `M600`, se documenta en el aviso de pausa |
| R5 | `M104` no espera: el bloque arranca con la boquilla aún en transición | Aviso en la UI; la torre de temperatura compensa con bloques de 10 mm (≈ 50 capas) |
| R6 | **Kiri cambia los índices** en una actualización del vendor | `test:motor` (T3) falla; los números de línea del ADR se revalidan al actualizar `vendor/kiri/` |
| R7 | **Capa 0 y `firstLayer*`:** un cambio que alcance la capa 0 no hace nada | `lo >= 1` por regla; la torre pone el valor del bloque 0 en Avanzado (que sí fija `firstLayerNozzleTemp`) |
| R8 | **Cambios obsoletos al cambiar de pieza/impresora:** milímetros que ya no valen | `estado.cambios` se reinicia al montar un modelo; al cambiar de impresora o altura de capa se conservan (siguen en mm) y `avisosPostLaminado` avisa si quedan fuera de la pieza |
| R9 | Torre de retracción: Kiri no retrae si el viaje es corto o pasa por encima de la pieza | La separación de 35 mm entre columnas fuerza viajes largos; el caso 11 lo verifica con el perfil real. Si hiciera falta, se ajusta `separacionMm` |
| R10 | `paso1-modelo.js` (284 líneas) cerca del límite | El cableado se acota a 12 líneas; si no alcanza, T8 mueve el bloque de recientes a un módulo aparte (como ya anota el ADR 0001 para `impresoras.js`) |

### Fuera de alcance (v1)

Temperatura de cama por altura, cambio de paredes/capas sólidas por altura desde la UI (el modelo de
`Cambio` se puede ampliar con `sliceShells`/`sliceTopLayers` sin tocar el diseño), marcas de los cambios
en el deslizador de la vista previa, torres de otros parámetros (velocidad, ventilador), texto en relieve
con la temperatura de cada bloque, y persistencia de los cambios entre sesiones.

---
Reglas de uso: un ADR por decisión; numeración correlativa; no se editan los aceptados (se reemplazan con
otro ADR).
