"""Build 노랭이 보카 (the friend's app, forked from 초록 보카).
dist/pwa/  phone web app for GitHub Pages: app code in the clear, words and audio AES-GCM encrypted.
Words: friend/data/dayNN.json (from the PDF) + friend/content/dayNN.json (beginner cards). Audio: friend/audio/m4a,
'<d>-<n>.m4a' for the word and '<d>-<n>s.m4a' for its example (stored in the day pack as n + 10000).
Run with the build venv python (needs `cryptography`)."""
import base64, glob, hashlib, json, os, secrets, shutil, struct
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

HERE = os.path.dirname(os.path.abspath(__file__)); F = os.path.dirname(HERE)
SRC, DIST, ASSETS = os.path.join(HERE, 'src'), os.path.join(HERE, 'dist'), os.path.join(F, 'pwa-assets')
VERSION = '1.0.' + os.environ.get('BUILD_N', '1')
ITER = 600_000

rows = []
for p in sorted(glob.glob(os.path.join(F, 'data', 'day*.json'))):
    d = int(os.path.basename(p)[3:5])
    cp = os.path.join(F, 'content', f'day{d:02d}.json')
    content = {r['n']: r for r in json.load(open(cp))} if os.path.exists(cp) else {}
    for e in json.load(open(p)):
        c = content.get(e['n'], {})
        sense = [e.get('syn', ''), e['ko']] + ([c['ex'].strip(), (c.get('exKo') or '').strip()] if c.get('ex') else [])
        extra = {k: v for k, v in {'pos': c.get('pos'), 'say': c.get('say'), 'hit': c.get('hit'), 'ch': c.get('chunks'), 'tip': c.get('tip'), 'pat': bool(e.get('pattern'))}.items() if v}
        rows.append([d, e['n'], e['word'], [sense], '', e.get('fix', ''), extra])   # fix: a note for a corrected source typo
days = sorted({r[0] for r in rows})
os.makedirs(DIST, exist_ok=True)
json.dump({'words': rows}, open(os.path.join(DIST, 'rows.json'), 'w'), ensure_ascii=False)   # plain copy for the node tests; never published

def pack_day(d):   # 'CVA1' | count u16 | count x (key u16, offset u32, length u32) | clips
    blobs, index, off = [], [], 0
    for r in rows:
        if r[0] != d: continue
        for key, name in ((r[1], f'{d}-{r[1]}'), (r[1] + 10000, f'{d}-{r[1]}s')):
            p = os.path.join(F, 'audio', 'm4a', name + '.m4a')
            if not os.path.exists(p): continue
            b = open(p, 'rb').read()
            index.append(struct.pack('<HII', key, off, len(b))); blobs.append(b); off += len(b)
    return b'CVA1' + struct.pack('<H', len(index)) + b''.join(index) + b''.join(blobs), len(index)
packs = {d: pack_day(d) for d in days}
AUDIO_V = hashlib.sha256(b''.join(packs[d][0] for d in days)).hexdigest()[:10]

sec_path = os.path.join(HERE, 'secret.json')
if os.path.exists(sec_path): sec = json.load(open(sec_path))
else:
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    sec = {'code': ''.join(secrets.choice(alphabet) for _ in range(8)), 'salt': base64.b64encode(secrets.token_bytes(16)).decode()}
    json.dump(sec, open(sec_path, 'w'))
key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(sec['salt']), iterations=ITER).derive(sec['code'].encode())
aes = AESGCM(key)
def seal(data):
    iv = secrets.token_bytes(12)
    return b'CVE1' + iv + aes.encrypt(iv, data, None)

shell = open(os.path.join(SRC, 'shell.html')).read()
parts = {k: open(os.path.join(SRC, f)).read() for k, f in (('css', 'style.css'), ('logic', 'logic.js'), ('app', 'app.js'))}
def page(head, body_open, end, config):
    out = shell
    for k, v in [('<!--@HEAD@-->', head), ('/*@CSS@*/', parts['css']), ('<!--@BODY@-->', body_open), ('/*@CONFIG@*/', json.dumps(config, ensure_ascii=False)),
                 ('/*@WORDS@*/', ''), ('/*@LOGIC@*/', parts['logic']), ('/*@APP@*/', parts['app']), ('<!--@END@-->', end)]:
        assert out.count(k) == 1, k
        out = out.replace(k, v)
    return out
HEAD = '''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>노랭이 보카</title>
<meta name="description" content="노랭이 단어장을 카드와 퀴즈로 쉽게 외우는 간격 반복 단어장">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="노랭이 보카">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#f1f4ef" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1411" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">'''

out = os.path.join(DIST, 'pwa')
shutil.rmtree(out, ignore_errors=True)
os.makedirs(os.path.join(out, 'data', 'audio'))
shutil.copytree(os.path.join(ASSETS, 'icons'), os.path.join(out, 'icons'))
for f in ('manifest.json', 'README.md', '.nojekyll'): shutil.copy(os.path.join(ASSETS, f), os.path.join(out, f))
rev = hashlib.sha256(json.dumps(rows, ensure_ascii=False).encode()).hexdigest()[:12]
words_bin = seal(json.dumps({'v': 2, 'rev': rev, 'words': rows}, ensure_ascii=False, separators=(',', ':')).encode())
open(os.path.join(out, 'data', 'words.bin'), 'wb').write(words_bin)
tot = 0
for d, (b, n) in packs.items():
    sealed = seal(b); tot += len(sealed)
    open(os.path.join(out, 'data', 'audio', f'd{d:02d}.bin'), 'wb').write(sealed)
cfg = {'mode': 'pwa', 'version': VERSION, 'crypto': {'salt': sec['salt'], 'iter': ITER}, 'data': {'words': 'data/words.bin', 'rev': rev},
       'audio': {'base': 'data/audio/', 'enc': True, 'v': AUDIO_V, 'days': days, 'mb': max(1, round(tot / 1e6))}}
html = page(HEAD, '</head>\n<body>', '</body>\n</html>\n', cfg)
open(os.path.join(out, 'index.html'), 'w').write(html)
digest = hashlib.sha256(html.encode() + words_bin).hexdigest()[:10]
sw = open(os.path.join(SRC, 'sw.js')).read().replace('__VERSION__', VERSION + '-' + digest).replace('__AUDIO_V__', AUDIO_V)
open(os.path.join(out, 'sw.js'), 'w').write(sw)
clips = sum(n for b, n in packs.values())
print('built', VERSION, '| entries', len(rows), '| with examples', sum(1 for r in rows if len(r[3][0]) > 2), '| audio clips', clips, f'{tot/1e6:.1f} MB', '| out', out)
print('code', sec['code'][:4] + '-' + sec['code'][4:])
