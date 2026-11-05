import sys, glob, json, re, os
sys.path.insert(0, sys.argv[0].rsplit('/',1)[0])
from uasset import Pkg, R
import uasset, yaml
RAW, MODS, OUT = sys.argv[1:4]
for f in glob.glob(RAW + '/**/*.uasset', recursive=True):
    rel = re.sub(r'^FactoryGame/Mods/(GameFeatures/)?([^/]+)/Content/', r'/\2/', f[len(RAW)+1:-7]); uasset.REG[rel.lower()] = f
reach = {}; keys = set(); errs = 0
def walk(v, out):
    if isinstance(v, dict):
        for k, x in v.items():
            if k == 'mRecipes' and isinstance(x, list): out.extend(y for y in x if isinstance(y, str))
            else: walk(x, out)
    elif isinstance(v, list):
        for x in v: walk(x, out)
for f in glob.glob(RAW + '/**/*.uasset', recursive=True):
    b = os.path.basename(f)
    if 'Schem' not in b and 'Research' not in b and not b.startswith('SC_'): continue
    d = open(f, 'rb').read()
    try: p = Pkg(d)
    except Exception: errs += 1; continue
    sch = re.sub(r'^FactoryGame/Mods/(GameFeatures/)?([^/]+)/Content/', r'/\2/', f[len(RAW)+1:-7])
    for e in p.exports:
        try: r = R(p, e['pos']); r.u8(); pr = r.props()
        except Exception: continue
        out = []; walk(pr, out)
        for rc in out: reach.setdefault(rc, set()).add(sch.rsplit('/',1)[1])
for f in glob.glob(MODS + '/**/*.yml', recursive=True):
    try: y = yaml.safe_load(open(f, encoding='utf-8-sig'))
    except Exception: continue
    if isinstance(y, dict) and y.get('type') == 'schematic':
        for s in y.get('schematics') or []:
            for rc in s.get('recipes') or []: reach.setdefault(rc, set()).add('yml:' + s.get('class', '?').rsplit('.',1)[-1])
json.dump({k: sorted(v) for k, v in reach.items()}, open(OUT, 'w'), indent=0)
print('reachable recipe classes', len(reach), 'pkg errs', errs)
