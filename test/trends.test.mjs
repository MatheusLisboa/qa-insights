import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeMetrics } from '../src/metrics.mjs';
import { computeTrends, lastChange } from '../src/trends.mjs';
import { loadHistory } from '../src/history.mjs';

const SAMPLE_HISTORY = new URL('../data/sample/history', import.meta.url).pathname;

const test = (id, status, durationMs = 100) => ({ id, title: id, suite: '', file: 'f', project: 'p', status, durationMs, attempts: 1 });
const run = (i, tests, wallMs = 1000 * (i + 1)) => ({
  id: `r${i}`,
  startTime: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
  wallMs,
  tests,
});

describe('computeTrends', () => {
  const runs = [
    run(0, [test('a', 'passed', 100), test('b', 'failed', 300)]),
    run(1, [test('a', 'passed', 200), test('b', 'flaky', 400)]),
    run(2, [test('a', 'skipped', 0), test('b', 'skipped', 0)]),
  ];

  it('gera um ponto por execução, em ordem, com os números certos', () => {
    const { points } = computeTrends(runs);
    assert.deepEqual(points.map((p) => p.id), ['r0', 'r1', 'r2']);
    assert.equal(points[0].passRate, 0.5);
    assert.equal(points[0].firstAttemptRate, 0.5);
    assert.equal(points[1].passRate, 1);
    assert.equal(points[1].firstAttemptRate, 0.5, 'flaky não conta como sucesso na primeira tentativa');
    assert.equal(points[0].wallMs, 1000);
    assert.equal(points[0].failed, 1);
    assert.equal(points[1].flaky, 1);
  });

  it('usa exatamente a mesma definição de métricas do dashboard', () => {
    for (const r of runs) {
      const m = computeMetrics({ tests: r.tests, startTime: r.startTime, wallMs: r.wallMs });
      const p = computeTrends([r]).points[0];
      assert.equal(p.passRate, m.totals.passRate);
      assert.equal(p.p95Ms, m.duration.p95Ms);
      assert.equal(p.meanMs, m.duration.meanMs);
    }
  });

  it('execução só com testes ignorados tem taxa e duração nulas, não zero', () => {
    const p = computeTrends(runs).points[2];
    assert.equal(p.passRate, null);
    assert.equal(p.firstAttemptRate, null);
    assert.equal(p.p95Ms, null);
  });

  it('execução sem wallMs fica com duração nula', () => {
    const p = computeTrends([run(0, [test('a', 'passed')], undefined)]).points[0];
    assert.equal(p.wallMs, null === p.wallMs ? null : p.wallMs);
    const semWall = { ...run(0, [test('a', 'passed')]), wallMs: undefined };
    assert.equal(computeTrends([semWall]).points[0].wallMs, null);
  });

  it('respeita a janela usando as execuções mais recentes', () => {
    const many = Array.from({ length: 10 }, (_, i) => run(i, [test('a', 'passed')]));
    const { points, window } = computeTrends(many, { window: 4 });
    assert.equal(window, 4);
    assert.deepEqual(points.map((p) => p.id), ['r6', 'r7', 'r8', 'r9']);
  });

  it('histórico vazio devolve série vazia', () => {
    assert.deepEqual(computeTrends([]).points, []);
  });

  it('histórico de exemplo: 20 pontos e a última execução bate com o relatório de exemplo', () => {
    const { points } = computeTrends(loadHistory(SAMPLE_HISTORY));
    assert.equal(points.length, 20);
    const last = points.at(-1);
    assert.equal(last.passRate, 37 / 40);
    assert.equal(last.firstAttemptRate, 34 / 40);
    assert.equal(last.failed, 3);
  });
});

describe('lastChange', () => {
  const pts = [{ v: 0.8 }, { v: 0.9 }, { v: 0.85 }];

  it('devolve a última, a anterior e a diferença', () => {
    const c = lastChange(pts, 'v');
    assert.equal(c.last, 0.85);
    assert.equal(c.previous, 0.9);
    assert.ok(Math.abs(c.delta - -0.05) < 1e-12);
  });

  it('pula pontos sem valor ao procurar a anterior', () => {
    const c = lastChange([{ v: 1 }, { v: null }, { v: 3 }], 'v');
    assert.deepEqual(c, { last: 3, previous: 1, delta: 2 });
  });

  it('com menos de dois valores não há variação para mostrar', () => {
    assert.equal(lastChange([{ v: 1 }], 'v'), null);
    assert.equal(lastChange([{ v: null }, { v: 2 }], 'v'), null);
    assert.equal(lastChange([], 'v'), null);
  });
});
