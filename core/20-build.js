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
