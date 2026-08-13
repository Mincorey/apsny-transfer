#!/usr/bin/env python3
"""
Пересборка всех значков сайта и приложения из public/logo.png.

Исходник — 1807x1789 (не квадрат, разница 18 px), поэтому сначала
дополняется до квадрата прозрачным полем, иначе при масштабировании
логотип сплющило бы.

Три семейства файлов делаются по-разному, и это не прихоть:

  • обычные значки (192, 512, icon.png) — прозрачные углы сохраняются,
    их скругляет либо система, либо CSS на самом сайте;

  • maskable для Android — система обрезает значок по кругу и заливает
    углы. Поэтому нужна сплошная подложка и «безопасная зона»: рисунок
    ужимается до 80% и центрируется, иначе горы и рамка уедут под обрез;

  • apple-touch-icon — iOS не умеет прозрачность и заливает её чёрным.
    Поэтому тоже сплошная подложка, но без ужимания: iOS скругляет сам.

Фавиконки 16 и 32 — отдельный случай. Полная иллюстрация на таком
размере превращается в неразборчивое пятно (проверено), поэтому для них
берётся кадр с микроавтобусом крупным планом.
"""

from PIL import Image
import os

PUBLIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
ICONS = os.path.join(PUBLIC, 'icons')

# Фон сайта (--color-surface / theme-color в index.html). Используется там,
# где прозрачность недопустима.
BG = (16, 19, 26, 255)

# Доля рисунка внутри maskable-значка. Спецификация требует, чтобы всё
# значимое умещалось в круг диаметром 80% от стороны.
SAFE = 0.80

# Кадр под фавиконку: микроавтобус на дороге. Доли от размера исходника,
# подобраны и проверены на увеличенных превью.
VAN_BOX = (0.14, 0.55, 0.62, 0.92)


def load_square(path):
    """Открывает логотип и дополняет до квадрата прозрачным полем."""
    im = Image.open(path).convert('RGBA')
    s = max(im.size)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - im.size[0]) // 2, (s - im.size[1]) // 2))
    return sq


def on_bg(im, bg=BG):
    """Кладёт картинку на сплошную подложку — убирает прозрачность."""
    plate = Image.new('RGBA', im.size, bg)
    return Image.alpha_composite(plate, im)


def save(im, path, keep_alpha=True):
    im = im.convert('RGBA') if keep_alpha else im.convert('RGB')
    im.save(path, 'PNG', optimize=True)
    print(f'  {os.path.relpath(path, PUBLIC):28} {im.size[0]}x{im.size[1]:<5} '
          f'{os.path.getsize(path) / 1024:7.1f} КБ')


def plain(src, size):
    """Обычный значок: прозрачные углы сохраняются."""
    return src.resize((size, size), Image.LANCZOS)


def maskable(src, size):
    """Значок под обрезку системой: подложка + рисунок в безопасной зоне."""
    inner = int(size * SAFE)
    canvas = Image.new('RGBA', (size, size), BG)
    art = src.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.alpha_composite(art, (off, off))
    return canvas


def van(src, size):
    """Кадр с микроавтобусом — для мелких размеров, где иллюстрация не читается."""
    W, H = src.size
    box = (int(W * VAN_BOX[0]), int(H * VAN_BOX[1]),
           int(W * VAN_BOX[2]), int(H * VAN_BOX[3]))
    c = src.crop(box)
    s = max(c.size)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(c, ((s - c.size[0]) // 2, (s - c.size[1]) // 2))
    return sq.resize((size, size), Image.LANCZOS)


def main():
    src = load_square(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logo.png'))
    print(f'Исходник приведён к квадрату: {src.size[0]}x{src.size[1]}\n')

    print('Обычные значки (прозрачные углы):')
    save(plain(src, 192), os.path.join(ICONS, 'icon-192.png'))
    save(plain(src, 512), os.path.join(ICONS, 'icon-512.png'))
    save(plain(src, 512), os.path.join(ICONS, 'icon.png'))

    print('\nMaskable для Android (подложка + безопасная зона 80%):')
    save(maskable(src, 192), os.path.join(ICONS, 'icon-192-maskable.png'), keep_alpha=False)
    save(maskable(src, 512), os.path.join(ICONS, 'icon-512-maskable.png'), keep_alpha=False)

    print('\nApple touch icon (без прозрачности, iOS скругляет сам):')
    save(on_bg(plain(src, 180)), os.path.join(ICONS, 'apple-touch-icon.png'), keep_alpha=False)

    print('\nФавиконки — кадр с микроавтобусом:')
    save(van(src, 16), os.path.join(ICONS, 'favicon-16.png'))
    save(van(src, 32), os.path.join(ICONS, 'favicon-32.png'))

    # favicon.ico — многоразмерный: 16 и 32 берём кадром с фургоном,
    # 48 уже достаточно крупный, чтобы показать иллюстрацию целиком.
    ico = os.path.join(PUBLIC, 'favicon.ico')
    van(src, 32).save(ico, format='ICO',
                      sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])
    print(f'\n  {"favicon.ico":28} 16/24/32/48  {os.path.getsize(ico) / 1024:7.1f} КБ')


if __name__ == '__main__':
    main()
