// Gráfico de linhas em SVG, como função PURA.
//
// IMPORTANTE: esta função precisa ser totalmente autocontida (sem imports, sem
// variáveis de fora, sem sintaxe que dependa de transpilação), porque o dashboard
// injeta o código-fonte dela na página (buildLineChartSvg.toString()) para redesenhar
// o gráfico na largura real da tela. Há um teste que a executa num contexto vazio
// para garantir que isso continua verdadeiro.
//
// spec:
//   width, height   tamanho em pixels
//   format          'pct' (valores são razões 0..1) ou 'ms' (milissegundos)
//   series          [{ name, color, area, values: (número|null)[] }]
//   labels          texto do eixo X por execução (usa o primeiro, o último e o do meio)
//   tips            texto do tooltip por execução (linhas separadas por \n)
//   ariaLabel       descrição do gráfico para leitores de tela

export function buildLineChartSvg(spec) {
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var r2 = function (v) {
    return String(Math.round(v * 100) / 100);
  };
  var comma = function (v, d) {
    return v.toFixed(d).replace('.', ',');
  };

  var series = spec.series || [];
  var labels = spec.labels || [];
  var tips = spec.tips || [];
  var n = labels.length;
  var W = Math.max(240, Math.round(spec.width || 640));
  var H = Math.max(120, Math.round(spec.height || 220));
  var pct = spec.format === 'pct';
  var aria = esc(spec.ariaLabel || '');

  // Maior valor bruto, para escolher a unidade (ms ou s) e a escala.
  var rawMax = -Infinity;
  var rawMin = Infinity;
  series.forEach(function (s) {
    s.values.forEach(function (v) {
      if (typeof v === 'number' && isFinite(v)) {
        rawMax = Math.max(rawMax, v);
        rawMin = Math.min(rawMin, v);
      }
    });
  });

  if (n === 0 || rawMax === -Infinity) {
    return (
      '<svg class="lc" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + aria + '">' +
      '<text class="ax" x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle">Sem dados</text></svg>'
    );
  }

  var inSeconds = !pct && rawMax >= 2000;
  var mult = pct ? 100 : inSeconds ? 0.001 : 1;
  var unit = pct ? '%' : inSeconds ? ' s' : ' ms';

  var data = series.map(function (s) {
    return s.values.map(function (v) {
      return typeof v === 'number' && isFinite(v) ? v * mult : null;
    });
  });

  // ---- domínio do eixo Y ----
  var lo = rawMin * mult;
  var hi = rawMax * mult;
  var span = hi - lo;
  var pad = span === 0 ? Math.abs(hi) * 0.1 || 1 : span * 0.15;
  // Taxas usam eixo ajustado aos dados; durações têm zero real, então a base é zero
  // (importante para a área preenchida não exagerar as variações).
  lo = pct ? Math.max(0, lo - pad) : 0;
  hi = hi + pad;
  if (pct) hi = Math.min(100, hi);
  var raw = (hi - lo) / 4;
  var p10 = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var f = raw / p10;
  var step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p10;
  if (!pct && !inSeconds && step < 1) step = 1;
  lo = Math.floor(lo / step + 1e-9) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  if (pct && hi > 100) hi = 100;
  if (hi === lo) hi = lo + step;

  var decimals = 0;
  while (decimals < 4 && Math.abs(step * Math.pow(10, decimals) - Math.round(step * Math.pow(10, decimals))) > 1e-6) decimals += 1;

  var fmtValue = function (v) {
    // v já está em unidade de exibição
    if (pct) return comma(v, 1) + '%';
    if (inSeconds) return comma(v, 1) + ' s';
    return Math.round(v) + ' ms';
  };

  // ---- geometria ----
  var top = 14;
  var bottom = 26;
  var left = 46;
  var plotH = H - top - bottom;
  var yOf = function (v) {
    return top + ((hi - v) / (hi - lo)) * plotH;
  };

  // Rótulo direto no fim de cada linha, só se as pontas não colidirem.
  var ends = data.map(function (vals, si) {
    for (var i = vals.length - 1; i >= 0; i -= 1) if (vals[i] !== null) return { si: si, i: i, v: vals[i], y: yOf(vals[i]) };
    return null;
  });
  var live = ends.filter(function (e) {
    return e !== null;
  });
  var labelsOn = live.length > 0;
  for (var a = 0; a < live.length; a += 1) {
    for (var b = a + 1; b < live.length; b += 1) if (Math.abs(live[a].y - live[b].y) < 16) labelsOn = false;
  }
  var right = labelsOn ? 54 : 14;
  var padX = 8;
  var x0 = left + padX;
  var x1 = W - right - padX;
  var colStep = n === 1 ? x1 - x0 : (x1 - x0) / (n - 1);
  var xOf = function (i) {
    return n === 1 ? (x0 + x1) / 2 : x0 + i * colStep;
  };

  var out = [];
  out.push('<svg class="lc" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + aria + '">');

  // grade e rótulos do eixo Y
  var first = Math.ceil(lo / step - 1e-9);
  var last = Math.floor(hi / step + 1e-9);
  for (var k = first; k <= last; k += 1) {
    var tv = k * step;
    var ty = yOf(tv);
    out.push('<line class="gl" x1="' + left + '" x2="' + (W - right) + '" y1="' + r2(ty) + '" y2="' + r2(ty) + '"/>');
    out.push('<text class="ax" x="' + (left - 8) + '" y="' + r2(ty) + '" dy="0.32em" text-anchor="end">' + esc(comma(tv, decimals) + (pct ? '%' : unit)) + '</text>');
  }
  out.push('<line class="axis" x1="' + left + '" x2="' + (W - right) + '" y1="' + (top + plotH) + '" y2="' + (top + plotH) + '"/>');

  // rótulos do eixo X: primeiro, último e (se couber) o do meio
  var xl = function (i, anchor) {
    out.push('<text class="ax" x="' + r2(xOf(i)) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + esc(labels[i]) + '</text>');
  };
  xl(0, n === 1 ? 'middle' : 'start');
  if (n > 1) xl(n - 1, 'end');
  if (n >= 7 && W >= 480) xl(Math.floor((n - 1) / 2), 'middle');

  // áreas, linhas e marcadores finais
  series.forEach(function (s, si) {
    var color = esc(s.color || 'currentColor');
    var segments = [];
    var cur = [];
    data[si].forEach(function (v, i) {
      if (v === null) {
        if (cur.length) segments.push(cur);
        cur = [];
      } else {
        cur.push({ x: xOf(i), y: yOf(v) });
      }
    });
    if (cur.length) segments.push(cur);

    segments.forEach(function (seg) {
      if (seg.length === 1) {
        out.push('<circle cx="' + r2(seg[0].x) + '" cy="' + r2(seg[0].y) + '" r="3" style="fill:' + color + '"/>');
        return;
      }
      var d = seg
        .map(function (p, i) {
          return (i === 0 ? 'M' : 'L') + r2(p.x) + ' ' + r2(p.y);
        })
        .join(' ');
      if (s.area) {
        var base = top + plotH;
        out.push('<path d="' + d + ' L' + r2(seg[seg.length - 1].x) + ' ' + base + ' L' + r2(seg[0].x) + ' ' + base + ' Z" style="fill:' + color + ';opacity:0.1"/>');
      }
      out.push('<path d="' + d + '" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke:' + color + '"/>');
    });

    var e = ends[si];
    if (e) {
      out.push('<circle class="end" cx="' + r2(xOf(e.i)) + '" cy="' + r2(e.y) + '" r="4" style="fill:' + color + '"/>');
      if (labelsOn) {
        out.push('<text class="dl" x="' + r2(xOf(e.i) + 10) + '" y="' + r2(e.y) + '" dy="0.32em">' + esc(fmtValue(e.v)) + '</text>');
      }
    }
  });

  // colunas de interação: uma por execução, com linha-guia e marcadores no hover
  for (var i = 0; i < n; i += 1) {
    var cx = xOf(i);
    var tip = tips[i] ? ' data-tip="' + esc(tips[i]) + '"' : '';
    out.push('<g class="col"><rect class="hit" x="' + r2(cx - colStep / 2) + '" y="' + top + '" width="' + r2(colStep) + '" height="' + plotH + '"' + tip + '/>');
    out.push('<line class="xhair" x1="' + r2(cx) + '" x2="' + r2(cx) + '" y1="' + top + '" y2="' + (top + plotH) + '"/>');
    series.forEach(function (s, si) {
      var v = data[si][i];
      if (v !== null) out.push('<circle class="hm" cx="' + r2(cx) + '" cy="' + r2(yOf(v)) + '" r="4" style="fill:' + esc(s.color || 'currentColor') + '"/>');
    });
    out.push('</g>');
  }

  out.push('</svg>');
  return out.join('');
}
