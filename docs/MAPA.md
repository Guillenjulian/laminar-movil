# Mapa de la app

> **Para qué sirve:** ubicar rápido dónde está cada cosa sin leer todo el código.
> **Regla:** todo cambio que agregue, mueva o borre un módulo actualiza este mapa en el mismo commit.
> **Decisiones de arquitectura:** están en [`docs/decisiones/`](decisiones/). La división de `src/main.js` es el [ADR 0001](decisiones/0001-dividir-main.md).

## 1. Flujo general

```
Paso 1: Subir         Paso 2: Configurar        Paso 3: Laminar            Paso 4: Listo
─────────────         ──────────────────        ───────────────            ─────────────
archivo STL/OBJ/3MF   impresora · calidad       laminador.worker.js        vista capa por capa
o foto (litofanía)    material · soportes       (Kiri:Moto en 1 hilo)      pausas de filamento
   │                  personalizar · avanzado          │                   descargar / compartir
   ▼                         │                         ▼                          ▲
convertir.worker.js          ▼                  G-code (string) ─► recorridos.worker.js
vista.worker.js       perfiles.js ─► { dispositivo, proceso } ─────────────────────┘
visor.js (3D)         armarConfiguracion()
transformar.js (escala/rotación/apoyar cara)
```

En el paso 1 puede haber varias piezas y varias copias de cada una (ADR 0003): `piezas-ui.js` maneja las piezas
(chips, agregar, quitar, pieza activa) y `copias-ui.js` el stepper de copias. `acomodo.js` (`acomodarPiezas`) las
acomoda en la cama con `motor/piezas.js`, y el visor muestra en rojo las copias que no entran. El paso 3 vuelve a
acomodar y lamina `piezasParaMotor()`; el worker arma un widget de Kiri por copia (`preparar-piezas.js`). Con una
sola pieza y una copia, el flujo es el de antes.

Entrega (ADR 0005): el G-code sale del laminador sin pausas; se arman al descargar o compartir. `entrega-ui.js` lee
`salidaDe(impresora)` y llama a `entrega.js` (`armarEntrega`): `gcode` baja el `.gcode` de texto de siempre y `gcode.3mf`
(las Bambu) lo deja dentro de un ZIP (`motor/bambu-3mf.js`, con MD5). El archivo se arma una vez por combinación de
pausas, se precarga para que Compartir lo tenga listo y el cache guarda sólo el `File`.

Envío por red (ADR 0007, experimental): en el paso 4, si la impresora es de G-code plano, `envio-ui.js` ofrece "Enviar por red…" (hoja `red-hoja.js`: tipo, dirección, clave, probar, guardar) y, con config guardada, "Enviar a la impresora": pide el mismo archivo que Descargar a `entrega-ui`, lo sube con `red/cliente` (que `main.js` baja con `import()` memoizado, junto con `red/transporte`, recién al probar o enviar, para no engordar el chunk principal; si la carga falla, los envoltorios devuelven el error `carga` y se reintenta) y muestra "Enviando…" con Cancelar y el resultado. Descargar y Compartir siempre quedan; `sw.js` no intercepta `/api/`, `/server/`, `/printer/` ni `/access/`.

Todo lo pesado corre en Web Workers. Cada tarea abre un worker y lo cierra al terminar (`motor.js`).

## 2. Módulos

### Interfaz (`src/`, `src/ui/`)

| Archivo | Responsabilidad | Depende de |
|---|---|---|
| `index.html` | Estructura de los 4 pasos, las hojas (pantallas encima) y las acciones de abajo | — |
| `src/main.js` | Punto de entrada: inicializa los módulos de `src/ui/` en orden (ver ADR 0001) | `almacen` y los módulos de `src/ui/` que inicializa (ver grafo abajo); al final del arranque llama `precargarVisor()` (en `requestIdleCallback`) |
| `src/ui/util-dom.js` | `$` (getElementById) y `escapar` (texto del usuario a entidades para `innerHTML`) | — |
| `src/ui/estado.js` | Objeto `estado` único (con `piezas`, ADR 0003), `crearPieza`, `piezaActiva`, `matrizPieza`, `matrizModelo`, `copiasTotales`, `piezasParaMotor`, `valoresActuales` y la persistencia de preferencias e impresoras propias | `perfiles`, `almacen`, `motor/transformar`, `motor/tipos-linea`, `avanzado` |
| `src/ui/navegacion.js` | Muestra el paso y la hoja correctos y mantiene el historial para que "atrás" funcione; `alMostrarPaso` avisa los cambios de paso; `irAPaso1` vuelve al paso 1 por el historial (cuenta las hojas, espera si hay un recorrido en curso y enfoca el paso 1); `devolverFocoAlCerrar(hojaId, abridor, respaldo?, alCerrar?)` devuelve el foco al cerrar una hoja (lo usan `red-hoja` y `torres`; A2 del ADR 0008 lo vuelve genérico) | `ui/estado`, `ui/util-dom` |
| `src/ui/paso1-modelo.js` | Sube el modelo (STL, OBJ, 3MF, foto, ejemplo o reciente), crea la pieza en `estado.piezas` y lo muestra en el visor; el ajuste lo hace `ajuste-modelo` y las piezas extra `piezas-ui` | `estado`, `navegacion`, `util-dom`, `visor-carga`, `litofania`, `torres`, `ajuste-modelo`, `piezas-ui`, `motor/motor`, `perfiles/perfiles`, `almacen`, `recientes` |
| `src/ui/ajuste-modelo.js` | Ajuste de la pieza activa (ADR 0003): escala, rotaciones de 90°, apoyar cara, ajustar a la cama, restablecer y avisos (no entra, modelo pesado); en cada `aplicar` guarda en la pieza su medida real (`p.tamano`, desde `visor.tamanoModelo`); `crearAjuste` | `estado`, `util-dom`, `formato`, `motor/transformar`, `perfiles/perfiles`, `config` |
| `src/ui/piezas-ui.js` | Varias piezas en el paso 1 (ADR 0003, T8 y T10): chips de `#listaPiezas` (desde 2 piezas, con `×copias`), "Agregar pieza" (archivo o cubo de ejemplo; no con torre ni litofanía; tope de piezas y de copias; las agregadas van a recientes con `ctx.guardar`), quitar y elegir la pieza activa (chip o toque en el visor). `reacomodar()`: `acomodarPiezas()`, `visor.ponerCopias` por pieza (las que no entran, en rojo), aviso `#avisoEntran` "No entran todas en la cama" y "Siguiente" deshabilitado (con una pieza y una copia no cambia nada: sigue el aviso de `ajuste-modelo`); expone `data-copias` en `#listaPiezas`; al terminar cada `reacomodar` llama a `ctx.alReacomodar` (paso 1 redibuja las marcas de zonas); `crearPiezas` | `estado`, `util-dom`, `config`, `motor/piezas`, `acomodo`, `copias-ui` |
| `src/ui/copias-ui.js` | Stepper de copias de la pieza activa (ADR 0003, T10): `#copiasPieza` con − / + y el número; mínimo 1, máximo según `validarCantidad` (`MAX_PIEZAS`, `maxCopias()`), con texto que explica el tope; oculto con torre o litofanía; `crearCopias` | `estado`, `util-dom`, `config`, `motor/piezas` |
| `src/ui/acomodo.js` | `acomodarPiezas(medir?)` (ADR 0003, T9), sin DOM (`medir` opcional: tamaño real transformado; sin él, caja de 8 esquinas): huella de cada copia (`vista.tamano` × `matrizPieza`), `motor/piezas.acomodar` con la cama de la impresora elegida y `SEPARACION_PIEZAS_MM`; escribe `p.posiciones` y `estado.entra` y devuelve `{ entra, fuera }` (índices de copia global). Sin `medir` usa `p.tamano` (la medida real que guardan `ajuste-modelo` y `piezas-ui` desde `visor.tamanoModelo`) y, si falta, la caja de 8 esquinas. Lo llaman `piezas-ui` (`reacomodar`) y el paso 3 | `estado`, `motor/piezas`, `motor/transformar`, `perfiles/perfiles`, `config` |
| `src/ui/recientes.js` | Lista de recientes (abrir, borrar) y guardado de escala y rotación de las piezas cargadas como modelo (las agregadas, en T10; las copias no): 500 ms tras el último cambio, o de inmediato al salir del paso 1 / `pagehide` | `estado`, `navegacion`, `util-dom`, `formato`, `almacen` |
| `src/ui/impresoras.js` | Elegir impresora (hoja con búsqueda) y su tarjeta; cablea el formulario de "Mi impresora" | `estado`, `navegacion`, `util-dom`, `formulario-impresora`, `perfiles/perfiles` |
| `src/ui/formulario-impresora.js` | Formulario de "Mi impresora": crear, copiar un perfil como propio, editar y borrar (`iniciarFormularioImpresora`); avisa con el callback `elegir(id)` | `estado`, `navegacion`, `util-dom`, `perfiles/perfiles`, `perfiles/generico` |
| `src/ui/paso2-config.js` | Pantalla del paso 2: calidad, material, soportes, Personalizar y Avanzado (`iniciarPaso2({ irAPaso1 })`, `dibujarOpciones`); aviso `#avisoEntranPaso2` (role=status, siempre en el DOM; sólo cambia su texto) y botón aparte "Ir al paso 1" y Laminar deshabilitado si con la impresora elegida no entran las piezas. El tipo de soporte lo dibuja `soportes-tipo-ui` (`#tipoSoportes`, desde `dibujarOpciones`: al entrar al paso 2 y tras cargar preferencias) | `estado`, `acomodo`, `impresoras`, `util-dom`, `avanzado`, `cambios`, `materiales`, `iconos-relleno`, `soportes-tipo-ui`, `perfiles/perfiles` |
| `src/ui/paso3-laminar.js` | Acomoda las piezas (`acomodarPiezas`; si no entran muestra el error y no lamina), lanza el laminado de `piezasParaMotor()` (con la configuración de la torre si hay una), muestra el progreso, permite cancelar y muestra el error; al terminar llama `alTerminar` | `estado`, `navegacion`, `util-dom`, `motor/motor`, `perfiles/perfiles`, `perfiles/torres`, `config`, `acomodo` |
| `src/ui/paso4-resultado.js` | Resumen del resultado (con "N piezas" si hay copias), avisos (incluye los de cambios por altura fuera de la pieza, `avisosPostLaminado`) y botones Compartir / Descargar / Elegir otro modelo (y, con red configurada, el envío de `envio-ui`: `mostrarResultado` llama `actualizarEnvio` y `#otro`, `cancelarEnvio`). `#nombreArchivo` y `a.download` salen de `nombreEntrega`; en las Bambu la fila "Archivo" se llama "G-code". Compartir y Descargar piden el archivo a `entrega-ui`; el aviso "Listo el archivo. Tocá Compartir otra vez" va a `#estadoEntrega` (`role=status`), y el botón dice "Compartir archivo" con .gcode.3mf | `estado`, `navegacion`, `util-dom`, `vista-capas`, `paso2-config`, `formato`, `materiales`, `entrega`, `entrega-ui`, `perfiles/perfiles`, `perfiles/cambios` |
| `src/ui/entrega-ui.js` | Qué archivo se entrega y cuándo se arma (ADR 0005, 3.5): `archivoEntrega()` (async; el cache guarda sólo el `File` del .gcode.3mf, por impresora + offsets de pausas, y lo suelta `mostrarResultado`; el .gcode plano se arma en cada pedido y no se guarda; arma `Salida` e `InfoBambu` desde `estado` y el perfil), `precargar`/`programarPrecarga` (sólo con `gcode.3mf`; `main.js` la cablea como `alCambiarPausas` de `iniciarVistaCapas`, que `pausas-ui` llama tras agregar o quitar una pausa), `esperarArchivo(boton)` ("Armando el archivo… N %" con los dos botones deshabilitados, sólo en `gcode.3mf`), `puedeCompartir` (`canShare` con un File vacío del nombre y MIME finales: octet-stream, zip, model/3mf), `paraCompartir`, `soltarEntrega`. Salió de `paso4-resultado` para dejarlo corto | `estado`, `util-dom`, `materiales`, `entrega`, `perfiles/perfiles` |
| `src/ui/entrega.js` | Sin DOM ni `estado` (ADR 0005, 3.4): `nombreEntrega` (`.gcode` o `.gcode.3mf`), `mimeEntrega` y `armarEntrega` (inserta las pausas y deja el `File`, plano o dentro de un `.gcode.3mf`) | `motor/pausas`, `motor/bambu-3mf` |
| `src/ui/vista-capas.js` | Vista previa capa por capa (visor, deslizador, reproducción); lee con `{ auto: true }` (ADR 0006) y muestra en `#avisoVista` (role=status) el texto de `aviso-vista`; le inyecta a `pausas-ui` el visor, las capas y el callback `alCambiarPausas` que recibe de `main.js` | `estado`, `navegacion`, `util-dom`, `visor-carga`, `formato`, `motor/motor`, `motor/tipos-linea`, `perfiles/perfiles`, `config`, `pausas-ui`, `aviso-vista` |
| `src/ui/aviso-vista.js` | `textoAvisoVista(r, capas)` (ADR 0006), puro: '' si no hace falta, el texto de "vista simplificada, el G-code no cambia" si `simplificado` (no `nivel > 0`) y el de "vista hasta la capa N" si `incompleta` | — |
| `src/ui/pausas-ui.js` | Pausas de filamento de la vista previa: avisa cada cambio con `alCambiarPausas`; lista de filamentos, marcas sobre el deslizador, modo y colores de los recorridos | `estado`, `util-dom`, `formato`, `motor/tipos-linea`, `perfiles/perfiles` |
| `src/ui/actualizacion.js` | Registra el service worker y ofrece "Actualizar" cuando hay una versión nueva. Lo llama `main.js` al final del arranque | `util-dom` |
| `src/ui/visor-carga.js` | Fachada sincrónica del visor (ADR 0006): `crearVisor(contenedor, { alListo })` con la misma API que `visor.js`; es el único que lo importa, con `import('./visor.js')`, así three.js queda en un chunk aparte (`visor-*.js`). Encola las órdenes hasta que el chunk llega (`marcasBloqueo.poner/quitar` también: en la cola son un solo estado y cuenta la última; `alTocarPunto`, igual) y las reproduce en orden; `tamanoModelo` da `null` hasta entonces y `alListo` (una vez, después de la cola) hace que `paso1-modelo` rehaga `ajuste.aplicar()` y `piezas.reacomodar()`. `data-visor="cargando"\|"listo"\|"error"` en el contenedor y aviso `.visor-estado` (contenedor `aria-live` siempre presente; con error, un `<button>` reintenta). `precargarVisor()` baja el chunk antes de necesitarlo | `ui/visor` (dinámico) |
| `src/ui/visor.js` | Visor three.js: cama, una malla por pieza (por `id`, 0 si no se dice: `ponerModelo`, `ponerTransformacion`, `ponerCopias`, `tamanoModelo`, `quitarModelo`, `resaltarPieza`), `alTocarPunto(fn\|null)` y `marcasBloqueo` (`{poner, quitar}`, ADR 0004), ciclo de dibujo (sólo cuando algo cambia). Delega en `visor-cara`, `visor-recorridos` y `visor-bloqueos` (ADR 0003, T5) | three, `visor-cara`, `visor-recorridos`, `visor-cama`, `visor-bloqueos` |
| `src/ui/visor-cara.js` | Elegir cara con un toque ("apoyar cara"): detección del toque, triángulo resaltado, avisa normal e `id` de la pieza (`elegirCara`, `alTocarPieza`) y el punto tocado en el marco de la pieza, el de `centrar()` (`alTocarPunto`, `puntoEnMarcoPieza`; ADR 0004) | three |
| `src/ui/visor-bloqueos.js` | Marcas de las zonas sin soporte (ADR 0004, T3): una esfera translúcida por zona y por copia, con geometría y material compartidos (el radio es la escala); `crearMarcasBloqueo`: `poner(bloqueos, posiciones)` y `quitar()` (libera). Lo crea `visor.js` y lo expone como `marcasBloqueo` | three |
| `src/ui/bloqueos-ui.js` | Panel "Zona sin soporte" del paso 1 (ADR 0004, T5): modo "marcar" (`aria-pressed`), stepper de radio (2 a 40 mm, 8 por defecto), lista de zonas de la pieza activa con chips quitables, tope `MAX_BLOQUEOS`, aviso al vaciar si cambia la firma `[rotacion, escala]` y marcas en el visor; el visor, `avisar` y `nuevoId` llegan por `ctx`. Guarda `Pieza.bloqueos` y `Pieza.firmaBloqueos`. Lo cablea `paso1-modelo.js` (T6): `dibujar()` al montar un modelo, al quitarlo y en cada `reacomodar` (pieza activa, copias, posiciones); `sincronizar()` en el `alCambiar` del ajuste, después de reacomodar (el aviso de vaciado va a `#bloqueoAyuda`); `nuevoId` = `++estado.ultimoIdBloqueo`. Con torre o litofanía el panel no se ve; `crearBloqueosUI` | `estado`, `util-dom`, `motor/bloqueos` |
| `src/ui/soportes-tipo-ui.js` | Selector `#tipoSoportes` del paso 2 (ADR 0004, T5): No / Normal / Árbol con ayuda, guarda `estado.soportes` con `normalizarSoportes` y avisa `alCambiar`; muestra "N zonas sin soporte" en `#tipoSoportesZonas` si el tipo no es 'no'. Exporta `textoZonasSinSoporte(n)` y `zonasVigentes()` para el paso 4. Lo cablea `paso2-config.js`; `crearTipoSoportes` | `estado`, `util-dom`, `perfiles/soportes` |
| `src/ui/red-hoja.js` | Hoja "Enviar por red local" (ADR 0007, T6), experimental: tipo (OctoPrint/Moonraker), dirección, clave (nunca vuelve al DOM; se reutiliza sólo con la misma dirección y tipo), casilla de imprimir, Probar, Guardar, Quitar y Abrir la impresora; plan B si el error es `bloqueado`/`sin-llegada`. `iniciarRedHoja(ctx)` (`repositorio`, `probarConexion`, `normalizarDireccion`, `alGuardar` llegan por `ctx`) y `abrirRedHoja(impresoraId?)` (sin argumento, la impresora elegida; desde el paso 4, la del resultado) | `estado`, `navegacion`, `util-dom`, `perfiles/perfiles` |
| `src/ui/envio-ui.js` | Envío a la impresora por red local desde el paso 4 (ADR 0007, T7), experimental. `#configurarRed` ("Enviar por red…", abre la hoja) si la impresora del resultado es de G-code plano; `#enviarRed` sólo si además hay config guardada. Manda el MISMO archivo que Descargar (`archivoEntrega()`, con las pausas de ahora). Con `imprimir` prendido pide `confirm()` antes de cada envío; doble toque protegido. Progreso "Enviando…" en `#progresoEnvioRed` (`role=status`, sin porcentaje) con `#cancelarEnvio` (AbortController); resultado con `textContent` en `#estadoEntrega`; ante `bloqueado`/`sin-llegada` aparece `#ayudaEnvioRed` (abre la hoja, plan B). Nunca esconde Descargar/Compartir. `iniciarEnvio(ctx)` (`repositorio`, `enviarGcode` con sus deps y `abrirConfiguracion(impresoraId?)` llegan por `ctx` desde `main.js`), `actualizarEnvio`, `cancelarEnvio` | `estado`, `util-dom`, `entrega-ui`, `entrega` |
| `src/ui/visor-cama.js` | La cama del visor: plano, grilla cada 10 mm y marca del origen; `reemplazarCama` libera la anterior | three |
| `src/ui/visor-recorridos.js` | Recorridos del G-code capa por capa: `ponerRecorridos`, `mostrarCapa`, `pintarRecorridos`, `atenuarAbajo`, `quitarRecorridos`, `esfera` | three, `motor/tipos-linea.js` |
| `src/ui/idioma.js` | Idioma activo (ADR 0008, I1): `t(clave, valores)` (plural con `n`; no escapa HTML: si el resultado va a `innerHTML` con valores del usuario, pasalos por `escapar` de `util-dom`; clave inexistente = la clave cruda en producción, sin respaldo español; en desarrollo `⟦clave⟧` y aviso una vez, y si cae al respaldo español avisa "falta en en"), `marcar`, `existe`, `idiomaActual`, `localeActual`, `iniciarIdioma` (preferencia o `navigator.languages`; nunca lanza), `cambiarIdioma` (carga, guarda la preferencia sólo acá, pone `<html lang>` y avisa; con pedidos simultáneos gana el último con diccionario y sólo él avisa; `iniciarIdioma` cede ante un cambio del usuario), `alCambiarIdioma` (devuelve la baja) y `ponerDiccionarios` (pruebas). Los diccionarios entran con `import()` dinámico (chunks aparte). Destino libre de cualquier módulo de `src/ui/`; no importa nada de `src/ui/` | `almacen`, `textos/traducir`, `textos/es`, `textos/en` (dinámicos) |
| `src/textos/traducir.js` | Núcleo puro del idioma, sin imports ni DOM: `IDIOMAS`, `IDIOMA_BASE`, `LOCALES`, `interpolar`, `elegirForma` (`Intl.PluralRules`), `traducir` (diccionario, respaldo, clave), `elegirIdioma`, `variablesDe` | — |
| `src/textos/es.js`, `src/textos/en.js` | Juntan `src/textos/<idioma>/*.json` (un JSON por área, ADR 0008 B.3) en un solo `default`; no se editan: agregar un área = agregar sus dos `.json` | — |
| `src/ui/formato.js` | Números, medidas, duración, gramos y pesos en formato es-AR | — |
| `src/ui/iconos-relleno.js` | SVG de cada patrón de relleno | — |
| `src/ui/torres.js` | Hoja "Torre de calibración" del paso 1 (ADR 0002): tipo, cantidad de bloques, valor de cada uno (sugeridos según impresora y material), avisos y carga como modelo con `estado.torre`. Con torre se ocultan escala y rotación y no entra en recientes | `perfiles/torres`, `perfiles/perfiles`, `motor/motor`, `util-dom`, `formato` |
| `src/ui/litofania.js` | Hoja de opciones de litofanía y decodificación de la foto a grises | `motor/motor`, `motor/litofania`, `formato` |
| `src/ui/materiales.js` | Tarjeta del material, precio del rollo y filas de filamento/costo del resumen (`gramosDe` calcula los gramos; también lo usa `entrega-ui`). `iniciarMateriales()` registra el listener de "Poné el precio" y devuelve la promesa de carga de precios (la llama `main.js`, que la espera antes del primer dibujo) | `perfiles`, `almacen`, `formato` |
| `src/ui/avanzado.js` | Sección "Avanzado" del paso 2 (jarrón, altura variable, costura, retracción, z-hop, coasting, wipe, compensación, velocidad, temperaturas, ventilador) | `perfiles` |
| `src/ui/cambios.js` | Sección "Cambios por altura" del paso 2 (ADR 0002): agregar, editar y quitar cambios (relleno, temperatura, velocidad, ventilador desde cierta altura en mm), errores de `validarCambios`, ayuda de Velocidad, aviso "sin valor: se ignora" y resumen en el `<summary>`. Deshabilitada con altura variable | `perfiles/cambios`, `util-dom` |
| `src/almacen.js` | IndexedDB: ajustes (`preferencias`, `impresorasPropias`, `precios`), modelos y archivos recientes | — |
| `src/config.js` | Límites que dependen de la memoria del equipo (`maxTriangulos`, `maxSegmentosVista`, `maxCopias`) y de piezas (`MAX_PIEZAS`, `SEPARACION_PIEZAS_MM`, ADR 0003) | — |
| `src/sw.js` | Service worker (offline). `vite.config.js` le inyecta la lista de archivos | — |
| `src/estilos*.css` | Estilos: base + uno por área (formatos, materiales, avanzado) + `estilos-a11y.css` (ADR 0008, A1: tokens `--acento-enlace`, `--borde-control`, `--foco`, anillo de foco, `prefers-reduced-motion`, alto de toque; se carga último y sobrescribe por orden; secciones reservadas `/* A3 */ /* A4 */ /* I3 */`) | — |

Grafo de dependencias de `src/ui/` (ADR 0001, sección 2; `A → B` = A importa B):

```
Nivel 6   main.js ──► (todos los de abajo)
Nivel 5   paso4-resultado ──► vista-capas, paso2-config, entrega-ui, entrega, soportes-tipo-ui, envio-ui
Nivel 3   envio-ui ──► estado, util-dom, entrega-ui, entrega (src/red/ entra por `ctx` desde main)
Nivel 3   red-hoja ──► estado, navegacion, util-dom, perfiles (src/red/ entra por `ctx` desde main)
Nivel 6   main ──► red-hoja, envio-ui, red/{direccion,cliente,transporte,config-red}
Nivel 2   entrega-ui ──► entrega, materiales, estado, util-dom, perfiles
Nivel 1   entrega ──► motor/pausas, motor/bambu-3mf
Nivel 4   paso2-config ──► impresoras, acomodo, soportes-tipo-ui
Nivel 3   impresoras ──► formulario-impresora
Nivel 3   paso1-modelo ──► ajuste-modelo, piezas-ui, bloqueos-ui, recientes, navegacion
Nivel 2   piezas-ui ──► acomodo, copias-ui
Nivel 2   paso3-laminar ──► acomodo
Nivel 1   acomodo ──► estado, config, motor/piezas, motor/transformar, perfiles
Nivel 2   formulario-impresora   vista-capas   paso3-laminar   ──► navegacion
          vista-capas ──► pausas-ui, aviso-vista
Nivel 0   aviso-vista (sin imports)
Nivel 1   pausas-ui ──► estado, util-dom
Nivel 1   copias-ui ──► estado, util-dom, config, motor/piezas
Nivel 1   soportes-tipo-ui ──► estado, util-dom, perfiles/soportes
Nivel 2   bloqueos-ui ──► estado, util-dom, motor/bloqueos (el visor entra por `ctx`)
Nivel 1   ajuste-modelo ──► estado, util-dom, formato, motor/transformar, perfiles, config
Nivel 1   visor-carga ──► visor (import() dinámico: chunk aparte)
Nivel 1   visor ──► visor-cara, visor-recorridos, visor-cama, visor-bloqueos (hojas, nivel 0)
Nivel 1   navegacion ──► estado
          pausas-ui ──► estado, util-dom
Nivel 0   estado, util-dom, actualizacion, cambios, torres ──► hojas ya existentes (avanzado, formato, materiales,
                                              litofania, visor, motor/*, perfiles/*, almacen, config)
```

La lista exacta de aristas está en el ADR 0001, sección 2; `npm run test:contratos` la verifica y detecta ciclos.

### Motor (`src/motor/`)

| Archivo | Responsabilidad |
|---|---|
| `motor.js` | API para la interfaz: `laminar` (una pieza o varias con `piezas`, ADR 0003), `leerParaVista`, `leerRecorridos(gcode, max, { auto })` (con `auto` el worker elige el nivel de detalle, ADR 0006), `convertirAStl`, `litofaniaAStl`, `torreAStl`. Un worker por tarea, cancelable con `AbortSignal`. `laminar` tiene un watchdog: 240 s sin ningún mensaje del worker (`plazoSinNoticiasMs`) lo mata y rechaza con "El laminado se trabó…" |
| `md5.js` | `Md5` (incremental: `agregar`, `hex`) y `md5Hex`: MD5 de RFC 1321 propio y sin imports, para el `.gcode.md5` del `.gcode.3mf` de Bambu (ADR 0005; WebCrypto no tiene MD5) |
| `laminador.worker.js` | `prepararPiezas` → un widget de Kiri por copia (cada uno con su `track.pos`) → slice por widget, un solo prepare y export → G-code. `info.copias` y `info.tamano` del conjunto; instala los ganchos de soportes, pasa `bloqueos` de cada pieza a `anno.bloqueos` y la cama (marco local del widget, con la pos de la copia) a `anno.cama` de sus widgets (ADR 0004, T0 y T4); `info.ganchos` sólo viaja con `proceso.laminarDiagnostico` (que sólo pone `prueba-motor.html`; el worker la saca del `proceso` antes de Kiri) |
| `vista.worker.js` | Lee el STL para mostrarlo (cuenta, mide y simplifica sólo para dibujar) |
| `convertir.worker.js` | OBJ/3MF/litofanía/torres de calibración → STL binario |
| `recorridos.worker.js` | Worker de la vista previa: recibe el G-code, llama a `leer` (o a `leerAuto` si el mensaje trae `auto`) y devuelve los recorridos, con `nivel`, `simplificado` y `leidoHasta` (re-exporta `leer`, que usan las pruebas en Node) |
| `recorridos-lector.js` | `leer(gcode, max, { nivel })`: G-code → tramos por capa (Uint16), colores, tipos, inicio de capa y offset de cada pausa; con `nivel` 0 a 3 (ADR 0006) une más tramos y devuelve además `nivel`, `simplificado` y `leidoHasta` (capas, Z, pausas y caja no cambian). Puro (sin `self`); la clase `Lector` guarda el estado y no arma objetos por línea (G-codes de millones de líneas) |
| `recorridos-niveles.js` | `NIVELES` (`desvio` y `largoCurva` de cada nivel), `REDUCCION` y `siguienteNivel` (ADR 0006); puro, sin imports |
| `recorridos-auto.js` | `leerAuto(gcode, max)` (ADR 0006): lee con el nivel 0 y, si se llena el tope, proyecta cuántos tramos faltaban y reintenta con un nivel mayor (`siguienteNivel`); como mucho 3 lecturas, la tercera ya en el nivel 3. Devuelve la última lectura (`simplificado` avisa al usuario; `incompleta` sólo si ni el 3 entra). Puro | `recorridos-lector`, `recorridos-niveles` |
| `recorridos-tramos.js` · `recorridos-lista.js` | Piezas de `leer`, puras: `Tramos` (guarda y une los tramos según el nivel, lleva caja y capas) y `Lista` (array tipado que crece), `q` (cuantizado), `tipoDe`, `valor` |
| `stl.js` · `formatos.js` · `litofania.js` | Lectores y generadores de mallas (Float32Array de triángulos) |
| `bambu-xml.js` | Textos XML/config de un `.gcode.3mf` de Bambu (ADR 0005): `armarContentTypes`, `armarRels`, `armarModelo`, `armarModelSettings`, `armarSliceInfo`, `escaparXml` y el typedef `InfoBambu`. Puro, sin imports |
| `bambu-3mf.js` | `armarGcode3mf` (G-code + info → `Blob` .gcode.3mf con jszip: MD5 de los mismos bytes UTF-8, DEFLATE 1, `alProgreso`) y `ENTRADAS` (nombres de las entradas del ZIP). ADR 0005 |
| `formatos-3mf.js` | Lector de 3MF (`leer3MF`, `leerXML3MF`); `formatos.js` lo re-exporta |
| `torres.js` | Mallas puras de las torres de calibración (`generarTorreTemperatura`, `generarTorreRetraccion`) y `bloquesDeTorre`; sin imports (ADR 0002) |
| `piezas.js` | Varias piezas o copias (ADR 0003): `acomodar` (estantes en la cama), `repartirTriangulos` y `validarCantidad`; funciones puras, sin imports |
| `bloqueos.js` | Zonas sin soporte (ADR 0004): `validarBloqueos`, `radioSeccion` (√(R²−dz²), 0 si la esfera no cruza), `seccionBloqueos` (esa sección como polígono circunscripto de `LADOS_SECCION` = 16 lados, con el `circulo` de `geometria-2d.js`; `FACTOR_SECCION` = lo que llegan sus vértices), `bloqueaPunto` y `sinBloqueos` (resta de la sombra; la resta de polígonos entra por parámetro, la pone el puente con Kiri). Puro; sólo importa `geometria-2d.js` |
| `preparar-piezas.js` | `prepararPiezas` (ADR 0003): lee, transforma, decima (tope repartido), centra y replica por copia; valida la cama. Exporta `centrar` (la usa el worker). No importa Kiri |
| `transformar.js` | Matrices 3×3: identidad, multiplicar, rotacion90, escala, rotacionQueApoya, aplicar, medir |
| `decimar.js` | Simplificación por agrupamiento en grilla |
| `pausas.js` | Inserta las pausas (M600/PAUSE) en el G-code al descargar |
| `espiral.js` | Modo jarrón: `espiralar` convierte cada vuelta en rampa de Z (Kiri lo hace en capas planas); `vueltaDesde` decide si una capa es una sola vuelta; exporta `MARCA` |
| `minions-locales.js` | Reemplaza el pool de sub-workers de Kiri por cálculo local: sombras de soportes (cediendo el hilo, ver `cola-cediendo.js`), `subtract`, `union` y `fill` (Kiri los manda al pool con capas de ≥ 8 polígonos; sin esto el laminado se cuelga). `clip` y `sliceZ` tiran un error claro |
| `soportes-kiri.js` | Puente de Kiri con los soportes (ADR 0004): `instalarGanchosSoportes` pone `globalThis.laminarMovil.{arbol, sinBloqueos}`, que llaman los parches `PARCHE laminar-movil` de `processSupports` (`scripts/vendor-kiri.mjs`, con `?.` en los dos). `arbol(stack, bloqueos, op)` (`op.cama` = `anno.cama`: el árbol no sale de la cama): convierte sombra y pieza de cada capa a `Poligono[]`, corre `planificarArbol` y deja `slice.supports`; si devuelve `true` el bucle de Kiri no corre y `sinBloqueos` no se llama (el árbol respeta las zonas solo); si falla devuelve `false` y Kiri sigue con 'automatic'. `sinBloqueos(shadow, z, bloqueos, minArea)`: `POLY.subtract` de las secciones con el `minArea` (lineWidth²) del bucle de Kiri. Sin zonas ni árbol no cambia nada. Si algo no se respeta (soporte árbol raro, zona ignorada) mirar acá. Registro de llamadas sólo con diagnóstico (`reiniciarGanchos(true)`, `resumenGanchos`) |
| `cola-cediendo.js` | `crearColaCediendo`: cola de tareas síncronas que cede el hilo cada ~100 ms para que salga el progreso |
| `tipos-linea.js` | Tipos de línea de Kiri, sus colores, paleta de filamentos, cuantizado |
| `geometria-2d.js` | Geometría 2D pura para los soportes árbol (ADR 0004): `puntoEnPoligono`, `distanciaAPoligono` (firmada, par-impar), `circulo(centro, radio, lados=8)` (dueño único: `bloqueos.js` lo reusa), `areaPoligono`. Sin imports |
| `soportes-arbol.js` | `planificarArbol(capas, opciones)` (ADR 0004): troncos verticales con deriva limitada que esquivan la pieza, se fusionan y engordan al bajar; círculos de 8 lados por capa, tope de 150 nodos activos. Ignora la capa final inyectada por Kiri (z índice), deriva según `z[i+1]-z[i]` (altura de capa variable) y poda los troncos colgados. Opción extra `cama`. Orquesta; puro, importa `geometria-2d`, `soportes-paso`, `soportes-siembra` y `soportes-poda` |
| `soportes-paso.js` · `soportes-siembra.js` | Piezas de `planificarArbol` (hojas, sin ciclos): `soportes-paso` (`holgura`, `bajar`, `fusionarTodo`, `LADOS`: mover, esquivar y fusionar nodos al bajar una capa) y `soportes-siembra` (`sembrar`: dónde nacen las puntas nuevas bajo los voladizos). Importan sólo `geometria-2d` y, la siembra, `soportes-paso` |
| `soportes-poda.js` | `marcarViables`: marca qué nodos del árbol llegan a la cama, a la pieza o a otro tronco que llega; el resto (frenado por un bloqueo o la cama) se poda. Puro, sin imports |

### Red local (`src/red/`, ADR 0007)

Envío opcional del G-code a OctoPrint o Moonraker. Puro o con efectos inyectados: sin DOM, sin `console`; `fetch` sólo en `transporte.js` (inyectado).

| Archivo | Responsabilidad |
|---|---|
| `direccion.js` | `normalizarDireccion` (acepta sólo http/https, sin usuario, query ni fragmento; devuelve `direccion`, `http`, `nombreSinLocal`) y `esDireccionLocal(url)` (IPv4 privada, `.local`, `.lan`, `.home.arpa`, una etiqueta, IPv6 fc00::/7 y fe80::/10; `localhost` no) que reusa el transporte. Sin imports |
| `peticiones.js` | Pedidos exactos de cada tipo (`peticionVersion`, `peticionEstado`, `peticionSubida` con multipart y nombre saneado) y lectura de respuestas (`leerVersion` y `estaOcupada` dan `null` si no se entiende; `empezoAImprimir(tipo, texto, imprimir)`: con `imprimir` false siempre da false, y en OctoPrint `done` sólo cuenta si se pidió imprimir). El texto de ayuda de CORS ya no está acá: vive en `errores.js`. La clave va sólo en `X-Api-Key`. Sin imports |
| `errores.js` | `errorDeRespuesta` (HTTP → `{codigo, mensaje, pista, estadoHttp?}` o `null` si es 2xx: ya no valida el cuerpo), `errorDeLectura(tipo)` (código `respuesta`, para un 2xx cuyo cuerpo no es lo esperado: lo usa el cliente cuando `leerVersion` da `null`), `errorDeTransporte` (`red`/`tiempo`/`cancelado`, con el aviso de R2 si se envió con imprimir) y `errorDeDireccion`. Los textos están en la tabla `TEXTOS`, con variantes por tipo y por caso (`bloqueado-octoprint`, `bloqueado-moonraker`, `sin-llegada-http`, `clave-con`/`clave-sin`…). No muestra el cuerpo de la respuesta ni la clave. Puro, sin imports |
| `transporte.js` | `crearTransporte({ fetch })`: manda una petición con `fetch` (tope de tiempo, cancelación, sin cookies; `targetAddressSpace: 'local'` si `esDireccionLocal`) y devuelve `{ estado, texto }`; rechaza con `ErrorTransporte` (`causa`: `red`, `tiempo` o `cancelado`). Sin porcentaje de subida. `sondaSinCors(url, fetchFn)`: `fetch` `no-cors` con tope de 4 s y también con `targetAddressSpace: 'local'` si la dirección es local (si no, Chrome bloquea la sonda y nunca se vería `bloqueado`). Importa sólo `direccion` (ADR 0007, 6.5) |
| `cliente.js` | `probarConexion(config, deps)` (versión y luego estado; ocupada no es error; `resumen.ocupada` es `null` si el estado no se entiende y la UI decide) y `enviarGcode(config, archivo, nombre, deps, opciones?)` (un solo POST, sin imprimir salvo `config.imprimir`). `deps = {transporte, sonda, origenApp}` inyectados; la `direccion` llega normalizada. Resuelven `{ok:true,…}` o `{ok:false,error}`, nunca lanzan ni reintentan; un 2xx ilegible da `errorDeLectura`. La sonda recibe el origen y sólo se consulta ante un fallo de causa `red`. Importa sólo `peticiones` y `errores` (ADR 0007, 6.4) |
| `config-red.js` | Configuración por impresora en la clave de ajustes `redImpresoras` (`{version:1, porImpresora}`, con `porImpresora` sin prototipo: ids como `__proto__` son claves comunes): `validarConfig` (renormaliza la dirección; recorta la clave y la descarta si tiene caracteres que no van en una cabecera HTTP), `describirConfig` (oculta la clave de API) y `crearRepositorioRed(almacen)` con `leer`, `guardar`, `borrar`. Lo corrupto se lee como sin configurar; un registro de versión mayor (de una app más nueva) se lee como vacío y no se pisa al escribir. Importa sólo `direccion` (ADR 0007, 6.6) |

### Perfiles (`src/perfiles/`): datos, no código

| Archivo | Contenido |
|---|---|
| `impresoras/*.json` | Perfiles armados a mano (`estado: revisado`), incluidos Bambu Lab A1, A1 mini, P1S y X1C (`salida: gcode.3mf`, `modeloBambu`, ADR 0005) |
| `impresoras/kiri/*.json` | 50 importadas de Kiri (`estado: importado`; la K1 y la Kobra 2 las tapa su perfil revisado, así que la app lista 48). **Generados**: no editar a mano |
| `materiales.json` · `opciones.json` | Materiales (temperaturas, densidad, avisos) · patrones, densidades, adhesiones |
| `perfiles.js` | `armarConfiguracion()`: combina impresora → calidad → material → adhesión → personalizado → avanzado → soportes, y recorta las temperaturas. `COSTURAS` (`avanzadoAProceso` es interna). Re-exporta la API pública de `catalogo.js` y `valores.js` (`procesoDeCalidad` queda interna de `valores.js`); los demás módulos siguen importando de acá |
| `catalogo.js` | Catálogo de impresoras: glob de los JSON, `reemplaza`/`idVigente`, `listaImpresoras`, `ponerImpresorasPropias`, `existeImpresora`, `buscarImpresora`, `IMPRESORA_INICIAL`. Importa sólo `generico` (no `perfiles`) |
| `valores.js` | Lo que se lee de un perfil: `lineasPausa`, `salidaDe` (`'gcode'` o `'gcode.3mf'`), `procesoDeCalidad`, `valoresDeCalidad`, `valoresDeAvanzado`, `esBowden`. Importa `catalogo` y `materiales.json` |
| `cambios.js` | Cambios por altura (ADR 0002), funciones puras sin imports: `validarCambios`, `cambiosARangos` (mm → `process.ranges` de Kiri), `resumenCambios`, `avisosPostLaminado` |
| `torres.js` | Configuración de las torres de calibración (ADR 0002): `valoresSugeridos` (según `hotendMax` y Bowden), `armarTorre`, `configuracionDeTorre` (bloque 0 en Avanzado, el resto como `cambios`). Importa `motor/torres`, `cambios` y `perfiles` |
| `soportes.js` | Tipo de soporte (ADR 0004): `normalizarSoportes` (boolean viejo → `'no'`, `'normal'` o `'arbol'`), `procesoDeSoportes` (claves de proceso de Kiri) y `etiquetaSoportes`. Puro, sin imports |
| `generico.js` | Calidades a partir de boquilla y velocidad, plantillas Marlin/Klipper, perfil de "Mi impresora" |
| `LEEME.md` | Referencia de todas las claves |

### Motor externo: `vendor/kiri/`
Kiri:Moto 4.7.0 (MIT), copiado por `scripts/vendor-kiri.mjs`. **No editar a mano.** Los parches están en el script y marcados `PARCHE laminar-movil`. Detalle en `vendor/kiri/ORIGEN.md`.

## 3. Estado (`estado` en src/ui/estado.js)

`estado` vive en `src/ui/estado.js`. Los módulos de la interfaz lo importan (un solo objeto, por referencia) y lo leen en el momento; `cargarPreferencias` lo rellena al arrancar y `guardarPreferencias` / `guardarPropias` lo envían a IndexedDB.

| Clave | Qué guarda | Se persiste |
|---|---|---|
| `piezas`, `activa`, `entra` | `Pieza[]` (id, nombre, stl, vista, rotacion, escala, copias, origen, posiciones y `tamano`; ADR 0003), id de la pieza activa (`null` = la primera) y si entran en la cama. `tamano` es la medida real ya transformada (`{x,y,z}`): la guarda `ajuste-modelo` y `piezas-ui` desde `visor.tamanoModelo`, y `acomodarPiezas` la usa. Se carga con `estado.piezas = [crearPieza({...})]; estado.activa = id` | recientes guarda nombre, stl, rotación y escala (no las copias) |
| `nombre`, `stl`, `vista`, `rotacion`, `escala` | Accesores de la pieza activa (sin pieza: `''`, `null`, `null`, identidad, `1`, y el setter no hace nada: cargar un modelo exige crear la pieza antes) | sí, en recientes (500 ms o al salir) |
| `impresoraId`, `calidad`, `material`, `soportes`, `personal`, `avanzado` | Elecciones del paso 2 (sólo lo cambiado). `soportes` es `'no'` \| `'normal'` \| `'arbol'` (ADR 0004; las preferencias viejas `true`/`false` se migran con `normalizarSoportes` al cargarlas): comparar siempre con `!== 'no'`, nunca por verdad (`'no'` es verdadero) | sí, en `preferencias` |
| `ultimoIdBloqueo` | Último id de zona sin soporte (secuencial de sesión, nunca se reutiliza). Las zonas viven en `Pieza.bloqueos` (marco de la pieza) y `Pieza.firmaBloqueos`; `piezasParaMotor()` las manda en copia profunda y `prepararPiezas` se las da a cada copia | no |
| `propias` | Impresoras del usuario | sí, en `impresorasPropias` |
| `resultado` | `{ gcode, info, archivo, impresoraId, capas, cambios }` del último laminado (`capas`: alturas de capa usadas; `cambios`: los efectivos y validados, o los de la torre) | no |
| `cambios` | Cambios por altura (`Cambio[]`, ADR 0002); se pasan a `armarConfiguracion`; tras laminar, los efectivos y validados van a `estado.resultado.cambios` y a `avisosPostLaminado` (paso 4). Se vacían al cargar un modelo | no |
| `torre` | Torre de calibración cargada (`Torre` + `aviso` + `resumen`, ADR 0002) o `null`; si existe, `paso3-laminar` usa `configuracionDeTorre` por encima de Avanzado, Personalizar, soportes y cambios | no |
| `pausas`, `coloresFilamento`, `modoColor` | Pausas y colores de la vista previa | no |

## 4. Pruebas

| Comando | Qué prueba | Dónde |
|---|---|---|
| `npm run test:transformar` | Matrices (Node) | `scripts/probar-transformar.mjs` |
| `npm run test:formatos` | OBJ, STL, 3MF, errores de archivos rotos, litofanía, MD5, textos XML y armado del .gcode.3mf de Bambu y entrega del archivo (Node) | `scripts/probar-formatos.mjs` (orquestador) + `scripts/formatos/*.mjs` (`obj-stl`, `3mf`, `errores`, `litofania`, `md5`, `bambu-xml`, `bambu-3mf`, `entrega`, `ayudas`, `ayudas-3mf`) |
| `npm run test:torres` | Mallas de las torres de calibración: cerradas, medidas, `bloquesDeTorre` (Node) | `scripts/probar-torres.mjs` |
| `npm run test:piezas` | Acomodo de piezas en la cama (Node): posiciones exactas, separación, `fuera`, reparto de triángulos y límites de cantidad; y `prepararPiezas`: vértices, copias, decimación repartida, borde de la cama y posiciones inválidas | `scripts/probar-piezas.mjs` + `scripts/piezas/preparar.mjs` |
| `npm run test:recorridos` | Lector de G-code de la vista previa (Node, G-codes sintéticos): cuantizado exacto, tipos y colores de Kiri, unión de tramos, `pausaCapa` (con y sin subida de Z), modo espiral, detección de capa (altura variable), tope e `incompleta`, crecimiento de arrays con más de 65536 tramos, niveles de simplificación (reducción monótona, error máximo punto a punto, capas/Z/pausas/caja sin cambios, `leidoHasta`), `leerAuto` (una lectura si entra, nivel elegido, tope de 3 lecturas contadas con un `leer` inyectado), cableado de `auto` motor → worker (`scripts/recorridos/worker.mjs`, con un `Worker` falso), `textoAvisoVista` (`scripts/recorridos/aviso.mjs`: las combinaciones de `simplificado`/`incompleta`, y nivel 3 sin simplificar no avisa) | `scripts/probar-recorridos.mjs` + `scripts/recorridos/*.mjs`; a mano `node scripts/medir-recorridos.mjs` (costo contra una base, ADR 0006) |
| `npm run test:soportes` | Soportes (Node): árbol sobre polígonos sintéticos (voladizo a 20 mm, fusión y deriva por capa, pieza esquivada, tope de nodos, bloqueos, poda de troncos colgados, cama, radio mínimo, altura de capa variable, capa inyectada, determinismo, tiempo de 1000 capas) | `scripts/probar-soportes.mjs` (recorre `scripts/soportes/*.mjs`, cada uno con `export default async ({ revisar, igual })`; se saltan los que no exportan `default`, como `ayudas-arbol.mjs`) |
| `npm run test:cambios` | Cambios por altura (Node): validación, mapeo mm → capa, campos de Kiri, resumen y avisos | `scripts/probar-cambios.mjs` |
| `npm run test:visor` | Marcas de zonas sin soporte y `alTocarPunto` (Node, sin WebGL): una esfera por zona y copia, el punto tocado en el marco de la pieza (el de `centrar()`) con copias en dos posiciones, y que el marco del visor coincide con el del motor | `scripts/probar-visor.mjs` + `scripts/visor/*.mjs` |
| `npm run test:visor-carga` | Fachada del visor (Node, cargador falso): cola en orden, última orden de `ponerCama`/`pausar`, `tamanoModelo` null y luego real, `alListo` una vez (y si tira no marca error), fallo del cargador y reintento, módulo ya cargado, nombres iguales a los de `visor.js` | `scripts/probar-visor-carga.mjs` |
| `npm run test:textos` | Textos e idioma (ADR 0008, I2; Node, sin Vite): se prueba a sí misma con diccionarios sintéticos (clave faltante o sobrante, variables `{x}` distintas, plural con formas distintas, forma de claves, marcado, uso de `t`/`existe`/`marcar`, HTML contra `es`, español suelto); sobre `src/textos/` real: mismas áreas, claves, variables y plurales en `es` y `en`, claves usadas y definidas, `data-t*` de `index.html` iguales a `es`, módulos de `MIGRADOS` sin español suelto. Sin `src/textos/` informa `✘ falta src/textos/…`. El núcleo `t` lo prueba `nucleo.mjs` (I1). Convención de claves usadas en la cabecera de `diccionarios.mjs` | `scripts/probar-textos.mjs` (orquestador) + `scripts/textos/{diccionarios,detectores,autopruebas}.mjs` |
| `npm run test:chunks` | Guardián del tamaño de los chunks (después de `npm run build`): principal < 100 kB, carga inicial < 400 kB, sin `WebGLRenderer` ni jszip (`generateAsync`) en ella, y todo chunk dinámico del visor o de jszip en el service worker; con `src/textos/` (ADR 0008), ningún chunk con los diccionarios en la carga inicial (`[textos-en-clausura]`) y todos en el service worker (`[textos-fuera-sw]`) | `scripts/verificar-chunks.mjs` |
| `npm run test:contratos` | Contratos de los módulos nuevos de `src/ui/` (ADR 0001): exports y aridad, que importarlos no toque el DOM, aristas permitidas y ciclos. Los que no existen se saltean; `CONTRATOS_ESTRICTO=1` los exige. `LIBRES = ['ui/idioma']` (ADR 0008): destino que cualquier módulo de `src/ui/` puede importar sin declararlo (los ciclos se siguen detectando). También corre las pruebas de los accesores de `estado.piezas` (Node), de `bloqueos` en `crearPieza` y `piezasParaMotor`, y que `armarConfiguracion` con `true` y `'normal'` dé el mismo proceso de siempre | `scripts/probar-contratos.mjs` + `scripts/lib/contratos-ui.js` + `scripts/probar-estado.mjs` |
| `npm run test:motor` | Laminado real en Chromium: perfil, calidades, relleno, adhesión, materiales, soportes, pausas, transformaciones, todas las impresoras importadas, malla pesada, cambios por altura (ADR 0002: relleno, temperatura, velocidad, ventilador, retracción, balsa, jarrón, pausa), torres de calibración (casos 10-11: M104 y retracción por bloque), los 8 perfiles revisados (tabla fija de datos de fábrica, macros sin reemplazar, temperaturas, X/Y dentro de la cama, retracción esperada, orden de arranque, G29 sólo donde corresponde, `reemplaza` e `idVigente`) y varias piezas con `track.pos` (ADR 0003: T0 con falda, borde, balsa y soportes; T6 con equivalencia con una pieza, 4 copias, alturas distintas, cambio por altura, fuera de la cama) | `scripts/probar-motor.mjs` (orquestador) + `prueba-motor.html` + `scripts/motor/{cubo,materiales,transformaciones,personalizar,impresoras,avanzado,malla-pesada,ayudas}.mjs` + `scripts/motor/cambios.mjs` + `scripts/motor/torres.mjs` + `scripts/motor/perfiles-revisados.mjs` + `scripts/motor/bambu-perfiles.mjs` (los 4 perfiles Bambu: cama, `{` sin reemplazar, temperaturas, pausa `M400 U1`, `salidaDe`) + `scripts/motor/piezas-kiri.mjs` + `scripts/motor/piezas.mjs` + `scripts/motor/soportes-ganchos.mjs` (ADR 0004, T0: `sinBloqueos` una vez por capa y copia con z decreciente, `anno.bloqueos` exacto, mismas zonas en cada copia, G-code idéntico al de una corrida sin ganchos; el registro sólo con `diagnostico: true`) + `scripts/motor/soportes-kiri.mjs` (ADR 0004, T4: T con tapa de 20×20, árbol contra normal por coordenadas, zona sin soporte con normal y árbol y con dos copias en marco absoluto, pieza de 220 mm que no saca el árbol de la cama, placa con agujero (`.inner`), nada flotando, igual que el Kiri sin puente) + `scripts/motor/soportes-signo.mjs` (ADR 0004, T6: tapa de 148 mm con la copia a ±35,8 mm en las cuatro esquinas: el árbol no sale de 0..220, lo que blinda el signo de `pos` en `camaLocal`) + `scripts/motor/piezas-extra.mjs` (cama centrada con `originCenter` y `bedRound` falso, progreso con 1 y 3 copias y `AbortError` con 3 copias sin worker vivo; `prueba-motor.html` expone `window.progreso` y `cancelarEn`) + `scripts/lib/gcode.mjs` (`puntosDeCapa`, compartido con `test:app`). Helpers de G-code en `scripts/motor/gcode-capas.mjs` + `scripts/motor/soportes-progreso.mjs` (con soportes, una placa de 36 islotes y una esfera rugosa terminan y la barra avanza cada 3 s) + `scripts/motor/minions-prueba.worker.js` (minions locales contra POLY.subtract/union directos) + `scripts/motor/watchdog.mjs` (Node: laminado trabado se cancela con aviso, sin timers vivos; cola que cede el hilo) |
| `npm run test:app` | La app de punta a punta emulando un Pixel 7, offline incluido | `scripts/probar-app.mjs` (orquestador) + `scripts/app/*.mjs` + `scripts/lib/` |
| `npm run lint` | ESLint (recomendado + límites de tamaño como aviso: 300 líneas por archivo, 40 por función); `npm run lint:fix` aplica los arreglos automáticos | `eslint.config.js` |
| `npm run format:check` | Prettier (4 espacios, comillas simples, 120 columnas); `npm run format` lo aplica | `.prettierrc.json` |

### `test:app` por área

`scripts/probar-app.mjs` sólo arma el contexto (`scripts/lib/app.mjs`: servidor de `dist/`, Chromium como Pixel 7, `ok`) y llama a las áreas en orden. Es un recorrido con estado: cada archivo de `scripts/app/` declara en su cabecera qué espera y cómo deja la app, así que el orden importa. Helpers compartidos en `scripts/lib/` (`chromium.mjs` también lo usa `test:motor`).

| Área | Archivo |
|---|---|
| Paso 1: modelo pesado, cubo, gesto en el visor (las áreas que leen el canvas esperan al visor con `esperarVisor`, `scripts/lib/visor.mjs`) | `scripts/app/paso1-modelo.mjs` |
| Paso 1: OBJ, 3MF, litofanía | `scripts/app/paso1-formatos.mjs` |
| Paso 1: varias piezas (agregar, activar, escalar, quitar, laminar dos cubos, tope, torre) | `scripts/app/piezas.mjs` |
| Paso 1: copias (stepper, acomodo, aviso "no entran", recientes) | `scripts/app/copias.mjs` |
| Paso 1: zonas sin soporte (modo marcar, radio, chip, quitar, aviso al cambiar la escala) y Paso 2: selector de tipo de soporte | `scripts/app/bloqueos.mjs`, `scripts/app/soportes-tipo.mjs` |
| Tipo de soporte de punta a punta: preferencias viejas (`true`/`false`) vuelven como 'normal'/'no' y se guardan como texto; laminar con árbol y una zona (el mensaje al laminador lleva la zona, ningún soporte dentro de la esfera, control sin zona, avisos de los pasos 2 y 4) | `scripts/app/soportes-estado.mjs` |
| Marcas de zonas y toque con punto en un visor de prueba (esbuild, sin usar el estado de la app) | `scripts/app/visor-bloqueos.mjs` |
| Esqueletos del idioma (ADR 0008, I2): `probarIdiomaArranque`, `probarIdiomaSelector`, `probarIdiomaPaso2`, `probarIdiomaCompleto`; vacíos y sin registrar en `probar-app.mjs` (los llenan y registran I3, I10 e I14) | `scripts/app/idioma.mjs` |
| Paso 1: dos piezas con giro de 45° (apoyar cara) acomodadas con la huella real | `scripts/app/piezas-extra.mjs` |
| Paso 2: calidad, atrás/adelante | `scripts/app/paso2-config.mjs` |
| Accesibilidad (ADR 0008): `probarContraste` (A1: ratios WCAG de texto naranja, números de pasos, bordes y anillo de foco en claro y oscuro, movimiento reducido y alto de toque; no cambia el estado; ratio puro en `scripts/lib/contraste.mjs`) y esqueletos de A2, A3 y A4 | `scripts/app/accesibilidad.mjs` |
| Paso 3: cancelar, personalizar, laminar el cubo | `scripts/app/paso3-laminar.mjs` |
| Materiales y costo | `scripts/app/materiales.mjs` |
| Avanzado (jarrón, costura, velocidad) | `scripts/app/avanzado.mjs` |
| Cambios por altura (agregar, quitar, altura variable, aviso en el paso 4) | `scripts/app/cambios.mjs` |
| Vista previa por capas (un cubo no muestra aviso) | `scripts/app/vista-capas.mjs` |
| Vista previa liviana: con `navigator.deviceMemory = 1` forzado (`addInitScript`, contexto aparte) una esfera grande con giroide entra simplificada: aviso, todas las capas y deslizador hasta la última | `scripts/app/vista-liviana.mjs` |
| Pausas / filamentos | `scripts/app/pausas.mjs` |
| Descarga del G-code | `scripts/app/descarga.mjs` |
| Descarga del .gcode.3mf de la Bambu A1 (entradas, M400 U1, MD5, cache de pausas) y vuelta al .gcode de la Ender | `scripts/app/descarga-bambu.mjs` |
| Envío por red local (ADR 0007): OctoPrint y Moonraker simulados con `page.route`; hoja, clave, envío igual al G-code descargado, confirm, cancelar, errores, Bambu sin envío, quitar (partido en `red.mjs`, `red-envio.mjs`, `red-impresoras.mjs`; helpers en `scripts/lib/red-simulada.mjs` y `red-pagina.mjs`) | `scripts/app/red.mjs` |
| Cambios por altura en el G-code (M104 a 10 mm) | `scripts/app/cambios-gcode.mjs` |
| Impresoras (buscar, propia, copiar) | `scripts/app/impresoras.mjs` |
| Recientes y ajustes guardados | `scripts/app/recientes.mjs` |
| Escala, rotar, apoyar cara | `scripts/app/transformar.mjs` |
| Torres de calibración (hoja, paso 2, M104 por bloque) | `scripts/app/torres.mjs` |
| Precio del rollo tras recargar (precio y costo) | `scripts/app/piezas-extra.mjs` |
| Visor diferido: con el chunk demorado (`page.route`, contexto sin service worker) gira la T y suma una copia antes de que llegue, y al llegar `alListo` deja la medida real | `scripts/app/visor-diferido.mjs` |
| PWA y sin conexión (incluye que el visor 3D cargue sin red y que su chunk esté en el caché del SW) | `scripts/app/offline.mjs` |

Antes de cualquier commit: `npm run build` y las suites que toquen el área cambiada. Antes de integrar, todas.

### CI

`.github/workflows/ci.yml` corre en cada PR y en cada push a `main` (Node de `.node-version`): `npm ci`, lint, format:check, build, `test:visor-carga`, `test:chunks`, instala Chromium (`playwright-core install --with-deps chromium`) y pasa su ruta en `CHROMIUM_PATH`, y corre `test:transformar`, `test:formatos`, `test:torres`, `test:cambios`, `test:piezas`, `test:recorridos`, `test:red`, `test:soportes`, `test:visor`, `test:motor`, `test:app` y `test:contratos`. Un push nuevo al mismo PR cancela la corrida anterior.

## 5. Dónde buscar si algo falla

| Síntoma | Mirar primero |
|---|---|
| El laminado se queda quieto en un porcentaje | `minions-locales.js`: ¿Kiri llama a una función del pool de minions que no está reemplazada? (el watchdog de `motor.js` lo corta a los 240 s y avisa). Pruebas: `scripts/motor/soportes-progreso.mjs`, `scripts/motor/watchdog.mjs` |
| El laminado se cuelga | `laminador.worker.js`: ¿se usa algo del pool de minions? (`minions-locales.js`) |
| G-code con temperatura, ventilador o velocidad mal | `perfiles.js` → `armarConfiguracion` y el orden de combinación; `materiales.json` |
| Macros `{...}` sin reemplazar | `dispositivo.gcodePre/Post` del perfil y el shim de QuickJS en `vendor-kiri.mjs` |
| No abre offline | `src/sw.js` (lista de archivos, `ignoreVary`), `vite.config.js` |
| La vista previa no coincide con las capas | `recorridos-lector.js` (detección de capa por cambio de Z en extrusión) |
| La vista previa dice "simplificada" (o no avisa) | `src/motor/recorridos-auto.js` y `src/ui/aviso-vista.js`; además `recorridos-niveles.js` y `armarVistaPrevia()` en `src/ui/vista-capas.js` |
| El visor 3D no aparece o dice "No se pudo cargar" | `src/ui/visor-carga.js` (la fachada y el reintento) y la lista `ARCHIVOS` de `dist/sw.js` (la verifica `npm run test:chunks`) |
| Modo jarrón sin espiral o capas raras | `espiral.js` y el comentario `; capa en espiral` que lee `recorridos-lector.js` |
| La sección "Cambios por altura" no responde o no marca errores | `crearCambios()` en `src/ui/cambios.js` |
| Un cambio por altura no se aplicó y no hay aviso en el paso 4 | `avisosDeCambios()` en `src/ui/paso4-resultado.js` y `avisosPostLaminado` en `src/perfiles/cambios.js` |
| Altura variable sin subir Z | parche de `slice.js` en `vendor-kiri.mjs` |
| La pausa cae en un lugar raro | `recorridos-lector.js` (`pausaCapa`) y `pausas.js` |
| El modelo aparece corrido | `visor.js` (`ponerTransformacion`), `preparar-piezas.js` (`centrar`) |
| El soporte árbol sale raro o falta debajo de un voladizo | `src/motor/soportes-arbol.js` (y `soportes-paso.js`, `soportes-siembra.js`, `soportes-poda.js`) y `src/motor/soportes-kiri.js` (el puente con Kiri) |
| Una zona sin soporte no se respeta | `src/motor/bloqueos.js`, `sinBloqueos` en `src/motor/soportes-kiri.js` y `piezasParaMotor()` en `src/ui/estado.js` |
| Un archivo no abre | `formatos.js` y `formatos-3mf.js` (mensajes de error) y `convertir.worker.js` |
| Un botón del paso 1 no responde | `iniciarPaso1()` en `src/ui/paso1-modelo.js` |
| Escala, rotación, apoyar cara o los avisos del modelo fallan | `crearAjuste()` en `src/ui/ajuste-modelo.js` |
| Un modelo cargado no aparece en `estado` (los accesores no escriben) | `montarModelo()` en `src/ui/paso1-modelo.js` y `crearPieza()` en `src/ui/estado.js` |
| Las copias no se acomodan o el visor no coincide con el G-code | `acomodarPiezas()` en `src/ui/acomodo.js` (posiciones) y `reacomodar()` en `src/ui/piezas-ui.js` (lo que se ve); `prepararPiezas()` en `src/motor/preparar-piezas.js` (cada copia con su `pos`) |
| No se puede agregar una pieza | `dibujar()` y `botonesAgregar()` en `src/ui/piezas-ui.js` (se oculta con torre o litofanía; se deshabilita en el tope de `validarCantidad` en `src/motor/piezas.js`, con `MAX_PIEZAS` y `maxCopias()` de `src/config.js`) |
| Un botón del paso 2 no responde o una opción no se redibuja | `iniciarPaso2()` y `dibujarOpciones()` en `src/ui/paso2-config.js` |
| Laminar, cancelar o el error no se muestran bien | `iniciarPaso3()` en `src/ui/paso3-laminar.js` |
| Compartir, descargar o "Elegir otro modelo" no responden | `iniciarPaso4()` en `src/ui/paso4-resultado.js` |
| El archivo descargado no tiene las pausas nuevas, o tarda en armarse el `.gcode.3mf` | `archivoEntrega()` (clave del cache) y `precargar()` en `src/ui/entrega-ui.js`; el armado, en `src/ui/entrega.js` y `src/motor/bambu-3mf.js` |
| El .gcode.3mf no abre en Bambu Studio o la impresora lo rechaza | `armarGcode3mf` en `src/motor/bambu-3mf.js` (entradas, MD5, `slice_info`) y los textos de `src/motor/bambu-xml.js`; perfiles en `src/perfiles/impresoras/bambu-lab-*.json` (`salida`, `modeloBambu`, `pausa`) |
| La vista previa por capas no responde | `iniciarVistaCapas()` en `src/ui/vista-capas.js` |
| La lista de filamentos, las marcas de pausa o los colores de la vista previa fallan | `dibujarPausas()` y `conectarPausas()` en `src/ui/pausas-ui.js` |
| No se puede elegir una impresora | `iniciarImpresoras()` en `src/ui/impresoras.js` |
| "Mi impresora" (crear, copiar, editar, borrar) no guarda o no abre | `iniciarFormularioImpresora()` en `src/ui/formulario-impresora.js` |
| "Atrás" sale de la app o no cierra la hoja; el paso no cambia | `iniciarNavegacion()` y `mostrar()` en `src/ui/navegacion.js` |
| Las preferencias o "Mi impresora" no se guardan o no vuelven al abrir | `cargarPreferencias`, `guardarPreferencias` y `guardarPropias` en `src/ui/estado.js` |
| El precio del rollo no se guarda | `iniciarMateriales()` en `src/ui/materiales.js` |
| El aviso "Hay una versión nueva" no aparece | `src/ui/actualizacion.js` |

## 6. Deuda técnica conocida
- El chunk `motor` (~205 kB: perfiles y lógica compartida con `prueba-motor.html`) sigue en el arranque; el principal ya no lleva three.js (ADR 0006, T3) y `test:chunks` lo vigila.
- Dos lectores de G-code en las pruebas del motor: `extrusionesDe` (`scripts/motor/soportes-kiri.mjs`, con tipo y extremos de cada extrusión) y `porCapa` (`gcode-capas.mjs`); unificarlos.
- Soportes árbol: un tronco absorbido en una fusión puede quedar tangente al de abajo (~0,5 % de los círculos, puente de 4 a 5 mm); no se mitiga en v1 (ADR 0004, R1).
- Soportes árbol: el tope de 150 nodos activos (`maxNodos`) no tiene prueba que llegue al límite (ADR 0004, sección 1).
- Zonas sin soporte: se vacían al cambiar escala o rotación. Se podrían transformar con `matrizPieza` (ADR 0004, sección 2).
- El chunk principal pesa más de 500 kB (three.js): evaluar importar three dinámicamente.
- `npm run lint`: 0 errores y 0 warnings.
- Piezas y copias (ADR 0003):
  - En recientes, dos piezas con el mismo nombre y peso guardan sólo la activa (la clave es nombre y bytes; limitación de v1).
  - No hay prueba de piezas con cama de cinta (R1 del ADR 0003 lo deja pendiente).
