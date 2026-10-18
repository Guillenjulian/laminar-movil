# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog 1.1.0](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Cambiado

- ESLint 10: migración desde ESLint 9 (`eslint` y `@eslint/js` ^10), con las mismas reglas del proyecto y 0 errores / 0 warnings.

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
