# 0005. Formato "sólo QR" con el nombre grabado atrás

- **Fecha:** 2026-11-03
- **Autor/a:** CTO

## Estado

Aceptado e implementado (sin publicar). Complementa el [0004](0004-placa-qr.md).

## Contexto

Para las láminas de los puntos de control el usuario pidió, en vez de la placa de 10 × 15 cm con textos, **sólo el
cuadrado del QR**, de 10 × 10 cm, con el nombre de la ubicación atrás para identificar cada pieza. La app no tiene
fuentes vectoriales y la decisión del 0004 fue no tipear textos: los renglones ya se copian de la imagen.

## Decisión

Vamos a sumar un formato a la hoja "Placa QR" (`name="formatoPlaca"`: `placa` | `cuadrado`):

- `generarCuadrado` (`motor/placa-qr.js`): base de 100 × 100 × 1,6 mm y el QR de 90 mm (5 mm de margen) en relieve
  hasta 2,2 mm. Los renglones de **arriba** del QR de la lámina (filial y sucursal) se graban 0,6 mm en la cara de
  abajo, **en espejo**, centrados y cada uno con su escala (hasta 84 mm de ancho; 10 mm de alto el primero, 7 mm los
  demás): la primera capa es el cuadrado con las letras como agujeros y los ojos de las letras como islas.
- `FORMATOS` (`motor/placa-medidas.js`) da medida, pausas y colores de cada formato; el cuadrado tiene **una** pausa
  (1,6 mm: blanco → negro). `lugaresEnCama(cama, medida)` sirve para los dos: en 220 × 220 entran 4 cuadrados.
- La UI pasa `{ pausas, colores }` del formato al cargar (`cargar(nombre, generar, datos)` → `estado.placa`), así la
  vista previa pone las pausas que corresponden.

Descartado: grabar el texto adelante o en relieve atrás (atrás en relieve no apoya plano en la cama), y tipear el
nombre (ADR 0004).

## Consecuencias

- Con una cama de 220 × 220 se hacen 4 cuadrados por tanda, con un solo cambio de filamento.
- El grabado de abajo queda en la primera capa: depende de que la cama esté bien nivelada para que se lea nítido.
- Los renglones de abajo de la lámina ("ubicación por confirmar", la leyenda) no se usan en este formato.
