#!/usr/bin/env python3
"""构建 camera-watermark（架构设计.md §5.5）

  1. 合并 core/*.js → core/bundle.js（字典序）
  2. 按 §4.3 计算每个 layout 变体的设计高度 → metadata.bandDp = max(...)
  3. 校验：素材引用 / 孤儿 preset / id=文件名 / layout 高度可算 / manifest.presets 完整 / 菜单来源
  4. messages.json:itemsReverse = 显示名 → id
  5. manifest.version = 载荷内容哈希（只散列真正下发的文件）
"""
import hashlib, json, re, sys, pathlib

R = pathlib.Path(__file__).parent
ok = True


def err(m):
    global ok
    ok = False
    print("  ✗", m)


def warn(m):
    print("  !", m)


# ---------------------------------------------------------------- 1) 合并 core/*.js
mods = sorted(p for p in (R / 'core').glob('*.js') if p.name != 'bundle.js')
(R / 'core' / 'bundle.js').write_text('\n'.join(p.read_text() for p in mods))
print(f"  合并 {len(mods)} 个模块 → core/bundle.js  ({[p.name for p in mods]})")


# ---------------------------------------------------------------- 2) bandDp（§4.3）
def node_h(node, fonts, path=""):
    """返回该节点的设计高度(dp)。文本=line-height；图片/分隔线=height；row=max；column=Σ"""
    kind = node.get('type', '')
    kids = node.get('children', []) or []
    if kind == 'text':
        f = fonts.get(node.get('font'))
        if f is None:
            err(f"{path}/{node.get('id')}: font '{node.get('font')}' 未定义")
            return 0
        if 'line-height' not in f:
            err(f"{path}/{node.get('id')}: font '{node.get('font')}' 缺 line-height")
            return 0
        return f['line-height']
    if kind in ('image', 'divider'):
        if 'height' not in node:
            err(f"{path}/{node.get('id')}: {kind} 缺 height")
            return 0
        return node['height']
    if not kids:
        return 0
    hs = [node_h(c, fonts, path + "/" + str(c.get('id'))) + (c.get('margin-top') or 0) for c in kids]
    return max(hs) if kind == 'row' else sum(hs)


def band_dp(variant_nodes, fonts):
    """变体高度 = padding.top + 内容高 + padding.bottom（内容 = 根子项最大高）"""
    root = variant_nodes[0]
    pad = root.get('padding') or {}
    content = 0
    for c in root.get('children', []) or []:
        content = max(content, node_h(c, fonts) + (c.get('margin-top') or 0))
    return round((pad.get('top', 0) or 0) + content + (pad.get('bottom', 0) or 0), 4)


print("  设计高度（§4.3）")
presets = {}
for pf in sorted((R / 'presets').glob('*.json')):
    preset = json.loads(pf.read_text())
    presets[pf.stem] = preset
    pid = (preset.get('metadata') or {}).get('id')
    if pid != pf.stem:
        err(f"{pf.name}: metadata.id({pid}) ≠ 文件名({pf.stem})")
    fonts = preset.get('fonts') or {}
    by_variant = {}
    for entry in preset.get('layout_group') or []:
        for name, nodes in entry.items():
            by_variant[name] = band_dp(nodes, fonts)
    if not by_variant:
        err(f"{pf.name}: layout_group 为空")
        continue
    bd = max(by_variant.values())
    print(f"    {pf.stem}: " + "  ".join(f"{k}={v}" for k, v in by_variant.items()) + f"  ⇒ bandDp={bd}")
    meta = preset.setdefault('metadata', {})
    if meta.get('bandDpByVariant') != by_variant or meta.get('bandDp') != bd:
        meta['bandDpByVariant'] = by_variant
        meta['bandDp'] = bd
        pf.write_text(json.dumps(preset, ensure_ascii=False, indent=2) + "\n")


# ---------------------------------------------------------------- 3) 校验
manifest = json.loads((R / 'manifest.json').read_text())
messages = json.loads((R / manifest.get('messages', 'messages.json')).read_text())
logo_ids = sorted(p.stem for p in (R / 'assets' / 'logo').glob('*.txt'))
styles_path = R / manifest.get('styles', 'styles.json')
if not styles_path.exists():
    err(f"manifest.styles 指向的 {styles_path.name} 不存在")
styles_doc = json.loads(styles_path.read_text()) if styles_path.exists() else {}
style_ids = list(styles_doc.get('order') or [])
style_table = styles_doc.get('styles') or {}
for sid in style_ids:
    st = style_table.get(sid)
    if st is None:
        err(f"{styles_path.name}: order 里的 '{sid}' 不在 styles 里")
        continue
    for k in ('foregroundStart', 'foregroundEnd', 'bgColor'):
        if not st.get(k):
            err(f"{styles_path.name}: styles.{sid} 缺 {k}")
for sid in style_table:
    if sid not in style_ids:
        warn(f"{styles_path.name}: styles.{sid} 不在 order 里（菜单里看不到）")
print(f"  {styles_path.name}: {len(style_ids)} 款配色 {style_ids}")

# 3.1 manifest.presets ↔ presets/*.json
listed = manifest.get('presets') or []
for pid in listed:
    if pid not in presets:
        err(f"manifest.presets 里的 '{pid}' 没有 presets/{pid}.json")
for stem in presets:
    if stem not in listed:
        err(f"孤儿 preset：presets/{stem}.json 未列进 manifest.presets")

# 3.2 菜单来源
for menu in manifest.get('menus') or []:
    mid, role = menu.get('id'), menu.get('role')
    if role == 'source':
        if not (R / 'menus' / f"{mid}.vcf").exists():
            err(f"菜单 '{mid}' (role=source) 缺 menus/{mid}.vcf")
    elif role == 'preset':
        if not listed:
            err("role=preset 但 manifest.presets 为空")
    elif role == 'style':
        if not style_ids:
            err(f"role=style 但 {styles_path.name} 的 order 为空")
    elif role == 'logo':
        if not logo_ids:
            err("role=logo 但 assets/logo/ 为空")
    else:
        err(f"菜单 '{mid}' 的 role '{role}' 未知")
    if not (messages.get('prompts') or {}).get(mid):
        warn(f"messages.prompts 缺菜单 '{mid}' 的提示语")
    if mid not in (messages.get('items') or {}) and role not in ('source', 'logo'):
        warn(f"messages.items 缺菜单 '{mid}'（显示名将回落为 id）")

# 3.25 preset 只管水印本身：配色表已独立为 styles.json
for stem, preset in presets.items():
    if 'styles' in preset or 'styleOrder' in preset:
        err(f"presets/{stem}.json 不该有 styles/styleOrder（配色表已独立为 {styles_path.name}）")
    if not (preset.get('appearance') or {}).get('bgColor'):
        err(f"presets/{stem}.json 缺 appearance.bgColor（默认外观）")

# 3.3 preset 内素材引用
for stem, preset in presets.items():
    for sname, s in (preset.get('styles') or {}).items():
        if s.get('bgImage') and not (R / 'assets' / 'background' / (s['bgImage'] + '.png')).exists():
            warn(f"preset {stem} style {sname}: 背景图 assets/background/{s['bgImage']}.png 缺失")
    for entry in preset.get('layout_group') or []:
        for vname, nodes in entry.items():
            stack = list(nodes)
            while stack:
                n = stack.pop()
                stack += n.get('children') or []
                if n.get('type') == 'image':
                    src = n.get('src')
                    if src and src not in ('logo', 'background') and src not in logo_ids:
                        err(f"preset {stem}/{vname}: image src '{src}' 不是 assets/logo 里的素材")

# 3.4 manifest.presets 恰好 1 个（无 preset 菜单时；有 preset 菜单时用户必选）
if not any(m.get('role') == 'preset' for m in manifest.get('menus') or []) and len(listed) != 1:
    err(f"无 preset 菜单时 manifest.presets 必须恰好 1 个（当前 {len(listed)}）")

# 3.5 文本字体引用 + 骨架占位符
for stem, preset in presets.items():
    for entry in preset.get('layout_group') or []:
        for vname, nodes in entry.items():
            stack = list(nodes)
            while stack:
                n = stack.pop()
                stack += n.get('children') or []
                if n.get('type') == 'text' and n.get('font') not in (preset.get('fonts') or {}):
                    err(f"preset {stem}/{vname}: text '{n.get('id')}' 引用未定义字体 '{n.get('font')}'")

skeleton = (R / 'index.html.txt').read_text()
for name in ['CONFIG', 'LOGO', 'CORE_JS', 'UNIT', 'MODEL', 'TIME', 'FOCAL', 'APERTURE', 'SPEED', 'ISO', 'LAT', 'LON',
             'FOREGROUND_START', 'FOREGROUND_END', 'FOREGROUND_STOP', 'FOREGROUND_DIRECTION', 'LINE_OPACITY',
             'BG_COLOR', 'BG_IMAGE']:
    if f"@@{name}@@" not in skeleton:
        err(f"index.html.txt 缺占位符 @@{name}@@")

# 3.6 模板占位符 ↔ 快捷指令 replaceText 一一对应（防"改了模板忘了改快捷指令"）
cherri = (R / 'camera-watermark.cherri').read_text()
tpl_ph = set(re.findall(r'@@([A-Z_]+)@@', skeleton))
short_ph = set(re.findall(r'replaceText\("@@([A-Z_]+)@@"', cherri))
for name in sorted(tpl_ph - short_ph):
    err(f"index.html.txt 的 @@{name}@@ 在 camera-watermark.cherri 里没有对应的 replaceText")
for name in sorted(short_ph - tpl_ph):
    err(f"camera-watermark.cherri 替换的 @@{name}@@ 在 index.html.txt 里已不存在")
if not (tpl_ph - short_ph or short_ph - tpl_ph):
    print(f"  占位符对账 ✓ ({len(tpl_ph)} 个: {', '.join(sorted(tpl_ph))})")

# ---------------------------------------------------------------- 4) itemsReverse + logos
mp = R / 'messages.json'
rev = {sec: {v: k for k, v in (kv or {}).items()} for sec, kv in (messages.get('items') or {}).items()}
messages['itemsReverse'] = rev
mp.write_text(json.dumps(messages, ensure_ascii=False, indent=2) + "\n")
print("  messages.json: itemsReverse 已生成", {k: len(v) for k, v in rev.items()})

# logo 菜单候选 = assets/logo/*.txt 的 id（构建写入 manifest，避免运行时列目录撞到杂文件：
# Get Text 对 .svg 只返回文件名，混进来会静默拿到文件名）
mf = json.loads((R / 'manifest.json').read_text())
if mf.get('logos') != logo_ids:
    mf['logos'] = logo_ids
    (R / 'manifest.json').write_text(json.dumps(mf, ensure_ascii=False, indent=2) + "\n")
print(f"  manifest.logos = {logo_ids}")

# ---------------------------------------------------------------- 5) version = 载荷哈希
PAYLOAD = [R / 'index.html.txt', R / 'messages.json']
PAYLOAD += [q for q in [R / manifest.get('styles', 'styles.json')] if q.exists()]
PAYLOAD += sorted((R / 'presets').glob('*.json'))
PAYLOAD += sorted((R / 'menus').glob('*'))
PAYLOAD += sorted((R / 'assets').rglob('*.txt'))
PAYLOAD += sorted((R / 'core').glob('*.js'))
h = hashlib.sha1()
for p in PAYLOAD:
    if p.is_file() and p.name != '.DS_Store':
        h.update(str(p.relative_to(R)).encode())
        h.update(p.read_bytes())
mf = json.loads((R / 'manifest.json').read_text())
mf['version'] = h.hexdigest()[:12]
(R / 'manifest.json').write_text(json.dumps(mf, ensure_ascii=False, indent=2) + "\n")
print(f"  manifest.version = {mf['version']}  (载荷 {len(PAYLOAD)} 个文件)")
print("构建 " + ("成功 ✓" if ok else "有错误 ✗"))
sys.exit(0 if ok else 1)
