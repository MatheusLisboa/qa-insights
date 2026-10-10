import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { describe, it } from 'node:test';
import { buildLineChartSvg } from '../src/chart.mjs';

const base = {
  width: 640,
  height: 220,
  format: 'pct',
  labels: ['01/10 00:00', '02/10 00:00', '03/10 00:00', '04/10 00:00', '05/10 00:00'],
  tips: ['t0', 't1', 't2', 't3', 't4'],
  ariaLabel: 'gráfico de teste',
  series: [{ name: 'A', color: 'var(--series-1)', values: [0.9, 0.92, 0.95, 0.93, 0.925] }],
};
const make = (over = {}) => buildLineChartSvg({ ...base, ...over });
const axisLabels = (svg) => [...svg.matchAll(/class="ax"[^>]*>([^<]*)</g)].map((m) => m[1]);
const count = (svg, re) => (svg.match(re) ?? []).length;

describe('buildLineChartSvg: estrutura', () => {
  it('gera um svg com viewBox, papel de imagem e descrição acessível', () => {
    const svg = make();
    assert.match(svg, /^<svg class="lc" viewBox="0 0 640 220" width="640" height="220" role="img" aria-label="gráfico de teste">/);
    assert.ok(svg.endsWith('</svg>'));
  });

  it('é determinístico', () => {
    assert.equal(make(), make());
  });

  it('largura mínima de 240 e altura mínima de 120', () => {
    assert.match(make({ width: 10, height: 10 }), /viewBox="0 0 240 120"/);
  });

  it('uma linha por série, com 2px de espessura e pontas arredondadas', () => {
    const svg = make({
      series: [
        { name: 'A', color: 'var(--series-1)', values: [0.9, 0.91, 0.92, 0.93, 0.94] },
        { name: 'B', color: 'var(--series-2)', values: [0.5, 0.52, 0.51, 0.53, 0.5] },
      ],
    });
    assert.equal(count(svg, /<path d="M[^"]*" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/g), 2);
  });

  it('marcador final com 4px de raio e anel da cor da superfície (classe .end)', () => {
    assert.equal(count(make(), /<circle class="end"[^>]* r="4"/g), 1);
  });

  it('área preenchida só quando pedida, a 10% de opacidade', () => {
    assert.equal(count(make(), /opacity:0\.1/g), 0);
    const comArea = make({ series: [{ ...base.series[0], area: true }] });
    assert.equal(count(comArea, /opacity:0\.1/g), 1);
  });

  it('valores nulos abrem lacunas em vez de ligar pontos distantes', () => {
    const svg = make({ series: [{ name: 'A', color: 'c', values: [0.9, 0.91, null, 0.8, 0.82] }] });
    assert.equal(count(svg, /<path d="M/g), 2, 'dois trechos');
  });

  it('um ponto isolado vira círculo, não uma linha de zero comprimento', () => {
    const svg = make({ series: [{ name: 'A', color: 'c', values: [0.9, null, 0.8, null, null] }] });
    assert.equal(count(svg, /<path d="M/g), 0);
    assert.equal(count(svg, /<circle [^>]*r="3"/g), 2);
  });
});

describe('buildLineChartSvg: casos de borda (nunca produz NaN, undefined ou Infinity)', () => {
  const casos = {
    'sem dados': { labels: [], tips: [], series: [] },
    'só nulos': { series: [{ name: 'A', color: 'c', values: [null, null, null, null, null] }] },
    'uma execução': { labels: ['x'], tips: ['t'], series: [{ name: 'A', color: 'c', values: [0.5] }] },
    'tudo 100%': { series: [{ name: 'A', color: 'c', values: [1, 1, 1, 1, 1] }] },
    'tudo 0%': { series: [{ name: 'A', color: 'c', values: [0, 0, 0, 0, 0] }] },
    'duração zero': { format: 'ms', series: [{ name: 'A', color: 'c', values: [0, 0, 0, 0, 0] }] },
    'duração pequena': { format: 'ms', series: [{ name: 'A', color: 'c', values: [120, 150, 90, 300, 200] }] },
    'duração enorme': { format: 'ms', series: [{ name: 'A', color: 'c', values: [1e9, 2e9, 1.5e9, 1e9, 3e9] }] },
    'valores não finitos': { series: [{ name: 'A', color: 'c', values: [0.9, Infinity, NaN, 0.8, undefined] }] },
    'sem tips': { tips: [] },
    'largura minúscula': { width: 1 },
    'muitas execuções': {
      labels: Array.from({ length: 200 }, (_, i) => `d${i}`),
      tips: [],
      series: [{ name: 'A', color: 'c', values: Array.from({ length: 200 }, (_, i) => 0.5 + (i % 7) / 20) }],
    },
  };
  for (const [nome, spec] of Object.entries(casos)) {
    it(nome, () => {
      const svg = make(spec);
      assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
      assert.ok(!/NaN|undefined|Infinity/.test(svg), `saída inválida: ${svg.match(/.{20}(NaN|undefined|Infinity).{20}/)?.[0]}`);
    });
  }

  it('sem dados mostra "Sem dados"', () => {
    assert.ok(make({ labels: [], tips: [], series: [] }).includes('Sem dados'));
  });
});

describe('buildLineChartSvg: eixo Y', () => {
  it('taxas nunca passam de 100% nem ficam abaixo de 0%', () => {
    for (const values of [[1, 1, 1, 1, 1], [0, 0.01, 0, 0, 0], [0.99, 1, 0.98, 1, 1]]) {
      const ticks = axisLabels(make({ series: [{ name: 'A', color: 'c', values }] })).filter((t) => t.endsWith('%'));
      assert.ok(ticks.length >= 2);
      for (const t of ticks) {
        const n = Number(t.replace('%', '').replace(',', '.'));
        assert.ok(n >= 0 && n <= 100, `tick fora do intervalo: ${t}`);
      }
    }
  });

  it('taxas usam eixo ajustado aos dados (não começam em zero)', () => {
    const ticks = axisLabels(make());
    assert.ok(!ticks.includes('0%'));
    assert.ok(ticks.includes('90%'));
  });

  it('durações sempre começam em zero', () => {
    const svg = make({ format: 'ms', series: [{ name: 'A', color: 'c', area: true, values: [50000, 52000, 49000, 51000, 53000] }] });
    assert.equal(axisLabels(svg)[0], '0 s');
  });

  it('usa segundos a partir de 2 s e milissegundos abaixo disso', () => {
    assert.ok(axisLabels(make({ format: 'ms', series: [{ name: 'A', color: 'c', values: [3000, 4000, 5000, 4000, 3500] }] })).some((t) => t.endsWith(' s')));
    const pequeno = axisLabels(make({ format: 'ms', series: [{ name: 'A', color: 'c', values: [300, 400, 500, 400, 350] }] }));
    assert.ok(pequeno.some((t) => t.endsWith(' ms')));
    assert.ok(!pequeno.some((t) => t.endsWith(' s')));
  });

  it('ticks usam vírgula decimal', () => {
    const svg = make({ format: 'ms', series: [{ name: 'A', color: 'c', values: [2100, 2300, 2500, 2400, 2200] }] });
    assert.ok(axisLabels(svg).some((t) => /^\d+,\d s$/.test(t)), axisLabels(svg).join('|'));
  });
});

describe('buildLineChartSvg: rótulos', () => {
  it('rótulo direto no fim da linha com o valor formatado', () => {
    assert.match(make(), /class="dl"[^>]*>92,5%</);
    assert.match(make({ format: 'ms', series: [{ name: 'A', color: 'c', values: [53000, 52000, 54000, 50000, 53548] }] }), /class="dl"[^>]*>53,5 s</);
  });

  it('com duas séries separadas, rotula as duas pontas', () => {
    const svg = make({
      series: [
        { name: 'A', color: 'c1', values: [0.9, 0.92, 0.95, 0.93, 0.95] },
        { name: 'B', color: 'c2', values: [0.5, 0.52, 0.51, 0.53, 0.5] },
      ],
    });
    assert.equal(count(svg, /class="dl"/g), 2);
  });

  it('com pontas coladas, não rotula (os rótulos se sobreporiam)', () => {
    const svg = make({
      series: [
        { name: 'A', color: 'c1', values: [0.9, 0.92, 0.95, 0.93, 0.95] },
        { name: 'B', color: 'c2', values: [0.9, 0.92, 0.95, 0.93, 0.949] },
      ],
    });
    assert.equal(count(svg, /class="dl"/g), 0);
  });

  it('eixo X: primeiro e último rótulos; o do meio só com 7+ execuções e largura >= 480', () => {
    assert.deepEqual(axisLabels(make()).filter((t) => t.includes('/')), ['01/10 00:00', '05/10 00:00']);
    const sete = {
      labels: ['a/1', 'b/2', 'c/3', 'd/4', 'e/5', 'f/6', 'g/7'],
      tips: [],
      series: [{ name: 'A', color: 'c', values: [0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96] }],
    };
    assert.deepEqual(axisLabels(make(sete)).filter((t) => t.includes('/')), ['a/1', 'g/7', 'd/4']);
    assert.deepEqual(axisLabels(make({ ...sete, width: 400 })).filter((t) => t.includes('/')), ['a/1', 'g/7']);
  });
});

describe('buildLineChartSvg: interação e segurança', () => {
  it('uma coluna de interação por execução, cada uma com seu tooltip', () => {
    const svg = make();
    assert.equal(count(svg, /<rect class="hit"/g), 5);
    assert.equal(count(svg, /data-tip="t\d"/g), 5);
    assert.equal(count(svg, /class="xhair"/g), 5);
  });

  it('marcadores de hover só onde há valor', () => {
    const svg = make({ series: [{ name: 'A', color: 'c', values: [0.9, null, 0.8, 0.85, null] }] });
    assert.equal(count(svg, /class="hm"/g), 3);
  });

  it('escapa tooltip, rótulos do eixo e descrição (nada de HTML injetado)', () => {
    const ataque = '"><script>alert(1)</script>';
    const svg = make({
      ariaLabel: ataque,
      labels: [ataque, 'b', 'c', 'd', ataque],
      tips: [ataque, ataque, ataque, ataque, ataque],
    });
    assert.ok(!svg.includes('<script>'));
    assert.ok(!svg.includes('"><script'), 'aspas não fecham atributos');
    assert.ok(!svg.includes('alert(1)</'), 'sem tag fechando');
    assert.ok(svg.includes('&lt;script&gt;'));
  });

  it('escapa a cor da série, que entra em atributo style', () => {
    const svg = make({ series: [{ name: 'A', color: '"><script>x</script>', values: [0.9, 0.9, 0.9, 0.9, 0.9] }] });
    assert.ok(!svg.includes('<script>'));
  });
});

describe('buildLineChartSvg: autocontida (é injetada na página)', () => {
  it('executa num contexto vazio e dá exatamente o mesmo resultado', () => {
    const isolada = runInNewContext(`(${buildLineChartSvg.toString()})`, {});
    for (const spec of [base, { ...base, format: 'ms', series: [{ name: 'A', color: 'c', area: true, values: [5000, 6000, null, 7000, 8000] }] }]) {
      assert.equal(isolada(spec), buildLineChartSvg(spec));
    }
  });

  it('o código-fonte não contém sequências que quebrariam um <script> inline', () => {
    const src = buildLineChartSvg.toString();
    assert.ok(!/<\/script/i.test(src));
    assert.ok(!src.includes('<!--'));
  });
});
