# 0005. Exportar .gcode.3mf para impresoras Bambu Lab

- **Fecha:** 2026-10-18
- **Autor/a:** arquitecto
- **Base:** commit `d0f3de0`

## Estado

Implementado (T1 a T7; T8 cierre). Aceptado por el CTO el 2026-10-18, con estas decisiones:

- **T0 no bloquea:** no hay un `.gcode.3mf` de referencia exportado de Bambu Studio. Se implementa con lo público y
  todo lo marcado **[A VALIDAR]** lo valida una persona en T9.
- **Perfiles Bambu con aviso:** salen con `estado: revisado` y un `aviso` ("Perfil sin validar con la impresora:
  probalo con un cubo antes de una pieza grande"), sin flag.
- **P1P fuera de v1:** alcanza con la P1S.
- **Firma de firmware:** si la exige, queda el aviso en el perfil (R7) y no se hace nada más en v1.

## Contexto

Laminar Móvil lamina STL → G-code en el navegador con Kiri:Moto y entrega un `.gcode` de texto plano
(`paso4-resultado.js`: `archivoGcode()` inserta las pausas con `insertarPausas` y lo comparte o descarga como
`text/plain`). Las Bambu Lab (A1, A1 mini, P1P/P1S, X1C) no se llevan bien con eso: Bambu Studio, Bambu Handy y la
impresora (por tarjeta SD o por LAN) trabajan con **`.gcode.3mf`**, un ZIP (OPC/3MF) que lleva el G-code de la placa
adentro más metadatos. Por eso el importador (`scripts/importar-impresoras-kiri.mjs`, tabla `EXCLUIDAS`) saltea
`Bambu.A1` y `Bambu.P1S` con el motivo "esperan archivos .gcode.3mf, no G-code plano", y `src/perfiles/LEEME.md` lo
repite. Hoy esas impresoras no se pueden usar en la app.

Hechos que condicionan el diseño:

- `jszip` (^3.10.2) ya es dependencia: `src/motor/formatos-3mf.js` lo usa para **leer** 3MF. Escribir con JSZip no suma
  nada nuevo al bundle. Verificado en Node 22: `generateAsync({ type: 'blob', compression: 'DEFLATE' })` devuelve un
  `Blob` y `JSZip.loadAsync` lo vuelve a abrir.
- **MD5 no existe** en WebCrypto (`crypto.subtle.digest` sólo trae SHA-1/256/384/512) y JSZip no lo calcula. Bambu
  guarda el MD5 del G-code en `Metadata/plate_1.gcode.md5` y la impresora lo chequea al abrir el archivo (ver 1.3).
  Hace falta un MD5 en JS puro: son unas 70 líneas, sin dependencias.
- El G-code que va adentro tiene que ser **el mismo** que se descargaría como `.gcode` (con las pausas ya insertadas
  por `insertarPausas`). Las pausas se aplican al descargar, no al laminar, así que el armado del contenedor también
  pasa **al descargar o compartir**, no en el worker.
- Un perfil de impresora hoy es sólo datos (`src/perfiles/impresoras/*.json`, ver `LEEME.md`); `gcodeFExt` ya existe
  en `dispositivo` (`"gcode"` en la Ender 3 V3 SE) pero la app no lo usa para decidir nada.
- `paso4-resultado.js` ya tiene 99 líneas y `mostrarResultado` ocupa casi todo el límite de 40; no conviene
  sumarle la lógica del contenedor adentro. Convenciones del ADR 0001: módulos de UI que no tocan el DOM al
  importarse y reciben callbacks; contratos verificados por `scripts/lib/contratos-ui.js`.
- `navigator.share` exige gesto del usuario vigente; si armar el ZIP tarda, el gesto puede vencer (ver R4).
- No hay una impresora Bambu a mano en el desarrollo. Lo que diga este ADR sobre cómo la firmware lee el archivo sale
  de la estructura que escriben Bambu Studio y OrcaSlicer (documentación y código públicos) y de lo que hacen
  herramientas de terceros que arman `.gcode.3mf`; **no está validado con hardware** y cada punto dudoso lleva la
  marca **[A VALIDAR]**. Lo valida una persona después (T9).

## Decisión

### 1. Formato del contenedor

#### 1.1 Entradas del ZIP

Un `.gcode.3mf` de Bambu Studio lleva unas quince entradas (modelo completo, configuración de proyecto, cinco PNG,
`plate_1.json`, etc.). Nosotros armamos el mínimo que tenga sentido para abrir y mandar a imprimir, y separamos
**obligatorio** de **opcional**:

| Entrada | v1 | Para qué sirve |
|---|---|---|
| `[Content_Types].xml` | obligatoria | Tipos de cada extensión (OPC). Sin esto JSZip abre el ZIP pero Bambu Studio lo rechaza como 3MF. |
| `_rels/.rels` | obligatoria | Relaciones OPC: modelo principal y miniaturas. |
| `3D/3dmodel.model` | obligatoria | Modelo 3MF. Va **sin malla** (ver 1.4): sólo cabecera y `<build/>` vacío. |
| `Metadata/plate_1.gcode` | obligatoria | El G-code de la placa 1, con las pausas. Es lo único que la impresora ejecuta. |
| `Metadata/plate_1.gcode.md5` | obligatoria | MD5 del G-code (ver 1.3). |
| `Metadata/slice_info.config` | obligatoria | Resumen que muestran Bambu Studio / Handy y la pantalla: tiempo, gramos, filamento, modelo de impresora. |
| `Metadata/model_settings.config` | obligatoria | Placas y objetos del proyecto (aquí, una placa y un objeto con el nombre del archivo). |
| `Metadata/plate_1.png` | opcional | Miniatura de la placa (512×512). Sin ella la pantalla muestra un recuadro vacío. |
| `Metadata/plate_1_small.png` | opcional | Miniatura chica (128×128). |
| `Metadata/project_settings.config` | **fuera de v1** | Perfiles de Bambu Studio (JSON enorme). Sin él Bambu Studio avisa que faltan ajustes. **[A VALIDAR]** que no bloquee. |
| `Metadata/plate_1.json`, `plate_no_light_1.png`, `top_1.png`, `pick_1.png`, `cut_information.xml` | **fuera de v1** | Datos de la vista 3D de Bambu Studio. La impresora no los usa. |

La lista **obligatoria** es nuestra apuesta de mínimo seguro: `plate_1.gcode`, `.md5`, `slice_info.config` y la
estructura OPC. Que `model_settings.config` y `3D/3dmodel.model` sean estrictamente necesarios para la impresora
**no está confirmado** (los incluimos porque Bambu Studio y Handy los esperan al abrir el archivo). **[A VALIDAR]**

#### 1.2 Contenido de ejemplo de cada entrada

`[Content_Types].xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>
```

`_rels/.rels` (las dos relaciones de miniatura sólo si hay PNG):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>
 <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>
</Relationships>
```

`3D/3dmodel.model` (sin malla):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">laminar-movil</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">cubo-20mm</metadata>
 <resources/>
 <build/>
</model>
```

`Metadata/plate_1.gcode`: el G-code completo (texto UTF-8), con `; --- PAUSA: ... ---` y `M400 U1` donde el usuario
marcó cambios de filamento.

`Metadata/plate_1.gcode.md5`: 32 caracteres hexadecimales, **en mayúsculas y sin salto de línea final**, del
contenido exacto de `plate_1.gcode` (los bytes UTF-8 que van en el ZIP), por ejemplo
`9E107D9D372BB6826BD81D3542A419D6`. Mayúsculas y sin `\n` es lo que escribe Bambu Studio. **[A VALIDAR]** (la
firmware podría comparar sin distinguir mayúsculas; no lo asumimos).

`Metadata/slice_info.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="laminar-movil"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="printer_model_id" value="N2S"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="timelapse_type" value="0"/>
    <metadata key="prediction" value="1920"/>
    <metadata key="weight" value="4.37"/>
    <metadata key="outside" value="false"/>
    <metadata key="support_used" value="false"/>
    <metadata key="label_object_enabled" value="false"/>
    <object identify_id="1" name="cubo-20mm" skipped="false"/>
    <filament id="1" tray_info_idx="GFL99" type="PLA" color="#FFFFFF" used_m="1.46" used_g="4.37"/>
  </plate>
</config>
```

`prediction` son segundos; `weight` y `used_g` son gramos; `used_m` son metros de filamento. Los `printer_model_id` que
usamos: A1 = `N2S`, A1 mini = `N1`, P1P = `C11`, P1S = `C12`, X1C = `BL-P001`. Los `tray_info_idx` genéricos:
PLA `GFL99`, PETG `GFG99`, ABS `GFB99`, ASA `GFB98`, TPU `GFU99`. **[A VALIDAR]** todos los identificadores contra un
`slice_info.config` real de cada modelo (T0).

`Metadata/model_settings.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="cubo-20mm"/>
    <metadata key="extruder" value="1"/>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="1"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>
</config>
```

`Metadata/plate_1.png` y `plate_1_small.png`: bytes PNG tal cual los entrega el llamador (campo `miniatura`, ver
sección 3). En v1 el llamador **no** los genera (ver "Fuera de v1").

#### 1.3 El MD5

Se calcula sobre los bytes del G-code ya codificados en UTF-8, los mismos que se guardan en el ZIP: una sola
codificación (`TextEncoder`) sirve para el MD5 y para `zip.file(...)`. Para no bloquear la interfaz con G-codes de
decenas de MB, el MD5 es **incremental** (`Md5.agregar(trozo)`) y se alimenta de a 4 MB cediendo el hilo entre trozo y
trozo. Se prueba contra los vectores de RFC 1321 y contra `node:crypto` con G-codes de tamaño real.

#### 1.4 Sin malla en `3dmodel.model` (decisión y plan B)

No ponemos geometría: la app no tiene a mano la malla ya orientada y acomodada en el formato de Bambu, y meter el STL
de cada pieza sumaría memoria y código. Riesgo conocido: Bambu Studio puede abrir el archivo con la placa vacía o
quejarse de un proyecto sin objetos. **[A VALIDAR]** (T9). **Plan B**, si falla: `info.caja` (ancho, fondo, alto de la
pieza, ya disponible como `info.tamano`) genera un único objeto-caja de 12 triángulos en `3dmodel.model`; cambia sólo
`armarModelo` en `bambu-xml.js` (un campo nuevo opcional; el resto del contrato no cambia).

### 2. Perfiles de impresora Bambu

#### 2.1 Clave nueva: `salida`

Nueva clave **opcional** en el JSON de la impresora, a nivel raíz (junto a `pausa`):

| Clave | Qué es |
|---|---|
| `salida` | Contenedor de la descarga: `"gcode"` (por defecto, G-code plano, como hoy) o `"gcode.3mf"` (ZIP de Bambu). |
| `modeloBambu` | Sólo con `salida: "gcode.3mf"`: `{ id, nombre }` para `slice_info.config` (por ejemplo `{ "id": "N2S", "nombre": "Bambu Lab A1" }`). |

Lo lee una función nueva de `src/perfiles/valores.js`, reexportada por `perfiles.js` como `lineasPausa`:

```js
/**
 * Contenedor de salida de la impresora.
 * @param {object} imp perfil de impresora (`salida`)
 * @returns {'gcode'|'gcode.3mf'} `'gcode'` si el perfil no dice nada o dice cualquier otra cosa
 */
export function salidaDe(imp) {}
```

Por qué una clave y no deducirlo de `marca === 'Bambu Lab'`: los datos viajan con el perfil (también los propios del
usuario, "Mi impresora" podría ofrecerlo más adelante) y la lógica no queda con un `if` por marca. `gcodeFExt` de
`dispositivo` **no** se usa: es una clave de Kiri que sólo cambia el nombre que Kiri sugiere, y mezclar las dos fuentes
confunde.

#### 2.2 Los cuatro perfiles revisados

Cuatro archivos nuevos en `src/perfiles/impresoras/` (los detecta el glob de `catalogo.js`, no hay que tocar código),
`"estado": "revisado"`, copiados de `creality-ender-3-v3-se.json` y adaptados:

| Archivo | `id` | Cama (X×Y×Z) | `hotendMax` / `camaMax` | `modeloBambu.id` |
|---|---|---|---|---|
| `bambu-lab-a1.json` | `bambu-lab-a1` | 256×256×256 | 300 / 100 | `N2S` |
| `bambu-lab-a1-mini.json` | `bambu-lab-a1-mini` | 180×180×180 | 300 / 80 | `N1` |
| `bambu-lab-p1s.json` | `bambu-lab-p1s` | 256×256×256 | 300 / 100 | `C12` |
| `bambu-lab-x1c.json` | `bambu-lab-x1c` | 256×256×256 | 300 / 120 | `BL-P001` |

La P1P comparte cama y firmware con la P1S: no es perfil propio en v1 (se elige la P1S y el aviso lo aclara). Todos:
`marca: "Bambu Lab"`, `originCenter: false` (el (0,0) es la esquina frontal izquierda), boquilla 0,4 mm y filamento
1,75 mm, `fwRetract: false`, `salida: "gcode.3mf"`, `adhesion: "falda"`, `pausa: ["M400 U1"]`. Valores base de `proceso`
y de las tres calidades a partir de la Ender 3 V3 SE, con velocidades más altas (la A1 y las P1/X1 aguantan 200 mm/s y
`outputMaxFlowrate` ~ 21 mm³/s con PLA). Los valores finos salen de la tarea T3.

Los cuatro llevan `aviso`: *"Archivo .gcode.3mf armado por Laminar Móvil. Es experimental: probalo primero con una pieza
chica. Las pausas usan M400 U1; el cambio de filamento se hace a mano en la pantalla."*

**G-code de inicio y fin "plano"** (sin macros de Bambu Studio): el de Bambu Studio usa macros del slicer
(`M1002 gcode_claim_action`, `M620`/`M621` de AMS, calibraciones de flujo). No los copiamos. Boceto del inicio de la A1
(los valores exactos y la secuencia son de T3; **[A VALIDAR]** en la máquina):

```
; --- Inicio: Bambu Lab A1 (laminar-movil) ---
; total layer number: {layers}
M104 S140                    ; precalentar sin que gotee
M140 S{bed_temp}             ; calentar cama
G28                          ; home
M190 S{bed_temp}             ; esperar la cama
M109 S{temp}                 ; esperar la boquilla
G90
M83
G92 E0
G1 Z0.5 F3000
G1 X20 Y10 F5000 ; línea de purga (T3 la ajusta al modelo)
...
```

Fin: levantar Z, `M104 S0`, `M140 S0`, `M106 S0`, `M106 P2 S0`, `M84`. `gcodeFan: ["M106 S{fan_speed}"]` (ventilador
de pieza, P1), `gcodeTrack: ["M73 P{progress}"]`, `gcodeLayer: [";LAYER:{layer}", "M991 S0 P{layer}"]` (el `M991` avisa
el cambio de capa a la pantalla; **[A VALIDAR]** que no moleste sin las macros del slicer). Sin nivelación en el inicio
de v1 (`G29`) salvo que T9 demuestre que hace falta; A1 y P1S/X1C la tienen y se puede sumar sin cambiar el contrato.

#### 2.3 La pausa

`"pausa": ["M400 U1"]`. `M400 U1` espera a que termine el movimiento y deja la impresora en pausa esperando que se
retome desde la pantalla o Bambu Handy (es lo que usa Bambu Studio para "pausa por usuario"). No usa `M600`: la
firmware de Bambu no lo implementa. `insertarPausas` no cambia: sólo recibe otras `lineas`. **[A VALIDAR]** el
comportamiento exacto (si descarga el filamento, si hace falta `M104` antes) en la máquina real; una variante más
completa va en `pausa` (es un arreglo) sin tocar código.

#### 2.4 El importador

`scripts/importar-impresoras-kiri.mjs` **sigue salteando** `Bambu.A1` y `Bambu.P1S`: el perfil de Kiri trae el G-code
de inicio de un slicer que no es el nuestro y no sabe de `salida`. Cambia sólo el **motivo** en `EXCLUIDAS`, para que
no parezca un pendiente:

```js
'Bambu.A1': 'perfil revisado a mano en src/perfiles/impresoras/bambu-lab-a1.json (salida .gcode.3mf, ADR 0005)',
'Bambu.P1S': 'perfil revisado a mano en src/perfiles/impresoras/bambu-lab-p1s.json (salida .gcode.3mf, ADR 0005)',
```

Alternativa descartada: importarlas con `reemplaza`. No hay perfil importado que tapar (el importador no las genera),
y un importado Bambu con G-code plano sería peor que ninguno. `LEEME.md` documenta `salida`/`modeloBambu`, actualiza la
lista de revisados y la frase del importador.

## Contratos

Todo lo nuevo es **puro** (sin DOM, sin `self`, sin imports de `src/perfiles`) y se prueba en Node con `jszip`.

### 3.1 `src/motor/md5.js` (nuevo, ~80 líneas, sin imports)

```js
/**
 * MD5 incremental sobre bytes (RFC 1321). Mismo resultado que `crypto.createHash('md5')`.
 * Existe porque WebCrypto no ofrece MD5 y el .gcode.md5 de Bambu lo exige.
 */
export class Md5 {
    /** @param {Uint8Array} trozo bytes a sumar; se pueden dar en varios trozos de cualquier tamaño
     *  @returns {Md5} this (encadenable) */
    agregar(trozo) {}
    /** Cierra el cálculo. No se puede volver a llamar a `agregar` después.
     *  @param {boolean} [mayusculas=false] @returns {string} 32 caracteres hexadecimales */
    hex(mayusculas = false) {}
}

/** Atajo de una sola pasada. @param {Uint8Array} bytes @returns {string} 32 hex en minúsculas */
export function md5Hex(bytes) {}
```

### 3.2 `src/motor/bambu-xml.js` (nuevo, ~140 líneas, sin imports)

Funciones puras string → string, una por entrada de texto. Aparte de `bambu-3mf.js` para respetar el límite de 300
líneas y poder probarlas sin ZIP.

```js
/** @param {boolean} conMiniatura @returns {string} [Content_Types].xml */
export function armarContentTypes(conMiniatura) {}
/** @param {boolean} conMiniatura incluye las relaciones de plate_1.png / plate_1_small.png @returns {string} _rels/.rels */
export function armarRels(conMiniatura) {}
/** @param {string} nombre título del modelo @returns {string} 3D/3dmodel.model (sin malla) */
export function armarModelo(nombre) {}
/** @param {string} nombre @returns {string} Metadata/model_settings.config */
export function armarModelSettings(nombre) {}
/** @param {InfoBambu} info @returns {string} Metadata/slice_info.config */
export function armarSliceInfo(info) {}
/** Escapa & < > " ' para atributos y texto XML. @param {string} s @returns {string} */
export function escaparXml(s) {}
```

### 3.3 `src/motor/bambu-3mf.js` (nuevo, ~110 líneas)

Importa `jszip`, `./md5.js` y `./bambu-xml.js`.

```js
/**
 * @typedef {object} InfoBambu
 * @property {string} nombre              nombre del objeto/archivo sin extensión (ej. "cubo-20mm")
 * @property {number} tiempo              segundos estimados (`info.tiempo` del motor)
 * @property {number} gramos              gramos de filamento (gramos = mm de filamento × área × densidad, ya calculado por la UI)
 * @property {number} [metros]            metros de filamento (`info.filamento` / 1000); si falta se estima de `gramos`
 * @property {{id:string, nombre?:string}} modelo   modelo Bambu (`modeloBambu` del perfil; `id` va a `printer_model_id`)
 * @property {number} [boquilla=0.4]      diámetro (mm)
 * @property {{tipo:string, color:string, trayInfoIdx:string}} filamento  ej. {tipo:'PLA', color:'#FFFFFF', trayInfoIdx:'GFL99'}
 * @property {boolean} [soportes=false]
 * @property {Uint8Array} [miniatura]     PNG 512×512 → Metadata/plate_1.png
 * @property {Uint8Array} [miniaturaChica] PNG 128×128 → Metadata/plate_1_small.png
 */

/**
 * Arma un .gcode.3mf de Bambu con una sola placa (ver la tabla de la sección 1.1).
 * El G-code se codifica una sola vez en UTF-8; ese mismo arreglo alimenta al MD5 y al ZIP.
 * @param {string} gcode G-code final, con las pausas ya insertadas
 * @param {InfoBambu} info
 * @param {{alProgreso?: (fraccion:number) => void}} [opciones] `alProgreso` recibe 0..1 (para el cartel "Armando el archivo…")
 * @returns {Promise<Blob>} ZIP (compresión DEFLATE nivel 1, `type: 'application/octet-stream'`)
 * @throws {Error} 'El G-code está vacío.' si `gcode` no tiene texto; 'Falta el modelo de impresora Bambu.' sin `info.modelo.id`
 */
export async function armarGcode3mf(gcode, info, opciones) {}
```

Por qué devolver `Blob` y no `Uint8Array`: el navegador puede mantener el Blob fuera del heap de JS (lo respalda en
disco con archivos grandes) y `new File([blob], nombre)` no lo copia. `JSZip.generateAsync({ type: 'blob' })` lo
resuelve sin cargar el ZIP entero como arreglo. Con `streamFiles: true` escribe cada entrada con descriptor de datos,
lo que acepta cualquier lector de ZIP; **[A VALIDAR]** que la firmware lo lea (si no, `streamFiles: false`, una línea).

Nombres exactos de entrada: constantes exportadas `ENTRADAS` (`{ gcode: 'Metadata/plate_1.gcode', md5:
'Metadata/plate_1.gcode.md5', ... }`) para que las pruebas y el resto de la app no repitan cadenas.

### 3.4 `src/ui/entrega.js` (nuevo, ~70 líneas, módulo de UI sin DOM)

Decide **qué archivo** se entrega: aplica las pausas, elige el contenedor y arma el nombre. No lee `estado` ni
`perfiles` (recibe todo por parámetros), así que se prueba en Node.

```js
/**
 * @typedef {object} Salida
 * @property {'gcode'|'gcode.3mf'} formato  `salidaDe(imp)`
 * @property {string[]} pausa               `lineasPausa(imp)`
 * @property {{id:string, nombre?:string}} [modelo]  `imp.modeloBambu`, obligatorio con 'gcode.3mf'
 */

/** `cubo_rapido.gcode` → `cubo_rapido.gcode.3mf` si `formato` es 'gcode.3mf'; si no, el mismo nombre.
 *  Si `archivo` no termina en `.gcode`, le agrega la extensión de todos modos.
 *  @param {string} archivo @param {'gcode'|'gcode.3mf'} formato @returns {string} */
export function nombreEntrega(archivo, formato) {}

/** MIME para `File`: `text/plain` para G-code plano (varios celus no comparten `text/x-gcode`);
 *  `application/octet-stream` para el 3MF al descargar.
 *  @param {'gcode'|'gcode.3mf'} formato @returns {string} */
export function mimeEntrega(formato) {}

/**
 * Arma el archivo a entregar: inserta las pausas y, según `salida.formato`, lo deja como G-code plano
 * o dentro de un .gcode.3mf.
 * @param {{gcode:string, archivo:string, info:object}} resultado  `estado.resultado`
 * @param {{capa:number, offset:number, z:number}[]} pausas        `[...estado.pausas.values()]`
 * @param {Salida} salida
 * @param {InfoBambu} [infoBambu]   obligatorio con 'gcode.3mf' (lo arma paso4: tiempo, gramos, material)
 * @param {(fraccion:number) => void} [alProgreso]
 * @returns {Promise<File>}  nombre = `nombreEntrega(resultado.archivo, salida.formato)`
 */
export async function armarEntrega(resultado, pausas, salida, infoBambu, alProgreso) {}
```

Aristas permitidas de `entrega.js` (nivel 1, ADR 0001): `motor/pausas`, `motor/bambu-3mf`. Nada de `estado`,
`perfiles`, `util-dom`. `paso4-resultado` pasa a importarlo (nivel 5 → nivel 1, sin ciclo).

### 3.5 Cambio en `src/ui/paso4-resultado.js`

Se mantiene `iniciarPaso4({ alOtroModelo })` y `mostrarResultado()`. Cambios:

1. `archivoGcode()` (síncrona) se reemplaza por una función **asíncrona** y cacheada:

```js
/** Archivo a entregar con las pausas de ahora. Se arma una vez por combinación de pausas: la clave es
 *  `impresoraId` + pausas ordenadas por offset; si cambia, se vuelve a armar.
 *  @returns {Promise<File>} */
function archivoEntrega() {}
```

Arma `Salida` con `salidaDe(imp)`, `lineasPausa(imp)` y `imp.modeloBambu`, y `InfoBambu` con: nombre =
`archivo` sin extensión; `tiempo = info.tiempo`; `gramos` y `metros` con las mismas cuentas que ya hace
`materiales.filasResumen` (se **extrae** a una función exportada de `materiales.js` `gramosDe(filamentoMm, diametro,
material)` si hoy no existe, tarea T6); filamento a partir de `estado.material`; `soportes = estado.soportes`.

2. **Precarga**: `mostrarResultado()` y cada cambio de pausas (hoy `pausas-ui` dispara un callback al cambiar; T6 verifica
   dónde engancharse sin tocar `pausas-ui` si se puede) llaman a `archivoEntrega()` sin esperar el resultado cuando
   `salidaDe(imp) === 'gcode.3mf'`, para que Compartir tenga el archivo listo (R4). Con `'gcode'` no se precarga: el
   camino es el de hoy.
3. **Compartir**: `await navigator.share({ files: [await archivoEntrega()], title: nombre })`. Si el gesto venció
   (`NotAllowedError`) muestra "Listo el archivo. Tocá Compartir otra vez" (el cache ya lo tiene). Para decidir si se
   muestra el botón se usa `navigator.canShare({ files: [new File([], nombre, { type })] })` con un archivo vacío del
   nombre y MIME finales, **sin armar el ZIP** (reemplaza la llamada actual a `archivoGcode()` en `mostrarResultado`).
   Para el 3MF se prueba con `type` = `application/octet-stream`, `application/zip`, `model/3mf` en ese orden y se queda
   con el primero que `canShare` acepte; si ninguno, el botón Compartir se oculta y queda Descargar. **[A VALIDAR]** en
   Android e iOS (T9).
4. **Descargar**: igual que hoy pero con `await archivoEntrega()` y `a.download = file.name`.
5. `$('nombreArchivo').textContent = nombreEntrega(archivo, salida)`. La fila "Archivo" del resumen sigue mostrando el
   tamaño del G-code (`formato.bytes(gcode.length)`); con 3MF el rótulo pasa a "G-code".
6. Mientras se arma (puede tardar unos segundos con G-codes grandes) se deshabilita el botón y se muestra "Armando el
   archivo…" con `alProgreso`. Es lo único del paso 4 que toca texto nuevo en el DOM; usa los ids que ya existen
   (`#descargar`, `#compartir`), sin elementos nuevos.

`paso3-laminar.js` **no cambia**: `resultado.archivo` sigue siendo `…_calidad.gcode` y la extensión final la decide
`nombreEntrega`.

## Tareas

Reglas del equipo: máximo 200 líneas de producción por tarea, archivos < 300 líneas, funciones < 40, cada tarea con su
prueba en un archivo propio. "Crear en paralelo, recablear en serie": las olas de crear no comparten archivos
existentes; lo que toca archivos compartidos (`paso4-resultado.js`, `probar-*.mjs`, `contratos-ui.js`, `MAPA.md`)
va en serie al final.

| Ola | Tarea | Rol | Qué | Archivos | Prueba | Depende de |
|---|---|---|---|---|---|---|
| 0 | **T0** | persona (pendiente, con Bambu Studio / impresora) | Exportar de Bambu Studio un `.gcode.3mf` de un cubo de 20 mm para A1 y P1S (y X1C si hay), con y sin AMS; pasar el listado de entradas y el contenido de `slice_info.config`, `model_settings.config`, `.rels` y `plate_1.gcode.md5` (los PNG y el G-code no hacen falta). Se guarda como `scripts/formatos/ref-bambu/*.txt`. Confirma o corrige la sección 1 de la Decisión. | `scripts/formatos/ref-bambu/` | revisión de la persona | — |
| 1 | **T1** | dev motor | `md5.js`: `Md5`, `md5Hex` (~80 líneas) | `src/motor/md5.js` | `scripts/formatos/md5.mjs` (Node) | — |
| 1 | **T2** | dev motor | `bambu-xml.js`: las seis funciones de texto (~140) | `src/motor/bambu-xml.js` | `scripts/formatos/bambu-xml.mjs` (Node) | — |
| 1 | **T3** | dev datos | Los cuatro perfiles Bambu, `salidaDe` en `valores.js` (+ reexport en `perfiles.js`), `LEEME.md` y el motivo en `EXCLUIDAS` del importador (~30 de código, el resto datos) | `src/perfiles/impresoras/bambu-lab-*.json` ×4, `src/perfiles/valores.js`, `src/perfiles/perfiles.js`, `src/perfiles/LEEME.md`, `scripts/importar-impresoras-kiri.mjs` | `scripts/motor/bambu-perfiles.mjs` (Chromium, ver Pruebas) | — |
| 2 | **T4** | dev motor | `bambu-3mf.js`: `armarGcode3mf`, `ENTRADAS` (~110) | `src/motor/bambu-3mf.js` | `scripts/formatos/bambu-3mf.mjs` (Node) | T1, T2 |
| 3 | **T5** | dev interfaz | `entrega.js`: `nombreEntrega`, `mimeEntrega`, `armarEntrega` (~70) | `src/ui/entrega.js` | `scripts/formatos/entrega.mjs` (Node) | T4 |
| 4 | **T6** | dev interfaz | **Recablear `paso4-resultado.js`** con `entrega` (Contratos 3.4 y 3.5), `gramosDe` si falta, y registrar el contrato de `entrega` en `scripts/lib/contratos-ui.js` | `src/ui/paso4-resultado.js`, `src/ui/materiales.js`, `scripts/lib/contratos-ui.js` | `npm run test:contratos`, `npm run build` | T3, T5 |
| 5 | **T7** | dev interfaz | Prueba de la app: elegir una Bambu, laminar el cubo, marcar una pausa, descargar y abrir el ZIP con jszip; descarga de una Ender sigue siendo `.gcode`. Registrar los archivos nuevos en `probar-app.mjs` y `probar-motor.mjs` | `scripts/app/descarga-bambu.mjs`, `scripts/probar-app.mjs`, `scripts/probar-motor.mjs`, `package.json` (`test:formatos` suma los nuevos) | `npm run test:app`, `npm run test:motor`, `npm run test:formatos` | T6 |
| 6 | **T8** | arquitecto | Cierre: `MAPA.md` (flujo, módulos, aristas de `entrega`, tabla de pruebas), `CHANGELOG.md`, Estado → Aceptado | `docs/MAPA.md`, `CHANGELOG.md`, este ADR | `npm run format:check` | T7 |
| 6 | **T9** | persona (pendiente, con hardware) | Validar todo lo marcado **[A VALIDAR]**: abrir el `.gcode.3mf` en Bambu Studio y Handy, imprimir un cubo por SD y por LAN en A1 y P1S, probar la pausa `M400 U1`, el compartir en Android y iOS y las miniaturas | — | lista de chequeo de Pruebas, registrada en el PR | T7 |

Paralelismo: **T0 ∥ T1 ∥ T2 ∥ T3** (nadie toca archivos de otro; T0 no es código). **T4** espera a T1 y T2 porque los
importa. **T5** espera a T4. T6 y T7 van **en serie** (comparten `paso4-resultado.js`, `contratos-ui.js` y los
orquestadores de pruebas). T0 no bloquea: si el listado de la persona contradice la sección 1 de la Decisión, T4 lo corrige antes de
cerrar (los cambios son de texto en `bambu-xml.js`).

Primer entregable de valor: hasta T5 la app no cambia para el usuario; T6 activa las Bambu.

## Pruebas

Todas con la convención del repo: Node para lo puro (`scripts/formatos/*.mjs`, que ya orquesta
`scripts/probar-formatos.mjs`), Chromium para lo que necesita Kiri o la app (`scripts/motor/*.mjs`,
`scripts/app/*.mjs`).

- **`scripts/formatos/md5.mjs` (T1).** Vectores de RFC 1321 (`""` → `d41d8cd98f00b204e9800998ecf8427e`, `"abc"`,
  `"message digest"`, el alfabeto, los 80 dígitos); mismo resultado que `node:crypto` con buffers de 0, 1, 55, 56, 63,
  64, 65 bytes y de 5 MB aleatorios (semilla fija); resultado idéntico dando el mismo contenido en 1 trozo, en trozos de
  7 bytes y en trozos de 4 MB; `hex(true)` en mayúsculas.
- **`scripts/formatos/bambu-xml.mjs` (T2).** Cada salida es XML bien formado (se parsea con una expresión simple de
  etiquetas balanceadas, sin dependencias nuevas); `escaparXml` con `& < > " '`; `armarSliceInfo` contiene `prediction`,
  `weight`, `used_g`, `printer_model_id` y `tray_info_idx` iguales a los de `info`; `armarRels(false)` no menciona los PNG.
- **`scripts/formatos/bambu-3mf.mjs` (T4).** Arma un `.gcode.3mf` con un G-code sintético (incluye `;` con tildes y
  `ñ` para probar UTF-8, una línea de 10 KB y una pausa con `M400 U1`) y lo abre con `JSZip.loadAsync`:
  1. el ZIP tiene **exactamente** las entradas obligatorias de la tabla 1.1 (más las dos de miniatura si se pasaron
     PNG), ni una más ni una menos;
  2. `Metadata/plate_1.gcode` es **idéntico byte a byte** al G-code de entrada;
  3. `Metadata/plate_1.gcode.md5` es `md5Hex` en mayúsculas de **esos bytes**, tiene 32 caracteres, no termina en `\n`, y
     coincide con `crypto.createHash('md5')`; si se cambia un byte del G-code el md5 cambia;
  4. `slice_info.config` es coherente con `info`: `prediction` = `Math.round(info.tiempo)`, `weight` y `used_g` =
     `info.gramos` a 2 decimales, `printer_model_id` = `info.modelo.id`, `type` y `color` del filamento;
  5. `[Content_Types].xml` declara `rels`, `model`, `gcode` y (con miniatura) `png`; `_rels/.rels` apunta a entradas
     que existen en el ZIP;
  6. las pausas insertadas: se arma el G-code con `insertarPausas` y `['M400 U1']` en dos capas, se pasa a
     `armarGcode3mf`, y en `plate_1.gcode` hay exactamente dos `M400 U1`, cada uno precedido por su línea
     `; --- PAUSA: ... ---` y en el mismo orden y offset que en el G-code sin ZIP;
  7. errores: G-code vacío, `info.modelo` ausente;
  8. G-code de 40 MB sintético (se repite una capa): termina, el md5 coincide con `node:crypto`, `alProgreso` se llamó con
     valores crecientes entre 0 y 1; se anota el tiempo en el log (no hay umbral duro: el hardware es otro).
- **`scripts/formatos/entrega.mjs` (T5).** `nombreEntrega('cubo_rapido.gcode', 'gcode.3mf')` → `cubo_rapido.gcode.3mf`,
  `'gcode'` → igual, nombre sin extensión; `armarEntrega` con `'gcode'` devuelve un `File` de texto con las pausas (igual
  que `insertarPausas` solo) y con `'gcode.3mf'` devuelve un `File` cuyo contenido abre con jszip y cuyo `plate_1.gcode`
  es el G-code con pausas.
- **`scripts/motor/bambu-perfiles.mjs` (T3, Chromium).** Para cada perfil `bambu-lab-*`: se lamina el cubo con las tres
  calidades; `salidaDe === 'gcode.3mf'`; la cama coincide con la tabla 2.2; el G-code no contiene llaves `{` sin
  reemplazar; trae `; total layer number:`, `M104 S` y `M140 S` con las temperaturas del material, y ninguna temperatura
  pasa de `hotendMax`/`camaMax`; `lineasPausa` devuelve `['M400 U1']`; los ids existen y no chocan con otros perfiles.
- **`scripts/app/descarga-bambu.mjs` (T7, Chromium como Pixel 7).** Elegir "Bambu Lab A1", laminar el cubo, marcar una
  pausa en la vista previa, tocar Descargar: el nombre sugerido es `cubo-20mm_rapido.gcode.3mf`; el ZIP abre con jszip;
  `plate_1.gcode` tiene un solo `M400 U1`, y su MD5 coincide; `slice_info.config` tiene `printer_model_id` `N2S`. Vuelve
  a una Ender 3 V3 SE y comprueba que la descarga sigue siendo `…gcode` con `M600`.
- `npm run test:contratos` (T6) con `entrega.js` registrado; `npm run format:check` en cada tarea.

La prueba de que la **impresora real** acepta el archivo no es automatizable: es T9 (checklist al final de Pruebas).

### Lo que no se puede validar sin hardware (checklist de T9)

1. Bambu Studio abre el `.gcode.3mf` sin errores y muestra tiempo y gramos (y qué hace con `3dmodel.model` vacío).
2. Bambu Handy lo acepta y muestra el resumen.
3. La impresora lo imprime desde SD y por LAN (A1, A1 mini, P1S, X1C) y no rechaza el archivo por MD5.
4. El G-code de inicio/fin plano de los cuatro perfiles (secuencia, purga, nivelación, ventiladores `M106 P2/P3`).
5. `M400 U1`: pausa, mensaje en pantalla y retomar; qué pasa con la temperatura durante la pausa.
6. `M991 S0 P{layer}` y `; total layer number:` (barra de progreso).
7. Mayúsculas en el MD5 y que `streamFiles: true` lo lea la firmware.
8. Los `printer_model_id` y `tray_info_idx`.
9. `navigator.share` con `.gcode.3mf` en Android (Chrome) y iOS (Safari): qué MIME acepta `canShare`.
10. Firmware con autorización activada (ver R2): comportamiento con SD vs LAN.

## Riesgos

- **R1. Bambu cambia el formato.** No hay especificación formal: el contenido sale de lo que escriben sus slicers y
  cambia entre versiones de Bambu Studio y de firmware. Mitigación: todo el XML está en `bambu-xml.js` (un solo archivo
  para tocar), las constantes (`ENTRADAS`, ids de modelo) están juntas, y T0/T9 fijan una referencia real; si cambia, se
  corrige un archivo y sus pruebas. Si un firmware rechaza el archivo, el usuario puede bajar el `.gcode` plano
  (alternativa de reversa: poner `salida: "gcode"` en el perfil, sin tocar código).
- **R2. Firmware que exige firma o autorización.** Las P1/X1 con "control de autorización" y la LAN en modo sólo-nube
  podrían rechazar archivos no firmados por Bambu Studio. Desde la tarjeta SD no esperamos firma, pero **no lo
  sabemos**. Si se confirma, v1 queda con una advertencia en el `aviso` del perfil, y la solución real (firmar) no es
  viable sin las claves de Bambu: queda fuera.
- **R3. Memoria en el celu con G-codes de ~50 MB.** El string del G-code (JS guarda 1 o 2 bytes por carácter), el
  resultado de `insertarPausas` (otra copia), los bytes UTF-8 y el ZIP comprimido (~5–10 MB) pueden coexistir: del orden
  de 150–250 MB en el pico. Mitigación: una sola codificación a `Uint8Array` reutilizada para el MD5 y el ZIP; se suelta
  la referencia al string en `armarGcode3mf`; el ZIP sale como `Blob`; MD5 incremental con cesión del hilo; compresión
  nivel 1 (rápida). Medición en T4 con 40 MB (log de tiempo y `performance.memory` si existe). Si no alcanza en
  celulares de gama baja: mover el armado a un worker (el contrato `armarGcode3mf` no cambia; sólo el llamador).
- **R4. Gesto de usuario vencido en Compartir.** Armar el ZIP puede tardar segundos, y `navigator.share` exige gesto
  vigente. Mitigación: precarga al mostrar el resultado y al cambiar las pausas, caché por clave, y el mensaje "Tocá
  Compartir otra vez" si venció. Descargar no tiene ese problema.
- **R5. `3dmodel.model` sin malla** puede dejar a Bambu Studio sin objeto visible (ver 1.4, plan B).
- **R6. `M400 U1` y el inicio plano** pueden no hacer lo que esperamos sin las macros del slicer (filamento, AMS,
  calibración de flujo). Mitigación: perfiles marcados "experimental", sin AMS en v1.
- **R7. Reglas de marca.** No usamos logotipos de Bambu; sólo nombres de modelo para identificar compatibilidad.

## Consecuencias

**Más fácil:** las Bambu Lab pasan a poder imprimir lo que lamina la app; sumar otro contenedor (p. ej. `.ufp` de
Ultimaker o `.3mf` de otra marca) es agregar un valor de `salida` y un módulo puro; el cambio por impresora es de datos
(un JSON), no de código; el MD5 propio queda disponible para otras verificaciones.

**Más difícil:** el paso 4 deja de ser síncrono (hay que esperar el ZIP y manejar el gesto de Compartir); hay un módulo
de UI más (`entrega.js`) y tres módulos nuevos del motor, con un MAPA más largo; los perfiles Bambu llevan una
incertidumbre explícita hasta que alguien los pruebe con hardware, y la app no puede garantizar por sí sola que la
impresora acepte el archivo.

**Sin dependencias nuevas.** `jszip` ya estaba; el MD5 propio (T1) se justifica porque WebCrypto no lo ofrece y sumar
una librería de MD5 por ~70 líneas no compensa (más bundle, más licencia, más superficie).

### Fuera de v1

- Geometría real en `3dmodel.model` (plan B 1.4) y configuración de proyecto (`project_settings.config`).
- Miniaturas generadas por la app: el contrato acepta `miniatura`/`miniaturaChica`, pero ningún módulo las produce en v1
  (candidato natural: capturar el canvas de `visor.js` o `vista-capas.js` en una tarea posterior).
- Impresión directa por LAN/MQTT/FTPS y por la nube de Bambu (la app es PWA sin backend, y la LAN exige credenciales y
  cumplir la autorización de firmware).
- AMS y varios filamentos por placa (la app maneja un material y pausas manuales).
- Varias placas en un mismo archivo; P1P como perfil propio; H2D y X1E.
- Firma del archivo.

### Dudas abiertas para el CTO

1. ¿Alguien con una Bambu puede hacer T0 (exportar una muestra real) **antes** de T4? Reduce el riesgo R1 a casi cero.
2. ¿Aceptamos lanzar los perfiles Bambu como "experimentales" (con el `aviso`) hasta que T9 los valide, o se retienen
   detrás de un flag?
3. ¿P1P como perfil aparte o alcanza con la P1S?
4. Si la firmware exige firma (R2), ¿seguimos igual con el aviso o se abre otra decisión?

## Cómo quedó

Lo construido (T1 a T7) sigue el plan. Estas son las diferencias reales:

- **`entrega-ui.js` (módulo nuevo, no estaba en el plan).** Saca de `paso4-resultado.js` la lógica del archivo. El
  cache guarda sólo el `File` del `.gcode.3mf` (por impresora y pausas) y lo suelta `mostrarResultado`. Tiene la
  precarga, el cartel "Armando el archivo… N %" mientras se espera y `puedeCompartir`. El `.gcode` plano no se
  cachea: se arma en cada pedido.
- **Aviso de Compartir.** "Listo el archivo. Tocá Compartir otra vez" va a `#estadoEntrega`, con `role="status"`.
- **Callback `alCambiarPausas`.** El plan quería enganchar la precarga sin tocar `pausas-ui`, y no se pudo: el
  módulo llama al callback después de agregar o quitar una pausa. La cadena es `pausas-ui` → `vista-capas` →
  `main.js` → `entrega-ui` (`programarPrecarga`).
- **`gramosDe` ya estaba exportada** en `materiales.js` (firma `gramosDe(mm, diametro, id)`). No hubo que extraerla.
- **Nombre por defecto.** Si `info.nombre` viene vacío, el nombre interno del archivo es `pieza`
  (`NOMBRE_POR_DEFECTO` en `bambu-3mf.js`).
- **Entradas planas.** El ZIP se escribe con `createFolders: false`, sin carpetas intermedias.
- **Miniaturas.** Si hay `miniatura` y no `miniaturaChica`, la chica repite la grande. La app todavía no genera
  miniaturas (ver "Fuera de v1").
- **Prueba de perfiles.** `scripts/motor/bambu-perfiles.mjs` revisa que cada `{variable}` del G-code esté en una lista
  blanca de las que reemplaza Kiri (`VARIABLES_KIRI`), además de las temperaturas y la pausa.
- El `tray_info_idx` sale de `materiales.json` (`bambu`); el color sigue fijo en #FFFFFF.

Pendientes de una persona:

- **T0** (muestra de Bambu Studio): no bloquea. `scripts/formatos/ref-bambu/` todavía no existe.
- **T9** (validación con hardware): la checklist está en `README.md`, sección "Lo que NO pude validar".
