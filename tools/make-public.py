#!/usr/bin/env python3
"""Build the public «Shopkeeper» userscript from Toppzy's own copy.

Toppzy's install must keep @name «Toppzy Manager» (otherwise Tampermonkey treats it as a new
script and his key and list are lost). The public release gets its own name, namespace and file,
so other players install it separately. Only the header and the API comment differ.

Usage (from the repo root):  python3 tools/make-public.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'toppzy-bazaar-manager.user.js'
DST = ROOT / 'shopkeeper.user.js'
RAW = 'https://raw.githubusercontent.com/skur-commits/torn-scripts/main/'

src = SRC.read_text(encoding='utf-8')
swaps = [
    (r'^// @name\s+.*$', '// @name         Shopkeeper – Torn bazaar manager'),
    (r'^// @namespace\s+.*$', '// @namespace    shopkeeper.torn'),
    (r'^// @updateURL\s+.*$', '// @updateURL    ' + RAW + 'shopkeeper.user.js'),
    (r'^// @downloadURL\s+.*$', '// @downloadURL  ' + RAW + 'shopkeeper.user.js'),
]
out = src
for pat, rep in swaps:
    out, n = re.subn(pat, rep, out, count=1, flags=re.M)
    if n != 1:
        sys.exit(f'header line not found: {pat}')
out, n = re.subn(r'comment=ToppzyManager', 'comment=Shopkeeper', out)
if n != 1:
    sys.exit('API comment not found')
DST.write_text(out, encoding='utf-8')
print(f'wrote {DST.name} ({len(out.encode())} bytes)')
