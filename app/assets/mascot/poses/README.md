# Маскот · извлечённые ассеты (v2 — с ножками)

Автоматически извлечено из `новые правки/IMG_0987.png` (15 шт) и `IMG_0988.png` (45 шт) = 60 спрайтов.
Инструмент: `scripts/extract_new_mascot_v2.py` — connected components + flood-fill белого фона с краёв + trim.

## Основная идея
Маскот теперь — капелька с ножками (3D, soft clay, big eyes, румянец), а не только голова с ручками.
Сохраняем ноги, не обрезаем хвостики снизу.

## Основные позы (1024×1024, прозрачный фон, контент ~820)

| Файл | Источник | Описание | Где используется |
|---|---|---|---|
| `hello.png` | IMG_0987[0] — waving | Машет ручкой | Главная, онбординг, профиль |
| `calm.png` | IMG_0987[5] — sleeping Zz | Спит на боку | Тетрадь, чат header |
| `hug.png` | IMG_0987[3] — heart sitting | Сидит с сердечком | Пейволл, постер |
| `proud.png` | IMG_0987[12] — star | Держит звезду | Мастерство, hero |
| `peek.png` | IMG_0987[9] — peek | Выглядывает из-за края | с v42 в паке (был на «Навыках» и в мерче) |
| `book.png` | IMG_0987 — с книгой | Сидит с тетрадью | с v42 в паке (была поза «Навыков») |
| `meditate.png` | `_gen/meditate.png` — генерация в тот же материал и палитру | Лотос, глаза закрыты, ладони на коленях, искорки | Навыки (v42) |
| `mirror.png` | `_gen/mirror.png` — генерация; кепка взята с мокапа `assets/merch/cap.webp` | Примеряет нашу кепку перед зеркалом | с v43 в паке (была позой мерча) |
| `cashier.png` | `_gen/cashier.png` — генерация; прилавок, касса, крафт-пакет с каплей | Кассир за прилавком: одна рука подаёт вперёд, на груди бейдж с каплей | Мерч (v43) |
| `splash.png` | hello @ 690 | Тот же waving, поменьше | Splash экран |
| `icon.png` | hello @ 780 + radial gradient #fff → #dbeaff | Иконка приложения | Favicon, Apple touch |

`hero.png` = `proud.png`, `side.png` = `hello.png` для обратной совместимости.

Три новые позы (v42–v43) — не нарезка со sprite-листа, а аккуратная генерация того же персонажа:
исходник лежит в `app/assets/mascot/_gen/`, фон убирается заливкой с краёв, контент вписывается
в 820 px и центрируется на 1024×1024 — ровно как у остальных поз, поэтому `.mascot` в CSS к ним
применяется без исключений.

## Спрайт-листы (60 шт.)

- `sprite-01…15.png` ← IMG_0987.png (крупные, 3×5 сетка)
  - 01 waving hello, 02 happy hands up, 03 heart sitting, 04 wink star, 05 excited
  - 06 sleeping Zz, 07 surprised !!, 08 running, 09 angry crossed, 10 peek wall
  - 11 lying back, 12 back view, 13 star holding, 14 crying, 15 shy wave
- `sprite-16…60.png` ← IMG_0988.png (45 шт, 5×9 сетка)
  - Все эмоции: waving, happy, heart, wink, excited, crying, sleeping, thinking, running, angry, sunglasses, cookie, blanket, umbrella, flower, headphones, box, butterfly, leaf umbrella, etc.
- Размер 120–370 px, прозрачный фон, без апскейла (только даунскейл до 512 если больше)

Фон удаляется заливкой с краёв (floodfill), белая стена в peek-позах сохраняется когда она не касается края (sprite-39).

## Промпты генерации (v42–v43)

Общая часть (к ней добавляется только абзац про позу):

> A NEW pose of the SAME character from the reference images: Dibitishka, a small
> 3D soft-clay teardrop mascot — matte periwinkle / light sky-blue droplet hood
> covering the head, snowy white round face, big glossy dark navy eyes with white
> highlights, soft pink blush cheeks, tiny stubby arms and legs, no nose, tiny
> simple smile. … Flat solid pure white background #ffffff only — no checkerboard,
> no grid, no transparent-pattern, no floor, no cast shadow, no text, no numbers,
> no letters, no watermark. Same clay material, same pastel palette, same soft
> studio lighting as the reference. Sticker-style render, crisp edges, high detail,
> 1024x1024.

- `meditate` — «sitting cross-legged in a lotus meditation position, legs visible,
  both small hands resting softly on the knees with palms up, eyes closed as two
  calm curved lines, body hovering a hair above the ground, three tiny soft
  sparkles around». Референсы: `hello.png`, `hug.png`.
- `mirror` — «stands in three-quarter view admiring itself in a round standing
  mirror with a thin pale-wood frame, wearing the cap from the second reference
  (light sky-blue washed-cotton five-panel cap with a white embroidered teardrop
  outline), one tiny hand touches the brim». Референсы: `hello.png` + кепка с
  мокапа `app/assets/merch/cap.webp` (перед генерацией — растр без альфы).
- `cashier` — «works as a friendly shopkeeper behind a small counter (light wood
  front, white top), a tiny retro cash register with a round button, a small kraft
  paper bag with a plain white teardrop sticker, one hand offering forward palm
  up, a small plain light-blue name tag with NO letters». Референсы: `hello.png`,
  `_gen/meditate.png`.

Фразы «no text, no numbers, no letters» и «no checkerboard» обязательны: иначе
модель рисует либо псевдо-буквы, либо шахматную «прозрачность» прямо в пикселях.

## Как пересобрать

```bash
python3 scripts/extract_new_mascot_v2.py                     # спрайты и базовые позы
python3 scripts/postprocess-mascot.py                        # все позы pack'а + icon/splash
python3 scripts/postprocess-mascot.py meditate mirror cashier   # только новые позы v42–v43
```

Скрипт кладёт:
- `app/assets/mascot/{hello,calm,hug,proud,peek,splash,icon}.png`
- `bot/assets/mascot/*` (зеркало)
- `app/assets/mascot/poses/sprite-*.png` + `hero.png` + `side.png`
- `app/assets/mascot/_gen/` — исходные тримнутые ячейки для поз
