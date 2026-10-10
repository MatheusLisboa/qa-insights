import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { computeMetrics, median, percentile } from '../src/metrics.mjs';
import { parseReport } from '../src/parse.mjs';
import { failing, flaky, passing, report, skipped } from './helpers.mjs';

const metricsOf = (json, opts) => computeMetrics(parseReport(json), opts);

describe('percentile (nearest-rank)', () => {
  const dez = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it('calcula p50, p95 e p100', () => {
    assert.equal(percentile(dez, 50), 5);
    assert.equal(percentile(dez, 95), 10);
    assert.equal(percentile(dez, 100), 10);
  });
  it('não depende da ordem de entrada e não altera o array', () => {
    const embaralhado = [9, 1, 5, 3];
    assert.equal(percentile(embaralhado, 50), 3);
    assert.deepEqual(embaralhado, [9, 1, 5, 3]);
  });
  it('funciona com um único valor e devolve null para lista vazia', () => {
    assert.equal(percentile([7], 95), 7);
    assert.equal(percentile([], 95), null);
  });
  it('p0 devolve o menor valor', () => {
    assert.equal(percentile(dez, 0), 1);
  });
});

describe('median', () => {
  it('quantidade ímpar e par', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });
  it('lista vazia', () => assert.equal(median([]), null));
});

describe('computeMetrics', () => {
  it('conta flaky como sucesso na taxa e fora dela na primeira tentativa', () => {
    const m = metricsOf(report([passing('a'), passing('b'), flaky('c'), failing('d')]));
    assert.equal(m.totals.executed, 4);
    assert.equal(m.totals.passRate, 3 / 4);
    assert.equal(m.firstAttemptRate, 2 / 4);
  });

  it('ignorados ficam fora do denominador', () => {
    const m = metricsOf(report([passing('a'), skipped('b'), skipped('c')]));
    assert.equal(m.totals.total, 3);
    assert.equal(m.totals.executed, 1);
    assert.equal(m.totals.passRate, 1);
  });

  it('só ignorados: taxa é null, não NaN nem 100%', () => {
    const m = metricsOf(report([skipped('a')]));
    assert.equal(m.totals.passRate, null);
    assert.equal(m.firstAttemptRate, null);
    assert.equal(m.duration.p95Ms, null);
    assert.equal(m.duration.maxMs, null);
  });

  it('relatório vazio não quebra', () => {
    const m = metricsOf({ suites: [] });
    assert.equal(m.totals.total, 0);
    assert.equal(m.totals.passRate, null);
    assert.deepEqual(m.slowest, []);
    assert.deepEqual(m.bySuite, []);
  });

  it('estatísticas de duração ignoram testes ignorados', () => {
    const m = metricsOf(report([passing('a', 100), passing('b', 300), skipped('c')]));
    assert.equal(m.duration.meanMs, 200);
    assert.equal(m.duration.medianMs, 200);
    assert.equal(m.duration.maxMs, 300);
  });

  it('lista os mais lentos em ordem decrescente, sem ignorados, respeitando o limite', () => {
    const m = metricsOf(
      report([passing('rapido', 10), passing('medio', 50), passing('lento', 90), skipped('zero')]),
      { slowest: 2 },
    );
    assert.deepEqual(
      m.slowest.map((t) => t.title),
      ['lento', 'medio'],
    );
  });

  it('desempata duração igual de forma estável pelo id', () => {
    const m = metricsOf(report([passing('b', 50), passing('a', 50)]));
    assert.deepEqual(
      m.slowest.map((t) => t.title),
      ['a', 'b'],
    );
  });

  it('agrupa por arquivo e ordena a pior suíte primeiro, com suíte sem execução no fim', () => {
    const m = metricsOf(
      report({
        'boa.spec.ts': [passing('a'), passing('b')],
        'ruim.spec.ts': [passing('c'), failing('d')],
        'vazia.spec.ts': [skipped('e')],
      }),
    );
    assert.deepEqual(
      m.bySuite.map((s) => [s.name, s.passRate]),
      [
        ['ruim.spec.ts', 0.5],
        ['boa.spec.ts', 1],
        ['vazia.spec.ts', null],
      ],
    );
  });

  it('separa falhas e flaky', () => {
    const m = metricsOf(report([passing('a'), failing('b'), flaky('c')]));
    assert.deepEqual(m.failures.map((t) => t.title), ['b']);
    assert.deepEqual(m.flaky.map((t) => t.title), ['c']);
  });

  it('relatório de exemplo: números de referência (teste de regressão)', () => {
    const json = JSON.parse(readFileSync(new URL('../data/sample/playwright-report.json', import.meta.url)));
    const m = metricsOf(json);
    assert.deepEqual(
      [m.totals.total, m.totals.passed, m.totals.failed, m.totals.flaky, m.totals.skipped],
      [42, 34, 3, 3, 2],
    );
    assert.equal(m.totals.passRate, 37 / 40);
    assert.equal(m.firstAttemptRate, 34 / 40);
    assert.equal(m.slowest[0].title, 'emite confirmação por e-mail');
    assert.equal(m.bySuite[0].name, 'cart/cart.spec.ts');
  });
});
