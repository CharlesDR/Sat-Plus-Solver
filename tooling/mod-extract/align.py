import sys, json, re
from collections import defaultdict, Counter
EX, GD, OUT = sys.argv[1:4]
ex = json.load(open(EX)); gd = json.load(open(GD))
G = gd['Recipes']
byname = defaultdict(list)
for g in G: byname[g['Name']].append(g)
gparts = set(p['Name'] for p in gd['Parts']); gmach = set(m['Name'] for m in gd['Machines']) | set(m['Name'] for m in gd.get('MultiMachines', []))
import os
cls2name = json.load(open(OUT)) if os.path.exists(OUT) else {}; votes = defaultdict(Counter)
def nm(p): return cls2name.get(p['_class'], p['Part'])
def side(parts, neg): return [p for p in parts if p['Amount'].startswith('-') == neg]
for it in range(6):
    for r in ex:
        rname = r['Name'] if r['Name'] and not r['Name'].startswith('?') else None
        if rname is None:
            outs = side(r['Parts'], False)
            if outs and not nm(outs[0]).startswith('?'): rname = nm(outs[0])
        if rname is None: continue
        cands = byname.get(rname, [])
        mach = cls2name.get(r['_machineClasses'][0], r['Machine'])
        if len(cands) > 1 and not mach.startswith('?'):
            c2 = [g for g in cands if g['Machine'] == mach]; cands = c2 or cands
        if len(cands) != 1: continue
        g = cands[0]
        if mach.startswith('?'): votes['M:' + r['_machineClasses'][0]][g['Machine']] += 1
        for neg in (True, False):
            mine = side(r['Parts'], neg); theirs = [p['Part'] for p in g['Parts'] if p['Amount'].startswith('-') == neg]
            unres = [p for p in mine if nm(p).startswith('?')]
            left = [t for t in theirs if t not in [nm(p) for p in mine]]
            if len(unres) == 1 and len(left) == 1: votes[unres[0]['_class']][left[0]] += 1
    for k, c in votes.items():
        mc = c.most_common(2)
        best, n = mc[0]
        if len(mc) > 1 and mc[1][1] >= n: continue
        if k.startswith('M:'): cls2name[k[2:]] = best
        else: cls2name[k] = best
json.dump(cls2name, open(OUT, 'w'), indent=1, sort_keys=True)
amb = {k: dict(c) for k, c in votes.items() if len(c) > 1}
print('learned', len(cls2name), 'ambiguous', len(amb))
for k, v in list(amb.items())[:15]: print(' ', k.rsplit('.',1)[-1], v)
