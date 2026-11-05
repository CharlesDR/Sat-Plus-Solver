"""Minimal reader for UE5.4+ zen (IoStore) packages cooked with tagged properties."""
import struct
from zen import names_at, summary
from cityhash import cityhash64
REG = {}  # package path -> file path (mod packages available locally)
_EXP = {}
def pkg_exports(pk):
    if pk not in _EXP:
        m = {}
        f = REG.get(pk.lower())
        if f:
            d = open(f, 'rb').read(); s = summary(d); p = Pkg(d)
            for i, e in enumerate(p.exports):
                ph = struct.unpack_from('<Q', d, s['ExportMapOff'] + 72*i + 56)[0]
                m[ph] = e['name']
        _EXP[pk] = m
    return _EXP[pk]

class Pkg:
    def __init__(self, d):
        self.d = d; s = self.s = summary(d); p = 52
        if s['hasVer']:
            zv, ue4, ue5, lic, ncv = struct.unpack_from('<iiiii', d, p); p += 20 + ncv*20 + (8 if zv >= 3 else 0)
            self.ue5 = ue5
        self.names, p = names_at(d, p)
        self.ipn, _ = names_at(d, s['ImportedPkgNamesOff'])
        n = (s['ExportMapOff']-s['ImportMapOff'])//8
        self.imports = [struct.unpack_from('<Q', d, s['ImportMapOff']+8*i)[0] for i in range(n)]
        self.exports = []
        ne = (s['ExportBundleOff']-s['ExportMapOff'])//72
        for i in range(ne):
            so, ss, ni, nn, outer, cls, sup, tmpl, ph, of = struct.unpack_from('<QQIIQQQQQI', d, s['ExportMapOff']+72*i)
            self.exports.append(dict(name=self.names[ni & 0x3fffffff], size=ss, pos=s['HeaderSize']+so))
    def import_name(self, i):
        v = self.imports[i]; t = v >> 62
        if t == 2:
            pk = self.ipn[((v & ((1<<62)-1)) >> 32)]
            h = struct.unpack_from('<Q', self.d, self.s['ImpHashOff'] + 8*(v & 0xffffffff))[0]
            ex = pkg_exports(pk)
            if h in ex: return pk + '.' + ex[h]
            base = pk.rsplit('/', 1)[1]
            for c in [base + '_C'] + [f'{base}_{n}_C' for n in range(0, 60)] + [f'{base}{n}_C' for n in range(0, 60)]:
                if cityhash64(c.lower().encode('utf-16le')) == h: return pk + '.' + c
            return pk + '.?' + base + '_C#' + hex(h)
        return f'<import type {t}>'
    def obj_ref(self, idx):
        if idx < 0: return self.import_name(-idx-1)
        if idx > 0: return self.exports[idx-1]['name']
        return None

class R:
    def __init__(self, pkg, pos): self.p = pkg; self.d = pkg.d; self.o = pos
    def i32(self): v = struct.unpack_from('<i', self.d, self.o)[0]; self.o += 4; return v
    def u8(self): v = self.d[self.o]; self.o += 1; return v
    def f32(self): v = struct.unpack_from('<f', self.d, self.o)[0]; self.o += 4; return v
    def name(self):
        i, n = struct.unpack_from('<ii', self.d, self.o); self.o += 8
        s = self.p.names[i]; return s if n == 0 else f'{s}_{n-1}'
    def fstr(self):
        L = self.i32()
        if L == 0: return ''
        if L < 0: s = self.d[self.o:self.o-2*L].decode('utf-16le'); self.o += -2*L
        else: s = self.d[self.o:self.o+L].decode('latin1'); self.o += L
        return s.rstrip('\0')
    def typename(self):
        n = self.name(); c = self.i32()
        return (n, [self.typename() for _ in range(c)])
    def text(self):
        flags = self.i32(); h = self.u8()
        if h == 11: return {'table': self.name(), 'key': self.fstr()}
        if h == 0: ns = self.fstr(); key = self.fstr(); src = self.fstr(); return {'ns': ns, 'key': key, 'src': src}
        if h == 255:
            has = self.i32();  return {'str': self.fstr()} if has else {'str': ''}
        return {'history': h}
    def value(self, t, size, flags):
        tn, params = t
        if tn == 'BoolProperty': return bool(flags & 0x10)
        if tn == 'IntProperty': return self.i32()
        if tn == 'FloatProperty': return self.f32()
        if tn in ('ObjectProperty', 'ClassProperty'): return self.p.obj_ref(self.i32())
        if tn in ('SoftObjectProperty', 'SoftClassProperty'):
            pk = self.name(); an = self.name(); sub = self.fstr(); return f'{pk}.{an}' + (f':{sub}' if sub else '')
        if tn == 'TextProperty': return self.text()
        if tn in ('NameProperty',): return self.name()
        if tn in ('StrProperty',): return self.fstr()
        if tn in ('ByteProperty', 'EnumProperty'):
            return self.name() if size == 8 else (self.u8() if size == 1 else self.d[self.o:self.o+size].hex())
        if tn == 'ArrayProperty':
            n = self.i32(); inner = params[0]
            return [self.value(inner, None, 0) for _ in range(n)]
        if tn == 'StructProperty':
            sname = params[0][0] if params else '?'
            if sname == 'GameplayTagContainer':
                n = self.i32(); return [self.name() for _ in range(n)]
            return self.props()
        raise ValueError(f'unhandled {t}')
    def props(self):
        out = {}
        while True:
            nm = self.name()
            if nm == 'None': return out
            t = self.typename(); size = self.i32(); flags = self.u8()
            if flags & 0x01: self.i32()
            if flags & 0x02: self.o += 16
            if flags & 0x04:
                ext = self.u8()
                if ext & 0x02: self.u8(); self.u8()
            start = self.o
            try:
                v = self.value(t, size, flags)
                if t[0] != 'BoolProperty' and self.o != start + size: v = {'_unparsed': t[0], '_note': f'size mismatch {self.o-start}!={size}'}
            except Exception as e:
                v = {'_unparsed': t[0], '_err': str(e)}
            self.o = start + (0 if t[0] == 'BoolProperty' else size)
            out[nm] = v

def cdo_props(d):
    pkg = Pkg(d)
    for e in pkg.exports:
        if e['name'].startswith('Default__'):
            r = R(pkg, e['pos']); r.u8()  # serialization control extension
            return pkg, e['name'], r.props()
    return pkg, None, None
