#!/usr/bin/env python3
"""
Пересборка всех значков сайта и приложения из brand/logo_square.png.

Исходник — квадрат 1725x1725 без прозрачности, рисунок идёт до самых краёв,
углы прямые. Скругление и всё остальное делается здесь.

РАДИУС. 19,4% от стороны — не выдумка: ровно такое скругление было у
предыдущей версии логотипа, где оно было вшито в саму картинку (измерено по её
альфа-каналу: на верхней грани непрозрачное начиналось с 350-го пикселя при
стороне 1805). Заодно это совпадает с тем, что использует Android для
адаптивных значков. Так новый значок не выбивается из того, к чему уже привык
глаз.

ГДЕ СКРУГЛЯТЬ, А ГДЕ НЕЛЬЗЯ. Это главное, что легко сделать неправильно:

  • icon-192 / icon-512 / icon.png — показываются как есть (рабочий стол,
    список приложений Chrome). Скругляем.

  • favicon 16/32 — во вкладке браузера тоже показываются как есть.
    Скругляем, но радиус на таком размере — это 3 пикселя.

  • apple-touch-icon — НЕ скругляем. iOS накладывает собственную маску;
    если скруглить самим, углы срежет дважды и по краю пойдёт тёмная
    каёмка. Плюс iOS не понимает прозрачность и заливает её чёрным.
    Нужен полный квадрат во всю площадь.

  • maskable для Android — НЕ скругляем по той же причине: систему
    интересует квадрат, который она обрежет сама, как ей нужно (кругом,
    квадратом со скруглением, каплей — зависит от прошивки). Здесь важно
    другое: рисунок ужат до 80% и центрирован, иначе при обрезке по кругу
    от гор и дороги ничего не останется.

ФАВИКОНКА — отдельный кадр. Иллюстрация подробная, и на 16 пикселях от неё
остаётся пятно (проверено на реальном уменьшении). Поэтому во вкладке
показывается микроавтобус крупным планом: на 16 точках он читается как
машина, на 32 — отчётливо.
"""

from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(os.path.dirname(HERE), 'public')
ICONS = os.path.join(PUBLIC, 'icons')
SOURCE = os.path.join(HERE, 'logo_square.png')

# Фон сайта (--color-surface в src/index.css, theme-color в index.html).
# Ставится туда, где прозрачность недопустима.
BG = (16, 19, 26, 255)

# Радиус скругления, доля от стороны. Измерен у предыдущей версии логотипа.
RADIUS = 0.194

# Доля рисунка внутри maskable-значка: спецификация требует, чтобы всё
# значимое умещалось в круг диаметром 80% от стороны.
SAFE = 0.80

# Во сколько раз рисуется маска перед уменьшением. Без этого край скругления
# получается ступенчатым: обычный ellipse рисует без сглаживания.
SS = 8

# Кадр под фавиконку: микроавтобус на дороге, доли от стороны исходника.
VAN_BOX = (0.16, 0.52, 0.66, 0.93)


def rounded_mask(size, radius_frac=RADIUS):
    """Маска скругления со сглаженным краем (рисуется крупно и уменьшается)."""
    big = size * SS
    m = Image.new('L', (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=int(big * radius_frac), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def rounded(im):
    """Скругляет углы, делая их прозрачными."""
    out = im.copy()
    out.putalpha(rounded_mask(im.size[0]))
    return out


def on_bg(im, bg=BG):
    """Кладёт картинку на сплошную подложку — убирает прозрачность."""
    plate = Image.new('RGBA', im.size, bg)
    return Image.alpha_composite(plate, im)


def van(src, size):
    """Кадр с микроавтобусом — для размеров, где иллюстрация не читается."""
    W, H = src.size
    c = src.crop((int(W * VAN_BOX[0]), int(H * VAN_BOX[1]),
                  int(W * VAN_BOX[2]), int(H * VAN_BOX[3])))
    s = max(c.size)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(c, ((s - c.size[0]) // 2, (s - c.size[1]) // 2))
    return rounded(sq.resize((size, size), Image.LANCZOS))


def save(im, path, keep_alpha=True):
    im = im.convert('RGBA') if keep_alpha else im.convert('RGB')
    im.save(path, 'PNG', optimize=True)
    print(f'  {os.path.relpath(path, PUBLIC):28} {im.size[0]}x{im.size[1]:<5} '
          f'{os.path.getsize(path) / 1024:7.1f} КБ')


def main():
    src = Image.open(SOURCE).convert('RGBA')
    if src.size[0] != src.size[1]:
        raise SystemExit(f'исходник не квадратный: {src.size}')
    print(f'Исходник: {src.size[0]}x{src.size[1]}, '
          f'радиус скругления {RADIUS * 100:.1f}%\n')

    print('Скруглённые — показываются как есть:')
    for size, name in ((192, 'icon-192.png'), (512, 'icon-512.png'), (512, 'icon.png')):
        save(rounded(src.resize((size, size), Image.LANCZOS)), os.path.join(ICONS, name))

    print('\nМаску накладывает система — оставляем квадрат:')
    print('  apple-touch-icon: во всю площадь, без прозрачности (iOS зальёт её чёрным)')
    save(on_bg(src.resize((180, 180), Image.LANCZOS)),
         os.path.join(ICONS, 'apple-touch-icon.png'), keep_alpha=False)

    print('  maskable: рисунок ужат до 80%, вокруг подложка под обрез Android')
    for size in (192, 512):
        canvas = Image.new('RGBA', (size, size), BG)
        inner = int(size * SAFE)
        canvas.alpha_composite(src.resize((inner, inner), Image.LANCZOS),
                               ((size - inner) // 2, (size - inner) // 2))
        save(canvas, os.path.join(ICONS, f'icon-{size}-maskable.png'), keep_alpha=False)

    print('\nФавиконки — кадр с микроавтобусом:')
    save(van(src, 16), os.path.join(ICONS, 'favicon-16.png'))
    save(van(src, 32), os.path.join(ICONS, 'favicon-32.png'))

    ico = os.path.join(PUBLIC, 'favicon.ico')
    van(src, 64).save(ico, format='ICO',
                      sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])
    print(f'\n  {"favicon.ico":28} 16/24/32/48  {os.path.getsize(ico) / 1024:7.1f} КБ')

    patch_og_card(src)


# Положение значка на карточке для соцсетей. Найдено разбором самой картинки
# (столбцы, где бирюзовый идёт сплошной полосой в 290 px по высоте) и с тех пор
# не меняется — текст и вёрстка карточки те же.
OG_ICON = (100, 170, 290)


def patch_og_card(src):
    """
    Меняет значок на карточке для соцсетей, не трогая текст.

    Перерисовывать карточку целиком нельзя: шрифты сайта (Onest, Manrope) в
    сборочном окружении недоступны, а подбор похожего испортил бы типографику.
    Поэтому заменяется только квадрат со значком.

    Подложка под старым значком восстанавливается из самой карточки: её фон —
    строго горизонтальный градиент (строки выше и ниже содержимого совпадают с
    точностью до единицы в одном канале), поэтому чистую полосу высотой в один
    пиксель достаточно растянуть по вертикали. Шва не остаётся.

    Операция идемпотентна: повторный запуск снова затрёт фон и положит значок.
    """
    path = os.path.join(PUBLIC, 'og-image.png')
    if not os.path.exists(path):
        print('\n  og-image.png не найден — карточка пропущена')
        return

    x, y, side = OG_ICON
    card = Image.open(path).convert('RGBA')

    clean = card.crop((x, 20, x + side, 21))            # полоса чистого фона
    card.paste(clean.resize((side, side), Image.NEAREST), (x, y))
    card.alpha_composite(rounded(src.resize((side, side), Image.LANCZOS)), (x, y))

    card.convert('RGB').save(path, 'PNG', optimize=True)
    print(f'\n  {"og-image.png":28} 1200x630     {os.path.getsize(path) / 1024:7.1f} КБ')


if __name__ == '__main__':
    main()
