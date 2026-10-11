// 20-build: layout 树 → DOM
var buildNode = function (n) {
  var font = n.font ? CONFIG.fonts[n.font] : null;
  var css  = nodeStyle(n, font);
  var t = n.type;

  if (t === 'divider') {
    var d = EL('div', css);
    d.style.backgroundImage = 'linear-gradient(' + OVERRIDE.foregroundDirection + ',var(--foreground-start) ' + OVERRIDE.foregroundStop + ',var(--foreground-end))';
    return d;
  }
  if (t === 'image') {
    var box = EL('div', css); box.style.display = 'flex';
    var sourceId = n.src === 'leica' ? 'wm-leica-src' : 'wm-logo-src';
    var src = document.getElementById(sourceId);
    var svg = src ? src.innerHTML : '';
    if (svg) {
      box.innerHTML = svg;                           // SVG 内联（currentColor 跟随 css.color）
      var inner = box.querySelector('svg');           // 让 SVG 撑满容器（否则被自身 width/height 框死）
      if (inner) {
        inner.style.height = '100%'; inner.style.width = 'auto'; inner.setAttribute('height', '100%');
        var ns = 'http://www.w3.org/2000/svg', defs = document.createElementNS(ns, 'defs');
        var gradient = document.createElementNS(ns, 'linearGradient');
        var angle = (parseFloat(OVERRIDE.foregroundDirection) - 90) * Math.PI / 180;
        var dx = Math.cos(angle), dy = Math.sin(angle);
        gradient.setAttribute('id', 'cw-logo-gradient'); gradient.setAttribute('x1', (50 - dx * 50) + '%');
        gradient.setAttribute('y1', (50 - dy * 50) + '%'); gradient.setAttribute('x2', (50 + dx * 50) + '%'); gradient.setAttribute('y2', (50 + dy * 50) + '%');
        [[OVERRIDE.foregroundStop, OVERRIDE.foregroundStart], ['100%', OVERRIDE.foregroundEnd]].forEach(function (stop) {
          var s = document.createElementNS(ns, 'stop'); s.setAttribute('offset', stop[0]); s.setAttribute('stop-color', stop[1]); gradient.appendChild(s);
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
