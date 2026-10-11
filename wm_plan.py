#!/usr/bin/env python3
"""wm_plan —— 尺寸算术的唯一来源 = `camera-watermark.cherri` 本身

demo / 本地校验不再自己写一遍 `unit/reqW/bandH/上限`，而是把 cherri 里的
`calculateExpression("...")` 及其赋值/条件**原样提取出来求值**：
改了 cherri（比如上限 1512）本地这边自动跟着变，不存在"两套算法"。

支持的最小语法（cherri 里实际用到的）：
    数字 / 标识符 / + - * / ( ) / rint() / min() / max()
    const X = calculateExpression("…") ｜ @X = <表达式|数字|标识符>
    if <标识符> > <数字> { @A = calculateExpression("…") … }
"""
import math, pathlib, re, sys

R = pathlib.Path(__file__).parent
CHERRI = R / "camera-watermark.cherri"

RE_CALC = re.compile(r'(?:const\s+|@)?(\w+)\s*=\s*calculateExpression\(\s*"([^"]*)"\s*\)')
RE_PLAIN = re.compile(r'@(\w+)\s*=\s*(\w+|\d+(?:\.\d+)?)\s*$')
RE_IF = re.compile(r'if\s+(\w+)\s*([<>]=?)\s*([\w.]+)\s*\{')


class PlanError(RuntimeError):
    pass


def _tokenize(expr):
    return re.findall(r'\d+\.?\d*|[A-Za-z_]\w*|[-+*/(),]', expr)


def _eval(expr, env):
    """极小的算术求值器：只认识 cherri 用到的运算符/函数"""
    toks, i = _tokenize(expr), 0

    def peek():
        return toks[i] if i < len(toks) else None

    def eat(t=None):
        nonlocal i
        cur = peek()
        if t and cur != t:
            raise PlanError(f"表达式 {expr!r} 里期望 {t!r}，实际 {cur!r}")
        i += 1
        return cur

    def num(v):
        if isinstance(v, str):
            if v in env and isinstance(env[v], (int, float)):
                return float(env[v])
            raise PlanError(f"表达式 {expr!r} 里的 {v!r} 没有取值（env 缺 key）")
        return float(v)

    def primary():
        t = peek()
        if t == '(':
            eat('('); v = add(); eat(')'); return v
        if re.fullmatch(r'\d+\.?\d*', t or ''):
            return float(eat())
        name = eat()
        if peek() == '(':
            eat('(')
            args = [add()]
            while peek() == ',':
                eat(','); args.append(add())
            eat(')')
            if name == 'rint':
                return float(math.floor(args[0] + 0.5)) if args[0] >= 0 else float(math.ceil(args[0] - 0.5))
            if name == 'min':
                return min(args)
            if name == 'max':
                return max(args)
            raise PlanError(f"不认识的函数 {name}()")
        return num(name)

    def mul():
        v = primary()
        while peek() in ('*', '/'):
            op = eat()
            r = primary()
            v = v * r if op == '*' else v / r
        return v

    def add():
        v = mul()
        while peek() in ('+', '-'):
            op = eat(); r = mul()
            v = v + r if op == '+' else v - r
        return v

    v = add()
    if i != len(toks):
        raise PlanError(f"表达式 {expr!r} 没解析完：剩余 {toks[i:]}")
    return v


SIZE_KEYS = {'photoShortEdge', 'renderWidthRaw', 'unitRaw', 'renderWidth', 'unit', 'renderHeight'}


def load_program(cherri_path=CHERRI):
    """只提取尺寸链那几行：[(name, ('calc'|'num'|'ref', 值), 条件)]

    条件来自 `if <name> <op> <num> {` 块（cherri 里只有"走上限"那一段）；块外的条件为 None。
    顺手忽略 dpr 探针（依赖 probePixelWidth）—— 本地的 deviceScale 由参数给定。
    """
    prog, cond = [], None
    for ln in cherri_path.read_text().splitlines():
        st = ln.strip()
        m = RE_IF.search(st)
        if m:
            cond = (m.group(1), m.group(2), m.group(3)); continue
        if cond and st.startswith('}'):
            cond = None; continue
        m = RE_CALC.search(st)
        if m and m.group(1) in SIZE_KEYS:
            if 'probe' in m.group(2):
                continue
            prog.append((m.group(1), ('calc', m.group(2)), cond)); continue
        m = RE_PLAIN.search(st)
        if m and m.group(1) in SIZE_KEYS:
            v = m.group(2)
            prog.append((m.group(1), ('num', float(v)) if re.fullmatch(r'\d+(\.\d+)?', v) else ('ref', v), cond))
    return prog


def plan(photo_w, photo_h, dpr, design_short, band_dp, cherri_path=CHERRI, extra=None):
    """按 cherri 的公式算出 {unit, req_w, band_h}（pt）—— 公式来源可追溯"""
    env = dict(photoWidth=float(photo_w), photoHeight=float(photo_h), deviceScale=float(dpr),
               designShort=float(design_short), bandHeightDesign=float(band_dp))
    env.update(extra or {})
    for name, val, cond in load_program(cherri_path):
        if cond:
            cname, op, rhs = cond
            left = env.get(cname); right = env[rhs] if rhs in env else float(rhs)
            ok = {'>': left > right, '<': left < right, '>=': left >= right, '<=': left <= right}[op]
            if not ok:
                continue
        if val[0] == 'calc':
            expr = re.sub(r'\{@?(\w+)\}', lambda m: m.group(1), val[1])
            env[name] = _eval(expr, env)
        elif val[0] == 'num':
            env[name] = val[1]
        elif val[1] in env:
            env[name] = env[val[1]]
    for k in ('unit', 'renderWidth', 'renderHeight'):
        if k not in env:
            raise PlanError(f"没能从 {cherri_path.name} 里提取出 {k}（cherri 结构变了？）")
    return dict(unit=env['unit'], req_w=int(env['renderWidth']), band_h=int(env['renderHeight']),
                photo_short_edge=env.get('photoShortEdge', min(photo_w, photo_h)),
                source=cherri_path.name)


if __name__ == "__main__":
    for w, h, dpr in ((944, 1264, 3), (1080, 1440, 3), (5712, 4284, 3), (1024, 768, 1), (8000, 6000, 3)):
        p = plan(w, h, dpr, 1080, 159.8)
        print(f"{w}×{h} dpr={dpr} → reqW={p['req_w']} bandH={p['band_h']}pt unit={p['unit']:.5f}")
