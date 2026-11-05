import sys, glob, json
sys.path.insert(0, sys.argv[0].rsplit('/',1)[0])
from uasset import Pkg, R
out = {}
for f in glob.glob(sys.argv[1] + '/**/*.uasset', recursive=True):
    b = f.rsplit('/',1)[1]
    if not (b.startswith('ST_') or b.startswith('StringTable')): continue
    d = open(f,'rb').read(); p = Pkg(d)
    for e in p.exports:
        if e['name'].startswith('Default__'): continue
        r = R(p, e['pos']); r.u8(); r.props(); r.i32()
        ns = r.fstr(); n = r.i32(); t = {}
        for _ in range(n):
            k = r.fstr(); t[k] = r.fstr()
        pk = p.names[p.s['NameIdx']] if False else None
        # object path = package path + '.' + export name; package path from file location
        rel = f[len(sys.argv[1])+1:].replace('FactoryGame/Mods/GameFeatures/','/').replace('FactoryGame/Mods/','/').replace('/Content/','/',1)[:-7]
        out[rel + '.' + e['name']] = t
json.dump(out, open(sys.argv[2],'w'), indent=0)
print({k: len(v) for k,v in out.items()})
