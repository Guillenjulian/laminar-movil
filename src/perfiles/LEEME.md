# Perfiles de impresoras y materiales

- `impresoras/*.json`: perfiles **armados a mano** (`"estado": "revisado"`). **Se detectan
  solos**: para sumar una impresora, copiá `creality-ender-3-v3-se.json`, cambiale `id` y
  `nombre`, ajustá los valores y listo (no hay que tocar código).
  Revisados hasta ahora: Creality Ender 3 V3 SE, Ender 3 V2, Ender 3 V3 KE y K1; Elegoo Neptune 4;
  Anycubic Kobra 2 y Kobra 3; Prusa MK4; Sovol SV06. Si el revisado es el mismo modelo que uno
  importado, `"reemplaza": ["id-del-importado"]` lo saca de la lista (K1 y Kobra 2).
  **Pendientes de validar con la impresora real:** Kobra 3 (firmware y G-code de inicio),
  Ender 3 V2 (`M600` según el firmware instalado) y K1 / Ender 3 V3 KE (macros `START_PRINT` / `END_PRINT`).
- `impresoras/kiri/*.json`: 50 perfiles **importados de Kiri:Moto** (la app lista 48: la K1 y la Kobra 2 las tapan sus revisados) (`"estado": "importado"`),
  generados por `npm run importar:impresoras`. No los edites a mano (el importador los
  regenera): si querés mejorar uno, copialo a `impresoras/` con otro `id` y revisalo ahí.
- Impresoras **propias** (`"estado": "propio"`): las crea cada usuario con "Agregar mi
  impresora" y quedan guardadas sólo en su celu (IndexedDB).
- `generico.js`: arma las calidades Rápido/Normal/Detalle a partir de la boquilla y la
  velocidad (lo usan el importador y "Mi impresora").
- `materiales.json`: materiales comunes a todas las impresoras (PLA, PLA+, PETG, TPU, ABS, ASA).
  Cada uno trae `nombre`, `descripcion`, `densidad` (g/cm³, para los gramos y el costo),
  `proceso` (pisa a la calidad: por eso el TPU imprime lento aunque elijas Rápido) y, opcionales,
  `aviso` (se muestra al elegirlo) y `avisoBowden` (si la impresora retrae más de 2 mm).
  El precio del rollo lo carga cada usuario en el paso 2 y queda en el celu.
- `opciones.json`: patrones de relleno, atajos de densidad y tipos de adhesión.

El importador **saltea** las Bambu Lab (usan `.gcode.3mf`), las de cinta, la Makerbot
Replicator 2 (G-code propio), la LulzBot 747 (su G-code es de otro modelo) y las dos
plantillas genéricas. A las que traen el G-code de inicio sin `{temp}` o `{bed_temp}` les
agrega un aviso que se ve en la app.

Las claves que empiezan con `_` son comentarios y se ignoran.

## Cómo se combina la configuración

Lo de la derecha pisa a lo de la izquierda:

```
valores por defecto de Kiri → impresora.proceso → calidad.proceso → material.proceso → adhesión → personalizado → avanzado → soportes → extras → cambios por altura
```

"Avanzado" (`personal.avanzado`, ver `avanzadoAProceso` en `perfiles.js`) se aplica sobre lo ya
combinado: la velocidad escala la de la calidad y el modo jarrón pisa paredes y relleno.

Los cambios por altura (`cambios`, ver `cambios.js`) no reemplazan nada: se agregan como `proceso.ranges`
(rangos de capas de Kiri, que pisan campos puntuales sólo en esas capas). Sin cambios, la salida es la de siempre.

Después, las temperaturas (también las de cada rango) se recortan a `limites.hotendMax` y `limites.camaMax`.

## Estructura de un archivo de impresora

| Clave | Qué es |
|---|---|
| `id` | Identificador único, sin espacios (ej. `creality-ender-3-v3-se`). |
| `nombre` | Lo que ve el usuario. |
| `marca` | Para agrupar y buscar. |
| `estado` | `revisado`, `importado` o `propio` (ver arriba). |
| `aviso` | Opcional: texto que se muestra al elegirla (ej. un problema conocido). |
| `reemplaza` | Opcional (sólo revisados): ids de importados que este perfil tapa. Si el usuario tenía guardado uno de esos ids, la app lo pasa al revisado (`idVigente`). |
| `adhesion` | Adhesión por defecto: `nada`, `falda`, `borde` o `balsa`. |
| `pausa` | G-code para pausar en una capa (cambio de filamento). Por defecto `["M600"]`; en Klipper, `["PAUSE"]`. |
| `limites.hotendMax`, `limites.camaMax` | Temperaturas máximas en °C. |
| `dispositivo` | La máquina (claves de Kiri:Moto, ver abajo). |
| `proceso` | Valores de laminado comunes a todas las calidades. |
| `calidades.rapido/normal/detalle` | `nombre`, `descripcion` y un `proceso` que pisa al base. |

### `dispositivo` (máquina)

| Clave | Qué es |
|---|---|
| `bedWidth`, `bedDepth`, `maxHeight` | Volumen de impresión en mm (X, Y, Z). |
| `originCenter` | `false`: el (0,0) es la esquina frontal izquierda. `true`: el centro de la cama. |
| `extruders[0].extNozzle` | Diámetro de boquilla (mm). |
| `extruders[0].extFilament` | Diámetro de filamento (mm). |
| `fwRetract` | `true` si la retracción la hace el firmware (G10/G11). |
| `gcodePre` / `gcodePost` | G-code de inicio y fin, una línea por elemento. |
| `gcodeFan` | **Obligatorio**: sin esto no se prende nunca el ventilador de capa. |
| `gcodeLayer` | Se agrega al empezar cada capa. |
| `gcodeTrack` | Se agrega cuando cambia el porcentaje de avance (`M73`). |

Variables disponibles en el G-code: `{temp}`, `{bed_temp}`, `{fan_speed}`, `{layer}`,
`{layers}`, `{progress}`, `{top}` (fondo de la cama en Y), `{right}`, `{z_max}`,
`{minx}`, `{maxx}`, `{miny}`, `{maxy}` (contorno de la pieza).

### `proceso` (laminado)

| Clave | Qué es |
|---|---|
| `sliceHeight` / `firstSliceHeight` | Altura de capa / de la primera capa (mm). |
| `sliceShells` | Cantidad de perímetros (paredes). |
| `sliceTopLayers` / `sliceBottomLayers` | Capas sólidas arriba / abajo. |
| `sliceFillSparse` | Relleno, de 0 a 1 (0.2 = 20 %). |
| `sliceFillType` | Patrón de relleno: `hex`, `grid`, `gyroid`, `triangle`, … |
| `sliceSupportType` | `disabled` o `automatic`. |
| `outputTemp` / `outputBedTemp` | Temperatura de boquilla / cama (°C). |
| `outputFanSpeed` / `firstLayerFanSpeed` | Ventilador de capa, 0 a 255. |
| `outputFeedrate` | Velocidad de impresión (relleno), mm/s. |
| `outputFinishrate` | Velocidad del perímetro exterior, mm/s. |
| `outputSeekrate` | Velocidad de viaje (sin extruir), mm/s. |
| `firstLayerRate` / `firstLayerFillRate` | Velocidad de la primera capa, mm/s. |
| `outputMaxFlowrate` | Caudal máximo en mm³/s (frena si se supera). |
| `outputRetractDist` / `outputRetractSpeed` | Retracción en mm y mm/s. |
| `zHopDistance` | Levantar Z al viajar (mm, 0 = no). |
| `outputBrimCount` / `outputBrimOffset` | Vueltas de falda (skirt) y separación en mm. |

La lista completa de claves y sus valores por defecto está en
`vendor/kiri/src/kiri/app/conf/defaults.js` (sección `fdm`).
