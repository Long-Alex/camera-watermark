#!/usr/bin/env python3
"""真实照片端到端本地验证：demo photo/ → 水印 → 单独目录

走的是**真机同一条链路**（§5.4 尺寸链 + 1512pt 渲染宽上限 + 与快捷指令同一份 preset/styles/模板/bundle）：
  unit  = min(W,H)/dpr/1080         (dpr=3，模拟 iPhone)
  reqW  = rint(W/dpr)；>1512 则钳到 1512 且 unit ×= 1512/reqW
  bandH = rint(bandDp × unit)
  Chrome 以 (reqW, bandH)pt × dpr 出图 → 缩到照片宽 → 竖直接在照片下方

HEIC 用 macOS `sips` 转 JPEG（实测 EXIF/GPS 全保留）。
输出：demo_out/<原名>_leica.jpg + demo_out/report.md
用法：python3 demo_local.py [--dir "demo photo"] [--style light] [--dpr 3] [--only 关键词]
"""
import argparse, json, pathlib, shutil, subprocess, sys, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import argparse as _ap

import local_verify as lv
from PIL import Image, ImageOps

R = pathlib.Path(__file__).parent
OUT = R / "demo_out"
CAP = 1512
SIPS = "/usr/bin/sips"


def load_photo(p: pathlib.Path, tmp: pathlib.Path):
    """HEIC → sips 转 JPEG（保留 EXIF）；其它 Pillow 直读。返回 (RGB 图像, EXIF 源图)"""
    src = p
    if p.suffix.lower() in (".heic", ".heif"):
        src = tmp / (p.stem + ".jpg")
        if not src.exists():
            r = subprocess.run([SIPS, "-s", "format", "jpeg", str(p), "--out", str(src)],
                               capture_output=True)
            if r.returncode != 0:
                raise RuntimeError("sips 转 HEIC 失败: " + r.stderr.decode(errors="ignore")[-200:])
    ex = Image.open(src)
    meta = ex.getexif()
    return ImageOps.exif_transpose(ex).convert("RGB"), meta


def read_exif(meta):
    e = meta.get_ifd(0x8769) or {}
    g = meta.get_ifd(0x8825) or {}

    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    model = (meta.get(0x0110) or "").replace("\x00", "").strip()
    dt = (e.get(0x9003) or meta.get(0x0132) or "").strip()
    iso_date = (f"{dt[0:4]}-{dt[5:7]}-{dt[8:10]}T{dt[11:13]}:{dt[14:16]}:{dt[17:19]}"
                if len(dt) >= 19 else "")
    focal35 = num(e.get(0xA405))
    lat = lon = None
    if g.get(2) and g.get(4):
        def dms(t):
            d, m, s = [float(x) for x in t]
            return d + m / 60.0 + s / 3600.0
        lat = dms(g[2]) * (1 if g.get(1, "N") == "N" else -1)
        lon = dms(g[4]) * (1 if g.get(3, "E") == "E" else -1)
    return dict(model=model, date=iso_date,
                focal=(str(int(round(focal35))) if focal35 else ""),
                focalActual=num(e.get(0x829D)) and str(num(e.get(0xA404)) or ""),
                aperture=(str(num(e.get(0x829D))) if num(e.get(0x829D)) else ""),
                speed=(repr(num(e.get(0x829A))) if num(e.get(0x829A)) else ""),
                iso=(str(int(num(e.get(0x8827)))) if num(e.get(0x8827)) else ""),
                lat=lat, lon=lon)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="demo photo")
    ap.add_argument("--style", default="light")
    ap.add_argument("--dpr", type=int, default=3)
    ap.add_argument("--only", default="")
    ap.add_argument("--max-output-width", type=int, default=0, help="输出限宽（0=原尺寸）")
    a = ap.parse_args()
    global ARGS_DPR
    ARGS_DPR = a.dpr
    lv.ARGS = _ap.Namespace(font="ios", only="")

    src_dir = (R / a.dir) if not pathlib.Path(a.dir).is_absolute() else pathlib.Path(a.dir)
    OUT.mkdir(exist_ok=True)
    preset_text = (R / "presets" / "leica.json").read_text()
    preset = json.loads(preset_text)
    bundle = (R / "core" / "bundle.js").read_text()
    photos = sorted(p for p in src_dir.iterdir()
                    if p.suffix.lower() in (".jpg", ".jpeg", ".heic", ".heif", ".png")
                    and (not a.only or a.only in p.name))
    if not photos:
        print("没找到照片"); return 1
    print(f"素材：{src_dir}  共 {len(photos)} 张  dpr={a.dpr}  样式={a.style}  →  {OUT}")

    rows, fails = [], []
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="demo_heic_"))
    try:
        for i, p in enumerate(photos, 1):
            try:
                photo, meta = load_photo(p, tmp)
                ex = read_exif(meta)
                W, H = photo.size
                long_edge = max(W, H)
                variant = "layout" if (ex["lat"] is not None and ex["lon"] is not None) else "layout_loc_off"
                band_dp = preset["metadata"]["bandDpByVariant"][variant]
                design_short = preset["metadata"]["designShort"]
                unit = min(W, H) / a.dpr / design_short
                req_w0 = round(W / a.dpr)
                req_w = req_w0
                capped = req_w0 > CAP
                if capped:
                    unit = unit * CAP / req_w0
                    req_w = CAP
                band_h = round(band_dp * unit)

                case = dict(name=f"demo_{i:02d}", W=W, H=H, model=ex["model"], date=ex["date"],
                            exif=dict(focal=ex["focal"], aperture=ex["aperture"],
                                      speed=ex["speed"], iso=ex["iso"]),
                            gps=(ex["lat"], ex["lon"]) if ex["lat"] is not None else None,
                            logo="Leica")
                page = lv.build_page(preset, preset_text, bundle, case, a.style, "Leica", req_w)
                page = page.replace("UNITVAL", repr(unit))
                rep, shot, err = lv.render(case, unit, req_w, band_h, page,
                                           f"demo_{i:02d}_{p.stem[:20]}")
                if rep is None:
                    raise RuntimeError("没拿到 DOM 探针（Chrome 渲染失败）")
                if rep["err"]:
                    raise RuntimeError("页面报错: " + rep["err"])

                band = Image.open(shot).convert("RGB")
                target_w = a.max_output_width or W
                scale = target_w / band.width
                band = band.resize((target_w, max(1, round(band.height * scale))), Image.LANCZOS)
                if target_w != W:                                  # 输出缩放过则照片同步缩
                    ph = photo.resize((target_w, round(H * scale)), Image.LANCZOS)
                else:
                    ph = photo
                canvas = Image.new("RGB", (target_w, ph.height + band.height), (255, 255, 255))
                canvas.paste(ph, (0, 0)); canvas.paste(band, (0, ph.height))
                outp = OUT / (p.stem + "_leica.jpg")
                canvas.save(outp, "JPEG", quality=95)

                want_band = band_dp * min(W, H) / 1080.0
                ok = abs(band.height - want_band) <= 2
                if not ok:
                    fails.append(f"{p.name}: 带高 {band.height}px ≠ 设计 {want_band:.1f}px")
                used_fb = [k for k in ("model", "focal", "aperture", "speed", "iso")
                           if not ex[k] or ex[k] == ""]
                rows.append(dict(name=p.name, size=f"{W}×{H}", dpr=a.dpr, unit=round(unit, 5),
                                 req_w=req_w, band_h=band_h, capped=capped, variant=variant,
                                 band_final=band.height, want=round(want_band, 1),
                                 model=ex["model"] or "(fallback)", gps="有" if ex["lat"] is not None else "无",
                                 fb=",".join(used_fb) or "-", out=outp.name))
                print(f"  [{i:>2}/{len(photos)}] {p.name[:44]:<44} {W}×{H} unit={unit:.5f} "
                      f"reqW={req_w}{'*' if capped else ''} band={band_h}pt → 成品 {canvas.size[0]}×{canvas.size[1]}"
                      f"{'  ⚠' + ','.join(used_fb) + ' 走兜底' if used_fb else ''}")
            except Exception as e:
                fails.append(f"{p.name}: {e}")
                print(f"  [{i:>2}/{len(photos)}] {p.name[:44]:<44} ✗ {e}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    lines = [f"# demo photo 本地验证（{len(rows)}/{len(photos)} 张成功）", "",
             f"- 素材：`{src_dir}`", f"- 链路：dpr={a.dpr}、渲染宽上限 {CAP}pt、`unit = min(W,H)/dpr/1080`、"
             f"`bandH = rint(bandDp × unit)`、Chrome 出图后缩到照片宽再纵向拼接",
             f"- 样式：`{a.style}`；logo：`Leica`", "",
             "| 照片 | 像素 | unit | reqW(*=走上限) | bandH(pt) | 变体 | 成品带高 | 设计带高 | 机型 | 定位 | 兜底 | 输出 |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['name'][:34]} | {r['size']} | {r['unit']} | {r['req_w']}{'*' if r['capped'] else ''} | "
                     f"{r['band_h']} | {r['variant']} | {r['band_final']} | {r['want']} | {r['model']} | {r['gps']} | "
                     f"{r['fb']} | [{r['out']}]({r['out']}) |")
    if fails:
        lines += ["", "## ✗ 失败", ""] + [f"- {f}" for f in fails]
    (OUT / "report.md").write_text("\n".join(lines) + "\n")
    print(f"\n{'全部成功 ✓' if not fails else f'{len(fails)} 张失败 ✗'}  报告：demo_out/report.md")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
