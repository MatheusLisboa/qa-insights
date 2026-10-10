import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { computeMetrics } from '../src/metrics.mjs';
import { fmtDelta, jsonForScript, renderDashboard } from '../src/render.mjs';
import { computeTrends } from '../src/trends.mjs';

const mk = (id, status, durationMs = 100) => ({ id, title: id, suite: '', file: 'f', project: 'p', status, durationMs, attempts: 1 });
const run = (i, outcomes) => ({
  id: `r${i}`,
  startTime: `2026-10-0${i}T10:00:00.000Z`,
  wallMs: 1000 * i,
  tests: outcomes.map((o, k) => mk(`t${k}`, o, 100 + k * 50)),
});

function html(runs) {
  const last = runs[runs.length - 1];
  const metrics = computeMetrics({ tests: last.tests, startTime: last.startTime, wallMs: last.wallMs });
  return renderDashboard(metrics, { trends: computeTrends(runs) });
}

describe('fmtDelta', () => {
  it('pontos percentuais com sinal e vírgula', () => {
    assert.equal(fmtDelta({ delta: 0.05 }, 'pct'), '+5,0 p.p.');
    assert.equal(fmtDelta({ delta: -0.0123 }, 'pct'), '−1,2 p.p.');
    assert.equal(fmtDelta({ delta: 0 }, 'pct'), 'sem variação');
    assert.equal(fmtDelta({ delta: -2500 }, 'ms'), '−2,5 s');
    assert.equal(fmtDelta(null, 'pct'), '');
  });
});

describe('jsonForScript', () => {
  it('não deixa fechar a tag nem quebrar o parser', () => {
    const out = jsonForScript({ a: '</script><b>&', b: String.fromCharCode(0x2028) });
    assert.ok(!out.includes('<') && !out.includes('>') && !out.includes('&'));
    assert.ok(!out.includes(String.fromCharCode(0x2028)));
    assert.deepEqual(JSON.parse(out), { a: '</script><b>&', b: String.fromCharCode(0x2028) });
  });
});

describe('seção de tendência', () => {
  it('sem histórico, não aparece', () => {
    const r = run(1, ['passed']);
    const m = computeMetrics({ tests: r.tests, startTime: r.startTime, wallMs: r.wallMs });
    assert.ok(!renderDashboard(m).includes('Tendência'));
  });

  it('com uma só execução, explica que faltam dados', () => {
    const out = html([run(1, ['passed'])]);
    assert.match(out, /pelo menos 2 execuções/);
    assert.ok(!out.includes('id="chart-data"'));
  });

  it('com várias execuções, tem gráficos, tabela gêmea e dados embutidos', () => {
    const out = html([run(1, ['passed', 'passed']), run(2, ['passed', 'failed']), run(3, ['passed', 'passed'])]);
    assert.match(out, /Tendência nas últimas 3 execuções/);
    for (const id of ['chart-pass', 'chart-p95', 'chart-wall']) assert.ok(out.includes(`id="${id}"`), id);
    assert.match(out, /<svg class="lc"/);
    assert.match(out, /Ver os dados como tabela/);
    const m = out.match(/<script type="application\/json" id="chart-data">([\s\S]*?)<\/script>/);
    assert.ok(m);
    assert.equal(JSON.parse(m[1]).length >= 3, true);
  });

  it('resumo mostra a variação em relação à execução anterior', () => {
    const out = html([run(1, ['passed', 'passed']), run(2, ['passed', 'failed'])]);
    assert.match(out, /50,0%/);
    assert.match(out, /−50,0 p\.p\./);
  });

  it('é determinístico', () => {
    const runs = [run(1, ['passed']), run(2, ['failed'])];
    assert.equal(html(runs), html(runs));
  });
});

describe('CLI: dashboard com histórico', () => {
  it('o exemplo embutido gera a seção de tendência', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'qa-')), 'o.html');
    execFileSync('node', ['src/cli.mjs', '--history', 'data/sample/history', '--out', out], { stdio: 'pipe' });
    const page = readFileSync(out, 'utf8');
    assert.match(page, /Tendência nas últimas 20 execuções/);
  });
});
