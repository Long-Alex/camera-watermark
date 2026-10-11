#!/usr/bin/env python3
"""本地验证水印 HTML（样式 / 外观 / 计算 / 响应）—— 不上手机，先在 Chrome 里量

流程与快捷指令 §5.4 尺寸链一致：
    unit  = min(照片宽,照片高) / dpr / designShort
    reqW  = rint(照片宽 / dpr)          （WebView 宽，pt）
    bandH = rint(bandDp × unit)         （WebView 高，pt）
    makeImageFromRichText(reqW × bandH) → 位图 = 点数 × dpr

校验三件事：
  ① 硬不变量：40/48/24/10/64/2 dp、带高公式、空 EXIF 仍占一行、gps 决定变体、不溢出
  ② 与独立参考模型 ref_layout.py（直接吃 APK config.json 的 p880yu 规则）逐节点对比
  ③ 出图：每例 band PNG + 与样片合成的预览，报告 _local/report.md

用法：python3 local_verify.py [--font ios|misans] [--keep]
"""
import argparse, functools, html as htmlmod, http.server, json, math, pathlib, re, shutil, socketserver
import subprocess, sys, tempfile, threading
from urllib.parse import quote

from PIL import Image

import ref_layout

R = pathlib.Path(__file__).parent
OUT = R / "_local"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MISANS = "/Users/alex.long/小米/MiSans/可变字体/MiSansVF.ttf"
FAMILY = "-apple-system,BlinkMacSystemFont,Helvetica Neue,sans-serif"

# ---------------------------------------------------------------- 用例
CASES = [
    dict(name="landscape_4x3", W=4032, H=3024, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=100, aperture=1.8, speed=1 / 60, iso=200), gps=(39.9056, 116.3914), logo="Leica"),
    dict(name="portrait_3x4", W=3024, H=4032, model="iPhone 16 Pro Max", date="2026-06-14T08:43:00",
         exif=dict(focal=24, aperture=1.78, speed=1 / 120, iso=64), gps=(31.2304, 121.4737), logo="Leica"),
    dict(name="small_640x480", W=640, H=480, model="iPhone 15 Pro", date="2026-01-01T16:26:08",
         exif=dict(focal=65, aperture=2.6, speed=1 / 171, iso=50), gps=(39.9056, 116.3914), logo="Leica"),
    dict(name="no_gps", W=4032, H=3024, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=100, aperture=1.8, speed=1 / 60, iso=200), gps=None, logo="Leica"),
    dict(name="no_exif", W=4032, H=3024, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=None, aperture=None, speed=None, iso=None), gps=(39.9056, 116.3914), logo="Leica"),
    dict(name="no_gps_no_exif", W=3024, H=4032, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=None, aperture=None, speed=None, iso=None), gps=None, logo="Leica"),
    dict(name="long_model", W=1080, H=1440, model="Hasselblad X2D 100C", date="2026-03-18T21:25:00",
         exif=dict(focal=38, aperture=2.5, speed=1 / 250, iso=64), gps=(48.8566, 2.3522), logo="Hasselblad"),
    dict(name="style_dark", W=4032, H=3024, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=100, aperture=1.8, speed=1 / 60, iso=200), gps=(39.9056, 116.3914), logo="Leica",
         style="dark"),
    dict(name="style_gold_logo_Apple", W=4032, H=3024, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=100, aperture=1.8, speed=1 / 60, iso=200), gps=(39.9056, 116.3914), logo="Apple",
         style="gold"),
    dict(name="logo_Nikon", W=4032, H=3024, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=100, aperture=1.8, speed=1 / 60, iso=200), gps=(39.9056, 116.3914), logo="Nikon"),
    dict(name="logo_none", W=4032, H=3024, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=100, aperture=1.8, speed=1 / 60, iso=200), gps=(39.9056, 116.3914), logo=None),
    dict(name="ref_img28", W=1024, H=768, model="PME110", date="2026-01-01T16:26:08",
         exif=dict(focal=65, aperture=2.6, speed=1 / 171, iso=50), gps=(39.9056, 116.3914), logo="Leica"),
    dict(name="tiny_320x240", W=320, H=240, model="iPhone 15 Pro", date="2026-01-01T16:26:08",
         exif=dict(focal=65, aperture=2.6, speed=1 / 171, iso=50), gps=(39.9056, 116.3914), logo="Leica"),
    dict(name="shot_mac_2560x1440", W=2560, H=1440, model="", date="2026-06-14T08:43:00",
         exif=dict(focal=None, aperture=None, speed=None, iso=None), gps=None, logo="Leica"),
    dict(name="shot_iphone_1170x2532", W=1170, H=2532, model="", date="2026-06-14T08:43:00",
         exif=dict(focal=None, aperture=None, speed=None, iso=None), gps=None, logo="Leica"),
    dict(name="square_1080", W=1080, H=1080, model="iPhone 18 Pro Max", date="2026-06-14T08:43:00",
         exif=dict(focal=24, aperture=1.78, speed=1 / 120, iso=64), gps=(31.2304, 121.4737), logo="Leica"),
    dict(name="pano_4000x800", W=4000, H=800, model="iPhone 18 Pro Max", date="2026-06-14T08:43:00",
         exif=dict(focal=13, aperture=2.2, speed=1 / 500, iso=50), gps=(48.8566, 2.3522), logo="Leica"),
    dict(name="tall_800x4000", W=800, H=4000, model="iPhone 18 Pro Max", date="2026-06-14T08:43:00",
         exif=dict(focal=77, aperture=2.8, speed=1 / 250, iso=100), gps=(48.8566, 2.3522), logo="Leica"),
    dict(name="tiny_100x100", W=100, H=100, model="iPhone 18 Pro Max", date="2026-06-14T08:43:00",
         exif=dict(focal=None, aperture=None, speed=None, iso=None), gps=None, logo="Leica"),
    dict(name="huge_8000x6000", W=8000, H=6000, model="iPhone 18 Pro Max", date="2026-06-14T08:43:00",
         exif=dict(focal=24, aperture=1.78, speed=1 / 60, iso=200), gps=(39.9056, 116.3914), logo="Leica"),
    dict(name="dpr3_iphone", W=4032, H=3024, dpr=3, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=100, aperture=1.8, speed=1 / 60, iso=200), gps=(39.9056, 116.3914), logo="Leica"),
]

PORT = None


def start_server():
    """file:// 下 Chrome 拒绝加载 @font-face（跨源）⇒ 起个本机 http 服务供 MiSans 对照用"""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(R))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


RENDER_WIDTH_CAP = 1512   # 与 camera-watermark.cherri 保持一致（踩坑 §9.1）

PROBE = r"""
;(function () {
 function WMEMIT() {
  var u = CONFIG.unit, root = document.getElementById('wm-root');
  function box(el) { var r = el.getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; }
  var boxes = {}, texts = {};
  var els = root.querySelectorAll('[data-id]');
  for (var i = 0; i < els.length; i++) {
    var id = els[i].getAttribute('data-id');
    if (boxes[id]) { id = id + '#' + i; }
    boxes[id] = box(els[i]);
    texts[id] = els[i].textContent;
  }
  var c = document.createElement('canvas').getContext('2d');
  function fm(f, size, weight) {
    c.font = weight + ' ' + size + 'px ' + f;
    var m = c.measureText('Hg');
    return { a: m.fontBoundingBoxAscent, d: m.fontBoundingBoxDescent, w: m.width,
             aOk: m.fontBoundingBoxAscent !== undefined };
  }
  var fontsize = {};
  var tns = root.querySelectorAll('.tn');
  for (var t = 0; t < tns.length; t++) {
    fontsize[tns[t].getAttribute('data-id')] = { size: parseFloat(getComputedStyle(tns[t]).fontSize),
                                                 font: tns[t].getAttribute('data-font') };
  }
  var out = { unit: u, boxes: boxes, texts: texts, fontsize: fontsize,
              fitted: root.getAttribute('data-fit') === '1',
              doc: {w: document.documentElement.clientWidth, h: document.documentElement.clientHeight},
              root: { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, h: root.getBoundingClientRect().height },
              variant: root.getAttribute('data-variant'),
              err: (document.getElementById('wm-error') || {}).textContent || '',
              bodyBg: getComputedStyle(document.body).backgroundColor,
              metrics: { f1: fm(CONFIG.fonts.f1['font-family'], CONFIG.fonts.f1['font-size'] * u, CONFIG.fonts.f1['font-weight']),
                         f2: fm(CONFIG.fonts.f2['font-family'], CONFIG.fonts.f2['font-size'] * u, CONFIG.fonts.f2['font-weight']),
                         f3: fm(CONFIG.fonts.f3['font-family'], CONFIG.fonts.f3['font-size'] * u, CONFIG.fonts.f3['font-weight']) } };
  var pre = document.createElement('pre'); pre.id = 'wm-report';
  var M1 = '@@' + 'WMREPORT' + '@@', M2 = '@@' + '/WMREPORT' + '@@';
  pre.textContent = M1 + JSON.stringify(out) + M2;
  document.body.appendChild(pre);
 }
 if (document.fonts && document.fonts.ready && document.fonts.ready.then) { document.fonts.ready.then(WMEMIT); }
 else { WMEMIT(); }
})();
"""


def build_page(preset, preset_text, bundle, case, style_id, logo_file, req_w):
    style = STYLES["styles"][style_id]
    gps = case.get("gps")
    ex = case.get("exif") or {}
    def v(x):
        return "" if x is None else str(x)
    page = (R / "index.html.txt").read_text()
    reps = {
        "@@CONFIG@@": preset_text,
        "@@UNIT@@": "UNITVAL",
        "@@MODEL@@": case["model"],
        "@@TIME@@": case["date"],
        "@@FOCAL@@": v(ex.get("focal")), "@@FOCAL_ACTUAL@@": "",
        "@@APERTURE@@": v(ex.get("aperture")), "@@SPEED@@": v(ex.get("speed")), "@@ISO@@": v(ex.get("iso")),
        "@@LAT@@": v(gps[0]) if gps else "", "@@LON@@": v(gps[1]) if gps else "",
        "@@FOREGROUND_START@@": style["foregroundStart"], "@@FOREGROUND_END@@": style["foregroundEnd"],
        "@@FOREGROUND_STOP@@": style["foregroundStop"], "@@FOREGROUND_DIRECTION@@": style["foregroundDirection"],
        "@@LINE_OPACITY@@": str(style.get("lineOpacity", 1)),
        "@@BG_COLOR@@": style["bgColor"], "@@BG_IMAGE@@": "",
        "@@LOGO@@": (R / "assets" / "logo" / f"{logo_file}.txt").read_text() if logo_file else "",
        "@@CORE_JS@@": bundle,
    }
    for k, s in reps.items():
        page = page.replace(k, s)
    # 仅测试用：Chrome 无头最小窗口宽 500，用显式 body 宽度复现 WebView 的 reqW 宽视口
    page = page.replace("</head>", f"<style>html,body{{width:{req_w}px;}}</style></head>")
    page = page.replace("</script></body></html>", PROBE + "\n</script></body></html>")
    if ARGS.font == "misans":
        page = page.replace(FAMILY, "WMMiSans")
        # 参考对照必须用 MiSans 的原设计轴值，否则字重不同、宽度不可比
        for fk in ("f1", "f2", "f3"):
            f = preset["fonts"][fk]
            if f.get("design-weight"):
                page = page.replace(f'"font-weight": {f["font-weight"]}', f'"font-weight": {f["design-weight"]}')
        page = page.replace("<style id=\"wm-style\">",
                            "<style>@font-face{font-family:WMMiSans;src:url(http://127.0.0.1:%d/_local/MiSansVF.ttf);"
                            "font-weight:100 900;}</style><style id=\"wm-style\">" % PORT)
    return page


def _chrome_base(prof=None):
    """Chrome 154 在 dump/screenshot 后不会自己退出（updater 拖着）⇒ 产出到手就 kill。
    每次用全新 profile：复用 profile 时 Chrome 会还原上次会话，dump 出上一页的 DOM。"""
    if prof is None:
        prof = pathlib.Path(tempfile.mkdtemp(prefix="cw_chrome_"))
    return [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
            "--hide-scrollbars", "--disable-extensions", "--allow-file-access-from-files",
            "--disable-component-update", "--disable-background-networking", "--disable-sync",
            "--disable-default-apps", "--disable-client-side-phishing-detection", "--no-service-autorun",
            "--disable-breakpad", "--disable-features=Translate,OptimizationHints,MediaRouter",
            f"--user-data-dir={prof}", "--virtual-time-budget=3000"]


def _spawn(args):
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    return p


def _kill(p):
    import os, signal
    try:
        os.killpg(os.getpgid(p.pid), signal.SIGKILL)
    except Exception:
        try:
            p.kill()
        except Exception:
            pass
    try:
        p.wait(timeout=10)
    except Exception:
        pass


def run_dump(extra, marker, deadline=45):
    import os, select, time, shutil
    prof = pathlib.Path(tempfile.mkdtemp(prefix="cw_chrome_"))
    p = _spawn(_chrome_base(prof) + extra)
    out = b""
    t0 = time.time()
    try:
        while time.time() - t0 < deadline:
            r, _, _ = select.select([p.stdout], [], [], 0.3)
            if r:
                chunk = os.read(p.stdout.fileno(), 1 << 16)
                if not chunk:
                    break
                out += chunk
                if marker and marker.encode() in out:
                    break
            elif p.poll() is not None:
                break
    finally:
        _kill(p)
        shutil.rmtree(prof, ignore_errors=True)
    return out


def run_shot(extra, path, deadline=45):
    import time, shutil
    prof = pathlib.Path(tempfile.mkdtemp(prefix="cw_chrome_"))
    p = _spawn(_chrome_base(prof) + extra)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    last, stable, t0 = -1, 0, time.time()
    try:
        while time.time() - t0 < deadline:
            time.sleep(0.25)
            if path.exists():
                sz = path.stat().st_size
                if sz > 0 and sz == last:
                    stable += 1
                    if stable >= 2:
                        break
                last = sz
    finally:
        _kill(p)
        shutil.rmtree(prof, ignore_errors=True)
    return path.exists()



def render(case, unit, req_w, band_h, page, tag):
    p = OUT / f"{tag}.html"
    p.write_text(page)
    shot = OUT / f"{tag}.png"
    dpr = case.get("dpr", 1)
    # Chrome 无头：视口高 = 窗口高 − 87，视口宽 ≥ 500 ⇒ 取够大再裁
    win = (max(req_w, 500), band_h + 87)
    window = [f"--force-device-scale-factor={dpr}", f"--window-size={win[0]},{win[1]}"]
    url = f"http://127.0.0.1:{PORT}/_local/{tag}.html" if PORT else p.as_uri()
    dom = run_dump(["--dump-dom"] + window + [url], "@@/WMREPORT@@")
    if b"@@/WMREPORT@@" not in dom:                       # 偶发：Chrome 起不来/超时 ⇒ 重试一次
        dom = run_dump(["--dump-dom"] + window + [url], "@@/WMREPORT@@")
    run_shot([f"--screenshot={shot}"] + window + [url], shot)
    if not shot.exists():
        run_shot([f"--screenshot={shot}"] + window + [url], shot)
    if shot.exists():
        im = Image.open(shot)
        im.crop((0, 0, req_w * dpr, band_h * dpr)).save(shot)
    ms = re.findall(r"@@WMREPORT@@(.*?)@@/WMREPORT@@", dom.decode(errors="ignore"), re.S)
    rep = json.loads(htmlmod.unescape(ms[-1])) if ms else None
    if rep and abs(rep.get("unit", 0) - unit) > 1e-9:
        raise RuntimeError(f"{tag}: dump 到的页面 unit={rep.get('unit')} ≠ {unit}（拿到了别的页面）")
    return rep, shot, ""



def main():
    global ARGS, PORT
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default="ios", choices=["ios", "misans"])
    ap.add_argument("--only", default="")
    ARGS = ap.parse_args()

    httpd, PORT = start_server()
    preset_text = (R / "presets" / "leica.json").read_text()
    preset = json.loads(preset_text)
    bundle = (R / "core" / "bundle.js").read_text()
    OUT.mkdir(exist_ok=True)

    results, failures = [], 0
    for case in CASES:
        if ARGS.only and ARGS.only not in case["name"]:
            continue
        style_id = case.get("style", "light")
        logo = case.get("logo")
        variant = "layout" if case.get("gps") else "layout_loc_off"
        band_dp = preset["metadata"]["bandDpByVariant"][variant]
        dpr = case.get("dpr", 1)
        unit = min(case["W"], case["H"]) / dpr / preset["metadata"]["designShort"]
        req_w = round(case["W"] / dpr)
        # 与快捷指令同一套上限：视口宽 >1512pt 时等比缩 unit（最终再放大回照片宽）
        if req_w > RENDER_WIDTH_CAP:
            unit = unit * RENDER_WIDTH_CAP / req_w
            req_w = RENDER_WIDTH_CAP
        band_h = round(band_dp * unit)
        page = build_page(preset, preset_text, bundle, case, style_id, logo, req_w)
        page = page.replace("UNITVAL", repr(unit))
        rep, shot, stderr = render(case, unit, req_w, band_h, page, case["name"])

        # 参考模型（独立）—— 注意参考模型的 unit 用照片短边/1080（= 最终位图像素尺度）
        ref_unit = min(case["W"], case["H"]) / 1080.0
        rctx = dict(photo_w=case["W"], photo_h=case["H"], model=case["model"], date=case["date"],
                    exif=case.get("exif") or {}, lat=(case["gps"][0] if case.get("gps") else None),
                    lon=(case["gps"][1] if case.get("gps") else None),
                    fallback=preset.get("fallback"),
                    modelDefault=(preset.get("metadata") or {}).get("modelDefault"))
        ref_boxes, ref_meta = ref_layout.expected(rctx, variant=variant, logo_id=logo or "Leica")

        res = dict(case=case, unit=unit, req_w=req_w, band_h=band_h, band_dp=band_dp, variant=variant,
                   ref=ref_boxes, ref_meta=ref_meta, rep=rep, shot=str(shot), stderr=stderr,
                   dpr=dpr, ref_unit=ref_unit)
        results.append(res)
        if rep is None:
            print(f"✗ {case['name']}: 没拿到 DOM 探针（chrome: {stderr[:120]}）")
            failures += 1
            continue
        fails = check(res, preset, case)
        fails += check_pixels(res, preset, case, style_id)
        if "want_divider" in res:
            res.pop("want_divider")
        failures += len(fails)
        print(("✗ " if fails else "✓ ") + f"{case['name']:<24} {case['W']}x{case['H']} dpr={dpr} "
              f"unit={unit:.4f} reqW={req_w} bandH={band_h}pt {variant}" +
              ("" if not fails else "  —— " + "; ".join(fails[:3])))
        if shot.exists():
            im = Image.open(shot)
            assert im.width == req_w * dpr and im.height == band_h * dpr, \
                f"screenshot {im.size} != {req_w*dpr}x{band_h*dpr}"
            if round(case["W"] / dpr) > RENDER_WIDTH_CAP:      # 走了上限路径
                scale = case["W"] / im.width                   # = resizeImageByLongestEdge(结果, 照片宽)
                final_h = im.height * scale
                want_h = band_dp * min(case["W"], case["H"]) / 1080.0
                if abs(final_h - want_h) > 2:
                    fails.append(f"上限路径放大回照片宽后带高 {final_h:.1f}px ≠ 设计 {want_h:.1f}px")
        if rep["err"]:
            print("   ! 页面报错:", rep["err"][:160])
            failures += 1

    pix = compare_with_replica(results)
    write_report(results, pix)
    print(f"\n{'全部通过 ✓' if not failures else f'{failures} 处不通过 ✗'}  报告: _local/report.md")
    return 1 if failures else 0


# ---------------------------------------------------------------- 断言
def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def check_pixels(res, preset, case, style_id):
    """截图内容校验：底色 = 样式底色、logo 区域真的有图形（防"拿到别的页面"）"""
    fails, shot = [], pathlib.Path(res["shot"])
    if not shot.exists():
        return ["截图缺失"]
    im = Image.open(shot).convert("RGB")
    want = hex_rgb(STYLES["styles"][style_id]["bgColor"])
    got = im.getpixel((3, 3))
    if max(abs(a - b) for a, b in zip(got, want)) > 6:
        fails.append(f"截图底色 {got} ≠ 样式底色 {want}")
    rep = res["rep"] or {}
    ln = (rep.get("boxes") or {}).get("line_layout")
    # 分隔线宽 <1.5 设备像素时取色不可测（0.44px 抗锯齿），跳过颜色断言（几何断言仍在）
    if ln and res.get("want_divider") and ln["w"] * res.get("dpr", 1) >= 1.5:
        cx = int((ln["x"] + ln["w"] / 2) * res.get("dpr", 1))
        cy = int((ln["y"] + ln["h"] / 2) * res.get("dpr", 1))
        got = im.getpixel((cx, cy))
        want = res["want_divider"]
        if max(abs(g - w) for g, w in zip(got, want)) > 14:
            fails.append(f"分隔线颜色 {got} ≠ 前景×lineOpacity 混底色 {want}")
    lb = (rep.get("boxes") or {}).get("logo")
    dpr = res.get("dpr", 1)
    if case.get("logo") and lb:
        x0, y0 = int(lb["x"] * dpr) + 2, int(lb["y"] * dpr) + 2
        x1, y1 = int((lb["x"] + lb["w"]) * dpr) - 2, int((lb["y"] + lb["h"]) * dpr) - 2
        if x1 > x0 and y1 > y0:
            box = im.crop((x0, y0, x1, y1))
            px = list(box.getdata())
            ink = sum(1 for c in px if max(abs(c[0] - want[0]), abs(c[1] - want[1]), abs(c[2] - want[2])) > 40)
            if ink < len(px) * 0.02:
                fails.append(f"logo 区域几乎没有图形（{ink}/{len(px)}）")
    return fails


def close(a, b, tol):
    return abs(a - b) <= tol


def check(res, preset, case):
    u, rep, ref, fails = res["unit"], res["rep"], res["ref"], []
    B = {k: v for k, v in rep["boxes"].items()}
    T = rep["texts"]

    def bx(i):
        return B.get(i)

    def atom(idn, msg):
        b = bx(idn)
        if b is None:
            fails.append(f"缺节点 {idn} ({msg})")
        return b

    dpu = 1.0  # 盒子已是 px，期望值 ×u 后比较
    row = atom("bottom_layout", "水印带根行")
    lcol = atom("left_bottom_layout", "左列")
    logo = bx("logo") if case.get("logo") else None
    line = atom("line_layout", "分隔线")
    col = atom("exif_location_layout", "右列")
    model = atom("model", "机型")
    exif = atom("exif", "EXIF")
    loc = bx("location") or bx("time")

    # ① 带高（§4.3）
    if row:
        want = res["band_dp"] * u
        if not close(row["h"], want, max(1.2, want * 0.004)):
            fails.append(f"带高 {row['h']:.2f}px ≠ {want:.2f}px({res['band_dp']}dp)")
    # ② 左外边距 48dp
    for name, b in (("左列", lcol), ("机型", model)):
        if b and not close(b["x"], 48 * u, 1.0):
            fails.append(f"{name} x={b['x']:.2f} ≠ 48dp({48*u:.2f})")
    # ③ 右外边距 48dp
    if col:
        right = col["x"] + col["w"]
        if not close(right, res["req_w"] - 48 * u, 1.5):
            fails.append(f"右列右缘 {right:.2f} ≠ reqW-48dp({res['req_w']-48*u:.2f})")
    # ④ logo：高 64dp、宽 = 64dp × 宽高比
    if case.get("logo") and logo is None:
        fails.append("选了 logo 但节点缺失")
    if logo:
        if not close(logo["h"], 64 * u, 1.0):
            fails.append(f"logo 高 {logo['h']:.2f} ≠ 64dp({64*u:.2f})")
        want_w = 64 * u * ref["leica"]["w"] / ref["leica"]["h"]
        if not close(logo["w"], want_w, max(1.5, want_w * 0.03)):
            fails.append(f"logo 宽 {logo['w']:.2f} ≠ {want_w:.2f}(比例)")

    # ⑤ 分隔线 2dp×64dp，间距 24dp
    if line and col:
        if not close(line["w"], 2 * u, 1.0):
            fails.append(f"分隔线宽 {line['w']:.2f} ≠ 2dp({2*u:.2f})")
        if not close(line["h"], 64 * u, 1.0):
            fails.append(f"分隔线高 {line['h']:.2f} ≠ 64dp")
        if logo and not close(line["x"], logo["x"] + logo["w"] + 24 * u, 1.0):
            fails.append(f"分隔线 x {line['x']:.2f} ≠ logo右缘+24dp({logo['x']+logo['w']+24*u:.2f})")
        if not logo and not close(col["x"] - line["x"] - line["w"], 24 * u, 1.0):
            fails.append(f"无 logo 时分隔线→右列间距 {col['x']-line['x']-line['w']:.2f} ≠ 24dp({24*u:.2f})")
    if col and line:
        if not close(col["x"], line["x"] + line["w"] + 24 * u, 1.0):
            fails.append(f"右列 x {col['x']:.2f} ≠ 分隔线右缘+24dp({line['x']+line['w']+24*u:.2f})")
    # ⑥ 文本对齐：EXIF 贴列右缘、经纬度贴列左缘
    if exif and col:
        if not close(exif["x"] + exif["w"], col["x"] + col["w"], 1.0):
            fails.append(f"EXIF 右缘 {exif['x']+exif['w']:.2f} ≠ 列右缘 {col['x']+col['w']:.2f}")
    if loc and col:
        if not close(loc["x"], col["x"], 1.0):
            fails.append(f"第二行 x {loc['x']:.2f} ≠ 列左缘 {col['x']:.2f}")
    # ⑦ 行间距 10dp
    if model and (bx("time") if res["variant"] == "layout" else None):
        t = bx("time")
        if not close(t["y"], model["y"] + model["h"] + 10 * u, 1.0):
            fails.append(f"时间 y {t['y']:.2f} ≠ 机型底+10dp({model['y']+model['h']+10*u:.2f})")
    if exif and loc and loc is not exif:
        if not close(loc["y"], exif["y"] + exif["h"] + 10 * u, 1.0):
            fails.append(f"第二行 y {loc['y']:.2f} ≠ EXIF 底+10dp({exif['y']+exif['h']+10*u:.2f})")
    # ⑧ 垂直居中：左右组中心 = 行内容区中心
    if row and lcol:
        cy_row = row["y"] + 40 * u + (row["h"] - 80 * u) / 2
        cy_left = lcol["y"] + lcol["h"] / 2
        if not close(cy_left, cy_row, 1.2):
            fails.append(f"左列中心 {cy_left:.2f} ≠ 行内容中心 {cy_row:.2f}")
        if col and not close(col["y"] + col["h"] / 2, cy_row, 1.2):
            fails.append(f"右列中心 {col['y']+col['h']/2:.2f} ≠ 行内容中心 {cy_row:.2f}")
    # ⑨ 不溢出
    if rep["root"]["scrollWidth"] - rep["root"]["clientWidth"] > 1:
        fails.append(f"横向溢出 {rep['root']['scrollWidth']} > {rep['root']['clientWidth']}")
    # ⑩ 变体
    if rep["variant"] != res["variant"]:
        fails.append(f"变体 {rep['variant']} ≠ {res['variant']}")
    # ⑪ EXIF 无效 ⇒ 文本空但仍占一行高
    ex = case.get("exif") or {}
    exif_bad = not all(ex.get(k) and float(ex[k]) > 0 for k in ("focal", "aperture", "speed", "iso"))
    fb = preset.get("fallback") or {}
    can_fb = all(isinstance(fb.get(k), (int, float)) and fb[k] > 0 for k in ("focal", "aperture", "speed", "iso"))
    if exif_bad:
        if can_fb and exif and not T.get("exif", "").strip():
            fails.append("拍摄参数缺失且有兜底值，却渲染成空 ✗")
        if (not can_fb) and exif and T.get("exif", "").strip():
            fails.append(f"EXIF 无效且无兜底却渲染了文字: {T['exif']!r}")
        if exif and not close(exif["h"], preset["fonts"]["f3"]["line-height"] * u, 1.0):
            fails.append(f"EXIF 行高度 {exif['h']:.2f} ≠ 行高({preset['fonts']['f3']['line-height']*u:.2f})")
    # ⑪b 字号 = 设计字号(dp) × unit；只有被 fit() 缩过才允许更小
    for node, fk in (("model", "f1"), ("time", "f2"), ("location", "f2"), ("exif", "f3")):
        fs = (rep.get("fontsize") or {}).get(node)
        if not fs:
            continue
        want = preset["fonts"][fk]["font-size"] * u
        if rep.get("fitted"):
            if fs["size"] > want + 0.75:
                fails.append(f"{node} 字号 {fs['size']:.2f} > {want:.2f}(=size×unit) 且未缩字号")
        elif not close(fs["size"], want, 0.75):
            fails.append(f"{node} 字号 {fs['size']:.2f} ≠ {want:.2f}(={preset['fonts'][fk]['font-size']}dp×unit)")
    else:
        if exif and not T.get("exif", "").strip():
            fails.append("EXIF 有效却没渲染文字")
    # ⑫ 文本格式化对照（独立实现）
    want_txt = {k: ref_layout.text_of(k, dict(model=case["model"], date=case["date"],
                                              exif=case.get("exif") or {},
                                              lat=(case["gps"][0] if case.get("gps") else None),
                                              lon=(case["gps"][1] if case.get("gps") else None),
                                              fallback=preset.get("fallback"),
                                              modelDefault=(preset.get("metadata") or {}).get("modelDefault")))
                for k in ("model", "time", "exif", "location")}
    for k in ("model", "time", "exif", "location"):
        if k in T and T.get(k) != want_txt[k]:
            fails.append(f"{k} 文本 {T.get(k)!r} ≠ 参考 {want_txt[k]!r}")
    # ⑬ 与参考模型逐节点对比（字体一致时才有意义：ref 用 MiSans 字形宽）
    if ARGS.font == "misans":
        for k, rb in ref.items():
            if k.startswith("_") or k not in B or k in SKIP_REF:
                continue
            b = B[k]
            textish = k in ("model", "exif", "location", "time", "left_bottom_group", "left_bottom_layout",
                            "exif_location_layout", "brand_layout", "line_layout")
            tol = max(2.0, rb["w"] * u * 0.03) if textish else 1.2
            # x 位置只受"文本块宽度"影响（字形宽度 PIL 比 Chrome 宽 ~2%）
            tol_x = max(2.0, B.get("exif_location_layout", {}).get("w", 0) * 0.03) if textish else 1.2
            if not close(b["x"], rb["x"] * u, tol_x):
                fails.append(f"[ref] {k} x {b['x']:.2f} ≠ {rb['x']*u:.2f}")
            if not close(b["w"], rb["w"] * u, tol):
                fails.append(f"[ref] {k} w {b['w']:.2f} ≠ {rb['w']*u:.2f}")
            if not close(b["y"], rb["y"] * u, 1.2):
                fails.append(f"[ref] {k} y {b['y']:.2f} ≠ {rb['y']*u:.2f}")
            if not close(b["h"], rb["h"] * u, 1.2):
                fails.append(f"[ref] {k} h {b['h']:.2f} ≠ {rb['h']*u:.2f}")
    # ⑬b 分隔线颜色 = 前景色 × lineOpacity 混底色（防"透明度没传进来"这类静默错）
    if line and row:
        st = STYLES["styles"][case.get("style", "light")]
        a = float(st.get("lineOpacity", 1))
        fg = hex_rgb(st["foregroundStart"]); bg = hex_rgb(st["bgColor"])
        want_px = tuple(round(a * f + (1 - a) * b) for f, b in zip(fg, bg))
        res["want_divider"] = want_px

    # ⑭ 基线（设计字体 ascent = 1.044em）
    for fkey, node in (("f1", "model"), ("f2", "time" if res["variant"] == "layout" else "location"), ("f3", "exif")):
        b, m = B.get(node), rep["metrics"].get(fkey)
        if not b or not m:
            continue
        lh = preset["fonts"][fkey]["line-height"] * u
        size = preset["fonts"][fkey]["font-size"] * u
        if m.get("aOk"):
            base_css = b["y"] + (lh - (m["a"] + m["d"])) / 2 + m["a"]
            base_design = b["y"] + 1.044 * size
            res.setdefault("baseline", {})[fkey] = round(base_design - base_css, 3)
    return fails


REF_IMG = pathlib.Path("/Users/alex.long/小米/leica_watermark_output/OPPO/img28_leica.jpg")


def pixel_anchors(img, top, unit):
    """从位图量锚点（dp）：左边距 / EXIF 行右距 / 带高 / 分隔线宽高"""
    import numpy as np
    a = np.asarray(Image.open(img).convert("RGB")).astype(int)
    H, W, _ = a.shape
    band = a[top:H]
    dark = (band < 200).all(axis=2)
    rows = np.where(dark.sum(axis=1) > 0)[0]
    if not len(rows):
        return None
    half = (rows.min() + rows.max()) // 2
    top_cols = np.where(dark[rows.min():half + 1].sum(axis=0) > 0)[0]
    out = dict(band_dp=round(band.shape[0] / unit, 2), left_dp=round(top_cols.min() / unit, 2),
               right_dp=round((W - 1 - top_cols.max()) / unit, 2), w=W, band_px=band.shape[0])
    # 分隔线：整条带里"竖直连续 ≥ 40dp"的列，按连续列分组，取最窄的一组（品牌 logo 更宽）
    def longest_run(col):
        best = cur = 0
        for v in col:
            cur = cur + 1 if v else 0
            best = max(best, cur)
        return best
    tall = [x for x in range(W) if longest_run(dark[:, x]) >= 40 * unit]
    groups = []
    for x in tall:
        if groups and x == groups[-1][-1] + 1:
            groups[-1].append(x)
        else:
            groups.append([x])
    if groups:
        best = min(groups, key=len)
        out["divider_x_dp"] = round(best[0] / unit, 2)
        out["divider_w_dp"] = round(len(best) / unit, 2)
        out["divider_h_dp"] = round(max(longest_run(dark[:, x]) for x in best) / unit, 2)
    return out


def compare_with_replica(results):
    """与小米参考渲染（小米 leica/1 版式，PIL 复刻件）逐锚点对照"""
    if not REF_IMG.exists():
        return None
    ref = pixel_anchors(REF_IMG, 768, 768 / 1080.0)
    mine = None
    for r in results:
        if r["case"]["name"] == "ref_img28" and pathlib.Path(r["shot"]).exists():
            mine = pixel_anchors(r["shot"], 0, min(r["case"]["W"], r["case"]["H"]) / 1080.0)
            mine["band_dp_design"] = r["band_dp"]
    return dict(ref=ref, mine=mine)


def write_report(results, pix=None):
    lines = ["# 本地验证报告（水印 HTML）", "",
             f"- 用例数：{len(results)}", f"- 字体模式：`{ARGS.font}`",
             "- 尺寸链：`unit = min(W,H)/dpr/1080` → `reqW = rint(W/dpr)` → `bandH = rint(bandDp×unit)`",
             "- 参考模型：`ref_layout.py`（独立 Python 实现，直接读 APK `leica/1/config.json`）", "",
             "| 用例 | 照片 | dpr | unit | reqW×bandH(pt) | 位图 | 带高(dp) | 变体 |",
             "|---|---|---|---|---|---|---|---|"]
    for r in results:
        c = r["case"]
        lines.append(f"| {c['name']} | {c['W']}×{c['H']} | {r['dpr']} | {r['unit']:.4f} | "
                     f"{r['req_w']}×{r['band_h']} | {r['req_w']*r['dpr']}×{r['band_h']*r['dpr']} | "
                     f"{r['band_dp']} | {r['variant']} |")
    lines += ["", "## 关键量（px，dpr=1 时 = pt）", "",
              "| 用例 | 行高 | 左列x | 机型y/h | logo x/w/h | 分隔线 x/w | 右列右缘 | 剩余右边距 |",
              "|---|---|---|---|---|---|---|---|"]
    for r in results:
        rep = r["rep"] or {}
        B = rep.get("boxes", {})
        g = lambda i, k: (f"{B[i][k]:.1f}" if i in B else "—")
        col = B.get("exif_location_layout")
        lines.append(f"| {r['case']['name']} | {g('bottom_layout','h')} | {g('left_bottom_layout','x')} | "
                     f"{g('model','y')}/{g('model','h')} | {g('logo','x')}/{g('logo','w')}/{g('logo','h')} | "
                     f"{g('line_layout','x')}/{g('line_layout','w')} | "
                     f"{(col['x']+col['w']):.1f} | {r['req_w']-(col['x']+col['w']):.1f} |" if col else
                     f"| {r['case']['name']} | 缺右列 |")
    lines += ["", "## 基线偏差（设计字体 MiSans ascent=1.044em 位置 − Chrome 实际基线，px）", "",
              "| 用例 | f1 机型 | f2 时间/经纬 | f3 EXIF |", "|---|---|---|---|"]
    for r in results:
        rep = r["rep"] or {}
        m = rep.get("metrics") or {}
        B = rep.get("boxes") or {}
        row = []
        for fkey, node in (("f1", "model"), ("f2", "time" if r["variant"] == "layout" else "location"), ("f3", "exif")):
            b, mm = B.get(node), m.get(fkey)
            if not b or not mm or not mm.get("aOk"):
                row.append("—")
                continue
            lh = PRESET_CACHE["fonts"][fkey]["line-height"] * r["unit"]
            size = PRESET_CACHE["fonts"][fkey]["font-size"] * r["unit"]
            base_css = (lh - (mm["a"] + mm["d"])) / 2 + mm["a"]
            base_design = 1.044 * size
            row.append(f"{base_design - base_css:+.2f}")
        lines.append(f"| {r['case']['name']} | {row[0]} | {row[1]} | {row[2]} |")
    if pix and pix.get("mine"):
        r, m = pix["ref"], pix["mine"]
        lines += ["", "## 与小米参考渲染逐锚点对照（像素量，dp）", "",
                  f"参考件：`{REF_IMG}`（小米 leica/1 版式，1024×768 样片，scale=0.7111）", "",
                  "| 锚点 | 参考渲染 | 本渲染 | 判定 |", "|---|---|---|---|"]
        def row(label, a, b, tol, note=""):
            ok = abs(a - b) <= tol
            lines.append(f"| {label} | {a} | {b} | {'✓' if ok else '✗'} (±{tol}{note}) |")
        row("左边距 dp", r["left_dp"], m["left_dp"], 2.0)
        row("EXIF 行右距 dp", r["right_dp"], m["right_dp"], 2.0)
        row("分隔线宽 dp", r.get("divider_w_dp", 0), m.get("divider_w_dp", 0), 1.5)
        row("分隔线高 dp", r.get("divider_h_dp", 0), m.get("divider_h_dp", 0), 2.0)
        row("带高 dp（本渲染实测 vs 设计值）", m["band_dp_design"], m["band_dp"], 0.7, "；截图按 pt 取整")
        lines += ["",
                  f"- 参考件实测带高 {r['band_dp']}dp，比设计值 159.8dp 大 {r['band_dp'] - 159.8:.2f}dp（+{(r['band_dp']/159.8-1)*100:.1f}%），"
                  f"原因是 PIL 复刻件把字号取整后再取行高（30.6→31、22→22、30→30），行高 42+30 而非 40.6+29.2；"
                  f"本渲染按引擎公式 1.326×size 计算，与设计值一致"]
    lines += ["", "## 出图", ""]
    for r in results:
        p = pathlib.Path(r["shot"])
        if p.exists():
            lines.append(f"- [{r['case']['name']}]({p.name})")
    (OUT / "report.md").write_text("\n".join(lines) + "\n")


PRESET_CACHE = json.loads((R / "presets" / "leica.json").read_text())
STYLES = json.loads((R / "styles.json").read_text())
# 结构不同名/不同实现方式的容器：只比它们的内容节点
SKIP_REF = {"bottom_layout", "right_bottom_group"}

if __name__ == "__main__":
    sys.exit(main())
