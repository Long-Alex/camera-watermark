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
  var bgKey = 'background:' + (OVERRIDE.bgImage || '');
  if (OVERRIDE.bgImage && ASSETS[bgKey]) {
    root.style.backgroundImage = 'url(' + ASSETS[bgKey] + ')';
    root.style.backgroundSize = '100% 100%';
  }
  pick.forEach(function (n) { root.appendChild(buildNode(n)); });
  fitText(root);
  } catch (e) {
    var box = document.getElementById('err');
    if (box) box.textContent = 'ERR: ' + e.message + ' | ' + (e.stack || '').split('\n').slice(0, 3).join(' <- ');
  }
})();
