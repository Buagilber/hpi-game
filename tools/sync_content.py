#!/usr/bin/env python3
"""Копіює контент гри в app/content/: пригоду (без каталогу промптів), скіл Ведучого і зображення.

Запуск із папки HPI project:  python3 app/tools/sync_content.py
Зображення зменшуються для вебу (найбільша сторона 1280 px, JPEG ~80 %) засобом macOS `sips`.
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ROOT = os.path.dirname(APP)  # HPI project
OUT = os.path.join(APP, "content")

ADVENTURES = ["adventure_1_v4"]
SKIP = {"images_catalog.md"}  # промпти для генерації зображень Ведучому й застосунку не потрібні

def copy_adventures():
    for adv in ADVENTURES:
        src, dst = os.path.join(ROOT, adv), os.path.join(OUT, "adventures", adv)
        os.makedirs(dst, exist_ok=True)
        for name in sorted(os.listdir(src)):
            if name in SKIP or name.startswith("."):
                continue
            shutil.copy2(os.path.join(src, name), os.path.join(dst, name))
        print(f"пригода {adv}: {len(os.listdir(dst))} файлів")

def copy_skill():
    dst = os.path.join(OUT, "skill")
    os.makedirs(dst, exist_ok=True)
    shutil.copy2(os.path.join(ROOT, "skill_gamemaster_v4.md"), os.path.join(dst, "gamemaster.md"))
    print("скіл Ведучого: gamemaster.md")

def copy_images():
    src, dst = os.path.join(ROOT, "images"), os.path.join(OUT, "images")
    os.makedirs(dst, exist_ok=True)
    n = 0
    for name in sorted(os.listdir(src)):
        if not name.lower().endswith((".jpeg", ".jpg", ".png", ".webp")):
            continue
        base = os.path.splitext(name)[0]
        out = os.path.join(dst, base + ".jpg")
        if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(os.path.join(src, name)):
            continue
        subprocess.run(["sips", "-Z", "1280", "-s", "format", "jpeg", "-s", "formatOptions", "80",
                        os.path.join(src, name), "--out", out], check=True, capture_output=True)
        n += 1
    total = sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst))
    print(f"зображення: оновлено {n}, усього {len(os.listdir(dst))}, {total / 1e6:.1f} МБ")

if __name__ == "__main__":
    if sys.platform != "darwin":
        sys.exit("Скрипт розрахований на macOS (sips).")
    copy_adventures(); copy_skill(); copy_images()
