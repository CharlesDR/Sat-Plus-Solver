import sys, os, glob, json, re, struct, copy
sys.path.insert(0, sys.argv[0].rsplit('/',1)[0])
from uasset import Pkg, R
import uasset
import yaml
RAW, MODS, STJ, GD, OUT = sys.argv[1:6]
ST = json.load(open(STJ))

def objpath(f):
    rel = f[len(RAW)+1:-7]
    rel = re.sub(r'^FactoryGame/Mods/(GameFeatures/)?([^/]+)/Content/', r'/\2/', rel)
    return rel + '.' + rel.rsplit('/',1)[1] + '_C'

def load_cdo(f):
    d = open(f,'rb').read(); p = Pkg(d)
    so, ss, ni, nn, outer, cls, sup, tmpl, ph, of = struct.unpack_from('<QQIIQQQQQI', d, p.s['ExportMapOff'])
    parent = p.ipn[(sup & ((1<<62)-1))>>32] if sup>>62 == 2 else None
    out = {}
    for e in p.exports:
        if e['name'].startswith('Default__'):
            r = R(p, e['pos']); r.u8(); out[e['name'][9:]] = r.props()
    return out, parent

for f in glob.glob(RAW + '/**/*.uasset', recursive=True):
    rel = re.sub(r'^FactoryGame/Mods/(GameFeatures/)?([^/]+)/Content/', r'/\2/', f[len(RAW)+1:-7])
    uasset.REG[rel.lower()] = f
CDO = {}; PARENT = {}
for f in glob.glob(RAW + '/**/*.uasset', recursive=True):
    b = os.path.basename(f)
    if not re.match(r'(Recipe_|Desc_|Build_|Res_|SlugDesc_|BP_.*(Recipe|Desc)|[A-Za-z]*Desc_)', b): continue
    try:
        props, parent = load_cdo(f)
    except Exception as e:
        print('ERR', f, e); continue
    pk = objpath(f).rsplit('.', 1)[0]
    for cn, pr in props.items():
        op = pk + '.' + cn; CDO[op] = pr
        if parent: PARENT[op] = parent + '.' + parent.rsplit('/',1)[1] + '_C'

def resolved(op, seen=()):
    p = CDO.get(op, {})
    par = PARENT.get(op)
    if par and par in CDO and par not in seen:
        base = copy.deepcopy(resolved(par, seen + (op,))); base.update(p); return base
    return copy.deepcopy(p)

# --- DataForge patches (explicit targets only) ---
PATCHED = {}; skipped_queries = []
def set_path(obj, path, value):
    parts = re.findall(r'([A-Za-z_0-9]+)(?:\[(\d+)\])?', path)
    cur = obj
    for i, (k, idx) in enumerate(parts):
        last = i == len(parts) - 1
        if idx == '':
            if last: cur[k] = value
            else: cur = cur.setdefault(k, {})
        else:
            lst = cur.setdefault(k, []); j = int(idx)
            while len(lst) <= j: lst.append({})
            if last: lst[j] = value
            else: cur = lst[j]
yml_files = sorted(glob.glob(MODS + '/GameFeatures/SatisfactoryPlus/DataForge/**/*.yml', recursive=True)) + sorted(glob.glob(MODS + '/KPatchwork/**/*.yml', recursive=True))
for f in yml_files:
    try: y = yaml.safe_load(open(f, encoding='utf-8-sig'))
    except Exception as e: print('YAMLERR', f, e); continue
    if not isinstance(y, dict) or y.get('type') != 'cdo': continue
    for pt in y.get('patches') or []:
        t = pt.get('target')
        if t is None: skipped_queries.append((f[len(MODS):], pt.get('ofClass'), [p.get('path') for p in pt.get('properties', [])])); continue
        for tgt in (t if isinstance(t, list) else [t]):
            for pr in pt.get('properties') or []:
                PATCHED.setdefault(tgt, []).append((f[len(MODS):], pr['path'], pr.get('value')))

def final(op):
    base = resolved(op) if op in CDO else {}
    for src, path, val in PATCHED.get(op, []): set_path(base, path, val)
    return base

def text(v):
    if v is None: return None
    if isinstance(v, str): return v
    if 'table' in v: return ST.get(v['table'], {}).get(v['key'])
    return v.get('src') or v.get('source') or v.get('str')

ALIAS = {'Fuel':'Packaged Fuel','LiquidFuel':'Fuel','LiquidOil':'Crude Oil','LiquidTurboFuel':'Turbofuel','TurboFuel':'Packaged Turbofuel','LiquidBiofuel':'Liquid Biofuel','Biofuel':'Solid Biofuel','GenericBiomass':'Biomass','CircuitBoardHighSpeed':'AI Limiter','ModularFrameHeavy':'Heavy Modular Frame','ModularFrameFused':'Fused Modular Frame','IronPlateReinforced':'Reinforced Iron Plate','SteelPlateReinforced':'Encased Industrial Beam','SteelPlate':'Steel Beam','HighSpeedWire':'Quickwire','ComputerSuper':'Supercomputer','AluminumPlate':'Alclad Aluminum Sheet','AluminumPlateReinforced':'Heat Sink','NuclearFuelRod':'Uranium Fuel Rod','UraniumCell':'Encased Uranium Cell','PlutoniumCell':'Encased Plutonium Cell','NuclearWaste':'Uranium Waste','Cement':'Concrete','Stone':'Limestone','OreBauxite':'Bauxite','GoldIngot':'Caterium Ingot','Gunpowder':'Black Powder','GunpowderMK2':'Smokeless Powder','MotorLightweight':'Turbo Motor','DarkEnergy':'Dark Matter Residue','QuantumEnergy':'Excited Photonic Matter','DarkMatter':'Dark Matter Crystal','SAMIngot':'Reanimated SAM','Diamond':'Diamonds','FicsiteMesh':'Ficsite Trigon','QuantumOscillator':'Superposition Oscillator','TemporalProcessor':'Neural-Quantum Processor','AlienPowerFuel':'Alien Power Matrix','PackagedOil':'Packaged Oil','PackagedOilResidue':'Packaged Heavy Oil Residue','PackagedAlumina':'Packaged Alumina Solution','FluidCanister':'Empty Canister','GasTank':'Empty Fluid Tank','Filter':'Gas Filter','HazmatFilter':'Iodine-Infused Filter',
 'SpaceElevatorPart_1':'Smart Plating','SpaceElevatorPart_2':'Versatile Framework','SpaceElevatorPart_3':'Automated Wiring','SpaceElevatorPart_4':'Modular Engine','SpaceElevatorPart_5':'Adaptive Control Unit','SpaceElevatorPart_6':'Magnetic Field Generator','SpaceElevatorPart_7':'Assembly Director System','SpaceElevatorPart_8':'Thermal Propulsion Rocket','SpaceElevatorPart_9':'Nuclear Pasta','SpaceElevatorPart_10':'Biochemical Sculptor','SpaceElevatorPart_11':'Ballistic Warp Drive','SpaceElevatorPart_12':'AI Expansion Server'}
GDJ = json.load(open(GD)); GDNAMES = set(p['Name'] for p in GDJ['Parts']) | set(m['Name'] for m in GDJ['Machines'])
def vanilla_name(op):
    cn = op.rsplit('.', 1)[-1]; cn = re.sub(r'^(Desc_|Build_|BP_ItemDescriptor|BP_EquipmentDescriptor)', '', cn); cn = re.sub(r'_C$', '', cn)
    if cn in ALIAS and ALIAS[cn] in GDNAMES: return ALIAS[cn]
    sp = re.sub(r'(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', ' ', cn).replace('_', ' ')
    if sp in GDNAMES: return sp
    return None
LEARNED = json.load(open(OUT + '/learned-names.json')) if os.path.exists(OUT + '/learned-names.json') else {}
def dname(op):
    p = final(op); return text(p.get('mDisplayName')) or (vanilla_name(op) if op.startswith('/Game/') else None) or LEARNED.get(op)

VANILLA_FLUIDS = {'Desc_Water','Desc_LiquidOil','Desc_HeavyOilResidue','Desc_LiquidFuel','Desc_LiquidTurboFuel','Desc_LiquidBiofuel','Desc_AluminaSolution','Desc_SulfuricAcid','Desc_NitricAcid','Desc_NitrogenGas','Desc_RocketFuel','Desc_IonizedFuel','Desc_DarkEnergy','Desc_QuantumEnergy','Desc_DissolvedSilica'}
def is_fluid(op):
    p = final(op); f = p.get('mForm')
    if f: return 'LIQUID' in str(f) or 'GAS' in str(f)
    return op.rsplit('.',1)[1][:-2] in VANILLA_FLUIDS

from fractions import Fraction
def f32str(x):
    t = struct.unpack('<f', struct.pack('<f', x))[0]
    for nd in range(0, 10):
        s = f'{x:.{nd}f}'
        if struct.unpack('<f', struct.pack('<f', float(s)))[0] == t: break
    return s
def amt(n, fluid):
    q = Fraction(n, 1000) if fluid else Fraction(n)
    if q.denominator == 1: return str(q.numerator)
    s = str(float(q))
    return s if Fraction(s) == q else f'{q.numerator}/{q.denominator}'

NONMACHINE = re.compile(r'BuildGun|WorkBench|Workshop|AutomatedWorkBench|BP_.*Component', re.I)
recipes = []; names_missing = set()
all_targets = set(k for k in CDO if '/Recipe_' in k) | set(k for k in PATCHED if '/Recipe_' in k)
for op in sorted(all_targets):
    p = final(op)
    prod_in = [m for m in (p.get('mProducedIn') or []) if m and not NONMACHINE.search(m)]
    if not prod_in: continue
    def parts(lst, sign):
        out = []
        for ia in lst or []:
            ic = ia.get('ItemClass'); n = ia.get('Amount', 1)
            if not ic: continue
            nm = dname(ic) if ic else None
            if nm is None: names_missing.add(ic); nm = '?' + (ic or 'None').rsplit('.',1)[-1]
            out.append({'Part': nm, 'Amount': ('-' if sign < 0 else '') + amt(n, is_fluid(ic)), '_class': ic, '_fluid': is_fluid(ic)})
        return out
    ins = parts(p.get('mIngredients'), -1); outs = parts(p.get('mProduct'), 1)
    name = text(p.get('mDisplayName')) if p.get('mDisplayNameOverride') else None
    if not name and outs: name = outs[0]['Part']
    machines = []
    for m in prod_in:
        mn = dname(m)
        if mn is None: names_missing.add(m); mn = '?' + m.rsplit('.',1)[-1]
        machines.append(mn)
    r = {'Name': name, 'Machine': machines[0], 'BatchTime': f32str(p.get('mManufactoringDuration', 1.0)), 'Parts': ins + outs,
         '_class': op, '_machines': machines, '_machineClasses': prod_in, '_source': 'patch-only' if op not in CDO else 'pak', '_tags': p.get('mGameplayTags') or [], '_patched_by': sorted(set(s for s,_,_ in PATCHED.get(op, [])))}
    if 'mVariablePowerConsumptionConstant' in p or 'mVariablePowerConsumptionFactor' in p:
        c = p.get('mVariablePowerConsumptionConstant', 0.0); fct = p.get('mVariablePowerConsumptionFactor', 1.0)
        r['_varPower'] = {'constant': f32str(c), 'factor': f32str(fct)}
    recipes.append(r)
os.makedirs(OUT, exist_ok=True)
json.dump(recipes, open(OUT + '/extracted-recipes.json', 'w'), indent=1, ensure_ascii=False)
print('production recipes', len(recipes), 'missing names', len(names_missing))
print(sorted(names_missing)[:60])
print('query patches skipped', len(skipped_queries))
