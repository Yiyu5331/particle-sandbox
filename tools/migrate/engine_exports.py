import sys, glob, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
def engine_exports():
    ns = {'__file__': os.path.join(os.path.dirname(os.path.abspath(__file__)), 'imports.py')}
    src = open(ns['__file__'], encoding='utf8').read()
    exec(src.split("exports = {p: exported(p)")[0].replace("ROOTS = sys.argv[1:] or ['src/engine']", "ROOTS=[]"), ns)
    exp = {}
    for f in glob.glob('src/engine/*.js'):
        if f.endswith('index.js'): continue
        for n in ns['exported'](f): exp[n] = os.path.basename(f)
    return exp
