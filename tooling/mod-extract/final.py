import sys, json, copy, re
from fractions import Fraction
from collections import defaultdict, Counter
EX, GD, OUT, VERSION = sys.argv[1:5]
REACH = json.load(open(OUT + '/reach.json'))
ex = json.load(open(EX)); gd = json.load(open(GD)); G = gd['Recipes']
for r in ex:
    if r['Name']: r['Name'] = r['Name'].replace('™', '')
    for p in r['Parts']: p['Part'] = p['Part'].replace('™', '')
gparts = set(p['Name'] for p in gd['Parts'])
def q(s):
    s = s.strip(); neg = s.startswith('-'); s = s.lstrip('-')
    v = sum(Fraction(x) for x in s.split(' '))
    return -v if neg else v
def sig(parts): return Counter((p['Part'], q(p['Amount'])) for p in parts)
def pset(parts): return frozenset(p['Part'] for p in parts)
def prods(parts): return frozenset(p['Part'] for p in parts if not p['Amount'].startswith('-'))
def base(n): return re.sub(r'^Alternate: ', '', n or '')
def fstr(x):
    s = '-' if x < 0 else ''; x = abs(x)
    if x.denominator == 1: return s + str(x.numerator)
    d = str(float(x)); return s + (d if Fraction(d) == x else f'{x.numerator}/{x.denominator}')
ex_live = [r for r in ex if 'KMods.PlannerExclude' not in r['_tags']]
excluded = [r for r in ex if 'KMods.PlannerExclude' in r['_tags']]
def mfam(m): return re.sub(r'^Farming Platform \((\w+ Plot).*\)$', r'\1', m)
def rsig(parts, bt):
    d = defaultdict(Fraction)
    for p in parts: d[p['Part']] += q(p['Amount']) * 60 / q(bt)
    return dict(d)
def do_pairs():
    used = set(); pairs = {}
    for keyf_g, keyf_r, unique in [
        (lambda g: (g['Name'], mfam(g['Machine'])), lambda r: (base(r['Name']), mfam(r['Machine'])), False),
        (lambda g: (mfam(g['Machine']), pset(g['Parts'])), lambda r: (mfam(r['Machine']), pset(r['Parts'])), True),
        (lambda g: (g['Name'], pset(g['Parts'])), lambda r: (base(r['Name']), pset(r['Parts'])), True)]:
        idx = defaultdict(list)
        for i, g in enumerate(G):
            if i not in used: idx[keyf_g(g)].append(i)
        rk = Counter(keyf_r(r) for j, r in enumerate(ex_live) if j not in pairs)
        cand = []
        for j, r in enumerate(ex_live):
            if j in pairs: continue
            c = [i for i in idx.get(keyf_r(r), []) if i not in used]
            if not c or (unique and (len(c) != 1 or rk[keyf_r(r)] != 1)): continue
            for i in c:
                score = (rsig(G[i]['Parts'], G[i]['BatchTime']) == rsig(r['Parts'], r['BatchTime']), r['_class'] in REACH, len(pset(G[i]['Parts']) & pset(r['Parts'])))
                cand.append((score, j, i))
        for score, j, i in sorted(cand, key=lambda t: t[0], reverse=True):
            if j in pairs or i in used: continue
            pairs[j] = i; used.add(i)
    return pairs, used
pairs, used = do_pairs()
# map in-game part names to dataset part names, learned from matched pairs
pmap = defaultdict(Counter)
for j, i in pairs.items():
    r, g = ex_live[j], G[i]
    for neg in (True, False):
        mine = [p['Part'] for p in r['Parts'] if p['Amount'].startswith('-') == neg]
        theirs = [p['Part'] for p in g['Parts'] if p['Amount'].startswith('-') == neg]
        um = [m for m in mine if m not in gparts]; ut = [t for t in theirs if t not in mine]
        if len(um) == 1 and len(ut) == 1: pmap[um[0]][ut[0]] += 1
PMAP = {k: c.most_common(1)[0][0] for k, c in pmap.items()}
for r in ex:
    for p in r['Parts']:
        if p['Part'] not in gparts and p['Part'] in PMAP: p['Part'] = PMAP[p['Part']]
pairs, used = do_pairs()
def is_pack(r): return any(t in ('Recipe.Package', 'Recipe.Unpackage') for t in r['_tags']) or re.match(r'(Packaged|Unpack)', r['Name'] or '')
for r in ex:
    merged = {}
    for p in r['Parts']:
        k = (p['Part'], p['Amount'].startswith('-'))
        if k in merged: merged[k]['Amount'] = fstr(q(merged[k]['Amount']) + q(p['Amount']))
        else: merged[k] = dict(p)
    r['Parts'] = list(merged.values())
pairs, used = do_pairs()
def rate(a, bt): return q(a) * 60 / q(bt)
def fmt(x):
    x = abs(x); return str(int(x)) if x.denominator == 1 else (f'{float(x):.4g}')
same, changed, renamed, batchonly, packkept = [], [], [], [], []
newgd = copy.deepcopy(gd); unknown_parts = set()
for j, i in pairs.items():
    r, g = ex_live[j], G[i]
    if base(r['Name']) != g['Name']: renamed.append((g['Name'], r['Name'], g['Machine']))
    if q(g['BatchTime']) == q(r['BatchTime']) and sig(g['Parts']) == sig(r['Parts']): same.append(i); continue
    if is_pack(r): same.append(i); packkept.append(g['Name']); continue
    if rsig(g['Parts'], g['BatchTime']) == rsig(r['Parts'], r['BatchTime']): same.append(i); batchonly.append((g['Name'], g['Machine'], g['BatchTime'], r['BatchTime'])); continue
    changed.append((i, j))
    ng = newgd['Recipes'][i]; ng['BatchTime'] = r['BatchTime']
    ng['Parts'] = [{'Part': p['Part'], 'Amount': p['Amount']} for p in r['Parts']]
    if mfam(g['Machine']) != mfam(r['Machine']): ng['Machine'] = r['Machine']
    for p in r['Parts']:
        if p['Part'] not in gparts: unknown_parts.add(p['Part'])
# In-game confirmations for 2026.4.651 (Charles, 2026-11-05): slug paint moved to the Particle Accelerator;
# Strange Universal Matter - Alpha exists. With mod-versions/2026.4.651/game_data.json as the base they are
# already in the dataset; a later version that needs its own adds a block like this one.
confirmed = []
if VERSION == '2026.4.651':
    def exfind(name, machine): return next(r for r in ex if (r['Name'] or '') == name and r['Machine'] == machine)
    for nm in ['Universal Paint (Copper Slug)', 'Universal Paint (Golden Slug)', 'Universal Paint (Iron Slug)', 'Universal Paint (Orange Slug)']:
        r = exfind(nm, 'Particle Accelerator'); i = next(k for k, g in enumerate(G) if g['Name'] == nm)
        old = G[i]; vp = r['_varPower']; c, fct = Fraction(vp['constant']), Fraction(vp['factor'])
        newgd['Recipes'][i] = {'Name': nm, 'Machine': 'Particle Accelerator', 'BatchTime': r['BatchTime'], 'Tier': old['Tier'],
            'MinPower': fstr(-(c + fct)), 'AveragePower': fstr(-(c + fct / 2)), 'Parts': [{'Part': p['Part'], 'Amount': p['Amount']} for p in r['Parts']], 'Mark': old['Mark']}
        confirmed.append((old, r))
    r = exfind('Strange Universal Matter - Alpha', 'Wet Washer')
    newgd['Recipes'].append({'Name': r['Name'], 'Machine': 'Wet Washer', 'BatchTime': r['BatchTime'], 'Tier': '10-0',
        'Parts': [{'Part': p['Part'], 'Amount': p['Amount']} for p in r['Parts']], 'Mark': 'modfiles_' + VERSION})
    confirmed.append((None, r))
json.dump(newgd, open(OUT + f'/game_data-{VERSION}.json', 'w'), indent=1, ensure_ascii=False)
newr = [r for j, r in enumerate(ex_live) if j not in pairs]
json.dump([{k: v for k, v in r.items()} for r in newr], open(OUT + f'/not-in-dataset-{VERSION}.json', 'w'), indent=1, ensure_ascii=False)
# report
L = []
L.append(f'# SF+ {VERSION} recipes read from the mod files\n')
L.append(f'Source: the installed mods zip, SF+ `SatisfactoryPlus.uplugin` VersionName {VERSION}. Recipes read directly from the mod paks (tagged properties, no mappings needed) with the SatisfactoryPlus DataForge and KPatchwork YAML patches applied on top.\n')
L.append(f'- Machine recipes in the mod files: **{len(ex)}** ({len(excluded)} tagged `KMods.PlannerExclude` by SF+, left out below)')
L.append(f'- Matched to a `game_data.json` recipe: **{len(pairs)}**; identical: **{len(same)}**; different: **{len(changed)}**')
L.append(f'- In the mod files but not matched to the dataset: **{len(newr)}** (see `not-in-dataset-{VERSION}.json`). Five of them are confirmed in game and applied below. The rest are disabled or absent in game (Refined Power, Ficsit Farming plots, Trigon repaints), T10 decor, or recipes nothing unlocks.')
L.append(f'- Dataset recipes with no recipe asset in the mods: **{len(G)-len(used)}** (vanilla recipes SF+ leaves alone, miners, generators/heaters and other entries the wiki builds from building data). These are copied unchanged.\n')
L.append('## What this covers\n')
L.append('- Every recipe asset in the installed mods (SF+, KLib, Refined Power, Ficsit Farming, AB Fluid Extras and the rest of the zip), with SF+ DataForge and KPatchwork YAML patches applied (`target:` patches). Verified on Washed Iron against the in-game spot check.')
L.append(f'- `game_data-{VERSION}.json` is `game_data.json` with the "Changed recipes" below replaced by the mod-file values (in-game per-batch amounts and batch time, dataset part names). Everything else (Parts, Machines, Tier, Alternate, power, miners, heaters) is copied unchanged.')
L.append('- Not covered: base-game recipes SF+ does not patch (not in the mod files; dataset values kept), runtime Blueprint patches (packaging, see the Packaging section), 15 query-style YAML patches (they add the A.I. Fluid Packer as a second machine for Packager recipes and similar; no rate changes), variable power, and new tiers or unlocks.\n')
L.append('Rates are per minute at 100% clock. Fluids in m³.\n')
L.append('Flags: **[U]** no unlock for this recipe was found in the mod schematics; it may be unlocked another way (building recipe lists, research) or be unused.\n')
L.append('## Changed recipes\n')
L.append('| Recipe | Machine | Batch (s) | Old /min | New /min |')
L.append('|---|---|---|---|---|')
for i, j in sorted(changed, key=lambda t: (G[t[0]]['Machine'], G[t[0]]['Name'])):
    g, r = G[i], ex_live[j]
    bt = g['BatchTime'] if q(g['BatchTime']) == q(r['BatchTime']) else f"{g['BatchTime']} → {r['BatchTime']}"
    def side(parts, bt):
        ins = ', '.join(f"{p['Part']} {fmt(rate(p['Amount'], bt))}" for p in parts if p['Amount'].startswith('-'))
        outs = ', '.join(f"{p['Part']} {fmt(rate(p['Amount'], bt))}" for p in parts if not p['Amount'].startswith('-'))
        return f'{ins} → {outs}'
    flag = []
    if 'Recipe.Package' in r['_tags'] or 'Packag' in g['Name'] or 'Unpack' in g['Name']: flag.append('P')
    if r['_class'] not in REACH: flag.append('U')
    if mfam(g['Machine']) != mfam(r['Machine']) or (g['Machine'] != r['Machine'] and not g['Machine'].startswith('Farming')): flag.append('machine: ' + r['Machine'])
    L.append(f"| {g['Name']}{(' ['+','.join(flag)+']') if flag else ''} | {g['Machine']} | {bt} | {side(g['Parts'], g['BatchTime'])} | {side(r['Parts'], r['BatchTime'])} |")
if unknown_parts:
    L.append(f"\nParts used by changed recipes that are not in `game_data.json` Parts: {', '.join(sorted(unknown_parts))}.\n")
if confirmed:
    L.append('\n## Moved or added (confirmed in game by Charles, 2026-11-05)\n')
    L.append('| Recipe | Machine | Batch (s) | Old /min | New /min |')
    L.append('|---|---|---|---|---|')
    for g, r in confirmed:
        def side2(parts, bt):
            ins = ', '.join(f"{p['Part']} {fmt(rate(p['Amount'], bt))}" for p in parts if p['Amount'].startswith('-'))
            outs = ', '.join(f"{p['Part']} {fmt(rate(p['Amount'], bt))}" for p in parts if not p['Amount'].startswith('-'))
            return f'{ins} → {outs}'
        if g: L.append(f"| {g['Name']} | {g['Machine']} → {r['Machine']} | {g['BatchTime']} → {r['BatchTime']} | {side2(g['Parts'], g['BatchTime'])} | {side2(r['Parts'], r['BatchTime'])} |")
        else: L.append(f"| {r['Name']} (new, tier 10-0 like Mercer Sphere) | {r['Machine']} | {r['BatchTime']} | none | {side2(r['Parts'], r['BatchTime'])} |")
    L.append('\nAccelerator power for the paint recipes: 100 MW + 400 MW variable (dataset fields MinPower -500, AveragePower -300).')
    L.append('\nNot in game (Charles, 2026-11-05): Refined Power recipes (disabled by SF+), Ficsit Farming\'s own plot recipes (plots give Leaves only), the Trigon repaints, and the new Small FaxIT Disk recipe (the Assembler still uses Poled Kerr Crystal + Smart Plating, as in the dataset).')
if packkept:
    L.append(f'\n## Packaging recipes: dataset kept ({len(packkept)})\n')
    L.append('SF+ rewrites packaging recipes while the game loads (`CDORequirement_Packager`), so the files are not authoritative for them. Several gas recipes show twice the fluid in the files, but in game Packaged and Unpackage Air run at the dataset rate (Charles, 2026-11-05), so every packaging recipe keeps its dataset values.\n')
    L.append(', '.join(sorted(set(packkept))))
if batchonly:
    L.append('\n## Same rates, different batch size (no effect on plans; dataset keeps its batch)\n')
    for n, m, a, b in sorted(batchonly): L.append(f'- {n} ({m}): {a} s in the dataset, {b} s in the mod files')
if renamed:
    L.append('\n## Name differences (in-game name vs dataset name, matched by machine and parts)\n')
    for a, b, m in sorted(set(renamed)): L.append(f'- {a} ({m}): in game "{b}"')
open(OUT + f'/changes-{VERSION}.md', 'w').write('\n'.join(L) + '\n')
print('pmap', PMAP); print('pairs', len(pairs), 'same', len(same), 'changed', len(changed), 'new', len(newr), 'excluded', len(excluded), 'renamed', len(set(renamed)), 'unknown parts', sorted(unknown_parts))
