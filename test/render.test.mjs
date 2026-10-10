import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeMetrics } from '../src/metrics.mjs';
import { parseReport } from '../src/parse.mjs';
import { esc, fmtDate, fmtMs, fmtPct, renderDashboard } from '../src/render.mjs';
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
