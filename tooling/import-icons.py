#!/usr/bin/env python3
"""
Imports item and machine icons from a Satisfactory Modeler install (A38).

Usage: python3 tooling/import-icons.py <modeler>/images/icons

Run `pnpm build:data` first: icons are matched to data/generated/model.json by
name (case, spaces and punctuation ignored), shrunk to 64 px WebP and written to
apps/web/public/icons/{items,machines}/<id>.webp, with the list of ids in
apps/web/src/icons/manifest.json. Names without an icon are printed.

The icons are game art shipped with Modeler. They are not covered by this
repository's MIT licence; see apps/web/public/icons/NOTICE.md.
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE = 64


def key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    files = {}
    for folder, _, names in os.walk(src):
        for f in sorted(names):
            if f.lower().endswith(".png"):
                files.setdefault(key(f[:-4]), os.path.join(folder, f))
    with open(os.path.join(ROOT, "data/generated/model.json"), encoding="utf-8") as fh:
        model = json.load(fh)
    out = os.path.join(ROOT, "apps/web/public/icons")
    manifest = {}
    for kind in ("items", "machines"):
        os.makedirs(os.path.join(out, kind), exist_ok=True)
        found, missing = [], []
        for entry in model[kind]:
            path = files.get(key(entry["name"]))
            if path is None:
                missing.append(entry["name"])
                continue
            img = Image.open(path).convert("RGBA")
            img.thumbnail((SIZE, SIZE), Image.LANCZOS)
            img.save(os.path.join(out, kind, f"{entry['id']}.webp"), "WEBP", quality=90, method=6)
            found.append(entry["id"])
        manifest[kind] = sorted(found)
        print(f"{kind}: {len(found)} icons, {len(missing)} without: {', '.join(missing)}")
    with open(os.path.join(ROOT, "apps/web/src/icons/manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=0)
        fh.write("\n")


if __name__ == "__main__":
    main()
