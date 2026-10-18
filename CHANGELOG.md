# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog 1.1.0](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- Soportes de tipo **Normal** o **Árbol** (paso 2) y **zonas sin soporte** (paso 1): con "Marcar zona sin soporte" un toque sobre la pieza deja una esfera (radio de 2 a 40 mm) donde no se genera soporte; hasta 20 por pieza, valen para todas las copias, se ven en el visor y se vacían (con aviso) si cambia la escala, la rotación o "Apoyar cara". Los pasos 2 y 4 avisan "N zonas sin soporte" cuando hay soportes. El árbol usa menos material que las columnas normales (ADR 0004).
- Las impresoras Bambu Lab (A1, A1 mini, P1S y X1C) entregan un `.gcode.3mf` en el paso 4: el mismo G-code con las pausas (`M400 U1`) dentro de un ZIP con el MD5 y los metadatos que espera Bambu (ADR 0005). Compartir lo arma por adelantado y avisa "Armando el archivo…"; las demás impresoras siguen bajando el `.gcode` de siempre. Los cuatro perfiles Bambu salen con aviso de "sin validar con la impresora".
- Clave de perfil `salida` (y `modeloBambu`): dice si la descarga es `.gcode` o `.gcode.3mf`. Documentada en `src/perfiles/LEEME.md`.

### Cambiado

- El interruptor "Soportes" del paso 2 pasa a un selector No / Normal / Árbol. Las preferencias guardadas (`true`/`false`) se leen como Normal/No, y con Normal el G-code es el mismo de antes. La torre de calibración sigue sin soportes.
- jszip y el armado del `.gcode.3mf` se cargan sólo al entregar un archivo Bambu (y quedan guardados para usar sin conexión): el chunk principal baja de 169 a 65 kB. El G-code plano no los baja nunca.
- El importador de Kiri sigue salteando `Bambu.A1` y `Bambu.P1S`, con el motivo de que el perfil revisado a mano es el que se usa.
- La app arranca más liviana: three.js se carga aparte, cuando hace falta (y se precarga en segundo plano). El chunk principal pasa de 594 a 62 kB.
- La vista previa de G-codes enormes se simplifica si no entra en la memoria del equipo, y avisa. Antes se cortaba: ahora se ven todas las capas.

## [0.3.0] - 2026-10-18

Sprint de deuda técnica.

### Agregado

- El paso 2 avisa si con la impresora elegida no entran todas las piezas, deshabilita Laminar y ofrece "Ir al paso 1" (`irAPaso1` en `navegacion.js`, sin carreras con el cierre de hojas).
- Suite `test:recorridos` (Node) para el lector de la vista previa: cuantizado, pausas, tope, crecimiento, tipos de Kiri, unión de tramos, espiral, extrusión relativa y detección de capa.
- Pruebas nuevas: acomodo con giros que no son de 90° (huella real), cama centrada con `originCenter`, progreso y cancelación con varias piezas, precio del rollo tras recargar.

### Cambiado

- ESLint 10: migración desde ESLint 9 (`eslint` y `@eslint/js` ^10), con las mismas reglas del proyecto y 0 errores / 0 warnings (antes 12 warnings). `engines.node` pasa a `>=20.19`.
- Refactors sin cambio de comportamiento, verificados con regresiones antes/después:
  - `perfiles.js` dividido en `catalogo.js` (impresoras), `valores.js` (lecturas de un perfil) y `perfiles.js` (`armarConfiguracion`);
  - `formatos.js` con el 3MF en `formatos-3mf.js`; `decimar`, `generarLitofania`, `leerOBJ` y `leerXML3MF` partidas;
  - `espiralar` partida; el lector de recorridos en `recorridos-lector.js`, `recorridos-tramos.js` y `recorridos-lista.js`;
  - `crearAvanzado` y `prepararLitofania` partidas;
  - `probar-motor.mjs` y `probar-formatos.mjs` divididos por tema (`scripts/motor/`, `scripts/formatos/`), y `puntosDeCapa` compartida en `scripts/lib/gcode.mjs`.
- `materiales.js` ya no usa top-level await: `iniciarMateriales()` devuelve la promesa de precios y `main.js` la espera antes del primer dibujo.

### Corregido

- La vista previa ya no muestra una capa vacía al final cuando el tope de tramos corta justo al empezar una capa nueva.
- El progreso de "laminando" llega a 1 (antes quedaba entre 0,8 y 0,95 con una o varias piezas).
- El foco al volver al paso 1 no saca botones del orden de tabulación.

## [0.2.0] - 2026-10-18

Cierre de los sprints 0 a 2.

### Agregado

- Varias piezas y copias en la cama, con acomodo automático (ADR 0003): se agregan piezas (archivo o cubo de ejemplo), se les pone copias y la app las acomoda en la cama; con una sola pieza, todo sigue como antes.
- Perfiles revisados de Ender 3 V2, Ender 3 V3 KE, K1, Neptune 4, Kobra 2, Kobra 3, Prusa MK4 y Sovol SV06.
- `npm run test:piezas`: pruebas en Node del acomodo, el reparto de triángulos, los límites de cantidad y `prepararPiezas`.
- ESLint y Prettier, con `npm run lint`, `lint:fix`, `format` y `format:check`.
- CI en GitHub Actions: build, lint, formato y las suites de prueba en cada PR y en cada push a `main`.
- Prueba de contratos de los módulos de `src/ui/` (`npm run test:contratos`).
- `armarConfiguracion` acepta `cambios` por altura y los convierte en `proceso.ranges` de Kiri (ADR 0002, T2).
- ADR 0001 (`docs/decisiones/0001-dividir-main.md`): división de `main.js`.
- Cambios por altura (ADR 0002): a partir de cierta altura en mm cambian el relleno, la temperatura, la velocidad, el ventilador y la retracción. Tras laminar, el paso 4 avisa de los que quedan por encima de la pieza.
- Torres de calibración de temperatura y de retracción (ADR 0002): hoja "Torre de calibración" en el paso 1, con un valor por bloque; ocultan escala y rotación, no entran en recientes y se laminan con los cambios por altura.
- Los modelos recientes recuerdan su escala y rotación: al abrirlos vuelven con la misma transformación (se guarda 500 ms después del último cambio; los recientes viejos abren sin transformar).

### Cambiado

- `main.js` dividido en 10 módulos de `src/ui/` (de 1007 a 48 líneas).
- `probar-app.mjs` dividido por área en `scripts/app/`, con helpers en `scripts/lib/`.
- Código formateado con Prettier.
- Módulos de la interfaz divididos para que queden chicos: `pausas-ui` (sale de `vista-capas`), `formulario-impresora` (sale de `impresoras`), `visor-cara`, `visor-recorridos` y `visor-cama` (salen de `visor`), y `ajuste-modelo` (sale de `paso1-modelo`).
- Los importados de la K1 y la Kobra 2 quedan tapados por sus perfiles revisados, con `reemplaza`, para que el modelo no salga dos veces en la lista.

### Corregido

- `materiales.js` ya no registra listeners al importarse.
- Una impresora guardada que quedó tapada por un perfil revisado pasa a ese perfil (`idVigente`).

## [0.1.0] - 2026-10-18

### Agregado

- Cuatro pasos: subir, configurar, laminar y listo.
- Formatos STL, OBJ y 3MF, y litofanía o relieve generado desde una foto.
- Visor 3D con gestos táctiles y acomodo del modelo: escala, rotación de a 90°, apoyar cara y achicar para que entre.
- Impresoras: Creality Ender 3 V3 SE, 50 perfiles importados de Kiri:Moto (marcados "sin revisar") y "Mi impresora".
- Calidades Rápido, Normal y Detalle, con PLA por defecto y opción de soportes.
- Personalizar: patrón de relleno, densidad, paredes, capas sólidas y adhesión.
- Avanzado: modo jarrón, altura de capa variable, costura, retracción, temperaturas y ventilador, entre otros.
- Materiales PLA, PLA+, PETG, TPU, ABS y ASA, con costo estimado por pieza.
- Laminado en un Web Worker con barra de progreso y cancelación.
- Vista previa capa por capa, con colores por tipo de línea y colores por filamento.
- Pausas para cambiar de filamento en las capas elegidas (M600).
- Descarga y compartir del G-code, con Web Share API donde está disponible.
- App PWA que funciona offline.
- Recientes: últimos 6 modelos y última configuración, guardados en IndexedDB.
