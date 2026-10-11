#!/usr/bin/env python3
"""手机布局视口回归检查：布局视口必须 = 请求宽度（= 照片宽 / dpr）

背景（2026-10-11 实测）
    手机（iOS/Android）这条 HTML→图片 链路，对**没有 `<meta name="viewport">`** 的页面
    用默认 **980px** 视口排版，再把整页缩进请求的位图。于是：
      · `#wm-root{width:100%}` 是流式行 → 行宽 = 980，缩进后照样铺满整条带；
      · 但字号/边距/logo 是绝对 px（`dp × unit`，unit 按 reqW 宽算的）→ 被 980 一摊，
        只剩 `reqW/980`（小图 ≈ 1/3），内容缩在带的左上角。
    症状：只有小图（照片宽 < 980×dpr）中招；大图（请求宽 > 980）正常 —— 所以
    4032px 的照片看着没事，demo photo（944~1080px）内部排版全错。

    桌面 Chrome / macOS 忽略 viewport meta（同一页面加不加渲染结果完全一样），
    `local_verify.build_page` 还会注入 `html,body{width:reqWpx}` 把它盖住 ⇒ 本地必须
    用"移动端模拟"才能复现/拦住。本脚本用 Chrome 的
    `Emulation.setDeviceMetricsOverride(mobile=true)` 跑**真实页面**（模板/预设/bundle
    都取自仓库），断言布局视口 = reqW、机型文字左缘 = 48dp×unit。

用法：
    python3 mobile_viewport_check.py [--dpr 3] [--keep] [--no-selftest]
产物：_local/viewport/report.md + 各用例 png
"""
import argparse, base64, json, os, pathlib, shutil, socket, struct, subprocess, sys, tempfile, time
import urllib.request

R = pathlib.Path(__file__).parent
OUT = R / "_local" / "viewport"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

sys.path.insert(0, str(R))
import local_verify as lv  # 页面组装沿用校验器的同一份实现（只是剥掉两个测试专用注入）
import wm_plan

# ------------------------------------------------------------------ 极简 CDP（裸 socket WebSocket，不引第三方依赖）
class _WS:
    def __init__(self, url, timeout=30):
        assert url.startswith("ws://"), url
        hostport, path = url[5:].split("/", 1)
        host, port = hostport.split(":")
        self.s = socket.create_connection((host, int(port)), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((
            f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.s.recv(4096)
            if not chunk:
                raise RuntimeError("WebSocket 握手被关闭")
            buf += chunk
        if b" 101 " not in buf.split(b"\r\n")[0]:
            raise RuntimeError("WebSocket 握手失败: " + buf.split(b"\r\n")[0].decode(errors="ignore"))

    def send(self, obj):
        data = json.dumps(obj).encode()
        n, mask = len(data), os.urandom(4)
        head = b"\x81" + (bytes([0x80 | n]) if n < 126 else
                          bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else
                          bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.s.recv(n - len(buf))
            if not chunk:
                raise EOFError("WebSocket 关闭")
            buf += chunk
        return buf

    def recv(self):
        while True:                                    # 只关心文本帧，ping/pong/二进制忽略
            b1, b2 = self._exact(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._exact(8))[0]
            payload = self._exact(n) if n else b""
            if (b1 & 0x0F) == 1:
                return json.loads(payload.decode(errors="ignore"))

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


class CDP:
    """一个浏览器级连接 + 多个 flatten session（消息带 sessionId）"""
    def __init__(self, ws_url):
        self.ws, self._id, self.session = _WS(ws_url), 0, None

    def call(self, method, params=None, session=True):
        self._id += 1
        mid = self._id
        msg = {"id": mid, "method": method, "params": params or {}}
        if session and self.session:
            msg["sessionId"] = self.session
        self.ws.send(msg)
        while True:
            m = self.ws.recv()
            if m.get("id") == mid:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m.get("result", {})

    def attach_page(self):
        target = self.call("Target.createTarget", {"url": "about:blank"}, session=False)
        self.session = self.call("Target.attachToTarget",
                                 {"targetId": target["targetId"], "flatten": True}, session=False)["sessionId"]
        self.call("Page.enable")
        return self.session


def chrome_start(port, profile):
    return subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
         "--hide-scrollbars", "--disable-extensions", "--disable-component-update", "--disable-sync",
         "--disable-background-networking", f"--user-data-dir={profile}",
         f"--remote-debugging-port={port}", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def mobile_shot(page_path, req_w, req_h, dpr, png=None, deadline=30):
    """手机视口（mobile=true）渲染页面，返回 DOM 探针 + 截图尺寸"""
    port = 9333 + (os.getpid() % 400)
    profile = tempfile.mkdtemp(prefix="cw_cdp_")
    proc = chrome_start(port, profile)
    try:
        ver = None
        t0 = time.time()
        while time.time() - t0 < deadline:
            try:
                ver = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2).read())
                break
            except Exception:
                time.sleep(0.25)
        if not ver:
            raise RuntimeError("Chrome 没起来（remote debugging 端口不通）")
        cdp = CDP(ver["webSocketDebuggerUrl"])
        cdp.attach_page()
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": req_w, "height": req_h, "deviceScaleFactor": dpr, "mobile": True})
        cdp.call("Page.navigate", {"url": pathlib.Path(page_path).absolute().as_uri()})
        time.sleep(1.2)
        expr = ("(function(){var r=document.getElementById('wm-root')||{};"
                "var m=document.querySelector('[data-id=model]');"
                "return JSON.stringify({vw:window.innerWidth,docW:document.documentElement.clientWidth,"
                "rootW:r.clientWidth,scrollW:r.scrollWidth,rootH:(r.getBoundingClientRect?r.getBoundingClientRect().height:0),"
                "modelX:m?m.getBoundingClientRect().left:null,unit:CONFIG.unit,"
                "err:((document.getElementById('wm-error')||{}).textContent||'')});})()")
        probe = json.loads(cdp.call("Runtime.evaluate", {"expression": expr, "returnByValue": True})["result"]["value"])
        size = None
        if png:
            shot = cdp.call("Page.captureScreenshot", {"format": "png"})
            png.parent.mkdir(parents=True, exist_ok=True)
            png.write_bytes(base64.b64decode(shot["data"]))
            from PIL import Image
            size = Image.open(png).size
        cdp.ws.close()
        return probe, size
    finally:
        try:
            os.killpg(os.getpgid(proc.pid), 9)
        except Exception:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


# ------------------------------------------------------------------ 页面组装
def make_page(case, meta=True):
    lv.ARGS = lv.ARGS if hasattr(lv, "ARGS") else argparse.Namespace(font="ios", only="")  # build_page 依赖
    lv.PORT = None
    preset_text = (R / "presets" / "leica.json").read_text()
    preset = json.loads(preset_text)
    bundle = (R / "core" / "bundle.js").read_text()
    dpr = case.get("dpr", 3)
    variant = "layout" if case.get("gps") else "layout_loc_off"
    band_dp = preset["metadata"]["bandDpByVariant"][variant]
    plan = wm_plan.plan(case["W"], case["H"], dpr, preset["metadata"]["designShort"], band_dp)
    unit, req_w, band_h = plan["unit"], plan["req_w"], plan["band_h"]
    page = lv.build_page(preset, preset_text, bundle, case, case.get("style", "light"),
                         case.get("logo", "Leica"), req_w)
    page = page.replace("UNITVAL", repr(unit))
    page = page.replace(f"<style>html,body{{width:{req_w}px;}}</style>", "")          # 剥掉测试专用宽度注入
    page = page.replace(lv.PROBE + "\n</script></body></html>", "</script></body></html>")  # 剥掉探针
    if not meta:                                                                       # 自我对照：去掉 viewport 行
        import re
        page = re.sub(r'<meta name="viewport"[^>]*>', "", page)
    path = OUT / f"{case['name']}{'' if meta else '_nometa'}.html"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(page)
    return dict(page=path, unit=unit, req_w=req_w, band_h=band_h, dpr=dpr, band_dp=band_dp)


CASES = [
    dict(name="demo_944x1264", W=944, H=1264, model="iPhone 18 Pro Max", date="2026-10-09T01:17:00",
         exif=dict(focal=24, aperture=1.8, speed=1 / 60, iso=100), gps=None, logo="Canon", style="dark"),
    dict(name="demo_1080x1440", W=1080, H=1440, model="iPhone 17 Pro Max", date="2026-06-14T08:43:00",
         exif=dict(focal=100, aperture=2.8, speed=1 / 25, iso=1250), gps=None, logo="Leica"),
    dict(name="demo_1024x768", W=1024, H=768, model="PMA110", date="2026-03-18T21:25:00",
         exif=dict(focal=70, aperture=2.2, speed=1 / 48, iso=1000), gps=(39.9, 74.4), logo="Leica"),
    dict(name="control_4032x3024", W=4032, H=3024, model="iPhone 15 Pro", date="2026-06-14T08:43:00",
         exif=dict(focal=100, aperture=1.8, speed=1 / 60, iso=200), gps=(39.9056, 116.3914), logo="Leica"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dpr", type=int, default=3)
    ap.add_argument("--only", default="")
    ap.add_argument("--no-selftest", action="store_true", help="不跑\"去掉 viewport meta\"的自我对照")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    rows, fails = [], []
    for case in CASES:
        if a.only and a.only not in case["name"]:
            continue
        case = dict(case, dpr=a.dpr)
        m = make_page(case, meta=True)
        rep, size = mobile_shot(m["page"], m["req_w"], m["band_h"], m["dpr"], OUT / f"{case['name']}.png")
        problems = []
        if abs(rep["docW"] - m["req_w"]) > 1:
            problems.append(f"布局视口 {rep['docW']} ≠ 请求宽 {m['req_w']}（页面没声明 viewport？）")
        if rep["modelX"] is None:
            problems.append("机型节点缺失")
        elif abs(rep["modelX"] - 48 * m["unit"]) > 1.0:
            problems.append(f"机型左缘 {rep['modelX']:.2f} ≠ 48dp×unit({48*m['unit']:.2f})")
        if rep["scrollW"] - rep["rootW"] > 1:
            problems.append(f"横向溢出 {rep['scrollW']} > {rep['rootW']}")
        if rep["err"]:
            problems.append("页面报错: " + rep["err"][:80])
        if size and size != (m["req_w"] * m["dpr"], m["band_h"] * m["dpr"]):
            problems.append(f"位图 {size} ≠ reqW×dpr × bandH×dpr ({m['req_w']*m['dpr']}×{m['band_h']*m['dpr']})")
        fails += problems
        rows.append(dict(case=case["name"], size=f"{case['W']}×{case['H']}", req=f"{m['req_w']}×{m['band_h']}pt",
                         docW=rep["docW"], model_x=round(rep["modelX"] or 0, 2), want_x=round(48 * m["unit"], 2),
                         bitmap=f"{size[0]}×{size[1]}" if size else "-", problems=problems))
        print(("✗ " if problems else "✓ ") + f"{case['name']:<18} {case['W']}x{case['H']} req={m['req_w']}x{m['band_h']}pt "
              f"布局视口={rep['docW']} 机型左缘={rep['modelX']:.2f}(应{48*m['unit']:.2f})" +
              ("" if not problems else "  —— " + "; ".join(problems[:2])))

    # 自我对照：去掉 viewport meta 必须能被本检查抓到（小图请求宽 < 980）
    selftest = None
    if not a.no_selftest:
        case = dict(next(c for c in CASES if c["name"] == "demo_944x1264"), dpr=a.dpr)
        m = make_page(case, meta=False)
        rep, _ = mobile_shot(m["page"], m["req_w"], m["band_h"], m["dpr"])
        caught = abs(rep["docW"] - m["req_w"]) > 1
        selftest = dict(case=case["name"], req_w=m["req_w"], docW=rep["docW"], caught=caught)
        print(("✓ " if caught else "✗ ") + f"自我对照（去掉 viewport meta）: 布局视口={rep['docW']}（请求 {m['req_w']}）"
              + (" → 检查能抓到 ✓" if caught else " → 抓不到，检查失效 ✗"))
        if not caught:
            fails.append("自我对照失败：去掉 viewport meta 后布局视口仍等于请求宽，本检查抓不到回归")

    lines = ["# 手机布局视口回归检查", "",
             "- 断言：**布局视口 = 请求宽度**（= 照片宽/dpr）→ 绝对 px 的字号/边距才不会被默认 980 视口压小",
             "- 方法：Chrome `Emulation.setDeviceMetricsOverride(mobile=true)` + 仓库里的真实模板/预设/bundle",
             f"- dpr={a.dpr}；位图应为 reqW×dpr × bandH×dpr", "",
             "| 用例 | 照片 | 请求(pt) | 布局视口 | 机型左缘 | 应=48dp×unit | 位图 | 判定 |",
             "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['case']} | {r['size']} | {r['req']} | {r['docW']} | {r['model_x']} | {r['want_x']} | "
                     f"{r['bitmap']} | {'✓' if not r['problems'] else '✗ ' + '; '.join(r['problems'])} |")
    if selftest:
        lines += ["", f"自我对照：同一张 944 图**去掉 viewport meta** → 布局视口 = {selftest['docW']}（请求 "
                      f"{selftest['req_w']}）→ {'检查能抓到 ✓' if selftest['caught'] else '抓不到 ✗'}"]
    (OUT / "report.md").write_text("\n".join(lines) + "\n")
    print(f"\n{'全部通过 ✓' if not fails else f'{len(fails)} 处不通过 ✗'}  报告: _local/viewport/report.md")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
