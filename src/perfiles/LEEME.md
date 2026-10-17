# Perfiles de impresoras y materiales

- `impresoras/*.json`: un archivo por impresora. **Se detectan solos**: para sumar una
  impresora, copiá `creality-ender-3-v3-se.json`, cambiale `id` y `nombre`, ajustá los
  valores y listo (no hay que tocar código).
- `materiales.json`: materiales comunes a todas las impresoras.

Las claves que empiezan con `_` son comentarios y se ignoran.

## Cómo se combina la configuración

Lo de la derecha pisa a lo de la izquierda:

```
valores por defecto de Kiri → impresora.proceso → calidad.proceso → material.proceso → opciones del usuario
```

Después, las temperaturas se recortan a `limites.hotendMax` y `limites.camaMax`.

## Estructura de un archivo de impresora

| Clave | Qué es |
|---|---|
| `id` | Identificador único, sin espacios (ej. `creality-ender-3-v3-se`). |
| `nombre` | Lo que ve el usuario. |
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
