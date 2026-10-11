#!/usr/bin/env python3
"""本地验证水印 HTML：注入样例数据 → headless Chrome 截图 → 量关键尺寸（对照小米参考渲染）"""
import json, pathlib, subprocess, sys, tempfile
from PIL import Image
R = pathlib.Path(__file__).parent
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = R / "_local"; OUT.mkdir(exist_ok=True)

preset = json.loads((R / "presets/leica.json").read_text())
tpl    = (R / "index.html.txt").read_text()
bundle = (R / "core/bundle.js").read_text()
logo   = (R / "assets/logo/Leica.txt").read_text()

# 样例 = img28：1024×768，dpr=1（参考渲染同源）
photo_w, photo_h, dpr = 1024, 768, 1
designShort = preset["metadata"]["designShort"]
bandDp      = preset["metadata"]["bandDp"]
unit  = min(photo_w, photo_h) / dpr / designShort
reqW  = round(photo_w / dpr)
bandH = round(bandDp * unit)
sty   = preset["styles"]["light"]
data = dict(unit=unit, model="PME110", date="2026-01-01T16:26:08", focal="65",
            focalActual="15.38", aperture="2.6", speed="0.005842815", iso="50",
            lat="39.9056", lon="116.3914")
html = (tpl.replace("@@CONFIG@@", json.dumps(preset, ensure_ascii=False))
           .replace("@@UNIT@@", str(unit)).replace("@@MODEL@@", data["model"])
           .replace("@@TIME@@", data["date"]).replace("@@FOCAL@@", data["focal"])
           .replace("@@FOCAL_ACTUAL@@", data["focalActual"]).replace("@@APERTURE@@", data["aperture"])
           .replace("@@SPEED@@", data["speed"]).replace("@@ISO@@", data["iso"])
           .replace("@@LAT@@", data["lat"]).replace("@@LON@@", data["lon"])
           .replace("@@BG_COLOR@@", sty.get("bgColor", ""))
           .replace("@@BG_IMAGE@@", "")
           .replace("@@FOREGROUND_START@@", sty.get("foregroundStart", "#000000"))
           .replace("@@FOREGROUND_END@@", sty.get("foregroundEnd", "#000000"))
           .replace("@@FOREGROUND_STOP@@", sty.get("foregroundStop", ""))
           .replace("@@FOREGROUND_DIRECTION@@", sty.get("foregroundDirection", ""))
           .replace("@@LOGO@@", logo).replace("@@LEICA_LOGO@@", logo)
           .replace("@@CORE_JS@@", bundle))
page = OUT / "page.html"; page.write_text(html)
shot = OUT / "band.png"; shot.unlink(missing_ok=True)
cmd = [CH, "--headless=old", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
       f"--user-data-dir={tempfile.mkdtemp()}", "--virtual-time-budget=3000",
       f"--window-size={reqW},{bandH}", f"--screenshot={shot}", page.as_uri()]
try:
    r = subprocess.run(cmd, timeout=150, capture_output=True)
    err = (r.stderr or b"").decode(errors="ignore")[-800:]
except subprocess.TimeoutExpired:
    print("Chrome 超时 ✗"); sys.exit(1)
else:
    if err.strip(): print("chrome stderr:", err[-400:])
print(f"渲染: reqW={reqW}pt  bandH={bandH}pt  bandDp={bandDp}  unit={unit:.4f}  产物={shot.name} 存在={shot.exists()}")
if not shot.exists():
    sys.exit(1)
im = Image.open(shot).convert("RGB"); W, H = im.size; px = im.load()
print(f"实际输出: {W}x{H}")
rows = [y for y in range(H) if sum(1 for x in range(W) if sum(px[x, y]) < 600) > 3]
if rows:
    top, bot = min(rows), max(rows)
    print(f"内容纵向: {top} ~ {bot}   (padding-top 期望 {round(40*unit)}pt, 内容高期望 {round(79.8*unit)}pt)")
    for y in (top, (top + bot) // 2, bot):
        xs = [x for x in range(W) if sum(px[x, y]) < 600]
        print(f"  y={y}: x {min(xs)} ~ {max(xs)}")
    print(f"左边距: {min([x for y in rows for x in range(W) if sum(px[x,y])<600])}pt  (期望 {round(48*unit)}pt = 48dp)")
cols = [x for x in range(W) if sum(1 for y in range(H) if sum(px[x, y]) < 600) > H * 0.35]
print(f"竖向元素 x（logo/分隔线）: {cols[:4]} … {cols[-4:] if len(cols) > 4 else ''}")
