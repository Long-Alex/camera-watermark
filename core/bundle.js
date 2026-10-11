// 00-util: 基础工具（单位换算 / DOM / 取值）
// 单位链：unit = min(照片宽,照片高) / designShort（快捷指令算好写进 RUNTIME.unit；不除 dpr，踩坑 §9.1b）
// WebView 里 1 CSS px = 1 pt ⇒ dp × unit = px
var DP = function (v) {                       // dp 数值 → px；带单位字符串（"100%" / "0.083em"）原样
  if (typeof v === 'number') return (v * CONFIG.unit) + 'px';
  return v;
};
var EL = function (tag, css, text) {
  var e = document.createElement(tag);
  if (css) for (var k in css) e.style[k] = css[k];
  if (text != null) e.textContent = text;
  return e;
};
var PAD = function (p, side) { return p && p[side] != null ? p[side] : 0; };
var FONT = function (n) { return n.font ? ((CONFIG.fonts || {})[n.font] || null) : null; };
// 外观取值：键 = CSS 属性名（= 该 preset 的 styles 那套），运行时已被 OVERRIDE（选中样式）改写（§4.5）
var APP = function (k, dflt) {
  var a = CONFIG.appearance || {};
  return (a[k] != null && a[k] !== '') ? a[k] : dflt;
};

// 10-style: layout 节点 → CSS 样式对象（字段名即 CSS 属性名，纯数字 = dp）
// 对照 p880yu：水平容器 Σ(子宽+margin_left) / 高 = max(子高+margin_top)；垂直容器反过来。
var LAYOUT_PROPS = ['width','height','min-width','max-width','margin-top','margin-bottom','margin-left','margin-right',
                    'padding-top','padding-bottom','padding-left','padding-right',
                    'background-color','justify-content','align-items','align-self','flex-direction','flex','opacity'];
var LEN_PROP = /^(margin-|padding-|width$|height$|min-width$|max-width$)/;
var nodeStyle = function (n, font) {
  var css = { boxSizing: 'border-box' };
  LAYOUT_PROPS.forEach(function (p) {
    if (n[p] != null) css[p] = LEN_PROP.test(p) ? DP(n[p]) : n[p];
  });
  if (n.padding) {
    css['padding-top']    = DP(PAD(n.padding, 'top'));
    css['padding-bottom'] = DP(PAD(n.padding, 'bottom'));
    css['padding-left']   = DP(PAD(n.padding, 'left'));
    css['padding-right']  = DP(PAD(n.padding, 'right'));
  }
  if (n.flex == null) css['flex-shrink'] = 0;      // 引擎不压缩固定尺寸子项（分隔线 2dp 不能被挤掉）
  var t = n.type;
  if (t === 'row')    { css.display = 'flex'; css['flex-direction'] = 'row'; }
  if (t === 'column') { css.display = 'flex'; css['flex-direction'] = 'column'; css['align-items'] = css['align-items'] || 'flex-start'; }
  if (t === 'text' && font) {
    css['font-family'] = font['font-family'];
    css['font-size']   = DP(font['font-size']);        // px = size(dp) × scale（b.f()）
    css['line-height'] = DP(font['line-height']);      // = (descent − ascent) × size（MiSans hhea）
    css['min-height']  = DP(font['line-height']);      // 空文本视图仍占一行高（b.f() 不跳过）
    css['font-weight'] = font['font-weight'];
    css['white-space'] = 'pre';                        // EXIF/经纬度双空格 + 绝不换行
    css['word-break']  = 'keep-all';
    if (font.opacity != null) css.opacity = font.opacity;               // @foreground=2 ⇒ 50%
    if (font['letter-spacing']) css['letter-spacing'] = font['letter-spacing'];  // em ⇒ 随字号缩放
    if (n['text-align'] === 'right') css['align-self'] = 'flex-end';   // layout_gravity=right
  }
  if (n.css) (n.css || '').split(';').forEach(function (kv) {          // 逃生舱：节点级 css 最后写入
    var i = kv.indexOf(':'); if (i > 0) css[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return css;
};

// 20-build: layout 树 → DOM
// 图片：内联 SVG（只有内联才吃得到模板 CSS/渐变，见踩坑 §4.5）；
//       纯色标（fill=currentColor / 无 fill）走样式渐变，品牌色标（Leica/Nikon/ZEISS）保留自带填色。
var SVG_GRADIENT_ID = 'wm-fg-gradient';
var GRADIENT_SHAPES = 'path,rect,circle,ellipse,polygon,polyline,use,line';
var wantsPaint = function (v) { return v == null || v === '' || v === 'currentColor'; };

var paintGradient = function (svg) {
  var ns = 'http://www.w3.org/2000/svg';
  var defs = document.createElementNS(ns, 'defs');
  var g = document.createElementNS(ns, 'linearGradient');
  var angle = (parseFloat(APP('foreground-direction', '90deg')) - 90) * Math.PI / 180;
  var dx = Math.cos(angle), dy = Math.sin(angle);
  g.setAttribute('id', SVG_GRADIENT_ID);
  g.setAttribute('x1', (50 - dx * 50) + '%'); g.setAttribute('y1', (50 - dy * 50) + '%');
  g.setAttribute('x2', (50 + dx * 50) + '%'); g.setAttribute('y2', (50 + dy * 50) + '%');
  [[APP('foreground-stop', '0%'), APP('foreground-start', '#000000')], ['100%', APP('foreground-end', '#000000')]]
    .forEach(function (st) {
      var s = document.createElementNS(ns, 'stop');
      s.setAttribute('offset', st[0]); s.setAttribute('stop-color', st[1]);
      g.appendChild(s);
    });
  defs.appendChild(g);
  svg.insertBefore(defs, svg.firstChild);
  var shapes = svg.querySelectorAll(GRADIENT_SHAPES);
  for (var i = 0; i < shapes.length; i++) {
    if (wantsPaint(shapes[i].getAttribute('fill'))) shapes[i].setAttribute('fill', 'url(#' + SVG_GRADIENT_ID + ')');
    var strokeAttr = shapes[i].getAttribute('stroke');          // ⚠ 没写 stroke 的图形不能再补描边（会描出一圈黑框）
    if (strokeAttr != null && strokeAttr !== 'none' && wantsPaint(strokeAttr)) {
      shapes[i].setAttribute('stroke', 'url(#' + SVG_GRADIENT_ID + ')');
    }
  }
};

var buildNode = function (n) {
  var font = FONT(n);
  var css  = nodeStyle(n, font);
  var t = n.type;

  if (t === 'divider') {                                  // 2dp × 64dp 色块（@foreground=1）
    var d = EL('div', css);
    d.style.backgroundImage = 'linear-gradient(' + APP('foreground-direction', '90deg') + ',var(--foreground-start) ' +
                              APP('foreground-stop', '0%') + ',var(--foreground-end))';
    if (css.opacity == null) d.style.opacity = APP('line-opacity', 1);   // @foreground=1 的 alpha
    d.setAttribute('data-id', n.id);
    return d;
  }

  if (t === 'image') {
    var box = EL('div', css);
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.setAttribute('data-id', n.id);
    var src = document.getElementById('wm-logo-src');
    var svg = src ? src.innerHTML : '';
    if (svg) {
      box.innerHTML = svg;                                // 内联 SVG
      var inner = box.querySelector('svg');
      if (inner) {
        // 尺寸算死：高 = 节点 dp×unit，宽 = 高 × 宽高比（viewBox 优先）。
        // 不靠 width:auto（WebKit 对 inline SVG 的 auto 宽度解析与 Chrome 不一致 ⇒ 可能显示不全）
        var h = (typeof n.height === 'number' ? n.height * CONFIG.unit : 0) || 0;
        var vb = (inner.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
        var ratio = (vb.length === 4 && vb[2] > 0 && vb[3] > 0) ? vb[2] / vb[3]
                  : (parseFloat(inner.getAttribute('width')) > 0 && parseFloat(inner.getAttribute('height')) > 0)
                    ? parseFloat(inner.getAttribute('width')) / parseFloat(inner.getAttribute('height')) : 1;
        var w = h * ratio;
        // 安全宽度（节点 max-width，dp）：宽标（哈苏 821dp / SONY 363dp / Canon 304dp）不能挤爆行。
        // 逻辑是高度逻辑的镜像：安全宽度内以高为准；超过就以宽为准，反推高度（保持比例）
        var maxW = (typeof n['max-width'] === 'number' ? n['max-width'] * CONFIG.unit : 0) || 0;
        if (maxW > 0 && w > maxW) { w = maxW; h = ratio > 0 ? w / ratio : h; }
        if (h > 0) {
          inner.setAttribute('width', w); inner.setAttribute('height', h);
          inner.style.width = w + 'px'; inner.style.height = h + 'px';
          inner.style.display = 'block';
          box.style.width = w + 'px';
          box.style.height = h + 'px';
          box.style.flex = '0 0 ' + w + 'px';
          box.setAttribute('data-ratio', ratio.toFixed(4));
        }
        inner.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        paintGradient(inner);
      }
    }
    if (n.optional && !svg) box.style.display = 'none';   // 素材缺失 ⇒ 视图不渲染
    return box;
  }

  if (t === 'text') {
    var txt = expand(n.text);
    var e = EL('div', css, txt || '');
    e.className = 'tn';
    e.setAttribute('data-id', n.id);
    e.setAttribute('data-fs', DP(font ? font['font-size'] : 0));
    e.setAttribute('data-font', n.font || '');
    return e;
  }

  var row = EL('div', css);                               // row / column
  row.setAttribute('data-id', n.id);
  (n.children || []).forEach(function (c) { row.appendChild(buildNode(c)); });
  return row;
};

// 30-format: token 展开（唯一权威表见文档 §5.3；时间格式表 = 小米 arsc 字符串池）
var TIME_FMT = {                       // @wm_time_* → SimpleDateFormat 原文
  wm_time_yyyy_MM_dd_HH_mm: 'yyyy.MM.dd HH:mm',
  wm_time_yyyy_MM_dd:       'yyyy.MM.dd',
  wm_time_HH_mm:            'HH:mm',
  wm_time_MM:               'MM',
  wm_time_dd:               'dd',
  wm_time_week:             'EEEE'
};
var WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var pad2 = function (x) { return (x < 10 ? '0' : '') + x; };
var fmtTime = function (iso, pattern) {
  var d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) {          // 时间缺失/无效 ⇒ fallback.date（"now" = 渲染时刻）
    var fb = (CONFIG.fallback || {}).date;
    d = (fb && fb !== 'now') ? new Date(fb) : new Date();
  }
  if (isNaN(d.getTime())) return '';
  return pattern.replace(/yyyy/g, d.getFullYear())
                .replace(/EEEE/g, WEEK[d.getDay()])
                .replace(/MM/g, pad2(d.getMonth() + 1))
                .replace(/dd/g, pad2(d.getDate()))
                .replace(/HH/g, pad2(d.getHours()))
                .replace(/mm/g, pad2(d.getMinutes()))
                .replace(/ss/g, pad2(d.getSeconds()));
};
var dms = function (v, pos, neg) {     // Ci.a.d(): 度分秒整数截断 + 半球后缀
  var hemi = v >= 0 ? pos : neg, a = Math.abs(v);
  var d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.floor(((a - d) * 60 - m) * 60);
  return d + '°' + m + "'" + pad2(s) + '"' + hemi;
};
var hasGps = function () {
  return CONFIG.lat != null && CONFIG.lat !== '' && CONFIG.lon != null && CONFIG.lon !== '';
};
var latlng = function () {             // 单行，纬经之间【两个空格】（模板不拆行）
  return hasGps() ? (dms(Number(CONFIG.lat), 'N', 'S') + '  ' + dms(Number(CONFIG.lon), 'E', 'W')) : '';
};
var numValue = function (x) {
  if (typeof x === 'string' && x.indexOf('/') >= 0) {
    var p = x.split('/'), a = Number(p[0]), b = Number(p[1]);
    if (isFinite(a) && isFinite(b) && b !== 0) return a / b;
  }
  var n = Number(x);
  return isFinite(n) ? n : NaN;
};
var fmtFixed = function (x, dec) {     // 定点后去尾零（2.6 → "2.6"，2.0 → "2"）
  x = Number(x);
  return isFinite(x) ? String(Number(x.toFixed(dec))) : '';
};
var fmtSpeed = function (x) {          // <1s ⇒ 1/N；≥1s ⇒ %g（复刻 fmt_speed）
  x = Number(x);
  if (!isFinite(x) || x <= 0) return '';
  if (x >= 1) return String(parseFloat(x.toPrecision(6)));
  return '1/' + Math.round(1 / x);
};
// 取值链：运行时值 → preset.fallback 兜底 → NaN/空（截图、无 EXIF、无机型都不会空/出错）
var pickNum = function (k) {
  var n = numValue(CONFIG[k]);
  if (isFinite(n) && n > 0) return n;
  var f = numValue((CONFIG.fallback || {})[k]);
  return (isFinite(f) && f > 0) ? f : NaN;
};

var expand = function (tpl) {
  if (tpl == null) return '';
  // 就地替换（不早返回）：模板里可以同时有时间和别的 token；早返回会把其余内容整行吞掉
  tpl = tpl.replace(/@wm_time_(\w+)/g, function (_, k) {
    return fmtTime(CONFIG.date, TIME_FMT['wm_time_' + k] || k);
  });
  tpl = tpl.replace(/location_latlng/g, latlng());
  // 涉及拍摄参数的行：四项都取"值或兜底"；连兜底都没有才整行置空（仍占一行高）
  var needExif = /@\{(focal|aperture|speed|iso)\}/.test(tpl);
  if (needExif && !(isFinite(pickNum('focal')) && isFinite(pickNum('aperture')) &&
                    isFinite(pickNum('speed')) && isFinite(pickNum('iso')))) return '';
  return tpl.replace(/@\{(\w+)\}/g, function (_, k) {
    switch (k) {
      case 'model':      return CONFIG.model || (CONFIG.fallback || {}).model || '';
      case 'versionName':return CONFIG.versionName || '';
      case 'focal':      return fmtFixed(pickNum('focal'), 0);
      case 'focalActual':return fmtFixed(numValue(CONFIG.focalActual), 2);
      case 'aperture':   return fmtFixed(pickNum('aperture'), 1);
      case 'speed':      return fmtSpeed(pickNum('speed'));
      case 'iso':        return fmtFixed(pickNum('iso'), 0);
      case 'cvLens':     return CONFIG.lens || '';
      case 'logo':       return '';
      default:           return '';
    }
  });
};

// 90-boot: 入口 —— RUNTIME → CONFIG → 选 layout 变体 → CSS 变量 → 建 DOM → 防溢出
(function () {
  var fail = function (msg) {
    var b = document.getElementById('wm-error');
    if (b) { b.style.display = 'block'; b.textContent = 'watermark error: ' + msg; }
  };
  var fit = function (root) {                 // JS 缩字号：防文本换行 / 防右组被挤到左列上（§4.3 前提：文本单行）
    var nodes = root.querySelectorAll('.tn');
    var i, base = [];
    for (i = 0; i < nodes.length; i++) {      // 每次都从"基准字号"（data-fs）量起：重复调用幂等，
      base[i] = parseFloat(nodes[i].getAttribute('data-fs')) || 0;   // 不会把上一次（比如字体没就绪时）的误判留下
      if (base[i]) nodes[i].style.fontSize = base[i] + 'px';
    }
    var factor = 1;
    for (var pass = 0; pass < 3; pass++) {
      var k = 1;
      var sw = root.scrollWidth, cw = root.clientWidth;
      if (sw && cw && sw - cw > 1) k = cw / sw;                     // ① 右溢出（内容比行还宽）
      // ② 左列 + 右组内容 > 行内容区 ⇒ flex-end 会把右组往左推（logo 压到机型文字上、甚至出画布）。
      //    这种"向左溢出"不会让 scrollWidth 变大，① 抓不到 ⇒ 用两个组的**内容实际范围**量一次。
      //    只有文字会随字号缩（logo/分隔线/间距是固定 dp），所以一次算出 k = (可用 − 固定部分) / 文字部分
      var row = root.querySelector('[data-id=bottom_layout]');
      var lcol = root.querySelector('[data-id=left_bottom_layout]');
      var rgrp = root.querySelector('[data-id=right_bottom_group]');
      if (row && lcol && rgrp) {
        // 只看**可见**子项：没选 logo 时 logo 节点是 display:none，rect 全 0，会把 head.left 当成 0
        var kids = rgrp.children, head = null, tail = null;
        for (var ci = 0; ci < kids.length; ci++) {
          var kb = kids[ci].getBoundingClientRect();
          if (kb.width <= 0) continue;
          if (!head) head = kb;
          tail = kb;
        }
        if (head && tail) {
          var rr = row.getBoundingClientRect(), lr = lcol.getBoundingClientRect();
          // 右组自带 margin-left（机型文字 ↔ 品牌标的最小间隙）⇒ 可用宽度要扣掉它，
          // 否则 fit 会缩到"刚好塞下"，两段内容贴死（长标时看起来像叠在一起）
          var gap = parseFloat((window.getComputedStyle ? getComputedStyle(rgrp) : rgrp.style).marginLeft) || 0;
          var avail = rr.width - (lr.left - rr.left) - (rr.right - tail.right) - gap;
          var content = lr.width + (tail.right - head.left);
          if (content > avail + 0.5) {
            var textPart = lr.width + tail.width;                      // 会随字号缩的部分
            var fixedPart = content - textPart;                        // logo + 间距（不缩）
            var kk = textPart > 0 ? (avail - fixedPart) / textPart : 1;
            k = Math.min(k, Math.max(0.4, kk));
          }
        }
      }
      if (k >= 0.999) return;
      factor *= k;
      root.setAttribute('data-fit', '1');
      for (i = 0; i < nodes.length; i++) {
        if (base[i]) nodes[i].style.fontSize = (base[i] * factor) + 'px';
      }
    }
  };
  try {
    // 1) 运行时值合并进 CONFIG（扁平注入，见踩坑 §18.3）
    var keys = ['unit','model','versionName','date','focal','focalActual','aperture','speed','iso','lat','lon','lens'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (RTV && RTV[k] !== '' && RTV[k] != null) CONFIG[k] = RTV[k];
    }
    CONFIG.unit = parseFloat(CONFIG.unit) || 1;

    // 2) 选中样式（快捷指令从该 preset 的 styles 里挑一款传进来）→ 改写 CONFIG.appearance，见 §4.5
    var ap = CONFIG.appearance = CONFIG.appearance || {};
    var APP_KEYS = ['foreground-start','foreground-end','foreground-stop','foreground-direction',
                    'line-opacity','background-color','background-image','background-fit'];
    for (var a = 0; a < APP_KEYS.length; a++) {
      var k = APP_KEYS[a];
      if (OVERRIDE && OVERRIDE[k] !== '' && OVERRIDE[k] != null) ap[k] = OVERRIDE[k];
    }
    var st = document.documentElement.style;
    st.setProperty('--background-color', APP('background-color', '#FFFFFF'));
    st.setProperty('--foreground-start', APP('foreground-start', '#000000'));
    st.setProperty('--foreground-end', APP('foreground-end', APP('foreground-start', '#000000')));
    st.setProperty('--foreground-stop', APP('foreground-stop', '0%'));
    st.setProperty('--foreground-direction', APP('foreground-direction', '90deg'));

    var root = document.getElementById('wm-root');
    // 背景图：快捷指令注入 data URI（style 里的 background-image = assets/background/<id>.png）；
    // 定位/缩放由 style 的 background-fit 决定（缺省 cover）：
    //   cover   = 不变形、铺满、居中裁切（默认，适合照片/图案）
    //   repeat  = 高度铺满 + 按原比例横向平铺（适合纸纹/布料这类可平铺素材）
    //   stretch = 拉满整条带（素材本身就是按带子比例设计的才用，比如 1px 竖渐变）
    // 背景图：就是最简单的 CSS background-image（实测真机这条路是通的 —— 红色一度正常出图）。
    // 之前那版改成 <img>/内联 SVG 是响应"图没出来"，但事后查明那次是 iCloud 占位文件导致
    // "未能打开文件 red.png"，不是渲染管线的问题。这里回到简单写法 + 长度兜底。
    var backgroundImage = (BG_URI && BG_URI.length > 32) ? BG_URI : '';
    if (backgroundImage) {
      var bgFit = APP('background-fit', 'cover');
      root.style.backgroundImage = 'url(' + backgroundImage + ')';
      root.style.backgroundPosition = 'center';
      root.style.backgroundRepeat = 'no-repeat';
      root.style.backgroundSize = (bgFit === 'stretch') ? '100% 100%'
                               : (bgFit === 'repeat') ? 'auto 100%' : 'cover';
      if (bgFit === 'repeat') root.style.backgroundRepeat = 'repeat-x';
    }

    // 3) layout 变体：lat/lon 均非空 ⇒ layout；任一为空 ⇒ layout_loc_off（§5.3）
    var gps = hasGps(), variants = CONFIG.layout_group || [], pick = null;
    for (var v = 0; v < variants.length; v++) {
      var name = Object.keys(variants[v])[0];
      if (name === (gps ? 'layout' : 'layout_loc_off')) { pick = variants[v][name]; break; }
    }
    if (!pick && variants.length) pick = variants[variants.length - 1][Object.keys(variants[variants.length - 1])[0]];
    if (!pick) throw new Error('layout_group 为空');

    // 4) 建 DOM + 防溢出
    for (var n = 0; n < pick.length; n++) root.appendChild(buildNode(pick[n]));
    fit(root);
    root.setAttribute('data-variant', gps ? 'layout' : 'layout_loc_off');
    // 字体可能晚到（本地对照模式用 @font-face 加载 MiSans）⇒ 就绪后再 fit 一次；
    // fit() 每次从 data-fs 基准量起，幂等，不会把"字体没就绪时"的误判留下
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { try { fit(root); } catch (e) {} });
    }
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
