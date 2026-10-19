# 0007. Enviar el G-code por red local a OctoPrint o Moonraker (opcional)

- **Fecha:** 2026-10-19
- **Autor/a:** arquitecto
- **Base:** commit `3d1c1c7`

## Estado

Implementado (T1 a T9). Aceptado por el CTO el 2026-10-19. T10 (hardware) pendiente: la función sale como experimental.

## Contexto

Laminar Móvil es una PWA estática (Vercel, HTTPS, sin backend) que lamina en el navegador. El paso 4 entrega el archivo
con **Descargar** y **Compartir** (`entrega-ui.js`: `archivoEntrega`, `esperarArchivo`; `entrega.js`: `nombreEntrega`,
`armarEntrega`; `paso4-resultado.js`: `compartir`, `descargar`). Después el usuario tiene que llevar el archivo a la
impresora a mano (microSD o la app que use). Muchas impresoras de FDM de uso casero corren **OctoPrint** (Marlin) o
**Klipper + Moonraker** (Mainsail / Fluidd), y las dos tienen una API HTTP para subir el archivo y, si se quiere,
empezar a imprimir. Queremos ofrecer ese envío como algo **opcional**: si el usuario no lo configura, la app se ve y
anda igual que hoy.

Hechos que condicionan el diseño:

- **La app es https y las impresoras son http.** OctoPrint y Moonraker casi siempre responden por `http://192.168.x.x`
  (o `http://octopi.local`), sin certificado. Una página https que pide a un `http://` es *contenido mixto activo* y los
  navegadores lo bloquean, salvo las excepciones de la sección 1. Esto es el riesgo principal de la función.
- **No hay backend** que haga de puente, y no vamos a sumar uno (se perdería "todo queda en el celu"). Además un
  servidor en internet no llega a la IP privada del usuario.
- **CORS.** `https://<la app>` es otro origen que la impresora: OctoPrint y Moonraker bloquean el pedido si no se les
  habilita ese origen (sección 2). El usuario tiene que tocar la configuración de su impresora una vez.
- **El service worker** (`src/sw.js`) ya hace `return` si el pedido no es `GET` o no es del mismo origen
  (`new URL(request.url).origin !== location.origin`); los pedidos a la impresora son de otro origen y no pasan por él.
  Hoy no hace falta tocarlo, pero conviene un resguardo barato (decisión 8).
- No hay `vercel.json` ni `Content-Security-Policy` (ni `<meta http-equiv>` en `index.html`, ni cabeceras en
  `vite.config.js`): no hay un `connect-src` que impida conectar. Si alguna vez se agrega una CSP, debe permitir
  `connect-src http: https:` (o `*`) porque la dirección la elige el usuario.
- **Bambu Lab** (`.gcode.3mf`): las Bambu no hablan OctoPrint ni Moonraker; su modo LAN usa MQTT y FTPS, que un
  navegador no puede abrir. Quedan **fuera de v1** y el botón no se ofrece cuando `salidaDe(imp) === 'gcode.3mf'`
  (`src/ui/entrega-ui.js`: `entregaDe().formato`).
- ADR 0001: módulos < 300 líneas, funciones < 40, nada toca el DOM al importarse, callbacks inyectados, lógica pura
  separada de efectos, aristas de imports verificadas por `scripts/lib/contratos-ui.js` (que hoy sólo mira `src/ui/` y
  `src/main.js`: las aristas de `src/red/` se prueban con su propia prueba, T1).
- Persistencia: `src/almacen.js` guarda ajustes con `leerAjuste(clave)` / `guardarAjuste(clave, valor)` en IndexedDB.
  `estado.propias` (impresoras propias) se publica a `perfiles` y viaja con los perfiles; la clave de API **no** debe ir
  ahí.

### Fuentes y límites de la investigación

Este agente corre con un proxy que bloqueó `docs.octoprint.org`, `moonraker.readthedocs.io` y `developer.chrome.com`
(`CONNECT tunnel failed, 403`), así que **no pude leer las páginas**: lo que sigue sale de los resúmenes de búsqueda
(citados) y de lo que ya se conoce de las dos APIs. Todo lo que no pude confirmar contra la documentación va marcado
**[A VALIDAR]** y lo cierra T10 con una impresora real (o T2 leyendo la documentación desde una máquina con acceso).

- Chrome, Local Network Access (LNA): <https://developer.chrome.com/blog/local-network-access> (9/6/2025) y la
  *Intent to Ship* <https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY/m/JWenvGViCAAJ>. Cobertura de
  versiones (142 aplica el permiso por defecto, 147 suma WebSocket, 145/146 parten el permiso en dos, 156 saca la política
  de excepción): fuentes secundarias <https://blog.openreplay.com/chrome-local-network-access-lna-permission/>,
  <https://www.dynamsoft.com/web-twain/docs/faq/chromium-142-local-network-access-issue.html>,
  <https://www.superchargebrowser.com/library/chrome-156-local-network-access>.
- Firefox: <https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox> (restricciones
  de red local activadas por defecto en forma gradual desde Firefox 151, con permiso por sitio) y la versión para
  Android <https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox-android>.
- Safari: WebKit bloquea contenido mixto que no puede mejorar a https (bug
  <https://bugs.webkit.org/show_bug.cgi?id=279249>, y <https://bugs.webkit.org/show_bug.cgi?id=171934> sobre `localhost`);
  no hay equivalente del permiso de LNA para páginas web. Foro de Apple:
  <https://developer.apple.com/forums/thread/727831>.
- OctoPrint API de archivos: <https://docs.octoprint.org/en/devel/api/files.html>; API general y CORS:
  <https://docs.octoprint.org/en/dev/api/general.html>, <https://docs.octoprint.org/en/main/configuration/config_yaml.html>
  (clave `api.allowCrossOrigin`); ejemplo de subida con JS:
  <https://community.octoprint.org/t/uploading-file-to-octopi-through-the-api-using-javascript/3938>.
- Moonraker: <https://moonraker.readthedocs.io/en/latest/external_api/file_manager/> (subida en `/server/files/upload`,
  sólo HTTP, raíces `gcodes` y `config`), configuración
  <https://moonraker.readthedocs.io/en/latest/configuration/> (`cors_domains` en `[authorization]`), y
  <https://docs.fluidd.xyz/configuration/moonraker> (ejemplo de `cors_domains`).

## Decisión

Vamos a agregar un módulo nuevo `src/red/` con el cliente puro (armar pedidos, interpretar respuestas, traducir
errores), una hoja de configuración y un botón **Enviar a la impresora** en el paso 4 que sólo aparece si esa impresora
tiene la red configurada. Sin configuración la app no cambia. Sin backend, sin dependencias nuevas.

### 1. Contenido mixto y plan de degradación

Lo que hace cada navegador hoy (según las fuentes de arriba; el estado real cambia cada versión):

| Navegador | Qué pasa con `fetch`/XHR de `https://app` a `http://192.168.x.x` |
|---|---|
| **Chrome / Edge (Android y escritorio)** | Un pedido a una IP privada o a un nombre `.local` queda **exento del chequeo de contenido mixto**; para otros nombres (`octopi`, `impresora.lan`) la página tiene que marcarlo con la opción de `fetch` `targetAddressSpace: 'local'`. Desde Chrome 142 el pedido pasa por el **permiso de Local Network Access**: el navegador pregunta una vez ("buscar y conectarse con dispositivos de tu red local"); si el usuario **deniega, no vuelve a preguntar** y hay que habilitarlo en la configuración del sitio. En Android WebView el permiso se concede siempre (no aplica a la PWA instalada desde Chrome). **[A VALIDAR]** que XHR (no sólo `fetch`) pase por el mismo permiso y la misma exención, y que la PWA instalada se comporte igual que la pestaña. |
| **Firefox** | Sigue bloqueando contenido mixto activo hacia hosts que no son loopback. Las restricciones de red local (permiso por sitio) se activan en forma gradual desde Firefox 151. **No contamos con que ande**: si la primera prueba falla, mostramos el plan de degradación. **[A VALIDAR]** en una versión actual. |
| **Safari / iOS** (y todos los navegadores de iPhone, que usan WebKit) | Bloquea el contenido mixto que no puede subir a https y no tiene un permiso que lo habilite para IP privadas. **Lo damos por bloqueado.** |

Consecuencia de diseño: **no se detecta el navegador**; se prueba y se interpreta el resultado (sección 4). Chrome en
Android es el camino feliz; en iPhone se llega al plan de degradación casi siempre.

**Plan de degradación honesto.** Cuando la prueba de conexión (o el envío) falla por "no se llega" o "bloqueado", la hoja
muestra, en este orden, sin prometer lo que no podemos saber:

1. El mensaje del error (sección 4) con una sola frase de causa probable. Como el navegador **no distingue** entre "la
   impresora está apagada" y "el navegador me bloqueó" (ambos son un error de red genérico), el texto dice las dos cosas
   y no afirma ninguna.
2. Tres salidas, en el mismo texto de ayuda:
   a. **Abrir la impresora** (botón: abre `direccion` en otra pestaña con `rel="noopener"`; navegar no es contenido
      mixto): desde la interfaz de la impresora (OctoPrint, Mainsail, Fluidd) el usuario sube el archivo que acaba de
      **Descargar**. Es el plan B siempre disponible.
   b. **Usar el https de la propia impresora.** Si la impresora tiene un certificado válido (por ejemplo con
      `tailscale serve`, que da un `https://nombre.tailXXXX.ts.net` con certificado real, o un proxy con un certificado de
      una autoridad reconocida), la dirección `https://…` no tiene contenido mixto. Un certificado autofirmado **no**
      sirve: el navegador lo rechaza igual. La hoja lo explica en dos líneas; no es una función de la app.
   c. **Permiso del navegador** (Chrome/Firefox): "tocá el candado de la barra de direcciones → Permisos → Red local →
      Permitir" (texto genérico, sin capturas, que cambian con cada versión).
3. **Descartado:** servir la app por http dentro de la red local. Sin https no hay service worker ni instalación de la
   PWA (contexto seguro), así que perderíamos el uso sin conexión que es el corazón de la app.

**Nunca** se esconde el botón Descargar/Compartir: el envío por red es un atajo, no el único camino.

### 2. APIs de las impresoras

Todo lo que arma el cliente (`src/red/peticiones.js`) es para estas dos APIs. Para ambas la clave va **sólo** en la
cabecera `X-Api-Key` (nunca en la URL: queda en historiales y en mensajes de error).

#### 2.1 OctoPrint

- **Verificar conexión:** `GET {dir}/api/version` (responde `{api, server, text}`). **[A VALIDAR]** si exige clave o
  responde a invitados según la configuración de control de acceso.
- **Estado (¿ocupada?):** `GET {dir}/api/job` → `state` (`"Operational"`, `"Printing"`, `"Paused"`, `"Offline"`…).
  Con 403 la clave no sirve (o falta). **[A VALIDAR]** el texto exacto de `state` en la versión que use el usuario.
- **Subir:** `POST {dir}/api/files/local`, `multipart/form-data`, parte obligatoria `file` (con nombre de archivo).
  Para sólo subir **no mandamos más partes**. Para subir e imprimir, `select=true` y `print=true`. Respuesta `201`
  con JSON de los archivos. `409` si se pidió seleccionar/imprimir y la impresora no puede (ocupada o no conectada).
  `403` clave inválida; `400` pedido mal armado; `415`/`422` archivo rechazado.
- **CORS:** hay que activar *Ajustes → API → "Allow Cross Origin Resource Sharing (CORS)"* (clave `api.allowCrossOrigin`
  en `config.yaml`). Sin eso el navegador oculta la respuesta (error de red genérico). La clave de API sigue siendo
  obligatoria. Como la cabecera `X-Api-Key` no es "simple", el navegador hace antes un `OPTIONS` (preflight); con CORS
  activado OctoPrint lo contesta. **[A VALIDAR]** si pide reiniciar OctoPrint.
- Dónde sale la clave: *Ajustes → Application Keys* (o la clave de usuario). **[A VALIDAR]** el nombre en la versión
  actual.

#### 2.2 Moonraker

- **Verificar conexión:** `GET {dir}/server/info` → `result.klippy_state` (`"ready"`, `"startup"`, `"shutdown"`,
  `"error"`), `result.klippy_connected`, `result.moonraker_version`. `401` si pide autenticación y falta o no sirve la
  clave. **[A VALIDAR]** con `trusted_clients` el servidor puede dejar pasar sin clave.
- **Estado (¿ocupada?):** `GET {dir}/printer/objects/query?print_stats` → `result.status.print_stats.state`
  (`"printing"`, `"paused"` = ocupada; `"standby"`, `"complete"`, `"cancelled"`, `"error"` = libre).
- **Subir:** `POST {dir}/server/files/upload`, `multipart/form-data`, partes `file` (con nombre) y `root=gcodes`; con
  `print=true` Moonraker empieza a imprimir al terminar la subida (responde `print_started`). Si no se manda `print`,
  sólo sube. Respuesta `201`/`200` con `{item: {path, root, …}, print_started, action}`. `409` si el archivo está en uso o
  la impresora no puede arrancar. **[A VALIDAR]** nombres exactos del JSON y códigos.
- **CORS:** en `moonraker.conf`, sección `[authorization]`, la lista `cors_domains` debe incluir el **origen** de la app
  (`https://<dominio de la app>`, sin barra final), y hay que reiniciar Moonraker. Sin eso, el navegador oculta la
  respuesta. La clave (`X-Api-Key`) es opcional: sólo si Moonraker no confía en la IP del celu (`trusted_clients`).
- **Ojo (riesgo R2):** si el pedido es "simple" (un `POST` multipart **sin** `X-Api-Key`), el navegador no hace
  preflight, lo envía igual y sólo oculta la respuesta. Un Moonraker que confía en el celu **ejecuta** la subida (y el
  `print=true`) aunque el navegador diga "bloqueado por CORS". **[A VALIDAR]**. Por eso, ante un error de tipo
  "bloqueado" con `imprimir` activo el mensaje dice "puede que el archivo haya llegado: mirá la impresora antes de
  reintentar".

La hoja le muestra al usuario, listo para copiar, el origen exacto que tiene que habilitar (`location.origin`) y el
fragmento de configuración de su tipo. Ese texto se arma con `escapar` (aunque el origen no lo controla un tercero, el
hábito evita una inyección futura). Las previsualizaciones de Vercel tienen otro origen: cada una necesita su permiso; la
recomendación es usar el dominio de producción (decisión 7).

### 3. Datos guardados

Una sola clave de ajustes en IndexedDB (`almacen.guardarAjuste`), **sólo en el celu**:

```js
// clave: 'redImpresoras'
{
  version: 1,
  porImpresora: {
    // clave = impresoraId (la de perfiles, incluye 'propio-…' de Mi impresora)
    'creality-ender-3-v3-se': {
      tipo: 'octoprint',                 // 'octoprint' | 'moonraker'
      direccion: 'http://192.168.1.50',  // ya normalizada: sin barra final, con prefijo de ruta si lo hay
      claveApi: '',                      // '' = sin clave
      imprimir: false                    // true = "empezar a imprimir al terminar" (por defecto false)
    }
  }
}
```

Reglas:

- **Por impresora, no global** (decisión 2): quien tiene dos máquinas con dos IP no se pisa, y el botón sólo aparece en la
  impresora configurada. Se guarda en su **propia clave**, no dentro de `estado.propias`, porque `estado.propias` se
  publica a `perfiles` (`ponerImpresorasPropias`) y puede terminar en exportaciones o capturas; la clave de API no.
- **La clave de API nunca se escribe en `console`, ni en mensajes de error, ni en la URL, ni en el DOM** (el campo es
  `type="password"` con `autocomplete="off"`; al reabrir la hoja muestra "guardada" y un botón para cambiarla, no el
  valor). Sale del dispositivo **sólo** hacia la dirección configurada, en la cabecera `X-Api-Key`.
  `describirConfig(config)` (T5) devuelve una copia con `claveApi` reemplazada por `'•••'` y es lo único que se puede
  pasar a un log o a un mensaje.
- Se guarda en texto plano en IndexedDB (igual que el resto de los ajustes): el modelo de amenaza es "alguien con acceso
  al celu desbloqueado", el mismo que ya ve las claves de Wi‑Fi guardadas. Se avisa en la hoja ("queda guardada en este
  celu").
- Se valida al leer (`validarConfig`): lo que no cumple el formato se descarta (la impresora queda "sin configurar"), no
  se rompe la app.
- **No** hay exportación/importación de esta clave en v1; cualquier futura exportación de perfiles debe excluir
  `redImpresoras`.

### 4. Chequeo de conexión y errores

`probarConexion` hace dos pedidos en orden (versión, luego estado) con tope de 8 s cada uno y devuelve un resultado, no
lanza. El envío usa los mismos códigos. Cada código tiene un mensaje en español rioplatense (voseo) y una pista:

| Código | Cuándo | Mensaje (resumen) |
|---|---|---|
| `direccion` | `normalizarDireccion` rechaza el texto | "La dirección no es válida. Probá con algo como http://192.168.1.50" |
| `sin-llegada` | el pedido falla y la **sonda** (ver abajo) también | "No se pudo llegar a la impresora. Revisá que estén en el mismo Wi‑Fi, que la IP sea la correcta y que esté prendida. Si es `http` y la app es `https`, el navegador puede estar bloqueándolo." + salidas de la sección 1 |
| `bloqueado` | el pedido falla pero la sonda **llega** | "La impresora está, pero el navegador no deja que esta página lea la respuesta (CORS). Habilitá este origen en la impresora:" + origen y fragmento del tipo |
| `clave` | HTTP 401 o 403 | con clave: "La API key no sirve."; sin clave: "Esta impresora pide una API key." |
| `ocupada` | `409` al subir, o el estado dice que imprime | "La impresora está imprimiendo ahora. Podés subir el archivo sin imprimir, o esperar." |
| `rechazado` | 400, 413, 415, 422, 5xx | "La impresora no aceptó el archivo (código N)." (sin el cuerpo de la respuesta, que no controlamos) |
| `respuesta` | 404, o 200 con algo que no es lo esperado | "Esa dirección no parece ser un OctoPrint/Moonraker. ¿El puerto y el tipo son los correctos?" |
| `tiempo` | se pasó el tope | "La impresora no respondió a tiempo." |
| `cancelado` | el usuario canceló | "Envío cancelado." (no es un error: sin alerta roja) |

**La sonda** (`sondaSinCors`) resuelve el "sin red *vs.* bloqueado" que el navegador no reporta: tras un fallo genérico
se hace `fetch(origen, { mode: 'no-cors' })`. Si **resuelve** (respuesta opaca) el servidor es alcanzable y lo que falló
fue CORS; si **rechaza**, no se llegó (red, IP, o el navegador bloqueó el contenido mixto/LNA, que da el mismo error que
una red caída). Es una heurística y el mensaje de `sin-llegada` lo admite. **[A VALIDAR]** en Chrome Android que la sonda
distinga bien los dos casos, y qué hace con un LNA denegado.

### 5. Seguridad

- **`normalizarDireccion`** acepta sólo `http:` y `https:`; rechaza usuario/contraseña embebidos
  (`http://user:pass@host`), query y fragmento, host vacío y esquemas como `javascript:`, `file:`, `data:`. Si el
  usuario escribe `192.168.1.50` sin esquema, se asume `http://`. Quita las barras finales y conserva un prefijo de ruta
  (`/octoprint`). `https` con certificado inválido lo rechaza el navegador: el mensaje de red genérico aplica.
- **`escapar` de `util-dom`** para todo lo que vaya a `innerHTML` (origen, nombre de la impresora, fragmento de
  configuración, mensajes de la impresora si alguna vez se muestran). La regla de la casa: **mensajes con
  `textContent`**; `innerHTML` sólo con `escapar`. El cuerpo de las respuestas de la impresora **no** se muestra.
- **Nada de lo configurado se auto-envía:** el envío es una acción del usuario (toque en el botón), nunca al laminar.
  `imprimir` empieza **apagado** y, si está encendido, el botón pide confirmación (decisión 3).
- **No se loguea:** ninguna función de `src/red/` ni de la UI de red llama a `console.*` ni pone `claveApi` en un mensaje
  de `Error` (prueba en T1 y T8).
- **Service worker:** los pedidos son de otro origen y no pasan por el `fetch` del SW. No se cachean ni se interceptan.
  Resguardo de una línea en T7 (decisión 8).
- Sin dependencias nuevas, sin `eval`, sin cargar scripts de la impresora.

### 6. Módulos y contratos

Todo lo de `src/red/` es **puro o con efectos inyectados**: no importa nada de `src/ui/`, no toca el DOM, no llama a
`fetch`/`XMLHttpRequest` globales (los recibe) y no importa `almacen` (lo recibe). Tipos compartidos (JSDoc):

```js
/** @typedef {'octoprint'|'moonraker'} TipoRed */
/** @typedef {{tipo: TipoRed, direccion: string, claveApi: string, imprimir: boolean}} ConfigRed */
/** @typedef {{metodo: 'GET'|'POST', url: string, headers: Record<string,string>, cuerpo: FormData|null, tiempoMs: number}} Peticion */
/** @typedef {{estado: number, texto: string}} Respuesta  Cualquier respuesta HTTP (también 4xx/5xx). */
/** @typedef {{alProgreso?: (fraccion: number) => void, senal?: AbortSignal}} OpcionesEnvio */
/** @typedef {(peticion: Peticion, opciones?: OpcionesEnvio) => Promise<Respuesta>} Transporte
 *  Rechaza con un `ErrorTransporte` si no hubo respuesta HTTP. */
/** @typedef {Error & {name: 'ErrorTransporte', causa: 'red'|'tiempo'|'cancelado'}} ErrorTransporte */
/** @typedef {'direccion'|'sin-llegada'|'bloqueado'|'clave'|'ocupada'|'rechazado'|'respuesta'|'tiempo'|'cancelado'} CodigoError */
/** @typedef {{codigo: CodigoError, mensaje: string, pista: string, estadoHttp?: number}} ErrorRed */
/** @typedef {{ok: true, resumen: {nombre: string, ocupada: boolean}} | {ok: false, error: ErrorRed}} ResultadoPrueba */
/** @typedef {{ok: true, imprimiendo: boolean, nombre: string} | {ok: false, error: ErrorRed}} ResultadoEnvio */
```

#### 6.1 `src/red/direccion.js` (nuevo, ~60 líneas, sin imports)

```js
/** Valida y normaliza lo que escribió el usuario.
 *  @param {string} texto
 *  @returns {{ok: true, direccion: string, http: boolean, nombreSinLocal: boolean} | {ok: false, motivo: string}}
 *  `http`: la dirección es http. `nombreSinLocal`: es http y el host es un nombre que no es IP ni `.local`
 *  (Chrome no lo exime del contenido mixto sin `targetAddressSpace`; ver decisión 5). */
export function normalizarDireccion(texto) {}
```

#### 6.2 `src/red/peticiones.js` (nuevo, ~120 líneas, sin imports)

```js
/** @param {ConfigRed} config @returns {Peticion}  OctoPrint: GET /api/version · Moonraker: GET /server/info. tiempoMs 8000. */
export function peticionVersion(config) {}

/** @param {ConfigRed} config @returns {Peticion}  OctoPrint: GET /api/job · Moonraker: GET /printer/objects/query?print_stats. */
export function peticionEstado(config) {}

/** Arma el multipart. Sólo sube (sin `select`/`print`) salvo `config.imprimir`. El nombre se sanea
 *  (sin `/ \ : * ? " < > |`, máx. 100 caracteres, conserva la extensión). tiempoMs 600000.
 *  @param {ConfigRed} config @param {File|Blob} archivo @param {string} nombre
 *  @returns {Peticion} */
export function peticionSubida(config, archivo, nombre) {}

/** @param {TipoRed} tipo @param {string} texto cuerpo de la respuesta de `peticionVersion`
 *  @returns {{nombre: string}|null} null si el cuerpo no es la respuesta esperada de ese tipo. */
export function leerVersion(tipo, texto) {}

/** @param {TipoRed} tipo @param {string} texto cuerpo de `peticionEstado` @returns {boolean|null}
 *  true = imprimiendo o en pausa; false = libre; null = no se entendió. */
export function estaOcupada(tipo, texto) {}

/** @param {TipoRed} tipo @param {string} texto cuerpo de la respuesta de subida @returns {boolean}
 *  true si la impresora dice que empezó a imprimir (`print_started` en Moonraker; en OctoPrint, `done` y el pedido
 *  llevaba `print=true`). **[A VALIDAR]** */
export function empezoAImprimir(tipo, texto) {}

/** Texto de ayuda de CORS para la hoja. @param {TipoRed} tipo @param {string} origen `location.origin`
 *  @returns {string} texto plano (quien lo muestre en innerHTML debe pasarlo por `escapar`). */
export function ayudaCors(tipo, origen) {}
```

#### 6.3 `src/red/errores.js` (nuevo, ~90 líneas, sin imports)

```js
/** Traduce una respuesta HTTP que no es éxito. null si es éxito para esa fase.
 *  @param {TipoRed} tipo @param {'version'|'estado'|'subida'} fase @param {Respuesta} respuesta
 *  @param {{tieneClave: boolean}} contexto @returns {ErrorRed|null} */
export function errorDeRespuesta(tipo, fase, respuesta, contexto) {}

/** Traduce un fallo sin respuesta HTTP.
 *  @param {'red'|'tiempo'|'cancelado'} causa
 *  @param {{alcanzable: boolean, tipo: TipoRed, origenApp: string, http: boolean, imprimiendo: boolean}} contexto
 *  `alcanzable`: lo que dijo la sonda. `imprimiendo`: el envío llevaba print=true (agrega el aviso de R2).
 *  @returns {ErrorRed} */
export function errorDeTransporte(causa, contexto) {}

/** @param {string} motivo de normalizarDireccion @returns {ErrorRed} código 'direccion' */
export function errorDeDireccion(motivo) {}
```

#### 6.4 `src/red/cliente.js` (nuevo, ~120 líneas)

Importa: `red/peticiones`, `red/errores`. Recibe todo lo demás.

```js
/** @typedef {{transporte: Transporte, sonda: (url: string) => Promise<boolean>, origenApp: string}} DependenciasRed
 *  `sonda`: true si el host responde aunque el navegador no deje leer (ver `sondaSinCors`). */

/** Prueba la conexión: versión y luego estado. Nunca lanza.
 *  @param {ConfigRed} config @param {DependenciasRed} deps @returns {Promise<ResultadoPrueba>} */
export async function probarConexion(config, deps) {}

/** Sube el archivo (y lo imprime si `config.imprimir`). Nunca lanza.
 *  @param {ConfigRed} config @param {File|Blob} archivo @param {string} nombre
 *  @param {DependenciasRed} deps @param {OpcionesEnvio} [opciones] @returns {Promise<ResultadoEnvio>} */
export async function enviarGcode(config, archivo, nombre, deps, opciones) {}
```

#### 6.5 `src/red/transporte.js` (nuevo, ~90 líneas, sin imports)

Es el único que usa XHR (por el progreso de subida, que `fetch` no da) y `fetch` (la sonda). Se prueba con una clase
`XMLHttpRequest` falsa en Node y en el navegador con T8.

```js
/** @param {{XHR?: typeof XMLHttpRequest}} [deps] @returns {Transporte}
 *  Mapea: `onerror` → ErrorTransporte 'red'; `ontimeout` → 'tiempo'; `abort` (por `senal`) → 'cancelado'.
 *  `upload.onprogress` → `alProgreso(loaded/total)`. No lee `getAllResponseHeaders`. No loguea. */
export function crearTransporte(deps) {}

/** @param {string} url @param {typeof fetch} [fetchFn] @returns {Promise<boolean>}
 *  `fetch(url, {mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(4000)})`: true si resuelve. Sin cabeceras. */
export async function sondaSinCors(url, fetchFn) {}
```

#### 6.6 `src/red/config-red.js` (nuevo, ~70 líneas)

Importa: `red/direccion`. Recibe `almacen` (`{leerAjuste, guardarAjuste}`).

```js
/** @typedef {{leerAjuste: (clave: string) => Promise<any>, guardarAjuste: (clave: string, valor: any) => Promise<void>}} AlmacenAjustes */
export const CLAVE_AJUSTE = 'redImpresoras';

/** @param {any} crudo @returns {ConfigRed|null} null si no cumple el formato (la dirección se renormaliza). */
export function validarConfig(crudo) {}

/** @param {ConfigRed} config @returns {ConfigRed} copia con claveApi: '•••' (o '' si no hay), para logs y mensajes. */
export function describirConfig(config) {}

/** @param {AlmacenAjustes} almacen
 *  @returns {{leer: (impresoraId: string) => Promise<ConfigRed|null>,
 *             guardar: (impresoraId: string, config: ConfigRed) => Promise<void>,
 *             borrar: (impresoraId: string) => Promise<void>}} */
export function crearRepositorioRed(almacen) {}
```

#### 6.7 `src/ui/red-hoja.js` (nuevo, ~150 líneas)

Hoja `#hojaRed` (se agrega a `index.html` y a `navegacion.js`: `$('hojaRed').hidden = hoja !== 'red'`): tipo
(OctoPrint | Moonraker), dirección, clave (con mostrar/ocultar), "Empezar a imprimir al terminar" (apagado), **Probar
conexión** (estado en línea con el resultado y, si falla, la ayuda), **Guardar**, **Quitar** y **Abrir la impresora**.
No toca el DOM al importarse.

```js
/** Cablea la hoja una vez (desde main.js).
 *  @param {{alGuardar: () => void}} callbacks `alGuardar`: lo llama tras guardar o quitar (main: actualizarEnvio).
 *  @returns {void} */
export function iniciarRedHoja({ alGuardar }) {}

/** Carga la config de `estado.resultado.impresoraId` (o la impresora elegida) y abre la hoja.
 *  @returns {Promise<void>} */
export async function abrirRedHoja() {}
```

#### 6.8 `src/ui/envio-ui.js` (nuevo, ~130 líneas)

Botón `#enviarRed` ("Enviar a la impresora") y enlace `#configurarRed` ("Enviar por red…") en el pie del paso 4, más
`#envioRed` (progreso + Cancelar). Visibles: `#configurarRed` si la impresora es de G-code plano; `#enviarRed` sólo si
además hay config. Obtiene el archivo con `archivoEntrega()` (con las pausas de ahora) y el nombre con
`nombreEntrega(archivo, 'gcode')`. Muestra `Subiendo… 43 %` en el botón y un botón Cancelar (`AbortController`).
Resultado con `textContent` en `#estadoEntrega` (el existente, `role="status"`). Si `imprimir` está activo, pide
`confirm('¿Empezar a imprimir ahora? Fijate que la cama esté libre.')`.

```js
/** @param {{abrirConfiguracion: () => void}} callbacks (main: abrirRedHoja) @returns {void} */
export function iniciarEnvio({ abrirConfiguracion }) {}

/** Muestra u oculta los botones según `estado.resultado` y la config guardada. @returns {Promise<void>} */
export async function actualizarEnvio() {}

/** Cancela un envío en curso, si lo hay (al elegir otro modelo). @returns {void} */
export function cancelarEnvio() {}
```

#### 6.9 Cambios en archivos existentes

- `src/ui/paso4-resultado.js`: importa `actualizarEnvio` y `cancelarEnvio` de `./envio-ui.js`; `mostrarResultado` llama
  `actualizarEnvio()` al final; `#otro` llama `cancelarEnvio()`. ≤ 6 líneas (la función ya está en el límite: va una
  línea cada una).
- `src/main.js`: `iniciarRedHoja({ alGuardar: actualizarEnvio })` y `iniciarEnvio({ abrirConfiguracion: abrirRedHoja })`.
- `src/ui/navegacion.js`: la hoja `'red'`.
- `src/sw.js`: `if (/^\/(api|server|printer|access)\//.test(new URL(request.url).pathname)) return;` antes de
  `respondWith` (decisión 8).
- `index.html` y los CSS: la hoja y los tres elementos del paso 4.

#### 6.10 Aristas de imports permitidas (para `scripts/lib/contratos-ui.js`)

```js
'ui/red-hoja': {
    exports: { iniciarRedHoja: 1, abrirRedHoja: 0 },
    importa: ['ui/estado', 'ui/navegacion', 'ui/util-dom', 'perfiles/perfiles', 'almacen',
              'red/direccion', 'red/peticiones', 'red/cliente', 'red/transporte', 'red/config-red'],
},
'ui/envio-ui': {
    exports: { iniciarEnvio: 1, actualizarEnvio: 0, cancelarEnvio: 0 },
    importa: ['ui/estado', 'ui/util-dom', 'ui/entrega-ui', 'ui/entrega', 'almacen',
              'red/cliente', 'red/transporte', 'red/config-red'],
},
// y se agregan: 'ui/paso4-resultado' += 'ui/envio-ui'; 'main' += 'ui/red-hoja', 'ui/envio-ui'.
```

Aristas de `src/red/` (las verifica la prueba de T1, que lee los `import` de cada archivo; no entra en
`contratos-ui.js`, que sólo recorre `src/ui/`):

```
red/direccion  → (nada)            red/peticiones → (nada)       red/errores   → (nada)
red/transporte → (nada)            red/cliente    → red/peticiones, red/errores
red/config-red → red/direccion
```

Prohibido en `src/red/`: importar `ui/*`, `almacen`, `perfiles/*`, `motor/*`; usar `document`, `window`, `localStorage`,
`console`, `fetch`/`XMLHttpRequest` globales sin pasar por parámetro (la prueba lo chequea leyendo el texto). Prohibido
en las UI: `console.*` con config; `innerHTML` sin `escapar`.

## Tareas

Reglas: ≤ 200 líneas de producción por tarea, archivos < 300, funciones < 40, cada tarea con su prueba en un archivo
propio. "Crear en paralelo, recablear en serie": las olas de crear no comparten archivos; lo que toca archivos
compartidos (`index.html`, `paso4-resultado.js`, `main.js`, `contratos-ui.js`, `probar-app.mjs`, `MAPA.md`) va en serie.

| Ola | Tarea | Rol | Qué | Archivos | Prueba | Depende de |
|---|---|---|---|---|---|---|
| 1 | **T1** | QA | **Escribe primero** las pruebas del cliente puro contra los contratos de la sección 6 (fallan hasta T2–T5): `direccion`, `peticiones`, `errores`, `cliente` (con transporte falso), `transporte` (con XHR falso), `config-red` (con almacén falso), y la de aristas/prohibiciones de `src/red/`. Más la impresora falsa reutilizable. | `scripts/red/direccion.mjs`, `peticiones.mjs`, `errores.mjs`, `cliente.mjs`, `transporte.mjs`, `config-red.mjs`, `aristas.mjs`, `scripts/red/lib/impresora-falsa.mjs`, `scripts/probar-red.mjs`, `package.json` (`test:red`) | `npm run test:red` (rojo hasta que existan T2–T5, a propósito) | — |
| 2 | **T2** | dev motor | `direccion.js` + `peticiones.js` (~180). Si T2 puede leer las páginas de las APIs, cierra los **[A VALIDAR]** del ADR en un comentario. | `src/red/direccion.js`, `src/red/peticiones.js` | `test:red`: `direccion.mjs`, `peticiones.mjs` | T1 |
| 2 | **T3** | dev motor | `errores.js` (~90) | `src/red/errores.js` | `errores.mjs` | T1 |
| 2 | **T4** | dev motor | `transporte.js` (~90) + `config-red.js` (~70) | `src/red/transporte.js`, `src/red/config-red.js` | `transporte.mjs`, `config-red.mjs` | T1 (`config-red` importa `direccion` de T2: se integra al final de la ola) |
| 3 | **T5** | dev motor | `cliente.js` (~120) | `src/red/cliente.js` | `cliente.mjs`, `aristas.mjs` | T2, T3 |
| 4 | **T6** | dev interfaz | Hoja de configuración: `red-hoja.js` (~150), `#hojaRed` en `index.html` (~35 de HTML), hoja `'red'` en `navegacion.js` (~3), estilos mínimos reusando `.formulario`/`.contenido-hoja`. | `src/ui/red-hoja.js`, `index.html`, `src/ui/navegacion.js`, `src/estilos.css` | `node --check`, `npm run lint`; la prueba de comportamiento es T8 | T4, T5 (puede arrancar antes contra los contratos) |
| 5 | **T7** | dev interfaz | **Recablear:** `envio-ui.js` (~130), botones en el pie del paso 4 (`index.html`), 6 líneas en `paso4-resultado.js`, `main.js`, contratos en `contratos-ui.js`, guarda en `sw.js`. | `src/ui/envio-ui.js`, `index.html`, `src/ui/paso4-resultado.js`, `src/main.js`, `scripts/lib/contratos-ui.js`, `src/sw.js`, `src/estilos.css` | `npm run test:contratos`, `npm run build`, `npm run lint` | T6 (comparten `index.html`, `estilos.css`) |
| 6 | **T8** | QA | `scripts/app/red.mjs` (Playwright con `page.route`) y registrarlo en `probar-app.mjs` | `scripts/app/red.mjs`, `scripts/probar-app.mjs` | `npm run test:app` (la corre quien tenga máquina libre) | T7 |
| 7 | **T9** | arquitecto | Cierre: `MAPA.md` (flujo, módulos, aristas, tabla de pruebas), `CHANGELOG.md`, Estado → Aceptado | `docs/MAPA.md`, `CHANGELOG.md`, este ADR | `npm run format:check` | T8 |
| 7 | **T10** | persona (con impresoras) | Validar todo lo **[A VALIDAR]**: ver "Lista de chequeo" | — | lista registrada en el PR | T7 |

Paralelismo: **T2 ∥ T3 ∥ T4** (archivos distintos; sólo `config-red` necesita el `direccion` de T2 al integrar).
**T6** puede escribirse en paralelo con T2–T5 contra los contratos (inyecta funciones falsas) y se integra después.
**T7 va en serie después de T6** (mismos `index.html` y `estilos.css`). **T1 va primero** (o a la par de T2–T4 si lo escribe
otra persona, porque sólo depende de los contratos). T10 puede empezar en cuanto T7 está en una rama.

Primer entregable de valor: hasta T5 la app no cambia; T7 activa la función (sin impresoras configuradas, nadie ve nada).

## Pruebas

Convención del repo: Node para lo puro (`scripts/red/*.mjs`, orquesta `scripts/probar-red.mjs`, `npm run test:red`),
Chromium para la app (`scripts/app/*.mjs`).

**Node, con `fetch`/transporte/XHR/almacén falsos (T1).**

- `direccion.mjs`: `192.168.1.50` → `http://192.168.1.50`; con puerto y con `/octoprint/`; `HTTP://Octopi.LOCAL/` →
  minúsculas y sin barra final. Rechaza `javascript:alert(1)`, `file:///x`, `ftp://x`, `http://user:pass@host`,
  `http://host?x=1`, `http://host#a`, vacío, sólo espacios, `http://`. `nombreSinLocal` es `true` para
  `http://octopi` y `false` para `http://octopi.local`, `http://192.168.0.2` y `https://x.ts.net`.
- `peticiones.mjs`: por tipo, método/URL/cabeceras exactos de versión, estado y subida; sin clave no hay `X-Api-Key`; la
  clave nunca aparece en `url`; el `FormData` de subida tiene `file` con el nombre saneado (`a/b:c.gcode` → `a_b_c.gcode`,
  100 caracteres máx., extensión intacta); sin `imprimir`, **ninguna** parte `print`/`select` (OctoPrint) ni `print`
  (Moonraker); con `imprimir`, `select=true` + `print=true` (OctoPrint) y `print=true` + `root=gcodes` (Moonraker); `leerVersion`,
  `estaOcupada` y `empezoAImprimir` con respuestas reales de ejemplo (`Printing`, `Operational`, `printing`, `standby`,
  JSON roto → `null`/`false`); `ayudaCors` contiene el origen recibido.
- `errores.mjs`: tabla de la sección 4 completa (401 y 403 con y sin clave, 404, 409 en subida, 413, 422, 500, 200 con
  cuerpo ajeno); `errorDeTransporte('red')` con `alcanzable: true` → `bloqueado`, con `false` → `sin-llegada` (el
  texto menciona contenido mixto sólo si `http`); `imprimiendo: true` agrega el aviso de "puede que haya llegado"; todos
  los mensajes son no vacíos y **ninguno contiene la clave** (se prueba con una clave centinela `SECRETO-123` pasada en
  la config de cada caso).
- `cliente.mjs`: `probarConexion` y `enviarGcode` contra la impresora falsa (OctoPrint y Moonraker): éxito, ocupada
  (estado `Printing`; 409), clave mala, 404, sin red (transporte rechaza `red`, sonda `false`), CORS (rechaza `red`,
  sonda `true`), tiempo, cancelado a mitad (`AbortController`: `alProgreso` llegó a > 0 y < 1); el orden de los pedidos es
  versión → estado; nunca lanza; el `console` está espiado y **no recibe nada** (ni con la clave centinela).
- `transporte.mjs`: con un `XHR` falso: arma la petición (método, URL, cabeceras, `FormData`), `onload` → `{estado,
  texto}`, `onerror` → `ErrorTransporte` `red`, `ontimeout` → `tiempo`, `senal.abort()` → `cancelado` y `xhr.abort()`
  llamado, progreso `loaded/total` en 0..1, nunca dividir por cero (`lengthComputable: false`); `sondaSinCors` resuelve
  `true`/`false` con `fetch` falso y le pasa `mode: 'no-cors'` y **ninguna** cabecera.
- `config-red.mjs`: ida y vuelta por almacén falso; `validarConfig` descarta tipo desconocido, dirección inválida,
  `claveApi` que no es texto; `describirConfig` oculta la clave; `leer` de una impresora no configurada → `null`;
  `borrar` no toca las otras impresoras; datos corruptos → `null`, no excepción.
- `aristas.mjs`: lee los `import` de cada archivo de `src/red/` y comprueba las aristas de 6.10; falla si hay un
  `console.`, `document`, `window.`, `localStorage` o `fetch(`/`new XMLHttpRequest` fuera de `transporte.js`.

**Chromium, `scripts/app/red.mjs` (T8), con `page.route`.**

La página se sirve desde `http://localhost` (contexto seguro), así que **estas pruebas no ejercitan el contenido mixto ni
el permiso de red local**: eso sólo se valida a mano (T10). Lo que sí cubren es el flujo completo contra impresoras
simuladas por `page.route('http://192.168.1.50/**', …)`, contestando también el preflight `OPTIONS` con las cabeceras
CORS cuando el caso lo pide.

```
// Precondición: paso 4 visible con el resultado del cubo de 20 mm y la Ender 3 V3 SE elegida, sin red configurada
//               (igual que después de descarga.mjs).
// Deja:         paso 4 visible con el mismo resultado, con la red de la Ender 3 V3 SE sin configurar (se quitó al
//               final), sin rutas simuladas activas y sin envío en curso.
```

Casos, en orden (cada uno limpia sus rutas con `page.unroute`):

1. Sin configurar: no está `#enviarRed`; sí `#configurarRed`; Compartir/Descargar siguen como antes.
2. **OctoPrint feliz:** abrir la hoja, tipo OctoPrint, dirección `192.168.1.50` (queda `http://192.168.1.50`), clave
   `CLAVE-PRUEBA`, **Probar conexión** → "Conectada" (la ruta recibió `GET /api/version` y `/api/job` con
   `X-Api-Key: CLAVE-PRUEBA`); Guardar; aparece `#enviarRed`; enviar → la ruta recibe un `POST /api/files/local`
   `multipart/form-data` con `name="file"`, `filename="cubo-20mm_rapido.gcode"`, el contenido empieza como el G-code, y
   **sin** `print` ni `select`; el botón muestra el progreso y termina en "Listo: se subió …". Se reabre la hoja: el campo de
   clave **no** contiene `CLAVE-PRUEBA`.
3. **Moonraker feliz** con `imprimir` encendido: `confirm` aceptado (el diálogo se acepta con `page.once('dialog')`);
   `POST /server/files/upload` con `file`, `root=gcodes`, `print=true`; respuesta `{item:…, print_started:true}` →
   "Se subió y empezó a imprimir".
4. **Clave mala** (403 / 401): mensaje de `clave`; el botón vuelve a quedar habilitado.
5. **Ocupada** (OctoPrint `409` al subir; Moonraker `print_stats.state = printing` al probar): mensaje de `ocupada`.
6. **Sin llegada:** `route.abort('failed')` en todo → mensaje `sin-llegada` con "Abrir la impresora" (enlace a la
   dirección, `target=_blank`, `rel=noopener`).
7. **CORS:** respuesta 200 sin `access-control-allow-origin` al `GET`/`POST`, y la sonda (`sec-fetch-mode: no-cors`)
   respondida → mensaje `bloqueado` con el origen de la app y el fragmento (`cors_domains` / "Allow Cross Origin").
8. **Cancelar:** la ruta de subida queda colgada hasta que la prueba la libere; se toca Cancelar → "Envío cancelado.", el
   botón vuelve, la petición se abortó; reintentar funciona.
9. **Escapar:** una dirección con `<img src=x onerror=…>` es rechazada; el nombre de impresora y el origen aparecen como
   texto (no se inyecta nada: `page.locator('#hojaRed img')` no existe).
10. **Service worker:** con la app instalada (la prueba `offline.mjs` ya deja el SW activo) `page.on('request')` muestra
    que los pedidos a `192.168.1.50` tienen `request.serviceWorker() == null`/no vienen del SW, y sin conexión del origen
    de la app el envío falla con `sin-llegada` en vez de servir algo del cache.
11. **Secreto:** `page.on('console')` y `page.on('pageerror')` se juntan durante toda la prueba y **ninguno** contiene
    `CLAVE-PRUEBA`; tampoco `localStorage`/`sessionStorage`.
12. **Bambu:** elegir una Bambu (que salga `.gcode.3mf`): no aparece `#enviarRed` ni `#configurarRed`.
13. Quitar la configuración: desaparece `#enviarRed`.

### Lista de chequeo para T10 (hardware y navegadores reales)

1. Chrome en Android (pestaña y PWA instalada): `https://<app>` → `http://IP` de OctoPrint y de Moonraker, con permiso de
   red local aceptado; con el permiso denegado (el mensaje es entendible y "Abrir la impresora" funciona).
2. La sonda distingue bien "apagada" de "CORS" y qué dice con LNA denegado.
3. XHR (no sólo `fetch`) pasa por la exención de contenido mixto y el permiso; si no, pasar a `fetch` con
   `targetAddressSpace: 'local'` (decisión 5).
4. Hostnames: `http://octopi.local` y `http://octopi` (sin `.local`): cuál anda.
5. Safari/iPhone y Firefox (Android y escritorio): confirmar que cae al plan de degradación y que el texto es claro.
6. OctoPrint: ¿`/api/version` exige clave?; texto de `state` en `/api/job`; ¿409 al subir sin `print`, estando imprimiendo?
   (esperado: no); valor de `done`; si "Allow Cross Origin" pide reiniciar.
7. Moonraker: respuesta de `/server/info` con y sin `trusted_clients`; `print_started`; 409; la subida "simple" sin clave
   desde un origen no permitido, ¿se ejecuta aunque el navegador la oculte? (riesgo R2).
8. Un G-code de 20 MB por Wi‑Fi desde un celu de gama baja: memoria, progreso y tiempo.
9. Mainsail/Fluidd detrás de nginx (`client_max_body_size`), OctoPrint detrás de haproxy: ¿rechazan archivos grandes
   (413)?

## Riesgos

| # | Riesgo | Cómo se cubre |
|---|---|---|
| R1 | **El navegador bloquea el pedido** (iPhone, Firefox, Chrome con LNA denegado, hostnames que no son IP ni `.local`). Es el caso más probable. | Plan de degradación de la sección 1: mensaje honesto, "Abrir la impresora", https de la impresora, y Descargar/Compartir siempre presentes. Se mide en T10. |
| R2 | **Un error de CORS puede ocultar que el pedido sí se ejecutó** (POST simple sin `X-Api-Key` a un Moonraker que confía en el celu): el archivo se sube y, con `print=true`, empieza a imprimir, y la app dice "bloqueado". | `imprimir` apagado por defecto + confirmación; el mensaje `bloqueado` con `imprimir` avisa "puede que haya llegado: mirá la impresora antes de reintentar". **[A VALIDAR]** (T10, punto 7). |
| R3 | **Se filtra la clave** (logs, mensajes, URL, DOM, exportaciones). | Sólo en cabecera; `describirConfig`; campo `password`; la prueba espía `console` y busca una clave centinela en mensajes, DOM y almacenamiento (T1, T8). |
| R4 | Que XHR no tenga la misma exención/permiso que `fetch` en Chrome (la documentación habla de `fetch` y subrecursos). | Transporte inyectable: si T10 lo confirma, se cambia `transporte.js` por una versión con `fetch` + `targetAddressSpace` sin tocar el resto (sin progreso fino). Decisión 5. |
| R5 | **Formas de las APIs sin confirmar** (esta sesión no pudo leer las páginas oficiales). | Marcado **[A VALIDAR]**; el cliente es tolerante (`leerVersion`/`estaOcupada` devuelven `null` ante lo inesperado y el mensaje es `respuesta`, no un cuelgue); T2 y T10 las confirman. |
| R6 | Memoria: un G-code grande armado como `Blob` y subido por multipart. | `FormData` con `Blob` se transmite sin copiar a un string; el G-code ya está en memoria por `estado.resultado`. T10, punto 8. |
| R7 | **Imprimir a distancia** sin que nadie vea la cama. | `imprimir` apagado por defecto; texto de confirmación; decisión 3. |
| R8 | Cambios de Chrome (LNA se endurece: la política que permite exceptuar sitios se retira, según fuentes secundarias, en Chrome 156, 20/10/2026). | No dependemos de políticas de empresa; el plan de degradación no cambia. Re-verificar con Chrome estable antes de T10. |
| R9 | Certificado https autofirmado de la impresora: el navegador lo rechaza y el error parece de red. | La hoja avisa que hace falta un certificado válido para https; mensaje `sin-llegada` lo menciona. |
| R10 | Previsualizaciones de Vercel con otro origen: CORS falla en cada una. | La hoja muestra el origen actual; recomendación de usar el dominio de producción (decisión 7). |
| R11 | La UI crece (`index.html`, `paso4-resultado.js`). | Lógica en `envio-ui.js`/`red-hoja.js`; 6 líneas en `paso4-resultado.js`; tope de 200 líneas por tarea. |

## Consecuencias

Más fácil: quien use OctoPrint/Moonraker y Chrome en Android sube el archivo con un toque, con el archivo ya con sus
pausas. Todo el cliente es puro y se prueba en Node sin impresoras. Más difícil: hay que explicar CORS y contenido mixto
a gente que no es técnica; en iPhone la función casi siempre cae al plan B; y la clave de API queda guardada en el celu.
Plan de reversa: es opcional y aislado (`src/red/`, dos módulos de UI y una hoja); quitar el cableado de `main.js` y
`paso4-resultado.js` la desactiva y no deja datos que molesten (sólo la clave `redImpresoras` en IndexedDB).

Fuera de v1: Bambu Lab (LAN por MQTT/FTPS); Prusa Link, Duet, Repetier; descubrimiento automático (mDNS no se puede
desde un navegador); WebSocket de estado y seguimiento de la impresión; varias impresoras a la vez; cola de envíos;
miniaturas; carpetas de destino; el servidor de compañía/puente local.

### Dudas abiertas para el CTO

1. **¿Bambu en v1?** Recomiendo **no** (sin API HTTP abierta en el navegador; MQTT/FTPS no se pueden).
2. **¿Configuración por impresora o global?** Recomiendo **por impresora** (`redImpresoras.porImpresora[id]`): la mayoría
   tiene una, pero las que tienen dos no se pisan y el botón sólo aparece donde corresponde. Costo extra: nulo.
3. **¿Se puede empezar a imprimir desde la app?** Recomiendo **sólo subir por defecto**; "Empezar a imprimir al terminar"
   es una casilla apagada de la hoja, con `confirm()` en cada envío. Alternativa más estricta: no ofrecer imprimir en v1.
4. **¿Clave de API en texto plano en IndexedDB?** Recomiendo **aceptarlo** (mismo riesgo que el resto del celu; sin
   exportarla, sin loguearla) y dejarlo escrito en la hoja. Alternativa (cifrar con WebCrypto) no mejora nada sin una
   contraseña del usuario.
5. **¿XHR (con progreso) o `fetch` con `targetAddressSpace: 'local'`?** Recomiendo **XHR en v1** con aviso de usar IP o
   `.local` (`nombreSinLocal` muestra una advertencia en la hoja); si T10 muestra que XHR no pasa la exención, cambiar el
   transporte a `fetch` y mostrar el progreso como "Enviando…" sin porcentaje.
6. **¿Documentar el https por Tailscale en la hoja?** Recomiendo **dos líneas de texto con un enlace** (no una guía), como
   salida para iPhone. El CTO decide si la app nombra a un producto de terceros.
7. **Nombre del dominio de la app.** Para CORS conviene un origen estable; recomiendo fijar el dominio de producción en la
   documentación de la hoja y no esperar que las previsualizaciones anden.
8. **Resguardo en `sw.js`** para no cachear `/api/`, `/server/`, `/printer/`, `/access/` si algún día la app se sirve desde
   la propia impresora: recomiendo **hacerlo en T7** (una línea; hoy es inocuo).
9. **Texto de los errores y del plan B:** ¿lo revisa alguien de producto antes de T7? Recomiendo sí, 15 minutos con los
   textos de la sección 4.
10. **¿Cuándo se valida en hardware (T10)?** Recomiendo **antes de aceptar** el ADR en lo que toca contenido mixto (puntos 1 a 5
    de la lista), porque define si la función es útil en iPhone y qué dice la hoja.

### Decisiones del CTO (2026-10-19)

1. Bambu: **no** en v1.
2. Configuración **por impresora**.
3. **Sólo subir** por defecto; "Empezar a imprimir al terminar" apagado, con `confirm()` en cada envío. Con esa casilla
   prendida, el mensaje `bloqueado` avisa "puede que haya llegado: mirá la impresora antes de reintentar" (R2) y la app
   **nunca** reintenta sola.
4. Clave en texto plano en IndexedDB: **aceptado**, dicho en la hoja; nunca se loguea, exporta ni vuelve al DOM.
5. **`fetch` en v1, no XHR**: la exención documentada de Chrome es para `fetch`, y es la única forma de pasar
   `targetAddressSpace: 'local'` (necesaria para nombres que no son IP ni `.local`). `transporte.js` usa `fetch` con
   `targetAddressSpace: 'local'` cuando la dirección es privada o `.local` (la opción se ignora donde no existe) y
   `AbortController`; el progreso de subida se muestra como "Enviando…" sin porcentaje. La prueba de T1 usa un `fetch`
   falso (no XHR). El transporte sigue inyectable.
6. Tailscale: **sí**, dos líneas genéricas ("un https con certificado válido, por ejemplo con Tailscale"), sin enlace.
7. Dominio: la hoja muestra el origen actual (`location.origin`) para copiarlo en la config de CORS; la documentación
   recomienda el de producción.
8. Guarda en `sw.js`: **sí**, en T7.
9. Textos: los revisa el CTO al revisar T6/T7.
10. Hardware: T10 queda en la checklist del README ("Lo que NO pude validar"); la hoja dice "experimental" hasta entonces.
