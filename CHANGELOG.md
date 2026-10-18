# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog 1.1.0](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- ESLint y Prettier, con `npm run lint`, `lint:fix`, `format` y `format:check`.
- CI en GitHub Actions: build, lint, formato y las suites de prueba en cada PR y en cada push a `main`.
- Prueba de contratos de los módulos de `src/ui/` (`npm run test:contratos`).
- `armarConfiguracion` acepta `cambios` por altura y los convierte en `proceso.ranges` de Kiri (ADR 0002, T2).
- ADR 0001 (`docs/decisiones/0001-dividir-main.md`): división de `main.js`.

### Cambiado

- `main.js` dividido en 10 módulos de `src/ui/` (de 1007 a 48 líneas).
- `probar-app.mjs` dividido por área en `scripts/app/`, con helpers en `scripts/lib/`.
- Código formateado con Prettier.

### Corregido

- `materiales.js` ya no registra listeners al importarse.

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
