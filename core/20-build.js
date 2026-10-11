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
  var angle = (parseFloat(APP('foregroundDirection', '90deg')) - 90) * Math.PI / 180;
  var dx = Math.cos(angle), dy = Math.sin(angle);
  g.setAttribute('id', SVG_GRADIENT_ID);
  g.setAttribute('x1', (50 - dx * 50) + '%'); g.setAttribute('y1', (50 - dy * 50) + '%');
  g.setAttribute('x2', (50 + dx * 50) + '%'); g.setAttribute('y2', (50 + dy * 50) + '%');
  [[APP('foregroundStop', '0%'), APP('foregroundStart', '#000000')], ['100%', APP('foregroundEnd', '#000000')]]
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
    if (wantsPaint(shapes[i].getAttribute('stroke'))) shapes[i].setAttribute('stroke', 'url(#' + SVG_GRADIENT_ID + ')');
  }
};

var buildNode = function (n) {
  var font = FONT(n);
  var css  = nodeStyle(n, font);
  var t = n.type;

  if (t === 'divider') {                                  // 2dp × 64dp 色块（@foreground=1）
    var d = EL('div', css);
    d.style.backgroundImage = 'linear-gradient(' + APP('foregroundDirection', '90deg') + ',var(--foreground-start) ' +
                              APP('foregroundStop', '0%') + ',var(--foreground-end))';
    if (css.opacity == null) d.style.opacity = APP('lineOpacity', 1);   // @foreground=1 的 alpha
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
        inner.style.height = '100%'; inner.style.width = 'auto';
        inner.setAttribute('height', '100%'); inner.removeAttribute('width');
        if (!inner.getAttribute('viewBox') && !(inner.getAttribute('width') && inner.getAttribute('height'))) {
          box.style.width = DP(n.height || 0);            // 无 viewBox 的兜底：方形盒
        }
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
    return e;
  }

  var row = EL('div', css);                               // row / column
  row.setAttribute('data-id', n.id);
  (n.children || []).forEach(function (c) { row.appendChild(buildNode(c)); });
  return row;
};
