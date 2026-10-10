import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeFlakiness } from '../src/flakiness.mjs';
import { computeMetrics } from '../src/metrics.mjs';
import { parseReport } from '../src/parse.mjs';
import { esc, fmtDate, fmtMs, fmtPct, fmtPct0, renderDashboard } from '../src/render.mjs';
import { failing, flaky, passing, report, skipped } from './helpers.mjs';

const htmlOf = (json, opts) => renderDashboard(computeMetrics(parseReport(json)), opts);

describe('formatação', () => {
  it('fmtMs: ms, segundos com vírgula, minutos', () => {
    assert.equal(fmtMs(320), '320 ms');
    assert.equal(fmtMs(9754), '9,8 s');
    assert.equal(fmtMs(30000), '30,0 s');
    assert.equal(fmtMs(90000), '1 min 30 s');
    assert.equal(fmtMs(null), '–');
  });
  it('fmtPct', () => {
    assert.equal(fmtPct(0.925), '92,5%');
    assert.equal(fmtPct(1), '100,0%');
    assert.equal(fmtPct(null), '–');
  });
  it('fmtDate não depende do fuso horário', () => {
    assert.equal(fmtDate('2026-10-08T14:00:00.000Z'), '08/10/2026 14:00 UTC');
    assert.equal(fmtDate(null), null);
    assert.equal(fmtDate('lixo'), null);
  });
});

describe('esc', () => {
  it('escapa os cinco caracteres perigosos', () => {
    assert.equal(esc(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
  it('trata null e undefined como vazio', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
  });
});

describe('renderDashboard', () => {
  it('escapa títulos e erros vindos do relatório (sem injeção de HTML)', () => {
    const ataque = '<img src=x onerror=alert(1)>"><script>alert(2)</script>';
    const html = htmlOf(report([passing(ataque), failing(ataque, ataque)]), { title: ataque, note: ataque });
    assert.ok(!html.includes('<img src=x'), 'tag <img> vazou sem escape');
    assert.ok(!html.includes('<script>alert'), 'tag <script> vazou sem escape');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  it('mostra os números principais', () => {
    const html = htmlOf(report([passing('a'), passing('b'), flaky('c'), failing('d'), skipped('e')]));
    assert.ok(html.includes('75,0%'), 'taxa de sucesso: (2 passaram + 1 flaky) de 4 executados');
    assert.ok(html.includes('de 5 no total'));
  });

  it('exibe o aviso e a origem quando informados', () => {
    const html = htmlOf(report([passing('a')]), { note: 'Dados sintéticos', source: 'relatorio.json' });
    assert.ok(html.includes('role="note"'));
    assert.ok(html.includes('Dados sintéticos'));
    assert.ok(html.includes('Origem: relatorio.json'));
  });

  it('sem aviso, não renderiza o bloco de aviso', () => {
    assert.ok(!htmlOf(report([passing('a')])).includes('role="note"'));
  });

  it('relatório sem testes mostra mensagem em vez de gráficos vazios', () => {
    const html = htmlOf({ suites: [] });
    assert.ok(html.includes('Nenhum teste encontrado'));
    assert.ok(!html.includes('Testes mais lentos'));
  });

  it('sem falhas nem flaky, diz isso explicitamente', () => {
    assert.ok(htmlOf(report([passing('a')])).includes('Nenhuma falha nem teste instável'));
  });

  it('é autocontido: sem recursos externos', () => {
    const html = htmlOf(report([passing('a')]));
    assert.ok(!/(src|href)="https?:/.test(html));
    assert.ok(!html.includes('@import'));
  });

  it('é determinístico: mesma entrada, mesma saída', () => {
    const json = report([passing('a'), flaky('b'), failing('c')]);
    assert.equal(htmlOf(json), htmlOf(json));
  });

  it('testes ignorados aparecem com traço, não com 0 ms', () => {
    const html = htmlOf(report([skipped('pulado')]));
    assert.ok(!html.includes('0 ms'));
  });
});

// ---- seção de histórico ----
const CODES = { p: 'passed', f: 'failed', x: 'flaky', s: 'skipped' };
function histRuns(tests) {
  const length = Math.max(...Object.values(tests).map((q) => q.length));
  return Array.from({ length }, (_, i) => ({
    id: `r${i}`,
    startTime: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
    tests: Object.entries(tests).map(([title, seq]) => ({
      id: title,
      title,
      suite: 'G',
      file: 'a.spec.ts',
      project: 'chromium',
      status: CODES[seq[i]],
    })),
  }));
}
const withHistory = (tests, opts) =>
  htmlOf(report([passing('a')]), { flakiness: computeFlakiness(histRuns(tests), opts) });

describe('renderDashboard: histórico', () => {
  it('sem flakiness, não há seção de instabilidade', () => {
    assert.ok(!htmlOf(report([passing('a')])).includes('Instabilidade nas últimas'));
  });

  it('lista instáveis e falhas persistentes com os números certos', () => {
    const html = withHistory({ 'oscila': 'pxpxppppxp', 'quebrou': 'pppppppfff', 'firme': 'pppppppppp' });
    assert.ok(html.includes('Instabilidade nas últimas 10 execuções'));
    assert.ok(html.includes('>Instável<') || html.includes('Instável</span>'));
    assert.ok(html.includes('Falha persistente'));
    assert.ok(html.includes('30%'), 'oscila: 3 flaky em 10');
    assert.ok(html.includes('falhas seguidas'));
    assert.ok(!html.includes('title="firme"'), 'teste estável não entra na lista de problemas');
  });

  it('cada execução vira uma célula da faixa, com rótulo acessível', () => {
    const html = withHistory({ oscila: 'pxpxppppxp' });
    assert.equal((html.match(/class="cell c-(passed|flaky|failed|skipped|none)"/g) ?? []).length, 10);
    assert.ok(html.includes('aria-label="Últimas 10 execuções: 7 passou, 3 flaky"'));
  });

  it('falhas e flaky têm símbolo na célula, não dependem só de cor', () => {
    const html = withHistory({ oscila: 'pxpxppppxp', quebrou: 'pppppppfff' });
    assert.ok(/class="cell c-flaky"[^>]*>!</.test(html));
    assert.ok(/class="cell c-failed"[^>]*>✕</.test(html));
  });

  it('histórico curto demais: explica em vez de mostrar números enganosos', () => {
    const html = withHistory({ t: 'pxp' });
    assert.ok(html.includes('O histórico tem apenas 3 execuções'));
    assert.ok(html.includes('pelo menos 5'));
  });

  it('um histórico de 1 execução usa o singular', () => {
    assert.ok(withHistory({ t: 'p' }).includes('apenas 1 execução.'));
  });

  it('sem nenhum problema, diz isso', () => {
    assert.ok(withHistory({ a: 'pppppppp', b: 'pppppppp' }).includes('Nenhum teste instável nem com falha persistente'));
  });

  it('títulos vindos do histórico são escapados', () => {
    const ataque = '<img src=x onerror=alert(1)>';
    const html = withHistory({ [ataque]: 'pxpxppppxp' });
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  it('limita a lista e avisa quando há mais', () => {
    const muitos = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`t${String(i).padStart(2, '0')}`, 'pxpxpppppp']));
    const html = withHistory(muitos);
    assert.ok(html.includes('Mostrando os 10 primeiros de 13'));
  });

  it('fmtPct0 arredonda para inteiro', () => {
    assert.equal(fmtPct0(0.4), '40%');
    assert.equal(fmtPct0(0.155), '16%');
    assert.equal(fmtPct0(null), '–');
  });
});
