# Genera los íconos de la PWA en public/iconos/ (requiere Pillow: pip install pillow).
# Dibujo: capas apiladas (lo que hace un laminador) con una boquilla arriba.
from PIL import Image, ImageDraw

NARANJA = (240, 138, 36)
OSCURO = (26, 17, 0)
BLANCO = (255, 255, 255)

def dibujar(tam, enmascarable=False):
    esc = 4  # dibujamos más grande y achicamos, para que los bordes queden suaves
    t = tam * esc
    img = Image.new('RGBA', (t, t), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if enmascarable:
        d.rectangle([0, 0, t, t], fill=NARANJA)  # sin bordes: el sistema recorta la forma
        z = 0.62  # el dibujo va en la zona segura central
    else:
        d.rounded_rectangle([0, 0, t - 1, t - 1], radius=t * 0.22, fill=NARANJA)
        z = 0.78
    u = t * z / 100  # unidades de 0 a 100 dentro de la zona del dibujo
    ox = oy = (t - 100 * u) / 2
    caja = lambda x0, y0, x1, y1: [ox + x0 * u, oy + y0 * u, ox + x1 * u, oy + y1 * u]
    # Boquilla (trapecio) y su cuerpo
    d.rectangle(caja(38, 4, 62, 22), fill=OSCURO)
    d.polygon([(ox + 38 * u, oy + 22 * u), (ox + 62 * u, oy + 22 * u), (ox + 53 * u, oy + 34 * u), (ox + 47 * u, oy + 34 * u)], fill=OSCURO)
    # Capas: la de arriba más corta (se está imprimiendo)
    capas = [(30, 70, 40), (16, 84, 56), (10, 90, 72), (10, 90, 88)]
    for x0, x1, y in capas:
        d.rounded_rectangle(caja(x0, y - 6, x1, y + 6), radius=6 * u, fill=BLANCO)
    return img.resize((tam, tam), Image.LANCZOS)

for tam in (192, 512):
    dibujar(tam).save(f'public/iconos/icono-{tam}.png')
dibujar(512, enmascarable=True).save('public/iconos/icono-enmascarable-512.png')
dibujar(180).save('public/iconos/apple-touch-icon.png')
dibujar(48).save('public/favicon.png')
print('Íconos generados en public/iconos/')
