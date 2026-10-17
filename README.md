# Laminar Móvil

Laminador STL → G-code 100% en el navegador, pensado para usar con el celu.
Sin servidor y sin costos. El motor es [Kiri:Moto](https://github.com/GridSpace/grid-apps) (MIT).

> En construcción: la documentación completa (deploy gratis, cómo sumar impresoras) llega en la última etapa.

## Desarrollo

```bash
npm install
npm run dev        # servidor local
npm run build      # build estático en dist/
npm run test:motor # lamina un cubo en Chromium headless y valida el G-code
```

## Motor

`vendor/kiri/` tiene sólo los archivos de Kiri:Moto que usa el worker de laminado,
copiados por `npm run vendor:kiri` (ver `vendor/kiri/ORIGEN.md`).
