import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseReport, ReportFormatError } from '../src/parse.mjs';
import { failing, flaky, passing, report, result, skipped, spec } from './helpers.mjs';

describe('parseReport', () => {
  it('achata suites aninhadas e guarda o caminho do describe', () => {
    const { tests } = parseReport(report([passing('a'), passing('b')]));
    assert.equal(tests.length, 2);
    assert.equal(tests[0].suite, 'Grupo');
    assert.equal(tests[0].file, 'a.spec.ts');
  });

  it('percorre describes dentro de describes', () => {
    const json = {
      suites: [
        {
          title: 'f.spec.ts',
          file: 'f.spec.ts',
          suites: [
            { title: 'A', suites: [{ title: 'B', specs: [passing('profundo')], suites: [] }] },
          ],
        },
      ],
    };
    const { tests } = parseReport(json);
    assert.equal(tests[0].suite, 'A › B');
  });

  it('mapeia os status do Playwright para passed, failed, flaky e skipped', () => {
    const { tests } = parseReport(report([passing('p'), failing('f'), flaky('x'), skipped('s')]));
    assert.deepEqual(
      tests.map((t) => t.status),
      ['passed', 'failed', 'flaky', 'skipped'],
    );
  });

  it('deduz o status pelas tentativas quando test.status não existe', () => {
    const semStatus = report([
      spec('verde', { results: [result('passed')] }),
      spec('verde no retry', { results: [result('failed'), result('passed', 100, 1)] }),
      spec('vermelho', { results: [result('failed'), result('timedOut', 100, 1)] }),
      spec('ignorado', { results: [result('skipped', 0)] }),
      spec('sem tentativas', { results: [] }),
    ]);
    assert.deepEqual(
      parseReport(semStatus).tests.map((t) => t.status),
      ['passed', 'flaky', 'failed', 'skipped', 'skipped'],
    );
  });

  it('usa a duração da última tentativa e soma o total das tentativas', () => {
    const s = spec('lento', {
      status: 'flaky',
      results: [result('failed', 300), result('passed', 120, 1)],
    });
    const [t] = parseReport(report([s])).tests;
    assert.equal(t.durationMs, 120);
    assert.equal(t.totalMs, 420);
    assert.equal(t.attempts, 2);
  });

  it('testes ignorados têm duração 0 e nenhuma tentativa', () => {
    const [t] = parseReport(report([skipped('s')])).tests;
    assert.equal(t.durationMs, 0);
    assert.equal(t.attempts, 0);
    assert.equal(t.error, null);
  });

  it('ignorado com duração residual do Playwright continua contando como 0 ms', () => {
    const s = spec('pulado', { status: 'skipped', results: [result('skipped', 37)] });
    const [t] = parseReport(report([s])).tests;
    assert.equal(t.durationMs, 0);
  });

  it('guarda só a primeira linha do erro e remove códigos ANSI', () => {
    const msg = '\u001b[31mExpected: 1\u001b[39m\nReceived: 2\n   at x.ts:1';
    const [t] = parseReport(report([failing('erro', msg)])).tests;
    assert.equal(t.error, 'Expected: 1');
  });

  it('um teste que passou não carrega erro', () => {
    const [t] = parseReport(report([passing('ok')])).tests;
    assert.equal(t.error, null);
  });

  it('gera ids diferentes para o mesmo spec rodando em projetos diferentes', () => {
    const a = passing('mesmo', 100, { project: 'chromium', id: 'abc' });
    const b = passing('mesmo', 100, { project: 'firefox', id: 'abc' });
    const ids = parseReport(report([a, b])).tests.map((t) => t.id);
    assert.equal(new Set(ids).size, 2);
  });

  it('aceita um relatório sem testes', () => {
    const { tests } = parseReport({ suites: [] });
    assert.deepEqual(tests, []);
  });

  it('lê startTime e duração total de stats', () => {
    const parsed = parseReport(report([passing('a')], { duration: 4242 }));
    assert.equal(parsed.wallMs, 4242);
    assert.equal(parsed.startTime, '2026-10-08T14:00:00.000Z');
  });

  it('rejeita entradas que não são um relatório do Playwright', () => {
    for (const bad of [null, undefined, 42, 'texto', [], {}, { suites: 'x' }, { suites: {} }]) {
      assert.throws(() => parseReport(bad), ReportFormatError, `deveria rejeitar ${JSON.stringify(bad)}`);
    }
  });

  it('lê o relatório de exemplo inteiro: 42 testes', () => {
    const json = JSON.parse(readFileSync(new URL('../data/sample/playwright-report.json', import.meta.url)));
    assert.equal(parseReport(json).tests.length, 42);
  });
});
