#!/usr/bin/env python3
"""Build the Air · Glow mascot pack.

Sources: app/assets/mascot/_gen/{hello,calm,hug,proud,peek}.png
Outputs: 1024×1024 PNGs in app/assets/mascot and mirrored bot/assets/mascot.
Requires ImageMagick (`convert`). Generated sources stay untouched for easy reruns.
"""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "app/assets/mascot/_gen"
OUT = ROOT / "app/assets/mascot"
BOT = ROOT / "bot/assets/mascot"
POSES = ("hello", "calm", "hug", "proud", "peek")


def run(*args: str) -> None:
    subprocess.run(["convert", *map(str, args)], check=True)


def build_pose(name: str) -> Path:
    source, target = SRC / f"{name}.png", OUT / f"{name}.png"
    if not source.exists():
        raise SystemExit(f"Missing source: {source.relative_to(ROOT)}")
    # Preserve transparency, trim accidental empty margins, and keep a generous glow-safe inset.
    run(source, "-alpha", "on", "-fuzz", "2%", "-transparent", "#fefefe",
        "-fuzz", "2%", "-transparent", "#eeeeee", "-trim", "+repage", "-resize", "820x820>",
        "-gravity", "center", "-background", "none", "-extent", "1024x1024", target)
    return target


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    BOT.mkdir(parents=True, exist_ok=True)
    built = [build_pose(name) for name in POSES]

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
    main()
