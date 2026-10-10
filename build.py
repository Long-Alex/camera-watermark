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

# 2) bandDp（多 layout 变体取 max）
def band_dp(variant):
    def col_h(col):
        h = 0
        for ch in col.get('children', []):
            if ch.get('type') == 'text':
                h += ch.get('margin-top', 0) + 0   # 占位: line-height 由 fonts 提供
        return h
    # 简化: 用 fonts 里的 line-height 精确算
    def col_h2(col):
        h = 0
        for ch in col.get('children', []):
            if ch.get('type') == 'text':
                f = preset['fonts'][ch['font']]
                h += ch.get('margin-top', 0) + f.get('line-height', 0)
            elif ch.get('type') == 'image':
                h = max(h, ch.get('height', 0))
            elif ch.get('type') == 'divider':
                h = max(h, ch.get('height', 0))
        return h
    root = variant[0]
    pad = root.get('padding', {})
    left = right = 0
    for ch in root.get('children', []):
        i = root['children'].index(ch)
        if ch.get('type') == 'column' and i == 0: left = col_h2(ch)
        if ch.get('type') == 'row' and i == 1:
            right = max([col_h2(c) if c.get('type') == 'column' else c.get('height', 0) for c in ch.get('children', [])] or [0])
    return pad.get('top', 0) + max(left, right) + pad.get('bottom', 0)

for pf in sorted((R / 'presets').glob('*.json')):
    preset = json.loads(pf.read_text())
    pid = preset.get('metadata', {}).get('id')
    if pid != pf.stem: err(f"{pf.name}: metadata.id({pid}) ≠ 文件名")
    vals = [band_dp(list(v.values())[0]) for v in preset.get('layout_group', [])]
    bd = max(vals) if vals else 0
    print(f"  {pf.stem}: bandDp = {bd}  (变体 {vals})")
    if preset.get('metadata', {}).get('bandDp') != bd:
        preset['metadata']['bandDp'] = bd
        pf.write_text(json.dumps(preset, ensure_ascii=False, indent=2) + "\n")

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
