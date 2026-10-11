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
