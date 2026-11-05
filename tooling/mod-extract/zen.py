import struct, sys
def names_at(d, p):
    n, nbytes = struct.unpack_from('<II', d, p); p += 8
    if n == 0: return [], p
    p += 8  # hash version
    p += 8 * n
    lens = [struct.unpack_from('>h', d, p + 2*i)[0] for i in range(n)]; p += 2*n
    out = []
    for L in lens:
        if L < 0: s = d[p:p+(-L)*2].decode('utf-16le'); p += -L*2
        else: s = d[p:p+L].decode('latin1'); p += L
        out.append(s)
    return out, p
def summary(d):
    f = struct.unpack_from('<IIIIIIiiiiiii', d, 0)
    keys = ['hasVer','HeaderSize','NameIdx','NameNum','Flags','CookedHeaderSize','ImpHashOff','ImportMapOff','ExportMapOff','ExportBundleOff','DepBundleHdrOff','DepBundleEntOff','ImportedPkgNamesOff']
    return dict(zip(keys, f))
if __name__ == '__main__':
    d = open(sys.argv[1], 'rb').read()
    s = summary(d); print(s, 'unversioned=', bool(s['Flags'] & 0x2000))
    p = 13*4
    if s['hasVer']: print('has versioning info (not parsed)'); sys.exit()
    names, p = names_at(d, p); print('names:', names)
    print('after names', p)
    if s['ImportedPkgNamesOff'] < s['HeaderSize']:
        q = s['ImportedPkgNamesOff']
        try:
            ipn, q2 = names_at(d, q); print('imported pkg names:', ipn)
        except Exception as e: print('ipn err', e)
