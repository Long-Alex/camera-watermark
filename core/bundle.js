// 00-util: 基础工具
var DP = function (v) {                       // dp 数字 → pt 字符串；带单位/字符串原样
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

// 10-style: layout 节点 → CSS 样式对象（字段名即 CSS 属性名，纯数字=dp）
var LAYOUT_PROPS = ['width','height','margin-top','margin-bottom','margin-left','margin-right',
                    'padding-top','padding-bottom','padding-left','padding-right',
                    'text-align','background-color','justify-content','align-items','flex-direction','flex'];
var nodeStyle = function (n, font) {
  var css = { boxSizing: 'border-box' };
  LAYOUT_PROPS.forEach(function (p) {
    if (n[p] != null) css[p] = (/^(margin|padding)/.test(p) || p === 'width' || p === 'height') ? DP(n[p]) : n[p];
  });
  if (n.padding) {
    css['padding-top'] = DP(PAD(n.padding,'top')); css['padding-bottom'] = DP(PAD(n.padding,'bottom'));
    css['padding-left'] = DP(PAD(n.padding,'left')); css['padding-right'] = DP(PAD(n.padding,'right'));
  }
  var t = n.type;
  if (t === 'row')    css.display = 'flex', css['flex-direction'] = 'row';
  if (t === 'column') css.display = 'flex', css['flex-direction'] = 'column', css['align-items'] = css['align-items'] || 'flex-start';
  if (t === 'text' && font) {
    css['font-family']    = "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC',sans-serif";
    css['font-size']      = DP(font['font-size']);
    css['font-weight']    = font['font-weight'];
    css['line-height']    = DP(font['line-height']);
    if (font.color) css.color = font.color;
    if (font['letter-spacing']) css['letter-spacing'] = font['letter-spacing'];
    css['white-space']    = 'pre';
    if (n['text-align'] === 'right') css['align-self'] = 'flex-end';
  }
  if (t === 'image') css.color = css.color || '#000';
  // The preset root carries a literal white background. Apply the selected
  // theme to that node so it survives the layout's own inline background.
  if (n.id === 'bottom_layout' && OVERRIDE.bgColor) css['background-color'] = OVERRIDE.bgColor;
  if (n.css) (n.css || '').split(';').forEach(function (kv) {
    var i = kv.indexOf(':'); if (i > 0) css[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return css;
};

// 20-build: layout 树 → DOM
var buildNode = function (n) {
  var font = n.font ? CONFIG.fonts[n.font] : null;
  var css  = nodeStyle(n, font);
  var t = n.type;

  if (t === 'divider') {
    var d = EL('div', css);
    d.style.backgroundImage = 'linear-gradient(90deg,var(--foreground-start),var(--foreground-end))';
    return d;
  }
  if (t === 'image') {
    var box = EL('div', css); box.style.display = 'flex';
    var src = document.getElementById('wm-logo-src');
    var svg = src ? src.innerHTML : '';
    if (svg) {
      box.innerHTML = svg;                           // SVG 内联（currentColor 跟随 css.color）
      var inner = box.querySelector('svg');           // 让 SVG 撑满容器（否则被自身 width/height 框死）
      if (inner) {
        inner.style.height = '100%'; inner.style.width = 'auto'; inner.setAttribute('height', '100%');
        var ns = 'http://www.w3.org/2000/svg', defs = document.createElementNS(ns, 'defs');
        var gradient = document.createElementNS(ns, 'linearGradient');
        gradient.setAttribute('id', 'cw-logo-gradient'); gradient.setAttribute('x1', '0%');
        gradient.setAttribute('y1', '0%'); gradient.setAttribute('x2', '100%'); gradient.setAttribute('y2', '0%');
        [['0%', OVERRIDE.foregroundStart], ['100%', OVERRIDE.foregroundEnd || OVERRIDE.foregroundStart]].forEach(function (stop) {
          var s = document.createElementNS(ns, 'stop'); s.setAttribute('offset', stop[0]); s.setAttribute('stop-color', stop[1] || '#000000'); gradient.appendChild(s);
        });
        defs.appendChild(gradient); inner.insertBefore(defs, inner.firstChild);
        inner.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,use').forEach(function (shape) {
          var fill = shape.getAttribute('fill');
          if (fill !== 'none') shape.setAttribute('fill', 'url(#cw-logo-gradient)');
          var stroke = shape.getAttribute('stroke');
          if (stroke && stroke !== 'none') shape.setAttribute('stroke', 'url(#cw-logo-gradient)');
        });
      }
      box.style.alignItems = 'center';
    }
    if (n.optional && !svg) box.style.display = 'none';
    return box;
  }
  if (t === 'text') {
    var txt = expand(n.text);
    if (n.optional && !txt) { var h = EL('div'); h.style.display = 'none'; return h; }
    var e = EL('div', css, txt);
    e.className = 'tn';
    return e;
  }
  // row / column
  var root = EL('div', css);
  (n.children || []).forEach(function (c) { root.appendChild(buildNode(c)); });
  return root;
};
var fitText = function (root) {                    // 机型防溢出：缩字号（最多 6 步）
  var nodes = root.querySelectorAll('.tn');
  for (var i = 0; i < nodes.length; i++) {
    var e = nodes[i], s = parseFloat(e.style.fontSize) || 0, step = 0;
    while (e.scrollWidth > e.clientWidth + 1 && s > 8 && step < 6) {
      s *= 0.94; e.style.fontSize = s + 'px'; step++;
    }
  }
};

// 30-format: token 展开（唯一权威表见文档 §5.3）
var pad2 = function (x) { return (x < 10 ? '0' : '') + x; };
var fmtTime = function (iso, pattern) {
  if (!iso) return '';
  var d = new Date(iso);
  return pattern.replace(/yyyy/g, d.getFullYear()).replace(/MM/g, pad2(d.getMonth() + 1))
                .replace(/dd/g, pad2(d.getDate())).replace(/HH/g, pad2(d.getHours()))
                .replace(/mm/g, pad2(d.getMinutes())).replace(/ss/g, pad2(d.getSeconds()));
};
var dms = function (v, pos, neg) {
  var hemi = v >= 0 ? pos : neg, a = Math.abs(v);
  var d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.floor(((a - d) * 60 - m) * 60);
  var ss = (s < 10 ? '0' : '') + s;
  return d + '°' + m + "'" + ss + '"' + hemi;
};
var fmtSpeed = function (x) {
  x = Number(x);
  if (!x || isNaN(x)) return '';
  if (x >= 1) return String(Math.round(x * 10) / 10);
  return '1/' + Math.round(1 / x);
};
var fmtNum = function (x, dec) { x = Number(x); return (x == null || isNaN(x)) ? '' : String(Number(x.toFixed(dec))); };
var numValue = function (x) {
  if (typeof x === 'string' && x.indexOf('/') >= 0) {
    var p = x.split('/'), a = Number(p[0]), b = Number(p[1]);
    if (isFinite(a) && isFinite(b) && b !== 0) return a / b;
  }
  var n = Number(x);
  return isFinite(n) ? n : NaN;
};
var expand = function (tpl) {
  if (tpl == null) return '';
  var m = /@wm_time_(.*)$/.exec(tpl);
  if (m) return fmtTime(CONFIG.date, m[1]);
  if (tpl.indexOf('location_latlng') >= 0) {
    var g = CONFIG.gps || CONFIG;
    if (g.lat == null || g.lon == null) return '';
    return dms(g.lat, 'N', 'S') + ' ' + dms(g.lon, 'E', 'W');
  }
  var e = CONFIG.exif || CONFIG;   // 扁平键时直接读 CONFIG
  var fallback = (CONFIG.metadata && CONFIG.metadata.exifFallback) || {};
  ['focal','aperture','speed','iso'].forEach(function (k) {
    var n = numValue(e[k]);
    e[k] = (e[k] == null || e[k] === '' || !isFinite(n) || n <= 0) ? fallback[k] : n;
  });
  return tpl.replace(/@\{(\w+)\}/g, function (_, k) {
    switch (k) {
      case 'model': case 'versionName': return CONFIG.model || CONFIG.metadata.modelDefault || '';
      case 'focal': return fmtNum(e.focal, 0);
      case 'focalActual': return fmtNum(e.focalActual, 2);
      case 'aperture': return fmtNum(e.aperture, 1);
      case 'speed': return fmtSpeed(e.speed);
      case 'iso': return fmtNum(e.iso, 0);
      case 'cvLens': return CONFIG.lens || '';
      case 'logo': return '';
      default: return '';
    }
  });
};

// 90-boot: 入口
(function () { try {
  // 运行时值合并进 CONFIG（扁平注入, V19 同款）
  ['unit','model','date','focal','focalActual','aperture','speed','iso','lat','lon'].forEach(function(k){
    if (RTV && RTV[k] !== '' && RTV[k] != null) CONFIG[k] = RTV[k];
  });
  if (typeof CONFIG.unit === 'string') CONFIG.unit = parseFloat(CONFIG.unit);
  var g = CONFIG.gps || CONFIG;
  var hasGps = g.lat != null && g.lon != null;
  var variants = CONFIG.layout_group || [];
  var pick = null;
  for (var i = 0; i < variants.length; i++) {
    var v = variants[i], name = Object.keys(v)[0];
    if (name === 'layout' ? hasGps : !hasGps) { pick = v[name]; break; }
  }
  if (!pick) pick = variants.length ? variants[variants.length - 1][Object.keys(variants[variants.length - 1])[0]] : [];

  var root = document.getElementById('wm-root');
  root.style.width = '100%';
  root.style.background = OVERRIDE.bgColor || '';
  document.body.style.setProperty('--foreground-start', OVERRIDE.foregroundStart || '#000000');
  document.body.style.setProperty('--foreground-end', OVERRIDE.foregroundEnd || OVERRIDE.foregroundStart || '#000000');
  var bgKey = 'background:' + (OVERRIDE.bgImage || '');
  if (OVERRIDE.bgImage && ASSETS[bgKey]) {
    root.style.backgroundImage = 'url(' + ASSETS[bgKey] + ')';
    root.style.backgroundSize = '100% 100%';
  }
  pick.forEach(function (n) { root.appendChild(buildNode(n)); });
  fitText(root);
  } catch (e) {}
})();
