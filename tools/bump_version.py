#!/usr/bin/env python3
"""Ставить номер версії до шляхів скриптів і стилів (`?v=…`), щоб після публікації браузер не брав старі файли з кешу.

GitHub Pages віддає файли з кешем ~10 хв; без версії гравець може отримати суміш старих і нових модулів
(так фінальний екран показався без стилів, Z-34). Запускати перед комітом, який піде на сайт:
    python3 app/tools/bump_version.py            # версія = поточні дата й час
    python3 app/tools/bump_version.py 4.1.3      # або свій номер
"""
import os, re, sys
from datetime import datetime

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
version = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y%m%d-%H%M")

JS_SPEC = re.compile(r'(["\'])(\.{1,2}/[^"\'?]+\.js)(?:\?v=[^"\']*)?\1')   # import … from "./x.js", import("./x.js")
HTML_REF = re.compile(r'((?:href|src)=")((?:css|js)/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?(")')

changed = 0
for root, _, files in os.walk(os.path.join(APP, "js")):
    for name in files:
        if not name.endswith(".js"):
            continue
        path = os.path.join(root, name)
        src = open(path, encoding="utf-8").read()
        out = JS_SPEC.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(1)}", src)
        if out != src:
            open(path, "w", encoding="utf-8").write(out)
            changed += 1

index = os.path.join(APP, "index.html")
html = open(index, encoding="utf-8").read()
new_html = HTML_REF.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(3)}", html)
if new_html != html:
    open(index, "w", encoding="utf-8").write(new_html)
    changed += 1

print(f"версія {version}: оновлено файлів — {changed}")
