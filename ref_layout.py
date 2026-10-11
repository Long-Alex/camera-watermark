#!/usr/bin/env python3
"""独立参考模型：小米 pendant 布局引擎（p880yu）规则 → 期望盒子（单位 dp）

与 JS 渲染器完全独立实现：本文件直接吃 APK 原始 config.json
(`/Users/alex.long/小米/apk_extracted/assets/watermarks/leica/1/config.json`)，
按 徕卡水印渲染规则.md 的度量/摆放规则算，字形宽度用 PIL 读 MiSansVF 变体字。

只施加两处【题目允许的改动】：
  1. 去掉 brand_layout 里的小米字标（机型文字直接表达）
  2. 右侧 64dp 槽位放"用户选的品牌标"（默认 Leica，1:1 ⇒ 与 leica.webp 一致）

坐标：dp，原点 = 水印带左上角（照片底边）。
"""
import json, math, pathlib, re

from PIL import ImageFont

WM_ROOT = pathlib.Path("/Users/alex.long/小米/apk_extracted/assets/watermarks/leica/1")
FONT_PATH = pathlib.Path("/Users/alex.long/小米/MiSans/可变字体/MiSansVF.ttf")
LOGO_DIR = pathlib.Path(__file__).parent / "assets" / "logo"

# ---------------------------------------------------------------- 常量（来自 config.json / wmRes）
# 字体表：size(dp) / wght / letterSpacing(em) / 颜色角色
FONTS = {
    "f1": dict(size=30.6, wght=501, ls=0.0),
    "f2": dict(size=22.0, wght=451, ls=0.083),
    "f3": dict(size=30.0, wght=501, ls=0.0),
    "f4": dict(size=20.0, wght=401, ls=0.028),
}
ASCENT, DESCENT = 1.044, 0.282          # MiSans hhea 1044 / -282 (upem 1000)
WRAP, MATCH = -1, -2
G = {"top": 1, "bottom": 2, "left": 4, "right": 8, "center_vertical": 16, "center_horizontal": 32, "center": 48}

_font_cache = {}


def line_height(font_key):
    return round((ASCENT + DESCENT) * FONTS[font_key]["size"], 4)


def _font(wght, px=256):
    key = (wght, px)
    if key not in _font_cache:
        f = ImageFont.truetype(str(FONT_PATH), px)
        try:
            axes = []
            for a in f.get_variation_axes():
                nm = a["name"].decode() if isinstance(a["name"], bytes) else a["name"]
                axes.append(wght if nm.lower() in ("weight", "wght") else a["default"])
            f.set_variation_by_axes(axes)
        except Exception:
            pass
        _font_cache[key] = f
    return _font_cache[key]


def text_width(s, font_key):
    """Paint.measureText + letterSpacing(em)：每字符追加 em×size，含末字符"""
    if not s:
        return 0.0
    f = FONTS[font_key]
    big = _font(f["wght"])
    w = sum(big.getlength(c) for c in s) / 256.0 * f["size"]
    return w + f["ls"] * f["size"] * len(s)


# ---------------------------------------------------------------- 文本（与 JS 端同规则，独立实现）
def fmt_dt(iso):
    y, mo, d, hh, mi = iso[0:4], iso[5:7], iso[8:10], iso[11:13], iso[14:16]
    return f"{y}.{mo}.{d} {hh}:{mi}"


def fmt_aperture(v):
    s = f"{round(float(v) + 1e-9, 1):.1f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def fmt_speed(v):
    v = float(v)
    if v >= 1:
        return f"{v:g}"
    return f"1/{int(round(1.0 / v))}"


def dms(dec, pos, neg):
    a = abs(float(dec))
    deg = int(a)
    m = (a - deg) * 60.0
    mn = int(m)
    sec = int((m - mn) * 60.0)
    return f"{deg}°{mn}'{sec:02d}\"" + (pos if dec > 0 else neg)


def text_of(node_id, ctx):
    if node_id == "model":
        return ctx["model"] or (ctx.get("fallback") or {}).get("model") or ""
    if node_id == "time":
        return fmt_dt(ctx["date"])
    if node_id == "exif":
        fb = ctx.get("fallback") or {}

        def val(k):
            for src in (ctx["exif"], fb):               # 运行时值 → preset.fallback 兜底
                try:
                    x = float(src.get(k))
                    if x > 0:
                        return x
                except (TypeError, ValueError):
                    pass
            return None

        v = {k: val(k) for k in ("focal", "aperture", "speed", "iso")}
        if any(x is None for x in v.values()):
            return ""                                   # 纯引擎语义 E0：无值也无兜底 ⇒ 整行隐藏
        # ⚠ 有意差异：APK 模板原文是 "f/"，本项目按用户要求显示 "ƒ/"（U+0192）
        return f"{int(round(v['focal']))}mm  ƒ/{fmt_aperture(v['aperture'])}  {fmt_speed(v['speed'])}s  ISO{int(v['iso'])}"
    if node_id == "location":
        if ctx.get("lat") in (None, "") or ctx.get("lon") in (None, ""):
            return ""
        return dms(ctx["lat"], "N", "S") + "  " + dms(ctx["lon"], "E", "W")
    return ""


# ---------------------------------------------------------------- 树（来自 APK config.json）
def _clean(t):
    """够用的尺寸解析：'40dp' / 'match_parent' / 'wrap_content' / '2dp'"""
    if t is None or t == "":
        return (WRAP, "")
    if t == "match_parent":
        return (MATCH, "")
    if t == "wrap_content":
        return (WRAP, "")
    m = re.match(r"^(-?\d+\.?\d*)(dp|px|sp)?$", str(t))
    if m:
        return (float(m.group(1)), m.group(2) or "dp")
    return (WRAP, "")


def _grav(s):
    g = 0
    for tok in (s or "").split("|"):
        g |= G.get(tok.strip(), 0)
    return g


def load_template(variant="layout", logo_id="Leica", keep_xiaomi_logo=False):
    cfg = json.loads((WM_ROOT / "config.json").read_text())
    for entry in cfg["layout_group"]:
        if variant in entry:
            nodes = entry[variant]
            break
    root = nodes[0]

    def strip_brand(n):
        if n.get("id") == "brand_layout":
            n["childViews"] = [c for c in n["childViews"] if c.get("id") != "logo"]
            for c in n["childViews"]:
                if c.get("id") == "model":
                    c["text"] = c["text"].replace("@model= @", "@model=@")   # 去掉为字标留的前导空格
        for c in n.get("childViews", []):
            strip_brand(c)

    def drop_version(n):
        if n.get("id") == "brand_layout":
            n["childViews"] = [c for c in n["childViews"] if c.get("id") != "model_versionName"]
        for c in n.get("childViews", []):
            drop_version(c)

    if not keep_xiaomi_logo:
        strip_brand(root)
    drop_version(root)

    # 右侧 64dp 槽位（原 leica.webp）→ 用户选的品牌标
    svg = (LOGO_DIR / f"{logo_id}.txt").read_text()
    vb = re.search(r'viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"', svg)
    aspect = (float(vb.group(3)) / float(vb.group(4))) if vb else 1.0
    if logo_id == "Leica":
        aspect = 1.0                                     # 与 leica.webp(240×240) 一致
    box = dict(root=root, aspect=aspect)
    return box


def measure(n, pw, ph, ctx, aspect):
    kind = n.get("type")
    kids = n.get("childViews", []) or []
    if kind == "ImageView":
        if n.get("id") == "src_image_view":
            n["_w"], n["_h"] = pw, ctx.get("photo_h_dp", ph)
            return
        dh = _clean(n.get("display_height", "0dp"))[0]
        dw = _clean(n.get("display_width", "0dp"))[0]
        dh = 0 if dh in (WRAP, MATCH) else dh
        dw = 0 if dw in (WRAP, MATCH) else dw
        if n.get("id") in ("logo", "leica"):
            dh, dw = 64.0, 0.0                            # 我们的品牌标固定 64dp 高、宽等比
        if dw > 0 and dh > 0:
            n["_w"], n["_h"] = dw, dh
        elif dh > 0:
            n["_w"], n["_h"] = dh * aspect, dh
        elif dw > 0:
            n["_w"], n["_h"] = dw, dw / aspect
        else:
            n["_w"], n["_h"] = 0.0, 0.0
        return
    if kind == "TextView":
        t = text_of(n.get("id"), ctx)
        n["_text"] = t
        n["_w"] = text_width(t, n.get("font_ref", "f1"))
        n["_h"] = line_height(n.get("font_ref", "f1"))    # 空文本仍占一行高
        return
    # Layout
    lw, lh = _clean(n.get("layout_width")), _clean(n.get("layout_height"))
    pcw = pw if lw[0] in (WRAP, MATCH) else lw[0]
    pch = ph if lh[0] in (WRAP, MATCH) else lh[0]
    for c in kids:
        measure(c, pcw, pch, ctx, aspect)
    w = h = 0.0
    orient = n.get("orientation", "horizontal")
    for c in kids:
        ml = max(0.0, _clean(c.get("margin_left", "0dp"))[0])
        mt = max(0.0, _clean(c.get("margin_top", "0dp"))[0])
        if orient == "horizontal":
            w += c["_w"] + ml
            h = max(h, c["_h"] + mt)
        else:
            h += c["_h"] + mt
            w = max(w, c["_w"] + ml)
    if lw[0] == MATCH:
        w = pw
    elif lw[0] not in (WRAP,):
        w = lw[0]
    if lh[0] == MATCH:
        h = ph
    elif lh[0] not in (WRAP,):
        h = lh[0]
    n["_w"], n["_h"] = w, h


def place(n, W, H):
    orient = n.get("orientation", "horizontal")
    lw, lh = _clean(n.get("layout_width")), _clean(n.get("layout_height"))
    pmw, pmh = lw[0] == MATCH, lh[0] == MATCH
    cursor = 0.0
    for c in n.get("childViews", []) or []:
        g = _grav(c.get("gravity") if c.get("type") == "Layout" else c.get("layout_gravity"))
        ml = _clean(c.get("margin_left", "0dp"))[0]
        mt = _clean(c.get("margin_top", "0dp"))[0]
        ml = 0.0 if ml in (WRAP, MATCH) else ml
        mt = 0.0 if mt in (WRAP, MATCH) else mt
        if orient == "horizontal":
            if pmw and (g & 8):
                c["_x"] = W - c["_w"] + ml
            elif pmw and (g & 32):
                c["_x"] = (W - c["_w"]) / 2 + ml
            else:
                c["_x"] = cursor + ml
                cursor += c["_w"] + ml
            if g & 16:
                c["_y"] = (H - c["_h"]) / 2 + mt
            elif g & 2:
                c["_y"] = H - c["_h"] + mt
            else:
                c["_y"] = mt
        else:
            if g & 32:
                c["_x"] = (W - c["_w"]) / 2 + ml
            elif g & 8:
                c["_x"] = W - c["_w"] + ml
            else:
                c["_x"] = ml
            if pmh and (g & 2):
                c["_y"] = H - c["_h"] + mt
            elif pmh and (g & 16):
                c["_y"] = (H - c["_h"]) / 2 + mt
            else:
                c["_y"] = cursor + mt
                cursor += c["_h"] + mt
        place(c, c["_w"], c["_h"])


def collect(n, ox=0.0, oy=0.0, out=None):
    if out is None:
        out = {}
    x, y = n.get("_x", 0.0) + ox, n.get("_y", 0.0) + oy
    if n.get("id"):
        out[n["id"]] = dict(x=round(x, 3), y=round(y, 3), w=round(n.get("_w", 0), 3), h=round(n.get("_h", 0), 3))
    for c in n.get("childViews", []) or []:
        collect(c, x, y, out)
    return out


def expected(ctx, variant="layout", logo_id="Leica"):
    """返回 (boxes_dp, meta)。ctx: model/date/exif{focal,aperture,speed,iso}/lat/lon/photo_w/photo_h"""
    tpl = load_template(variant, logo_id)
    root = tpl["root"]
    aspect = tpl["aspect"]
    scale = min(ctx["photo_w"], ctx["photo_h"]) / 1080.0
    card_w_dp = ctx["photo_w"] / scale

    # 参考树里带照片 + 上下衬垫，这里只取"水印带" = bottom_padding1 + bottom_layout + bottom_padding2
    kids = [c for c in root["childViews"] if c.get("id") in ("bottom_padding1", "bottom_layout", "bottom_padding2")]
    band = dict(type="Layout", id="_band", orientation="vertical",
                layout_width="wrap_content", layout_height="wrap_content", childViews=kids)
    ctx = dict(ctx)
    ctx["photo_h_dp"] = 0
    measure(band, card_w_dp, 0, ctx, aspect)
    place(band, band["_w"], band["_h"])
    boxes = collect(band)
    return boxes, dict(bandDp=round(band["_h"], 3), card_w_dp=round(card_w_dp, 3), scale=scale,
                       logo_aspect=aspect)


if __name__ == "__main__":
    ctx = dict(photo_w=1024, photo_h=768, model="PME110", date="2026-01-01T16:26:08",
               exif=dict(focal=65, aperture=2.6, speed=0.005842815, iso=50), lat=39.9056, lon=116.3914)
    for v in ("layout", "layout_loc_off"):
        boxes, meta = expected(dict(ctx, lat=None, lon=None) if v != "layout" else ctx, variant=v)
        print(v, meta)
        for k, b in boxes.items():
            print("   ", k, b)
