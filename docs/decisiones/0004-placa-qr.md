# 0004. Placa QR desde la imagen de una lámina

- **Fecha:** 2026-11-03
- **Autor/a:** CTO

## Estado

Aceptado e implementado (v0.4.0, sin publicar).

## Contexto

Un usuario tiene unas 200 láminas PNG (una por punto de control), cada una con un QR, dos renglones arriba ("Filial
N" en bordó y la sucursal en azul) y dos abajo (ubicación en gris y una leyenda), con marco. Quiere imprimir cada una
como placa de 10 × 15 cm en una impresora de **un solo extrusor**, conservando los colores en lo posible, sin pasar
por otro programa. Hechos que condicionan el diseño:

- La app lamina STL; no tiene multimaterial. Con un extrusor, los colores salen sólo por **cambios de filamento a
  cierta altura** (las pausas del paso 4, `insertarPausas`).
- Las láminas son de baja resolución (unos 320 px de ancho): un QR re-muestreado sale borroso, pero el contenido del
  QR se puede leer y volver a generar limpio.
- Lo que cambia de una lámina a otra es el QR y los textos de filial y sucursal. Tipear 200 textos es lento y
  propenso a errores; un OCR suma ~5 MB y errores de lectura.
- Kiri descarta los trazos más finos que el ancho de línea (0,4 mm): el texto gris de las láminas mide ~0,4 mm.

## Decisión

Vamos a agregar una hoja "Placa QR" en el paso 1. Una imagen elegida con "Litofanía o placa QR" pasa primero por
`abrirImagenes` (`ui/placa-qr.js`); si tiene un QR legible se abre la hoja; si no, sigue a la litofanía como antes.
Con varias imágenes elegidas juntas, `lugaresEnCama` (`motor/placa-medidas.js`) calcula cuántas placas entran en la
cama (paradas o acostadas, 3 mm entre placas y 5 mm al borde) y `generarPlacas` las arma en **una sola malla**: la
separación general entre piezas (10 mm, ADR 0003) no deja dos placas de 100 mm en una cama de 220 mm.

- **Análisis** (`ui/placa-imagen.js`, hilo principal, sin DOM): `buscarQr` con jsQR; `quitarMarco` (filas y columnas
  del borde casi todas tinta); se blanquea la caja del QR; los renglones salen del perfil de filas con tinta
  (`tramosDeFilas` + `juntarTramos`, que pega acentos sueltos); el color de cada renglón es el promedio de su 30 %
  más oscuro y `esDestacado` marca los rojizos (bordó). Cada renglón se recorta y se agranda con interpolación
  bilineal a ~0,08 mm por píxel de máscara (`mascaraDeBanda`). El módulo se carga con `import()` dinámico, así jsQR
  no pesa en el arranque.
- **Malla** (`motor/placa-qr.js` en el worker de conversión): `disenarPlaca` ubica los renglones con una escala única
  (el más ancho a 90 mm, máximo 1,4× la lámina a 100 mm), los de arriba contra el margen de arriba y los de abajo
  contra el de abajo, y un QR de hasta 78 mm en el medio con 6 mm de aire. `matrizQr` lo regenera con
  qrcode-generator (corrección M). Los textos se pasan a relieve **copiando la imagen**: `contornos.js` traza los
  bordes de la máscara (sin diagonales sueltas), simplifica (Ramer-Douglas-Peucker) y agrupa agujeros; los trazos
  con grosor medio menor que 0,6 mm se engordan (`grosorMedio`, `engordar`). `extruir.js` arma prismas cerrados
  (earcut para las tapas, sin puntos alineados para que tapas y paredes compartan lados).
- **Alturas y colores** (`motor/placa-medidas.js`): base 0–1,6 mm (blanco); QR, marco y textos hasta 2,2 mm (negro);
  textos destacados hasta 2,6 mm (bordó). Mirada de arriba, cada parte se ve del color de su última capa.
- **Pausas solas**: al cargar la placa, `estado.placa = { pausas: [1,6, 2,2], colores }`; pasa a
  `estado.resultado.placa` al laminar y `ponerPausasEnAlturas` (pausas-ui) pone una pausa en la primera capa
  por encima de cada altura y los colores de los filamentos. Escala y rotación se ocultan (como con la torre).

Descartadas: OCR (peso y errores), tipear los textos (lento para 200 láminas), una fuente vectorial embebida (no
reproduce la tipografía de la lámina y obliga a tipear), conservar los 5 colores (necesita multimaterial) y
vectorizar el QR desde la imagen (borroso; regenerarlo es exacto).

## Consecuencias

- Una lámina se convierte en placa con dos toques; el QR siempre es exacto y se verifica en las pruebas leyéndolo de
  la malla (`test:placa`).
- Los textos copiados tienen la nitidez de la imagen original (a 320 px, bordes de ~0,3 mm): se leen bien a 10 × 15
  cm, pero no son letra dibujada. Los trazos finos quedan algo más gruesos que en la lámina.
- Con un extrusor, azul y gris salen negros. Si un renglón de texto toca el QR o el marco en la imagen, se pierde
  (se blanquea con ellos).
- En imágenes reales pueden quedar unas pocas aristas de área cero donde un agujero toca el contorno de su letra; Kiri
  las lamina igual (verificado con la lámina original).
- Varias placas por cama se eligen juntas desde "Litofanía o placa QR" (no con "Agregar pieza"). Dos dependencias
  nuevas, chicas y sin dependencias propias: `jsqr` (Apache-2.0) y `qrcode-generator` (MIT).
