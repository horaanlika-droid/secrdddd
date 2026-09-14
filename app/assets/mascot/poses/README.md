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
| `peek.png` | IMG_0987[9] — peek | Выглядывает из-за края | Навыки (peek), мерч |
| `splash.png` | hello @ 690 | Тот же waving, поменьше | Splash экран |
| `icon.png` | hello @ 780 + radial gradient #fff → #dbeaff | Иконка приложения | Favicon, Apple touch |

`hero.png` = `proud.png`, `side.png` = `hello.png` для обратной совместимости.

## Спрайт-листы (60 шт.)

- `sprite-01…15.png` ← IMG_0987.png (крупные, 3×5 сетка)
  - 01 waving hello, 02 happy hands up, 03 heart sitting, 04 wink star, 05 excited
  - 06 sleeping Zz, 07 surprised !!, 08 running, 09 angry crossed, 10 peek wall
  - 11 lying back, 12 back view, 13 star holding, 14 crying, 15 shy wave
- `sprite-16…60.png` ← IMG_0988.png (45 шт, 5×9 сетка)
  - Все эмоции: waving, happy, heart, wink, excited, crying, sleeping, thinking, running, angry, sunglasses, cookie, blanket, umbrella, flower, headphones, box, butterfly, leaf umbrella, etc.
- Размер 120–370 px, прозрачный фон, без апскейла (только даунскейл до 512 если больше)

Фон удаляется заливкой с краёв (floodfill), белая стена в peek-позах сохраняется когда она не касается края (sprite-39).

## Как пересобрать

```bash
python3 scripts/extract_new_mascot_v2.py
```

Скрипт кладёт:
- `app/assets/mascot/{hello,calm,hug,proud,peek,splash,icon}.png`
- `bot/assets/mascot/*` (зеркало)
- `app/assets/mascot/poses/sprite-*.png` + `hero.png` + `side.png`
- `app/assets/mascot/_gen/` — исходные тримнутые ячейки для поз
