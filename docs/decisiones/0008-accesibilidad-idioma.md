# 0008. Accesibilidad (lectores de pantalla, contraste, foco) y textos en inglés opcionales

- **Fecha:** 2026-10-19
- **Autor/a:** arquitecto
- **Base:** commit `3d1c1c7`

## Estado

Aceptado para implementar (CTO, 2026-10-19), con las decisiones de "Decisiones del CTO" (al final).

## Contexto

Laminar Móvil es una PWA estática en español rioplatense, con 4 pasos y 4 hojas (pantallas encima), sin framework y sin
backend. Dos pedidos, independientes entre sí y con una sola zona de choque (`index.html`):

1. **Accesibilidad.** Que se pueda usar con lector de pantalla, con buen contraste y con el foco siempre visible y
   ordenado.
2. **Inglés opcional.** El español sigue siendo el idioma por defecto; el inglés se elige con un selector y se
   recuerda.

### Hechos del código (por nombre, no por línea)

- `index.html` (695 líneas) tiene unos 205 textos sueltos y unos 50 atributos con texto (`aria-label`, `placeholder`,
  `alt`). `src/ui/*.js` arma otros 175 o más (listas, avisos, `alert()`, etiquetas ARIA dinámicas).
- Los números salen de `src/ui/formato.js`, que fija `es-AR`. Otros cuatro lugares llaman a `toLocaleString('es-AR')`
  directamente: `ui/torres.js`, `ui/avanzado.js`, `ui/impresoras.js` y `perfiles/generico.js`.
- Los nombres y las descripciones de calidades y materiales viven en `src/perfiles/materiales.json`,
  `opciones.json` y `generico.js`. Los mensajes de error del motor son `throw new Error('…')` en español
  (`src/motor/*`, unos 40).
- `<html lang="es-AR">` es fijo. La preferencia de usuario se guarda en IndexedDB (`almacen.guardarAjuste`).
- `navegacion.js` maneja pasos y hojas con el atributo `hidden` y el historial; no mueve el foco (salvo
  `irAPaso1`, que llama a `enfocarPaso1`).
- Reglas vigentes: ADR 0001 (módulos de `src/ui/` < 300 líneas, funciones < 40, nada toca el DOM al importarse, grafo
  acíclico verificado por `npm run test:contratos`), `test:chunks` (chunk principal < 100 kB; hoy pesa 71,2 kB) y que
  cada área de `test:app` declare Precondición y Deja.

### Auditoría de accesibilidad (con evidencia)

Se corrió `dist/` (build de la base) servido con `vite preview`, en Chromium como Pixel 7, con **axe-core 4.14.0**
(reglas WCAG 2.0/2.1/2.2 A y AA más buenas prácticas), más comprobaciones a mano que axe no cubre. Para repetirla:

```
npm run build
AXE_PATH=/ruta/a/node_modules/axe-core/axe.min.js node scripts/auditar-a11y.mjs --paso4
```

`scripts/auditar-a11y.mjs` (ya borrado: lo reemplazó `scripts/probar-a11y.mjs` en A6, `npm run test:a11y`) quedaba en el repo como herramienta de QA (no está en `package.json`; axe-core **no** está
instalado en el proyecto: se propone como devDependency en la decisión abierta 4).

**Lo que dice axe** (reglas violadas por pantalla):

| Pantalla | Resultado |
|---|---|
| Paso 1 vacío; paso 1 con el cubo; paso 2 (también con los tres desplegables abiertos); hoja "Mi impresora"; todo en tema claro y oscuro | 0 |
| Hoja de impresoras | 1: `heading-order` (moderado), el primer `h3` de la lista no tiene un `h2` antes |
| Paso 4 con la vista por capas | 2: `aria-prohibited-attr` (serio, `#visorCapas`: `aria-label` en un `div` sin rol) y `color-contrast` (serio, `button[data-poner-precio]`, **2,51:1**, texto `#f08a24` sobre `#ffffff`; pide 4,5:1) |
| Paso 3 (forzado visible: es transitorio) | 1: `aria-progressbar-name` (serio, `#progreso`) |

axe da pocas violaciones porque no mide lo importante de esta app: foco, hojas, regiones vivas y contrastes de
bordes. Eso salió de las comprobaciones a mano:

| # | Hallazgo | Evidencia | WCAG | Gravedad | Tarea |
|---|---|---|---|---|---|
| H1 | **Las hojas no son modales.** Sin `role="dialog"`, sin `aria-modal`, sin `inert` en el fondo; Escape no las cierra | En la hoja de impresoras, 14 Tab seguidos: **7 veces el foco salió** hacia controles del fondo (`INPUT`, `precioRollo`, `SUMMARY`). `#main.inert` y `footer.inert` son `false`; Escape no cierra "Mi impresora". El lector de pantalla recorre también el paso de atrás | 2.4.3, 4.1.2 | Alta | A2 |
| H2 | **El foco se pierde al cambiar de pantalla.** Al abrir una hoja el foco queda en el botón que ahora está tapado; al pasar de paso 1 a 2 y al abrir "Mi impresora" desde la hoja de impresoras el `activeElement` es `BODY` | Medido: tras tocar `#siguiente`, `document.activeElement` = `BODY`; igual tras `#nuevaImpresora`. Sólo `irAPaso1` enfoca algo. Nadie anuncia el paso nuevo | 2.4.3, 3.2.2 | Alta | A2 |
| H3 | **La barra de pasos no dice cuál es el actual.** Cuatro `li` con un dígito; el estado va sólo en clases (`actual`, `hecho`) y color | `aria-current` ausente en los 4 `li` en todos los pasos; `ol aria-label="Pasos"` sin texto por paso | 1.3.1, 1.4.1, 4.1.2 | Media | A2 |
| H4 | **Contraste de texto insuficiente en tema claro.** El naranja de acento se usa como color de texto | `--acento` `#f08a24` sobre `#fff`: **2,51:1** (axe). Se usa de color de texto en `.enlace` (`estilos-materiales.css`), en `#avanzado .contador.cambiado output` (`estilos-avanzado.css`) y en el botón "Poné el precio". Los números de `.pasos li` (`--suave` `#5d6673` sobre `--borde` `#d9dee5`): **4,30:1** (calculado; axe no lo marcó). En oscuro todo da ≥ 4,98:1 | 1.4.3 | Alta | A1 |
| H5 | **Contraste de componentes (bordes) insuficiente.** Los bordes de campos, botones y chips son casi invisibles | `--borde` sobre `--tarjeta`: **1,35:1** claro, **1,38:1** oscuro (pide 3:1 si el borde es lo que delimita el control). El borde `--acento` de la opción elegida sobre `--fondo`: 2,34:1 | 1.4.11 | Media | A1 |
| H6 | **No hay estilo de foco propio.** Hoy se ve el anillo del navegador; sólo `.visor-estado-boton:focus-visible` y `.campo-precio input:focus` lo redefinen. Reusar `--acento` como anillo daría 2,34:1 sobre claro | `grep outline src/estilos*.css`: 2 reglas. Ninguna regla global `:focus-visible` | 2.4.7, 2.4.11, 1.4.11 | Media | A1 |
| H7 | **Estados sin voz.** La barra de progreso del paso 3 no tiene nombre ni `aria-valuetext`; los errores `#errorLaminado`, `#errorImpresora`, `#errorLitofania` y `#errorTorre` no son `role="alert"` (sí lo son `#avisoEntran` y `#cambErrores`) | axe `aria-progressbar-name`; revisión de `index.html`. Un laminado que falla queda mudo para un lector de pantalla | 4.1.2, 4.1.3 | Alta | A3 |
| H8 | **El visor 3D no tiene alternativa textual ni de teclado.** El `canvas` no tiene nombre; el `div` contenedor lleva `aria-label` sin rol (axe lo marca en `#visorCapas`); "1 dedo: girar · 2 dedos: zoom · doble toque: centrar" es solo táctil | `#visor` y `#visorCapas`: `role` ausente, `canvas` sin nombre. Los datos del modelo ya están en texto (`#nombreModelo`, `#datosModelo`) pero no asociados al visor. Hay alternativa para girar y escalar con botones (`data-rotar`, `#escala`), no para mirar | 1.1.1, 2.1.1, 2.5.1 | Alta (texto) / Media (teclado) | A4, A5 |
| H9 | **Deslizador de capas.** `#capa` (`aria-label="Capa"`) no tiene `aria-valuetext`: el lector dice "12" sin "de 40"; `#textoCapa` ("Capa 12 de 40") no está asociado. Alto de 36 px | `input#capa` 264×36 px; `aria-valuetext` ausente | 4.1.2, 2.5.8 | Media | A4, A1 |
| H10 | **Steppers.** Los 11 `.contador` de Personalizar y Avanzado no tienen `role="group"` ni nombre de grupo (el `span` de la etiqueta queda suelto); los botones sí tienen `aria-label` ("Menos paredes") y `<output>` ya anuncia el valor (rol `status` implícito). `#copiasNum` no tiene nombre. Los de copias y de radio de zona sí tienen `group` + `aria-labelledby` | `index.html`: `div.contador` sin `role` | 1.3.1, 4.1.2 | Baja | A3 |
| H11 | **Regiones vivas incompletas.** Ya hay `status`/`aria-live` en `#visor-estado`, `#avisoPiezas`, `#avisoEntranPaso2`, `#tipoSoportesZonas`, `#avisoVista`, `#estadoEntrega`, `#bloqueoAyuda`. Faltan: `#avisoModelo` ("no entra", "modelo pesado"), `#avisoTorre`, `#cargando` ("Leyendo el modelo…") y el cambio de paso | `index.html` | 4.1.3 | Media | A3, A2 |
| H12 | **Encabezados y glifos.** `h3` sin `h2` en la hoja de impresoras; emoji en `h2` ("¡Listo! 🎉") y en botones (`⏸`, `▶`) que el lector lee por su nombre ("rostro de fiesta") | axe `heading-order`; `index.html` | 1.3.1, 2.4.6 | Baja | A3 |
| H13 | **Idioma de la página fijo.** `<html lang="es-AR">` es correcto hoy; para el inglés hay que cambiarlo, o el lector pronuncia el inglés con voz española | `index.html`; `manifest.webmanifest` (`lang` también fijo) | 3.1.1, 3.1.2 | (Parte B) | I1 |
| H14 | **Movimiento.** Tres `transition` de 0,2 a 0,3 s y el ancho de la barra de progreso, sin `prefers-reduced-motion` | `estilos.css` | 2.3.3 | Baja | A1 |
| H15 | **Objetivos de toque.** Paso 2: 31 controles de 22×22 px (los radios y casillas viven dentro de etiquetas de 48 px o más, así que el área real alcanza); `input#soloCapa` 22×22 en una etiqueta de menos de 44 px de alto | medido con `getBoundingClientRect` | 2.5.8 (24 px: cumple) | Baja | A1 |

**Lo que ya está bien** (no se toca): `lang` correcto, `viewport` sin `user-scalable=no`, botones con `aria-label` en
steppers y quitar, chips con `aria-pressed`, `ul` con nombre para las piezas, `copias` y `radio` con `group`, varias
regiones vivas (H11), `color-scheme` claro y oscuro con tokens, `visor-estado` con
`aria-live` siempre en el DOM, `focus()` explícito al quitar chips o zonas, y `popstate` para el botón atrás.

### Revisión a mano de los cuatro componentes pedidos

- **Visor (canvas):** H8. El texto de alternativa se arma con datos que ya existen (`Pieza.nombre`, `Pieza.tamano`,
  `copias`, `estado.entra`); no hace falta leer píxeles.
- **Deslizador de capas:** H9. Un `input[type=range]` nativo es bueno (teclado y lector gratis); sólo falta el
  `aria-valuetext` y el alto de toque.
- **Steppers:** H10. Bien resueltos a medias; falta el grupo con nombre en los 11 `.contador`.
- **Chips:** bien (`aria-pressed`, `aria-label` en "×"); sin hallazgos.

## Decisión

Son dos pistas independientes: **Parte A** (accesibilidad, tareas `A1…A6`) y **Parte B** (inglés, tareas `I1…I14`).
Se pueden priorizar por separado. La Parte A no necesita nada de la B. La B necesita tres cosas de la A en
archivos compartidos (ver "Plan de tareas").

Objetivo de conformidad: **WCAG 2.2 AA**, con una excepción declarada: 2.5.1 (gestos multitáctiles) se cumple en el
visor con los botones de giro y escala y la descripción textual; el movimiento libre de cámara con teclado queda como
mejora opcional (A5).

## Parte A. Accesibilidad

### A.1 Colores y foco (H4, H5, H6, H14, H15) — tarea A1

Vamos a agregar `src/estilos-a11y.css`, cargado **después** de las demás hojas de estilo. Sobrescribe por orden (misma
especificidad), así que no se toca `estilos.css`. Contiene:

- Tokens nuevos, con valores de tema claro y oscuro (guardados con `prefers-color-scheme`, igual que los demás):

  | Token | Claro | Oscuro | Uso | Ratio medido |
  |---|---|---|---|---|
  | `--acento-enlace` | `#a85a00` | `#f08a24` (el actual) | color de **texto** naranja (`.enlace`, "Poné el precio", número cambiado en Avanzado) | 5,09:1 sobre blanco, 4,75:1 sobre `--fondo`; oscuro 6,22:1 |
  | `--borde-control` | `#7d8794` | `#6b7684` | borde de campos, botones, chips, `.boton-capa`, `.opcion` | 3,64:1 sobre blanco, 3,40:1 sobre `--fondo`; oscuro 3,38:1 sobre `--tarjeta` |
  | `--foco` | `#0b57d0` | `#8ab4f8` | anillo de foco | claro 6,39:1 sobre blanco y 5,96:1 sobre `--fondo`; oscuro 7,41:1 y 8,52:1 |

- `:focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; }` global, y `.pasos li` con el texto en
  `--texto` en vez de `--suave` (hoy 4,30:1 en claro; `--texto` sobre `--borde` da más de 11:1).
- `.fila-capa input[type='range'] { min-height: 44px }`, y `.tilde-capa` con `min-height: 44px`.
- `@media (prefers-reduced-motion: reduce)` que anula `transition` y `animation`.
- Tres secciones reservadas y vacías, `/* A3 */`, `/* A4 */`, `/* I3 */`, para que las tareas siguientes no choquen
  al editar el mismo archivo.

El borde del chip o de la opción elegida pasa a `--foco` además del relleno (el estado no depende sólo del color).

### A.2 Pasos, foco y hojas (H1, H2, H3, H11) — tarea A2

Vamos a modificar `navegacion.js` (hoy 138 líneas; queda por debajo de 220) y los `li` y las hojas de `index.html`:

- **Paso actual.** `mostrar` pone `aria-current="step"` en el `li` actual y lo saca de los demás. Cada `li` lleva
  texto para lectores: `<span class="solo-lectores">Paso </span>1<span class="solo-lectores"> de 4</span>` (clase que
  ya existe en `estilos.css`).
- **Foco al cambiar de paso.** Cuando el paso realmente cambia (no en el primer `mostrar`), el foco va al primer
  elemento visible con `[data-foco]` o, si no hay, al primer `h2` de la `.pantalla` del paso, con `tabindex="-1"` y
  `focus({ preventScroll: true })`. `enfocarPaso1` pasa a ser un caso de esta función (`irAPaso1` sigue igual para
  quien lo llama).
- **Hojas modales.** Cada `section.hoja` pasa a `role="dialog" aria-modal="true" aria-labelledby="<id del h1>"`. Al
  abrir una hoja: `inert = true` en `header.barra` (el de arriba), `#main` y `footer.acciones`; se guarda el
  `document.activeElement` como disparador y el foco va al `h1` de la hoja (`tabindex="-1"`) o, si la hoja tiene un
  campo de búsqueda, a ese campo. Al cerrar la última hoja: se sacan los `inert` y el foco vuelve al disparador (si
  sigue visible) o al encabezado del paso. Escape cierra la hoja de arriba (`history.back()`, igual que el botón
  "atrás" y que `[data-cerrar]`).
- **Sin trampa de foco propia.** `inert` saca el fondo del orden de tabulación y del árbol de accesibilidad. Es lo
  mínimo que hay que mantener y lo que menos puede fallar. Soporte: Chrome 102, Safari 15.5, Firefox 112 (PWA móvil
  actual). Alternativa descartada: `<dialog>` con `showModal()` (daría trampa y Escape gratis) por el costo de
  reescribir `mostrar`, los estilos de `.hoja` y su relación con `hidden` y el historial; se puede revisar en un ADR
  futuro.
- **Anuncio del paso.** El foco en el encabezado ya lo anuncia; no se agrega una región viva extra.
- **Fondo inert con la hoja de red.** Con la hoja de red abierta `footer.acciones` también queda `inert`: no se puede cancelar un envío en curso con la hoja encima (se cierra la hoja primero). Aceptado en la revisión de A2.

Las funciones nuevas son privadas; el contrato de `navegacion.js` no cambia (siete exports, mismas aridades).

### A.3 Regiones vivas, nombres y encabezados (H7, H10, H11, H12) — tarea A3

- `#progreso`: `aria-labelledby="tituloLaminando"`; `ponerProgreso` (paso 3) agrega `aria-valuetext`
  ("42 %, Cortando capas").
- `role="alert"` en `#errorLaminado`, `#errorImpresora`, `#errorLitofania`, `#errorTorre`. `role="status"` en
  `#avisoModelo`, `#avisoTorre` y `#cargando`.
- Los 11 `div.contador`: `role="group"` y `aria-labelledby` apuntando al `span` de su etiqueta (se le pone un
  `id`). `#copiasNum` hereda el nombre del grupo (ya tiene `for`).
- Emoji y glifos: `<span aria-hidden="true">🎉</span>` en el título del paso 4; `⏸` y `▶` envueltos con `aria-hidden`
  (los botones ya tienen texto o `aria-label`).
- `impresoras.js`: el título de grupo de la lista pasa de `h3` a `h2` (el estilo `.contenido-hoja h3` se copia a
  `.contenido-hoja h2` en la sección `/* A3 */` de `estilos-a11y.css`).

### A.4 Visor y deslizador (H8, H9) — tarea A4

- `#visor` y `#visorCapas`: `role="group"` (el `aria-label` deja de ser inválido) y `aria-describedby` hacia un
  `<p class="solo-lectores" id="descripcionVisor">`. El `canvas` queda `aria-hidden="true"` (lo crea three en el
  chunk del visor; el dev de A4 verifica si se marca en `visor.js` o en `visor-carga.js`; esta auditoría no leyó
  ninguno de los dos).
- Módulo puro nuevo `src/ui/visor-descripcion.js`, sin DOM, con el mismo estilo que `aviso-vista.js`:

  ```js
  /**
   * @typedef {object} DatosVisor
   * @property {{ nombre: string, tamano: {x:number, y:number, z:number}|null, copias: number }[]} piezas
   * @property {boolean} entra  false si alguna copia no entra en la cama
   */
  /**
   * Texto que describe lo que se ve en el visor: cada pieza con su medida y copias, y si entran.
   * @param {DatosVisor} datos
   * @returns {string} '' si no hay piezas
   */
  export function textoDescripcionVisor(datos) {}
  ```

  Con 0 piezas devuelve "La cama está vacía." y no '' (el nodo de descripción nunca queda sin texto; aceptado por el CTO).
  Lo llama `paso1-modelo.js` (en cada `reacomodar` y `aplicar`) y escribe en `#descripcionVisor`. Para el visor del
  paso 4: `aria-describedby="textoCapa resumen"` (ya existen).
- Deslizador: `vista-capas.js` pone `aria-valuetext="Capa 12 de 40, 3,36 mm"` en cada cambio (con `, con pausa` si la
  capa tiene una pausa; el ⏸ visible es `aria-hidden`). `#capa` no lleva `aria-describedby="textoCapa"` (se leería dos
  veces). `#textoCapa` sigue sin ser región viva (anunciaría cada paso del arrastre). Los glifos ▶ ❚❚ ⏸ ✕ de
  `vista-capas` y `pausas-ui` van en `<span aria-hidden="true">`.
- El texto de ayuda de gestos se mantiene, con `aria-hidden="true"` (es información visual para quien ve) y se suma
  un `<p class="solo-lectores">` con la alternativa: "Para girar y escalar usá los botones de debajo".

### A.5 Teclado en el visor (opcional, v1.1) — tarea A5

`src/ui/visor-teclado.js` (puro respecto de three: recibe funciones) agrega al contenedor `tabindex="0"`
`aria-keyshortcuts` y atiende flechas (girar 15°), `+`/`-` (zoom) y `0` (centrar). Lo importa `visor.js` y lo usan
los dos visores. **No se hace en la v1**: la alternativa por botones de giro y escala, más la descripción textual, es
suficiente para AA. Está acá para que el contrato exista si el CTO lo prioriza (decisión abierta 5).

```js
/**
 * @typedef {object} AccionesVisor
 * @property {(dx: number, dy: number) => void} girar  radianes
 * @property {(factor: number) => void} zoom  factor > 1 acerca
 * @property {() => void} centrar
 */
/**
 * Atiende el teclado en el contenedor del visor. No toca el DOM hasta que se lo llama.
 * @param {HTMLElement} contenedor
 * @param {AccionesVisor} acciones
 * @returns {() => void} función que quita los listeners
 */
export function conectarTecladoVisor(contenedor, acciones) {}
```

### A.6 Prueba de accesibilidad con axe (QA) — tarea A6

`scripts/probar-a11y.mjs` (a partir de `scripts/auditar-a11y.mjs`): corre las mismas etapas y **falla** con cualquier
violación nueva de axe; con axe como devDependency (`axe-core` fijado en 4.14.0, no `^`), `npm run test:a11y` y una
línea en el CI. Si el CTO no acepta la dependencia, la parte "a mano" ya queda cubierta por `scripts/app/accesibilidad.mjs`
(sección Pruebas) y A6 se descarta.

## Parte B. Inglés opcional

### B.1 Diseño general

- **Un solo `index.html`.** El español queda en el HTML (primer pintado sin JS, sin parpadeo, SEO y no-JS). Cada texto
  traducible lleva una clave (`data-t`, `data-t-html`, `data-t-attr`). Al arrancar en inglés y al cambiar de idioma,
  `traducirDom` reemplaza el texto con el del diccionario. No hay un segundo HTML ni un paso de compilación.
- **El español completo vive también en `es.json`.** Es la referencia de quien traduce y lo que se usa al volver de
  inglés a español en caliente. Para que no se desincronice de `index.html`, una prueba Node verifica que cada
  `data-t` tiene en `es` exactamente el mismo texto que el HTML (ver Pruebas).
- **Los textos de JavaScript** pasan a `t('clave', valores)`. La migración es por módulo y se puede hacer de a poco:
  un módulo migrado no se mezcla con otro sin migrar (cada módulo es todo o nada).
- **Cuándo se carga.** Los diccionarios no entran al chunk principal: `src/textos/es.js` y `en.js` se cargan con
  `import()` dinámico. `iniciarIdioma()` carga el que corresponde **en paralelo** con `cargarPreferencias()` en
  `main.js`; la app no dibuja nada hasta que llegan los dos (el `await` ya está). El idioma que no se usa no se baja.
  Los chunks entran automáticamente en la lista de `sw.js` (offline).
- **Tamaño esperado.** Hoy: principal 71,2 kB. Se suma ~5 kB (`traducir.js`, `idioma.js`, `idioma-dom.js`) y se
  **resta** cada cadena que sale de los módulos (~10 kB de literales en `src/ui/`). El diccionario es de ~20 kB sin
  comprimir por idioma (205 textos de HTML + 50 atributos + 300 cadenas de JS), fuera del principal. El balance del
  principal tiende a bajar; `test:chunks` lo vigila.

### B.2 Elección del idioma

1. Preferencia guardada: `almacen.leerAjuste('idioma')` devuelve `'es'` o `'en'` (`null` si nunca eligió).
   Se guarda **sólo cuando el usuario toca el selector** (clave aparte `idioma` de `ajustes`, no dentro de
   `preferencias`: no pasa por `validar` ni necesita migración).
2. Si no hay preferencia: el primer idioma de `navigator.languages` cuyo código base sea `es` o `en`. `['fr', 'en-GB']`
   da `en`; `['pt-BR']` da `es`; vacío da `es`.
3. `document.documentElement.lang` se actualiza en cada cambio: `es-AR` o `en-US` (la tabla `LOCALES`; es también el
   locale de `Intl`).
4. Selector visible: botón `#idioma` en la barra superior, con el nombre del **otro** idioma escrito en ese idioma
   ("English" cuando se usa español; "Español" cuando se usa inglés) y su `lang`. Mínimo 44×44 px. Cambia en caliente.
   Un `<p id="estadoIdioma" class="solo-lectores" role="status">` anuncia el resultado.
5. El selector nace con `hidden` y se muestra recién en la última tarea (I14), cuando están migradas todas las áreas
   de v1. Así nadie ve una app a medio traducir.

### B.3 Formato del diccionario

Un archivo JSON plano por **área** y por idioma: `src/textos/<idioma>/<area>.json`, con las claves de esa área y nada
más. El motivo es práctico: así las tareas en paralelo no tocan el mismo archivo.

- Áreas: `app`, `barra`, `comun`, `idioma`, `formato`, `paso1`, `piezas`, `paso2`, `perfiles`, `paso3`, `paso4`,
  `hojas`, `a11y`.
- Clave: `^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$` (ASCII), y su primer segmento es el nombre del archivo. Ejemplo:
  `paso2.entran.error` en `paso2.json`.
- Valor: `string`, o un objeto de plural `{ "one": "…", "other": "…" }`. Variables `{nombre}` (letras y números).
  Sin `{` ni `}` literales: no hay escape, porque no hace falta (el G-code no se traduce).
- Se permiten sólo `<b>`, `<small>` y `<br>` en los valores usados con `data-t-html` o con `innerHTML`; cualquier otro `<` o
  `&` falla la prueba. Las variables que vienen del usuario (nombres de archivo) las escapa quien llama, con
  `escapar` de siempre: `t()` no escapa.

```json
// src/textos/es/paso1.json
{
    "paso1.sinModelo.titulo": "Subí tu modelo",
    "paso1.sinModelo.ayuda": "Elegí un archivo <b>STL, OBJ o 3MF</b> del celu. Todo se procesa acá, no se sube a ningún lado.",
    "paso1.piezas.cantidad": { "one": "{n} pieza", "other": "{n} piezas" }
}
// src/textos/en/paso1.json
{
    "paso1.sinModelo.titulo": "Upload your model",
    "paso1.sinModelo.ayuda": "Choose an <b>STL, OBJ or 3MF</b> file from your phone. Everything is processed here; nothing is uploaded.",
    "paso1.piezas.cantidad": { "one": "{n} part", "other": "{n} parts" }
}
```

(El bloque de arriba lleva comentarios sólo para este documento; JSON real no.) Tono del inglés: neutro y
cercano ("phone", no "mobile device"); sin argentinismos ni regionalismos.

`src/textos/es.js` y `src/textos/en.js` **no se editan nunca**: juntan los archivos de su carpeta con
`import.meta.glob('./es/*.json', { eager: true, import: 'default' })` y exportan un único objeto. Agregar un área es
agregar dos archivos.

### B.4 Cómo se traduce `index.html`

| Atributo | Efecto | Ejemplo |
|---|---|---|
| `data-t="clave"` | `textContent` del elemento | `<h2 data-t="paso1.sinModelo.titulo">Subí tu modelo</h2>` |
| `data-t-html="clave"` | `innerHTML`, sólo `<b>`, `<small>`, `<br>` | `<p data-t-html="paso1.sinModelo.ayuda">Elegí un archivo <b>STL…</b>…</p>` |
| `data-t-attr="atributo:clave;otro:clave2"` | atributos (`aria-label`, `placeholder`, `alt`, `content`, `title`) | `<input type="search" placeholder="Buscar…" data-t-attr="placeholder:hojas.impresoras.buscar" />` |

Reglas:

1. **Sin variables en el HTML.** Los textos que llevan valores los arma JavaScript con `t()`.
2. **Un elemento con hijos no lleva `data-t`.** Si mezcla texto y controles
   (`<label>Nombre <input …></label>`), el texto se envuelve en un `<span data-t="…">`. Es la única modificación
   estructural y la revisa `test:app` (los estilos que usan `label > input` se verifican en I5, I6 e I7).
3. `<title data-t="app.titulo">` y `<meta name="description" data-t-attr="content:app.descripcion">`.
4. `traducirDom` aplica todo al arrancar **sólo si el idioma no es español** (el HTML ya está en español) y siempre
   que el idioma cambia.

### B.5 Migrar strings de JavaScript

- `import { t } from './idioma.js'`; los literales pasan a `t('area.clave', { n })`. Las cantidades usan `n` como
  variable de plural.
- **Claves siempre literales.** El escáner de pruebas busca `t('…')`, `existe('…')` y `marcar('…')`. Una clave
  dinámica (por ejemplo, según un id) se resuelve con una tabla y `marcar`:
  `const ETAPAS = { leyendo: marcar('paso3.etapa.leyendo'), … }` y después `t(ETAPAS[id])`.
- **`iniciarX` no llama a `t()`** (el diccionario todavía no llegó). Sólo `dibujarX` y los handlers.
- **Re-dibujo.** Cada módulo que arma texto con `t()` en listas o tarjetas registra en su `iniciarX`
  `alCambiarIdioma(redibujar)`. Los mensajes transitorios (avisos, errores en pantalla) quedan en el idioma en que se
  mostraron hasta el próximo evento: se acepta.
- **Números y unidades.** `formato.js` usa `localeActual()`, y sus textos pasan por `t()` (`formato.triangulos.millones`,
  etc.). Los tres `toLocaleString('es-AR', …)` sueltos de `src/ui/` pasan a `numero()` de `formato.js`; el de
  `perfiles/generico.js` (que arma la descripción de cada calidad) lo reemplaza la tarea I13, porque `perfiles/` no
  puede importar de `ui/`: la descripción sale del diccionario con la variable `{capa}` ya formateada por la UI. En
  inglés, los pesos se muestran `ARS 1,234`.
- **Perfiles.** Calidades, materiales, patrones y adhesiones: los `.json` de `src/perfiles/` **no se tocan**; la UI
  busca `existe('perfiles.material.<id>.nombre')` y, si está, la usa; si no, el texto del perfil. Ver "Fuera de la v1".

### B.6 Contratos exactos

#### `src/textos/traducir.js` — puro, sin imports, ~90 líneas

```js
/** @typedef {'es' | 'en'} Idioma */
/** @typedef {Record<string, string | { one?: string, other: string }>} Diccionario */
/** @typedef {Record<string, string | number>} Valores */

/** Idiomas disponibles, el primero es el base. @type {readonly Idioma[]} */
export const IDIOMAS = ['es', 'en'];
/** Idioma del HTML y de los respaldos. @type {Idioma} */
export const IDIOMA_BASE = 'es';
/** Locale de Intl y del atributo `lang` de <html>. @type {Record<Idioma, string>} */
export const LOCALES = { es: 'es-AR', en: 'en-US' };

/**
 * Reemplaza `{nombre}` por `valores.nombre`. Una variable sin valor queda literal ("{x}") para que se note.
 * @param {string} plantilla
 * @param {Valores | undefined} valores
 * @returns {string}
 */
export function interpolar(plantilla, valores) {}

/**
 * Elige la forma de plural con Intl.PluralRules; si la entrada es un texto, la devuelve tal cual.
 * Categorías que no existen en la entrada caen en `other`.
 * @param {string | { one?: string, other: string }} entrada
 * @param {number | undefined} n  `valores.n`; sin número se usa `other`
 * @param {Idioma} idioma
 * @returns {string}
 */
export function elegirForma(entrada, n, idioma) {}

/**
 * Traduce una clave: busca en `diccionario`, luego en `respaldo`; si no está en ninguno devuelve la clave.
 * No escapa nada.
 * @param {Diccionario} diccionario
 * @param {Diccionario} respaldo  puede ser `{}`
 * @param {string} clave
 * @param {Valores | undefined} valores
 * @param {Idioma} idioma
 * @returns {string}
 */
export function traducir(diccionario, respaldo, clave, valores, idioma) {}

/**
 * Idioma a usar: la preferencia guardada si es válida; si no, el primero de `navegador` cuyo código base sea
 * 'es' o 'en'; si no hay ninguno, el idioma base.
 * @param {string | null | undefined} guardado  'es' | 'en' | cualquier otra cosa (se ignora)
 * @param {readonly string[]} navegador  `navigator.languages`
 * @returns {Idioma}
 */
export function elegirIdioma(guardado, navegador) {}

/**
 * Nombres de las variables `{x}` de un texto, sin repetir y en orden de aparición (para las pruebas).
 * @param {string} texto
 * @returns {string[]}
 */
export function variablesDe(texto) {}
```

`fn.length` para el contrato: `interpolar` 2, `elegirForma` 3, `traducir` 5, `elegirIdioma` 2, `variablesDe` 1.

#### `src/textos/es.js` y `src/textos/en.js` — ~6 líneas cada uno

```js
// Junta src/textos/es/*.json en un solo objeto (un chunk por idioma). No se edita: agregar un área = agregar su .json.
const partes = import.meta.glob('./es/*.json', { eager: true, import: 'default' });
/** @type {import('./traducir.js').Diccionario} */
export default Object.assign({}, ...Object.values(partes));
```

Contrato: un único export `default` (valor).

#### `src/ui/idioma.js` — hoja de `src/ui/`, ~120 líneas

Guarda el idioma activo y el diccionario en variables de módulo. Importarlo no toca `document`, `navigator` ni
`indexedDB`.

```js
/**
 * Traduce una clave con el idioma actual. Si la clave no existe devuelve la clave (y en desarrollo avisa en la
 * consola). Antes de `iniciarIdioma` devuelve siempre la clave. No escapa HTML.
 * @param {string} clave  literal ('area.concepto'); para claves dinámicas ver `marcar`
 * @param {import('../textos/traducir.js').Valores} [valores]  `n` elige el plural
 * @returns {string}
 */
export function t(clave, valores) {}

/**
 * Marca una clave para el escáner de pruebas y la devuelve igual (para tablas { id: clave }).
 * @param {string} clave
 * @returns {string}
 */
export function marcar(clave) {}

/**
 * ¿Existe la clave en el idioma actual? (para los textos de perfiles, que tienen un respaldo en el .json).
 * @param {string} clave
 * @returns {boolean}
 */
export function existe(clave) {}

/** @returns {import('../textos/traducir.js').Idioma} idioma activo ('es' por defecto antes de iniciar) */
export function idiomaActual() {}

/** @returns {string} locale para Intl y para <html lang>: 'es-AR' o 'en-US' */
export function localeActual() {}

/**
 * Elige el idioma (preferencia guardada, si no `navigator.languages`), carga su diccionario con import() y pone
 * <html lang>. Llamar una vez, en paralelo con `cargarPreferencias`. Nunca lanza: si falla la carga queda en 'es'
 * sin diccionario (el HTML ya está en español).
 * @param {{ navegador?: readonly string[] }} [opciones]  `navegador` reemplaza `navigator.languages` (pruebas)
 * @returns {Promise<import('../textos/traducir.js').Idioma>}
 */
export async function iniciarIdioma(opciones) {}

/**
 * Cambia el idioma: carga el diccionario, guarda la preferencia, pone <html lang> y avisa a los suscriptores
 * (después de haber cambiado todo). Si la carga falla no cambia nada y lanza.
 * @param {import('../textos/traducir.js').Idioma} idioma
 * @returns {Promise<void>}
 */
export async function cambiarIdioma(idioma) {}

/**
 * Suscribe `fn` a los cambios de idioma. Cada módulo la usa en su `iniciarX` para redibujar sus textos.
 * @param {(idioma: import('../textos/traducir.js').Idioma) => void} fn
 * @returns {void}
 */
export function alCambiarIdioma(fn) {}

/**
 * Instala diccionarios sin tocar almacen ni DOM (pruebas en Node).
 * @param {import('../textos/traducir.js').Idioma} idioma
 * @param {import('../textos/traducir.js').Diccionario} diccionario
 * @param {import('../textos/traducir.js').Diccionario} respaldo
 * @returns {void}
 */
export function ponerDiccionarios(idioma, diccionario, respaldo) {}
```

Aridades: `t` 2, `marcar` 1, `existe` 1, `idiomaActual` 0, `localeActual` 0, `iniciarIdioma` 1, `cambiarIdioma` 1,
`alCambiarIdioma` 1, `ponerDiccionarios` 3.

En producción no se carga respaldo (las pruebas garantizan que `es` y `en` tienen las mismas claves). En
desarrollo (`import.meta.env.DEV`) `t` avisa una vez por clave inexistente.

#### `src/ui/idioma-dom.js` — ~90 líneas

```js
/**
 * Aplica el idioma actual al DOM bajo `raiz`: [data-t] (textContent), [data-t-html] (innerHTML) y
 * [data-t-attr="atributo:clave;…"]. Una clave que no existe deja el texto como está.
 * @param {ParentNode} raiz  `document` o un contenedor
 * @returns {void}
 */
export function traducirDom(raiz) {}

/**
 * Cablea `#idioma` (alterna es/en con `cambiarIdioma`, pone su `lang` y su texto, y anuncia en `#estadoIdioma`),
 * se suscribe a `alCambiarIdioma` para volver a llamar a `traducirDom(document)` y, si el idioma actual no es
 * español, lo aplica ya. Llamar una vez, después de `iniciarIdioma`.
 * @returns {void}
 */
export function iniciarIdiomaDom() {}
```

Aridades: `traducirDom` 1, `iniciarIdiomaDom` 0.

#### Cambios en archivos existentes (no son módulos nuevos)

- `main.js`: `await Promise.all([cargarPreferencias(), iniciarIdioma()]);` + `iniciarIdiomaDom();` antes de
  `dibujarOpciones()`. Queda por debajo de 80 líneas.
- `formato.js`: importa `t` y `localeActual`; `num` usa `localeActual()`. Mismos exports y aridades.
- `index.html`: ver B.4 y A.2.

### B.7 Aristas de imports permitidas (para `scripts/lib/contratos-ui.js`)

```js
'textos/traducir': { exports: { IDIOMAS: 'valor', IDIOMA_BASE: 'valor', LOCALES: 'valor', interpolar: 2,
                                elegirForma: 3, traducir: 5, elegirIdioma: 2, variablesDe: 1 }, importa: [] },
'textos/es': { exports: { default: 'valor' }, importa: [] },
'textos/en': { exports: { default: 'valor' }, importa: [] },
'ui/idioma': {
    exports: { t: 2, marcar: 1, existe: 1, idiomaActual: 0, localeActual: 0, iniciarIdioma: 1,
               cambiarIdioma: 1, alCambiarIdioma: 1, ponerDiccionarios: 3 },
    importa: ['almacen', 'textos/traducir', 'textos/es', 'textos/en'],   // es y en: import() dinámico
},
'ui/idioma-dom': { exports: { traducirDom: 1, iniciarIdiomaDom: 0 }, importa: ['ui/idioma', 'ui/util-dom'] },
'ui/formato': {
    exports: { numero: 1, milimetros: 1, triangulos: 1, duracion: 1, gramos: 1, filamento: 1, pesos: 1, bytes: 1 },
    importa: ['ui/idioma'],
},
'ui/visor-descripcion': { exports: { textoDescripcionVisor: 1 }, importa: ['ui/formato', 'ui/idioma'] },
// A5 (opcional): 'ui/visor-teclado': { exports: { conectarTecladoVisor: 2 }, importa: [] },
```

Más dos reglas de grafo:

1. **`ui/idioma` es un destino libre** para cualquier módulo de `src/ui/`. `probar-contratos.mjs` suma una constante
   `LIBRES = ['ui/idioma']` que se descuenta de las "aristas sobrantes" (una línea). Sin esto, cada tarea de
   migración tendría que editar el contrato de su módulo en el mismo archivo. Los ciclos se siguen detectando: `ui/idioma`
   no puede importar nada de `src/ui/` (por eso `formato` lo importa a él y no al revés).
2. `ui/idioma-dom` sólo lo importa `main.js`.

`nivel` en el grafo: `ui/idioma` es nivel 0 (hoja, sólo `almacen` y `textos/*`); `ui/idioma-dom` nivel 1;
`formato` pasa de hoja pura a nivel 1 (importa `idioma`).

### B.8 Qué queda fuera de la v1

- **Nombres de impresoras** y las descripciones y avisos de los perfiles importados de Kiri
  (`src/perfiles/impresoras/**`). Son nombres propios o texto generado.
- **G-code generado**: comentarios, macros y plantillas Marlin/Klipper.
- **Mensajes de error del motor y de los workers** (`throw new Error('…')` en `src/motor/*`, `formatos*.js`,
  `perfiles/*`). Se muestran en español dentro de un contenedor con `lang="es-AR"` (así el lector los pronuncia bien).
  La v1.1 los cambia por `ErrorApp { codigo, valores }` y la UI traduce `t('error.' + codigo)`.
- `manifest.webmanifest` (`name`, `short_name`, `lang`), `prueba-motor.html`, `README`, `LEEME.md`.
- El texto de usuario (nombres de archivo y de impresoras propias) por supuesto no se traduce.
- Formato de fechas: la app no muestra fechas.
- Un tercer idioma: el diseño lo admite (agregar una carpeta, un código a `IDIOMAS` y una fila a `LOCALES`), pero no
  se prueba.

## Pruebas

### Node: `t` y diccionarios — `scripts/probar-textos.mjs` (`npm run test:textos`)

Importa `src/textos/traducir.js` directo (sin Vite) y lee los `.json` con `fs`. Se agrega al CI.

1. **`t`** (puro): interpolación (`{n}` numérico, variable ausente queda `{x}`, variable repetida), plural
   (`es`: 1 → `one`, 0 y 2 → `other`; `en` igual; sin `n` → `other`), fallback a respaldo y a la clave,
   `elegirIdioma` (matriz: guardado válido gana; `['fr','en-GB']` → `en`; `['pt-BR']` → `es`; `[]` → `es`; guardado
   inválido se ignora), `variablesDe`.
2. **Misma estructura entre `es` y `en`**: mismas áreas (archivos), mismas claves, mismas variables `{x}` por clave,
   mismas formas de plural y el mismo tipo (texto o plural). Mensaje: `falta en en: paso2.entran.error`.
3. **Forma de las claves**: regex de B.3 y prefijo igual al nombre del archivo. Sin claves repetidas entre archivos.
4. **Markup permitido**: ningún valor contiene `<` ni `&` salvo `<b>`, `</b>`, `<small>`, `</small>`, `<br>`.
5. **Claves usadas contra definidas.** Un escáner recorre `src/**/*.js` y `index.html` y junta las claves de
   `t('…')`, `existe('…')`, `marcar('…')`, `data-t`, `data-t-html` y `data-t-attr`. Falla con: (a) *usada pero no
   definida*; (b) *definida pero no usada* (mensaje con la lista); (c) clave dinámica (`t(\`a.${x}\`)` o `t(variable)`:
   "usá marcar()"). Hay una sola excepción por prefijo en el propio test (`CLAVES_RESERVADAS`, vacía al empezar).
6. **El HTML dice lo mismo que `es.json`**: para cada `data-t`, `data-t-html` y `data-t-attr` de `index.html`, el
   texto (espacios colapsados) es igual al valor de `es`. Detecta que alguien cambió el HTML y no el diccionario.
7. **Sin variables en las claves del HTML** y todo `data-t` en un elemento sin hijos elemento.
8. **Módulos migrados sin español suelto.** La lista `MIGRADOS` (en el test) enumera los archivos de `src/ui/` ya
   terminados; en esos archivos, ningún literal entre comillas fuera de comentarios contiene `áéíóúñ¿¡` ni palabras
   vacías del español (`el`, `la`, `de`, `que`, `para`, `con`, `no`) salvo con `// t-ignorar` en la línea. Cada tarea
   de migración agrega su módulo a `MIGRADOS` en el mismo commit.
9. **Inglés sin copiar el español.** Aviso (no falla): valores de `en` idénticos a los de `es` y de más de una palabra.

### Node: `test:contratos` y `test:chunks`

- `scripts/lib/contratos-ui.js`: entradas de B.7 (cada tarea agrega la de su módulo; con `CONTRATOS_ESTRICTO=1` un
  contrato sin archivo falla, por eso no se adelantan).
- `scripts/probar-contratos.mjs`: constante `LIBRES`.
- `scripts/verificar-chunks.mjs`: nueva regla `[textos-fuera-sw]` (todo chunk con `src/textos` está en `ARCHIVOS` de
  `sw.js`) y `[textos-en-clausura]` (los diccionarios no entran en la carga inicial: la clausura estática sigue
  < 400 kB y el principal < 100 kB).

### Navegador: `scripts/app/accesibilidad.mjs` y `scripts/app/idioma.mjs`

Siguen la convención de `scripts/app/` (cabecera con Flujo, **Precondición** y **Deja**; reciben `ctx`; usan
`ctx.ok`). La tarea A1 crea `accesibilidad.mjs` con las cuatro funciones vacías (y su registro en
`scripts/probar-app.mjs`) y la I2 crea `idioma.mjs` con las suyas, para que cada tarea siguiente llene sólo la suya.

`scripts/app/accesibilidad.mjs`

| Función | Posición en `AREAS` | Precondición | Deja | Verifica |
|---|---|---|---|---|
| `probarContraste` (A1) | después de `probarConfig`, antes de `volverAlPaso1` (único punto con el paso 2 visible y el cubo cargado) | paso 2 visible, cubo cargado | igual | calcula con `getComputedStyle` y `scripts/lib/contraste.mjs` (puro): `.enlace` y "Poné el precio" ≥ 4,5:1; `.pasos li` ≥ 4,5:1; borde de `.boton` ≥ 3:1 contra su fondo; `:focus-visible` tiene `outline-width` ≥ 2 px y color con ≥ 3:1; en claro y en oscuro (`page.emulateMedia({ colorScheme })`), y `prefers-reduced-motion` anula `transition` |
| `probarAccesibilidadPasos` (A2) | después de `probarConfig` | paso 2 visible | paso 2 visible, ninguna hoja abierta, `main` sin `inert` | `aria-current="step"` sólo en el `li` del paso (1→2→1); tras `#siguiente` y tras `goBack` el foco está en un elemento del paso nuevo; hoja de impresoras: `role="dialog"`, `aria-modal`, `#main` y `footer` con `inert`; 20 Tab seguidos y el foco nunca sale de la hoja; Escape cierra y el foco vuelve a `#cambiarImpresora`; "Mi impresora" desde la hoja: foco dentro de la hoja nueva |
| `probarAccesibilidadRegiones` (A3) | después de `probarCancelar` | paso 2 visible | paso 2 visible | toca Laminar, en el paso 3 `#progreso` tiene nombre y `aria-valuetext`, cancela y vuelve al paso 2; `#errorLaminado`, `#errorImpresora`, `#errorLitofania`, `#errorTorre` tienen `role="alert"`; los 11 `.contador` tienen `role="group"` con nombre; la lista de la hoja de impresoras no salta de `h1` a `h3` |
| `probarAccesibilidadVisor` (A4) | después de `probarVistaCapas` | paso 4 con resultado | igual | `#descripcionVisor` nombra la pieza y su medida en mm; `#visorCapas` tiene `role="group"` y `aria-describedby` válido; `#capa` tiene `aria-valuetext` "Capa N de M, Z mm" que cambia al mover el deslizador con teclado (`ArrowRight`); `#capa` mide ≥ 44 px de alto |

`scripts/app/idioma.mjs` (contexto propio, como `vista-liviana.mjs`; `serviceWorkers: 'block'` salvo en la última)

| Función | Posición | Precondición | Deja | Verifica |
|---|---|---|---|---|
| `probarIdiomaArranque` (I3) | antes de `probarOffline` | cualquiera (usa su propio contexto) | no cambia la página del recorrido | con `navigator.languages = ['en-US']` (`addInitScript`): `<html lang="en-US">`, el título y `#sinModelo h2` salen en inglés, y no hay claves sin traducir visibles (regex `^[a-z]+\.[A-Za-z0-9.]+$` en cualquier texto visible); con `['es-AR']` quedan en español; con `['fr']` en español |
| `probarIdiomaSelector` (I3) | idem | idem | idem | el botón `#idioma` dice "English" en español y "Español" en inglés, con su `lang`; al tocarlo cambia sin recargar y el modelo cargado sigue; la preferencia sobrevive a `reload()` aun con `navigator.languages = ['es']`; `#estadoIdioma` anuncia; el selector mide ≥ 44 px y no se superpone en 360 px de ancho |
| `probarIdiomaPaso2` (I10) | idem | idem | idem | en inglés: calidad, material, soportes y desplegables en inglés; `1.234,5` pasa a `1,234.5` en una medida; un nombre de archivo con acentos no se rompe |
| `probarIdiomaCompleto` (I14) | idem | idem | idem | recorrido corto en inglés (cubo → paso 2 → laminar → paso 4): ningún texto visible en español salvo los de "fuera de v1" (con `lang="es-AR"`), cada hoja abierta, `alert()` sin claves; una vez con red y una sin red (`context.setOffline`) para el chunk `en` |

### Auditoría repetible

`scripts/probar-a11y.mjs` (A6, `npm run test:a11y`) reemplazó a `scripts/auditar-a11y.mjs` y falla con cualquier violación.

## Plan de tareas

Cada tarea suma **menos de 200 líneas de código de producción** (JS, HTML y CSS; los `.json` de diccionario y las
pruebas no cuentan, pero cada tarea los trae en el mismo commit) y deja `npm run build`, `npm run lint`, `npm run
format:check` y las suites que toque en verde. Roles: **DI** dev de interfaz, **QA**, **DOC** documentador.

### Archivos compartidos y cómo no pisarse

| Archivo | Quién lo toca y cómo se evita el choque |
|---|---|
| `index.html` | **Una tarea de accesibilidad por región** (A2: `<header>` y las 4 etiquetas de apertura de `.hoja` con sus `h1`; A3: paso 3, errores y contadores; A4: `#visor`, `#visorCapas`, `#capa`) y **después** el pasaje de claves por región (I5: barra, banner, pasos 1, 3 y 4, pie; I6: paso 2; I7: hojas). Regla: **una tarea de idioma no toca una región hasta que su tarea de accesibilidad esté integrada** (sobre todo los `h1` de las hojas y el `<header>`, que tocan ambas). Las regiones no se solapan, así que A2, A3 y A4 pueden ir en paralelo y también I5, I6 e I7 |
| `src/estilos-a11y.css` | La crea A1, con secciones reservadas `/* A3 */`, `/* A4 */`, `/* I3 */`. Cada tarea edita sólo la suya |
| `src/estilos.css` | **Nadie lo toca** (todo se sobrescribe por orden desde `estilos-a11y.css`) |
| `<head>` de `index.html` | Sólo A1 (`<link>`) e I3 (`data-t` en `<title>` y `<meta>`); I3 va después de A1 |
| `scripts/probar-app.mjs` | A1 registra las tres funciones de accesibilidad y I2 las de idioma, cada una en una línea de `AREAS` |
| `scripts/app/accesibilidad.mjs`, `scripts/app/idioma.mjs` | Los crea A1 e I2 con funciones vacías; cada tarea llena la suya |
| `scripts/lib/contratos-ui.js` | Cada tarea agrega la entrada de su módulo (nadie las adelanta); gracias a `LIBRES` las migraciones no lo tocan |
| `package.json` | I2 (`test:textos`) y A6 (`test:a11y`, devDependency): son dos líneas distintas |
| `docs/MAPA.md` | Cada tarea actualiza sus filas (regla del MAPA); DOC consolida al final |
| `src/ui/impresoras.js`, `torres.js`, `avanzado.js` | Orden fijo: A3 → I4 → I10/I11/I9 (ver dependencias) |
| `src/main.js` | Sólo I3 (3 líneas) |

### Pista A: accesibilidad

| Tarea | Rol | Qué | Archivos | Depende de | Paralelo con | Pruebas | Líneas |
|---|---|---|---|---|---|---|---|
| **A1** | DI | Tokens `--acento-enlace`, `--borde-control`, `--foco`; `:focus-visible`; `prefers-reduced-motion`; alto de toque del deslizador y de `.tilde-capa`; secciones reservadas. Crea `scripts/lib/contraste.mjs` y los esqueletos de `accesibilidad.mjs` | `src/estilos-a11y.css` (nuevo), `index.html` (`<link>`), `scripts/lib/contraste.mjs`, `scripts/app/accesibilidad.mjs`, `scripts/probar-app.mjs` | — | I1, I2 | `probarContraste` | ~80 |
| **A2** | DI | Paso actual (`aria-current`), foco al cambiar de paso, hojas modales con `inert`, Escape y retorno de foco | `src/ui/navegacion.js`, `index.html` (barra y apertura de hojas) | A1 (anillo y tokens) | A3, A4, I1, I2 | `probarAccesibilidadPasos`; `test:contratos` (navegacion sin cambios de exports); regresión: `irAPaso1` en `test:app` | ~110 |
| **A3** | DI | Progreso con nombre, `role=alert/status`, grupos en `.contador`, `aria-hidden` en glifos, `h3`→`h2` | `index.html` (paso 3, errores, contadores, glifos), `src/ui/paso3-laminar.js`, `src/ui/impresoras.js`, `src/estilos-a11y.css` (`/* A3 */`) | A1 | A2, A4 | `probarAccesibilidadRegiones` | ~90 |
| **A4** | DI | Descripción del visor, deslizador con `aria-valuetext`, canvas `aria-hidden`, grupos | `src/ui/visor-descripcion.js` (nuevo, ~45), `src/ui/paso1-modelo.js`, `src/ui/vista-capas.js`, `src/ui/visor-carga.js`, `index.html` (`#visor`, `#visorCapas`, `#capa`), contrato | A1 | A2, A3 | Node: `textoDescripcionVisor` (0, 1 y 2 piezas, copias, no entra, sin medida) en un archivo nuevo `scripts/a11y/descripcion.mjs` llamado desde `test:contratos`; `probarAccesibilidadVisor` | ~150 |
| **A5** | DI | (Opcional, v1.1) teclado del visor | `src/ui/visor-teclado.js`, `src/ui/visor.js`, contrato | A4 | todo | Node: la tabla de teclas → acciones; `test:app`: foco al visor y flechas giran (visor de prueba) | ~90 |
| **A6** | QA | `scripts/probar-a11y.mjs`: axe con 0 violaciones por etapa; `test:a11y`; CI | `scripts/probar-a11y.mjs`, `package.json`, `package-lock.json`, `.github/workflows/ci.yml` | A2, A3, A4 (o con una lista de violaciones conocidas que se vacía) | I* | el mismo script | ~120 |

### Pista B: inglés

| Tarea | Rol | Qué | Archivos | Depende de | Paralelo con | Pruebas | Líneas |
|---|---|---|---|---|---|---|---|
| **I1** | DI | Núcleo: `traducir.js`, `es.js`, `en.js`, `idioma.js`, semillas de `comun.json`, `idioma.json`, `formato.json` y `app.json` | `src/textos/traducir.js`, `src/textos/es.js`, `src/textos/en.js`, `src/textos/{es,en}/{comun,idioma,formato,app}.json`, `src/ui/idioma.js`, `scripts/lib/contratos-ui.js` (3 entradas) | — | A1, A2, A3, A4, I2 | `test:contratos` (exports y DOM al importar); `test:chunks` | ~170 |
| **I2** | QA | `probar-textos.mjs` (puntos 1 a 9), `LIBRES`, reglas de `verificar-chunks`, esqueleto de `scripts/app/idioma.mjs` y su registro | `scripts/probar-textos.mjs`, `scripts/probar-contratos.mjs`, `scripts/verificar-chunks.mjs`, `scripts/app/idioma.mjs`, `scripts/probar-app.mjs`, `package.json`, `.github/workflows/ci.yml` | contrato de B.6 (se integra después de I1) | A*, I1 | se prueba a sí misma con diccionarios sintéticos (claves faltantes, sobrantes, variables distintas) | ~190 |
| **I3** | DI | `idioma-dom.js`, botón `#idioma` y `#estadoIdioma` (con `hidden`), `data-t` en `<title>` y `<meta>`, cableado en `main.js`, CSS de `/* I3 */` | `src/ui/idioma-dom.js`, `src/main.js`, `index.html` (`<head>` y barra), `src/estilos-a11y.css`, contrato | I1, A1, A2 | I4 | `probarIdiomaArranque`, `probarIdiomaSelector` (con el botón destapado por `page.evaluate`; ver riesgo R7) | ~110 |
| **I4** | DI | `formato.js` con `t` y `localeActual`; los tres `toLocaleString('es-AR')` de `src/ui/` pasan a `numero()` | `src/ui/formato.js`, `src/ui/torres.js`, `src/ui/avanzado.js`, `src/ui/impresoras.js`, `src/textos/{es,en}/formato.json` | I1, A3 | I3, I5, I6, I7 | Node: `formato` con diccionarios sintéticos (`es-AR`: `1.234,5`; `en-US`: `1,234.5`; plural de triángulos; `pesos`); `test:app` completo (los números siguen igual en español) | ~80 |
| **I5** | DI | `data-t`/`data-t-html`/`data-t-attr` en la barra, banner, paso 1, paso 3, paso 4 y pie | `index.html` (regiones indicadas), `src/textos/{es,en}/{barra,paso1,paso3,paso4,comun}.json` | I1, I2, A2, A3, A4 | I6, I7 | `probar-textos` (puntos 5 a 7); `test:app` | ~180 |
| **I6** | DI | Ídem, paso 2 completo (Personalizar, Avanzado, Cambios por altura) | `index.html`, `src/textos/{es,en}/paso2.json` | I1, I2, A3 | I5, I7 | ídem | ~190 |
| **I7** | DI | Ídem, las 4 hojas (impresoras, mi impresora, litofanía, torre) | `index.html`, `src/textos/{es,en}/hojas.json` | I1, I2, A2 | I5, I6 | ídem | ~180 |
| **I8** | DI | JS del paso 1, parte 1: `paso1-modelo`, `ajuste-modelo`, `recientes`, `visor-carga` | esos archivos, `src/textos/{es,en}/{paso1,a11y}.json` | I1, I2, I4, A4 | I9–I12 | `probar-textos` (agrega a `MIGRADOS`); `test:app` | ~120 |
| **I9** | DI | JS del paso 1, parte 2: `piezas-ui`, `copias-ui`, `bloqueos-ui`, `torres`, `litofania` | esos archivos, `src/textos/{es,en}/piezas.json` | I1, I2, I4 | I8, I10–I12 | ídem | ~170 |
| **I10** | DI | JS del paso 2, parte 1: `paso2-config`, `soportes-tipo-ui`, `materiales`, `impresoras`, `formulario-impresora` | esos archivos, `src/textos/{es,en}/paso2.json` | I1, I2, I4, A3 | I8, I9, I11, I12 | ídem + `probarIdiomaPaso2` | ~190 |
| **I11** | DI | JS del paso 2, parte 2: `avanzado`, `cambios`, `iconos-relleno` (etiquetas) | esos archivos, `src/textos/{es,en}/paso2.json` | I1, I2, I4 | I8–I10, I12 | ídem | ~110 |
| **I12** | DI | JS de los pasos 3 y 4: `paso3-laminar`, `paso4-resultado`, `entrega-ui`, `vista-capas`, `pausas-ui`, `aviso-vista`, `actualizacion`, y los `alert()` de `main` y `litofania`; contenedor `lang="es-AR"` para errores del motor | esos archivos, `src/textos/{es,en}/{paso3,paso4}.json` | I1, I2, I4, A3, A4 | I8–I11 | ídem | ~190 |
| **I13** | DI | Perfiles: nombres y descripciones de calidades (incluida la descripción con `{capa}` de `perfiles/generico.js`), materiales, patrones, adhesiones y soportes (`perfiles.<tipo>.<id>.nombre/descripcion/aviso`) con el respaldo del `.json` | `src/ui/paso2-config.js`, `src/ui/materiales.js`, `src/ui/soportes-tipo-ui.js` (sólo la parte de etiquetas), `src/textos/{es,en}/perfiles.json` | I10 | I11, I12 | ídem; una prueba Node que verifica que cada `id` de `materiales.json`/`opciones.json` tiene su clave en `es` y `en` | ~100 |
| **I14** | QA | Activar: quitar `hidden` del selector, `probarIdiomaCompleto`, revisión de capturas en 360 px, lista de "fuera de v1" verificada | `index.html` (`hidden`), `scripts/app/idioma.mjs` | I3, I5–I13 | — | `test:app` completo; capturas a mano | ~40 |
| **D1** | DOC | `docs/MAPA.md` (módulos, estado, pruebas, "dónde buscar"), guía corta "cómo agregar un texto" en `docs/textos.md`, y el ADR pasa a Aceptado con las decisiones del CTO | `docs/MAPA.md`, `docs/textos.md`, este ADR (sólo la cabecera de estado) | todas | — | revisión | ~doc |

### Olas

1. **Ola 0** (paralelo, archivos disjuntos): A1, I1, I2.
2. **Ola 1** (paralelo): A2, A3, A4, I3 (después de A2), I4 (después de A3).
3. **Ola 2** (paralelo): I5, I6, I7 (regiones de `index.html` que no se solapan), I8 a I12 (módulos distintos), A6.
4. **Ola 3**: I13, I14, D1. A5 cuando el CTO lo pida.

**Camino mínimo si sólo se prioriza accesibilidad:** A1, A2, A3, A4 (y A6). No hace falta nada de la pista B.
**Camino mínimo para el inglés** (con la accesibilidad en paralelo): I1, I2, A1, A2, I3, I4, A3, A4, I5…I14.

## Consecuencias

**Más fácil**

- Las hojas son modales de verdad con un cambio chico (`inert` y `role`), y el foco deja de perderse.
- Los colores y el foco quedan en tres tokens y un archivo CSS; cambiarlos más adelante es una sola edición.
- Agregar un texto es una clave por idioma en el `.json` de su área, sin tocar un archivo central; una prueba avisa de
  lo que falta, lo que sobra y lo que se desincronizó del HTML.
- El inglés no engorda el chunk principal; el idioma no usado no se descarga.
- Un tercer idioma es una carpeta nueva más una línea en `IDIOMAS`/`LOCALES`.

**Más difícil**

- Todo texto nuevo pasa por una clave y dos archivos. Sale del flujo "escribo el string donde lo uso". La guía de
  D1 y la prueba `MIGRADOS` lo hacen cumplir.
- `index.html` repite el español (en el HTML y en `es.json`); la prueba 6 lo mantiene igual, pero un cambio de copy
  son dos ediciones.
- `formato.js` deja de ser una hoja pura (importa `idioma`); las pruebas Node que lo importen necesitan
  `ponerDiccionarios`.
- `navegacion.js` crece (~138 a ~220 líneas) y se hace cargo del foco y de `inert`.
- El cambio de idioma en caliente deja mensajes transitorios en el idioma anterior hasta el próximo evento.

**Riesgos que quedan abiertos**

- **R1. Primer pintado en español para quien tiene el inglés.** El HTML está en español y el diccionario llega por
  `import()` junto con `cargarPreferencias`. Habrá un parpadeo de ~100 a 300 ms. Se acepta en v1; el remedio, si molesta,
  es un script de dos líneas en `<head>` que lea `localStorage` y oculte `#main` hasta que `iniciarIdiomaDom` termine
  (no se hace ahora para no duplicar el almacenamiento de la preferencia).
  Medido en I3 (CPU x6 y 200 kB/s): ~590 ms en español antes de pasar a inglés. Es normal: el primer dibujo ya sale en
  inglés, porque `main.js` espera `iniciarIdioma` antes de dibujar; lo que se ve en español es el HTML estático.
- **R2. Mezcla de idiomas.** Un módulo sin migrar sigue en español. Mitigación: el selector nace oculto (I14 lo
  muestra) y `MIGRADOS` impide regresiones.
- **R3. Texto envuelto en `<span>`** puede romper selectores CSS del tipo `label > input` o `label > :first-child`.
  Mitigación: I5, I6 e I7 revisan `grep -n "label >" src/estilos*.css` y corren `test:app`.
- **R4. `inert` y el historial.** Cerrar una hoja rápido (doble toque en "atrás") deja el `inert` puesto si se pierde un
  `popstate`. Mitigación: `mostrar` recalcula `inert` de cero en cada llamada (es idempotente) y A2 lo prueba.
- **R5. Foco al cambiar de paso vs. pruebas existentes.** Algunas áreas de `test:app` podrían depender de no tener foco
  en un `h2`. Mitigación: A2 corre el recorrido completo.
- **R6. Calidad de la traducción.** Ninguna de estas tareas garantiza inglés idiomático. Hace falta una revisión humana
  de `src/textos/en/` antes de I14.
- **R7. Probar el selector antes de mostrarlo.** `probarIdiomaSelector` necesita el botón visible mientras esté `hidden`.
  Solución: la prueba lo hace visible con `page.evaluate`; I14 sólo cambia el atributo en el HTML.
- **R8. `alert()`.** Siguen siendo diálogos nativos del navegador (no se traducen sus botones). Se reemplazan por el
  aviso en pantalla sólo si el CTO lo pide.
- **R9. Reversa.** Cada tarea es un commit. Quitar el selector (`hidden`) apaga el inglés sin tocar nada más; revertir A2
  restaura la navegación anterior; los `.json` sin uso no hacen daño.

## Decisiones abiertas para el CTO

1. **Cambio de idioma en caliente o con recarga.** Recomendación: **en caliente** (`traducirDom` y cada módulo
   redibuja). Recargar la página perdería el modelo abierto, y los redibujos ya existen. Si I14 encuentra demasiado
   texto atrasado, se cambia a recarga con `location.reload()` (una línea en `idioma-dom.js`) sin tocar el resto.
2. **Selector en la barra o en otro lugar, y sin opción "automático".** Recomendación: botón en la barra, que alterna
   `es`/`en`; sólo se guarda lo que el usuario elige; no hay forma de volver a "automático" sin borrar los datos del
   sitio. Alternativa: fila "Idioma / Language" en el paso 1 (menos visible, pero sin problemas de ancho en 360 px).
3. **Diccionario inline o diferido.** Recomendación: **diferido para los dos idiomas** (chunks aparte, en paralelo con
   `cargarPreferencias`). Incluir `es` en el principal sumaría ~20 kB al presupuesto de 100 kB (hoy 71,2) sin necesidad.
   Costo: un request más en el arranque, ya precacheado por el service worker.
4. **`axe-core` como devDependency y `test:a11y` en el CI.** Recomendación: **sí**, fijada en 4.14.0 (sin `^`) porque
   axe cambia reglas entre versiones menores; no entra al build ni al service worker; suma ~30 s al CI. Si se rechaza,
   se hacen sólo las pruebas a mano de `accesibilidad.mjs` y se descarta A6.
5. **Teclado en el visor (A5).** Recomendación: **no en v1**, por AA alcanza con los botones de giro/escala y la
   descripción textual; se hace en la v1.1 si hay usuarios de teclado o switch.
6. **Errores del motor.** Recomendación: en v1 quedan en español con `lang="es-AR"`; en v1.1 pasan a códigos
   (`ErrorApp`) para traducirlos. Alternativa: traducirlos ahora por coincidencia de texto (frágil: se descarta).
7. **Locale del inglés y moneda.** Recomendación: `en-US` para números y `ARS 1,234` para los pesos. Alternativa
   `en-GB` (sin diferencias visibles para estos formatos).
8. **Idioma de arranque.** Recomendación: respetar `navigator.languages` (pedido original) con el selector siempre
   visible. Riesgo conocido: alguien con el celular en inglés y que prefiere español verá primero inglés; un toque lo cambia.
9. **Objetivo de conformidad.** Recomendación: WCAG 2.2 AA con la excepción de 2.5.1 declarada arriba.
10. **`inert` vs. `<dialog>`.** Recomendación: `inert` + `role="dialog"` (cambio mínimo, ya soportado en los navegadores
    objetivo). Se revisa `<dialog>` si se vuelve a tocar el sistema de hojas.
11. **Orden de integración de `index.html`.** Recomendación: primero A2, A3 y A4 (accesibilidad), después I5, I6 e I7
    (claves), según la tabla de archivos compartidos. Si se prioriza el inglés antes que la accesibilidad, hay que
    invertir el orden y aceptar que A2 a A4 re-toquen líneas con `data-t`.
12. **Nombre de las tareas.** Este ADR usa `A1…A6`, `I1…I14` y `D1` (en lugar de una sola serie T1…Tn) para poder
    priorizar las dos pistas por separado; las dependencias entre pistas están marcadas en la tabla.

### Decisiones del CTO (2026-10-19)

1. Cambio de idioma **en caliente**.
2. Selector en la barra, sin "automático": **sí**.
3. Los dos diccionarios **diferidos**, cargados en paralelo con `cargarPreferencias` y esperados antes del primer
   dibujo (como `iniciarMateriales`).
4. `axe-core` **4.14.0 fijado** como devDependency, con `test:a11y` en la CI (A6).
5. Teclado en el visor: **no en v1** (A5 queda en el backlog).
6. Errores del motor: v1 en español con `lang="es-AR"`.
7. Inglés `en-US`, moneda `ARS 1,234`: **sí**.
8. Arranque según `navigator.languages`: **sí**.
9. Objetivo WCAG 2.2 AA, con la excepción 2.5.1 declarada para los gestos del visor: **sí**.
10. `inert` + `role=dialog`: **sí** (no `<dialog>`).
11. Orden de `index.html`: A2, A3 y A4 antes que I5, I6 e I7: **sí**.
12. Nombres A/I/D: **sí**.
13. **Alcance por sprint.** Sprint 5: A1, A2, A3, A4, A6, I1, I2, I3 e I4 (el selector sigue `hidden`). Sprint 6: I5 a
    I14 y D1.
14. **Retorno del foco.** El ADR 0007 (T6) agrega `devolverFocoAlCerrar` en `navegacion.js` y lo usan `red-hoja.js` y
    `torres.js`. A2 arranca **después** de integrar T6, hace genérico el retorno del foco al cerrar cualquier hoja y
    **reemplaza** ese helper (lo saca de los dos módulos y del contrato si deja de hacer falta), sin dos mecanismos a la
    vez.
15. **Arranque en español hasta I14.** Hasta que el inglés esté completo, el arranque es en español salvo una
    preferencia guardada (`ARRANQUE_AUTOMATICO = false` en `idioma.js`, que ignora `navigator.languages`); I14 la pasa a
    `true`. Así nadie ve una app mezclada (números en `en-US` y el resto en español).
