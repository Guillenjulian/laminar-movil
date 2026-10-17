# Motor Kiri:Moto (vendorizado)

- Repo: https://github.com/GridSpace/grid-apps.git
- Versión: 4.7.0
- Commit: d138275bbe9d4e4030d8cb8b2dcf66607da9295a
- Licencia: MIT (ver license.md). Se conservan los encabezados de copyright originales.

Generado por `scripts/vendor-kiri.mjs`: sólo se copian los 114 archivos
que importa `src/kiri/run/worker.js`. Los archivos en `src/ext/` listados abajo
son shims propios (no vienen de upstream):

- `src/ext/three.js`
- `src/ext/jszip-esm.js`
- `src/ext/quickjs.js`
- `src/ext/earcut.js`
- `src/ext/tween.js`
- `src/ext/manifold.js`
- `src/gpu/raster.js`

Parches (marcados con `PARCHE laminar-movil`):

- `src/kiri/mode/fdm/work/export.js`: la macro `{fan_speed}` no se actualizaba cuando el ventilador cambia a mitad de capa (salía `M106 S0` y el ventilador quedaba apagado casi toda la impresión).
- `src/kiri/mode/fdm/work/prepare.js`: el ventilador de "capa puente" no se aplica a la primera capa.
- `src/kiri/mode/fdm/work/slice.js`: con altura de capa variable las capas quedaban sin altura (no subía Z) y se cortaban en el borde de arriba en vez del medio.
- `src/ext/jspoly.js` tiene un parche mínimo (se apagan `require()` de CommonJS que nunca corren en el navegador).

No editar a mano: para actualizar, correr `npm run vendor:kiri`.
