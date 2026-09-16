#!/usr/bin/env python3
"""Build the mascot pack (original IMG_0966 style: matte droplet-hood, white face).

Sources: app/assets/mascot/_gen/{hello,calm,hug,proud,peek}.png
         + app/assets/mascot/_gen/{meditate,mirror,cashier}.png — новые позы:
           «Навыки» (Дибитишка медитирует) и мерч (стоит за прилавком кассиром;
           mirror — та же примерка нашей кепки у зеркала, лежит в паке);
           это генерация в тот же материал и палитру, исходник лежит в _gen/,
           чтобы пересборка была повторимой.
Outputs: 1024×1024 PNGs in app/assets/mascot and mirrored bot/assets/mascot.
Requires ImageMagick (`convert`). Generated sources stay untouched for easy reruns.

Запуск:
  python3 scripts/postprocess-mascot.py                  # все позы + icon/splash
  python3 scripts/postprocess-mascot.py meditate mirror  # только новые позы
"""
import sys
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "app/assets/mascot/_gen"
OUT = ROOT / "app/assets/mascot"
BOT = ROOT / "bot/assets/mascot"
POSES = ("hello", "calm", "hug", "proud", "peek", "meditate", "mirror", "cashier")


def run(*args: str) -> None:
    subprocess.run(["convert", *map(str, args)], check=True)


def size_of(path: Path) -> tuple[int, int]:
    out = subprocess.check_output(["convert", str(path), "-format", "%w %h", "info:"])
    w, h = out.decode().split()
    return int(w), int(h)


def build_pose(name: str) -> Path:
    source, target = SRC / f"{name}.png", OUT / f"{name}.png"
    if not source.exists():
        raise SystemExit(f"Missing source: {source.relative_to(ROOT)}")
    # Фон убираем ЗАЛИВКОЙ С КРАЁВ (floodfill от четырёх углов), а не глобальным
    # -transparent: у маскота из IMG_0966 лицо снежно-белое, и глобальный knockout
    # пробивал бы в нём дырки. Floodfill до лица не добирается — оно замкнуто
    # контуром капюшона. Дальше: trim случайных полей и glow-safe inset 1024×1024.
    w, h = size_of(source)
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    args: list[str] = [source, "-alpha", "on", "-fuzz", "8%", "-fill", "none"]
    for x, y in corners:
        args += ["-draw", f"color {x},{y} floodfill"]
    args += ["-trim", "+repage", "-resize", "820x820>",
             "-gravity", "center", "-background", "none", "-extent", "1024x1024", target]
    run(*args)
    return target


def main(argv: list[str]) -> None:
    names = tuple(argv) or POSES
    unknown = [n for n in names if n not in POSES]
    if unknown:
        raise SystemExit(f"Неизвестная поза: {unknown}. Доступны: {', '.join(POSES)}")
    OUT.mkdir(parents=True, exist_ok=True)
    BOT.mkdir(parents=True, exist_ok=True)
    built = [build_pose(name) for name in names]

    if "hello" not in names:
        # иконка и splash собираются из hello — на выборочной сборке их не трогаем
        for path in built:
            shutil.copy2(path, BOT / path.name)
        print(f"Built {len(built)} поз (icon/splash пропущены) и синхронизированы с bot/assets/mascot")
        return

    # App icon: character only, no byline. Rounded clipping is handled by each platform.
    icon = OUT / "icon.png"
    run("-size", "1024x1024", "radial-gradient:#ffffff-#dbeaff",
        built[0], "-resize", "780x780", "-gravity", "center", "-composite", icon)

    # The creator byline is baked into this preloader artwork and appears nowhere as live text.
    splash = OUT / "splash.png"
    run("-size", "1024x1024", "radial-gradient:#ffffff-#dce8fb",
        built[0], "-resize", "690x690", "-gravity", "center", "-geometry", "+0-38", "-composite",
        "-gravity", "south", "-font", "DejaVu-Sans", "-pointsize", "27", "-fill", "#6f82a8",
        "-annotate", "+0+64", "app by @stonym0ntana", splash)

    for path in [*built, icon, splash]:
        shutil.copy2(path, BOT / path.name)
    print(f"Built {len(built) + 2} assets and synced bot/assets/mascot")


if __name__ == "__main__":
    main(sys.argv[1:])
