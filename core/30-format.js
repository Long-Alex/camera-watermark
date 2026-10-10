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
  return d + '°' + m + "'" + s + '"' + hemi;
};
var fmtSpeed = function (x) {
  x = Number(x);
  if (!x || isNaN(x)) return '';
  if (x >= 1) return String(Math.round(x * 10) / 10);
  return '1/' + Math.round(1 / x);
};
var fmtNum = function (x, dec) { x = Number(x); return (x == null || isNaN(x)) ? '' : String(Number(x.toFixed(dec))); };
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
