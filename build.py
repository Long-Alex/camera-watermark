#!/usr/bin/env python3
"""构建: 合并 core/*.js → bundle.js、计算 bandDp、校验、生成 manifest.version"""
import hashlib, json, re, sys, pathlib
R = pathlib.Path(__file__).parent
ok = True
def err(m):
    global ok; ok = False; print("  ✗", m)

# 1) 合并 core/*.js
mods = sorted(p for p in (R / 'core').glob('*.js') if p.name != 'bundle.js')
(R / 'core' / 'bundle.js').write_text('\n'.join(p.read_text() for p in mods))
print(f"  合并 {len(mods)} 个模块 → core/bundle.js")

# 2) bandDp（递归测量所有 layout 变体）
def node_height(node, fonts):
    kind = node.get('type')
    children = node.get('children', [])
    if kind == 'text':
        return fonts.get(node.get('font'), {}).get('line-height', 0)
    if kind in ('image', 'divider'):
        return node.get('height', 0)
    heights = [node_height(child, fonts) + child.get('margin-top', 0) for child in children]
    if kind == 'column':
        return sum(heights)
    if kind == 'row':
        return max(heights, default=0)
    return max(heights, default=0)

def band_dp(variant, fonts):
    root = variant[0]
    pad = root.get('padding', {})
    content = max((node_height(child, fonts) + child.get('margin-top', 0)
                   for child in root.get('children', [])), default=0)
    return pad.get('top', 0) + content + pad.get('bottom', 0)

for pf in sorted((R / 'presets').glob('*.json')):
    preset = json.loads(pf.read_text())
    pid = preset.get('metadata', {}).get('id')
    if pid != pf.stem: err(f"{pf.name}: metadata.id({pid}) ≠ 文件名")
    by_variant = {
        next(iter(v)): band_dp(list(v.values())[0], preset.get('fonts', {}))
        for v in preset.get('layout_group', [])
    }
    vals = list(by_variant.values())
    bd = max(vals) if vals else 0
    print(f"  {pf.stem}: bandDp = {bd}  (变体 {vals})")
    if preset.get('metadata', {}).get('bandDpByVariant') != by_variant:
        preset['metadata']['bandDpByVariant'] = by_variant
        pf.write_text(json.dumps(preset, ensure_ascii=False, indent=2) + "\n")
    if preset.get('metadata', {}).get('bandDp') != bd:
        preset['metadata']['bandDp'] = bd
        pf.write_text(json.dumps(preset, ensure_ascii=False, indent=2) + "\n")

# 2.5) 生成 itemsReverse（标签→id），供快捷指令从"显示名"反查 id
mp = R / 'messages.json'
msg = json.loads(mp.read_text())
rev = {}
for sec, kv in (msg.get('items') or {}).items():
    rev[sec] = {v: k for k, v in kv.items()}
msg['itemsReverse'] = rev
mp.write_text(json.dumps(msg, ensure_ascii=False, indent=2) + "\n")
print("  messages.json: itemsReverse 已生成", {k: len(v) for k, v in rev.items()})

# 3) 素材引用校验
for pf in (R / 'presets').glob('*.json'):
    preset = json.loads(pf.read_text())
    for s in preset.get('styles', {}).values():
        if s.get('bgImage') and not (R / 'assets' / 'background' / (s['bgImage'] + '.png')).exists():
            print(f"  ! 背景图缺失(暂不阻断): assets/background/{s['bgImage']}.png")

# 4) version = 内容哈希
h = hashlib.sha1()
for p in sorted(R.rglob('*')):
    if p.is_file() and p.name not in ('manifest.json',) and '.git' not in p.parts:
        h.update(p.read_bytes())
mf = json.loads((R / 'manifest.json').read_text())
mf['version'] = h.hexdigest()[:12]
(R / 'manifest.json').write_text(json.dumps(mf, ensure_ascii=False, indent=2) + "\n")
print(f"  manifest.version = {mf['version']}")
print("构建 " + ("成功 ✓" if ok else "有错误 ✗"))
sys.exit(0 if ok else 1)
