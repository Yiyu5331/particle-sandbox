import sys
sys.path.insert(0, 'tools/migrate')
from blocks import split_blocks, kind
for f in sys.argv[1:]:
    src = open(f, encoding='utf8').read()
    bl = split_blocks(src)
    print('##', f, len(bl), 'blocks')
    for t, names in bl:
        k = kind(t)
        first = [l for l in t.split('\n') if l.strip() and not l.strip().startswith('//') and not l.strip().startswith('*') and not l.strip().startswith('/*')]
        print(' ', k.ljust(8), ','.join(names)[:90] if names else (first[0][:90] if first else '?'))
