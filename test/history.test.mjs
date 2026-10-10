import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { HistoryFormatError, loadHistory, runFileName, runIdFor, toRunRecord, writeRun } from '../src/history.mjs';
import { parseReport } from '../src/parse.mjs';
import { failing, flaky, passing, report, skipped } from './helpers.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'qa-history-'));
const parsedOf = (specs, stats) => parseReport(report(specs, stats));

function record(overrides = {}) {
  return {
    schema: 1,
    id: 'run1',
    startTime: '2026-10-01T10:00:00.000Z',
    branch: null,
    commit: null,
    wallMs: 1000,
    tests: [{ id: 't1', title: 'um', suite: 'G', file: 'a.spec.ts', project: 'chromium', status: 'passed' }],
    ...overrides,
  };
}

function put(dir, name, content) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
}

describe('runIdFor', () => {
  it('é determinístico, tem 12 hexadecimais e muda com o conteúdo', () => {
    assert.equal(runIdFor('abc'), runIdFor('abc'));
    assert.match(runIdFor('abc'), /^[0-9a-f]{12}$/);
    assert.notEqual(runIdFor('abc'), runIdFor('abd'));
  });
});

describe('toRunRecord', () => {
  it('guarda só os campos necessários e omite error nulo', () => {
    const rec = toRunRecord(parsedOf([passing('ok'), failing('quebrou', 'boom')]), { id: 'r1', branch: 'main', commit: 'abc123' });
    assert.equal(rec.schema, 1);
    assert.equal(rec.branch, 'main');
    assert.equal(rec.commit, 'abc123');
    assert.equal(rec.tests.length, 2);
    assert.ok(!('error' in rec.tests[0]));
    assert.equal(rec.tests[1].error, 'boom');
    assert.ok(!('line' in rec.tests[0]), 'não carrega campos que a análise não usa');
  });

  it('usa a hora injetada quando o relatório não tem startTime', () => {
    const parsed = { ...parsedOf([passing('a')]), startTime: null };
    const rec = toRunRecord(parsed, { id: 'r1', now: () => new Date('2026-01-02T03:04:05.000Z') });
    assert.equal(rec.startTime, '2026-01-02T03:04:05.000Z');
  });

  it('recusa ids que poderiam escapar da pasta ou ficar ilegíveis', () => {
    const parsed = parsedOf([passing('a')]);
    for (const id of ['', '../x', 'a/b', 'a b', 'x'.repeat(65), undefined, '..\\x']) {
      assert.throws(() => toRunRecord(parsed, { id }), HistoryFormatError, `deveria recusar ${JSON.stringify(id)}`);
    }
    assert.doesNotThrow(() => toRunRecord(parsed, { id: 'run-2026.10_01' }));
  });
});

describe('runFileName', () => {
  it('ordenar por nome é ordenar no tempo', () => {
    const a = runFileName(record({ id: 'zzz', startTime: '2026-10-01T10:00:00.000Z' }));
    const b = runFileName(record({ id: 'aaa', startTime: '2026-10-01T10:00:01.000Z' }));
    assert.ok(a < b);
  });
  it('não contém caracteres inválidos em nomes de arquivo', () => {
    assert.match(runFileName(record()), /^[A-Za-z0-9._-]+$/);
  });
});

describe('writeRun', () => {
  it('grava um arquivo por execução', () => {
    const dir = tmp();
    const res = writeRun(join(dir, 'novo', 'historico'), record());
    assert.equal(res.written, true);
    assert.equal(readdirSync(join(dir, 'novo', 'historico')).length, 1);
  });

  it('é idempotente: o mesmo id não duplica a execução', () => {
    const dir = tmp();
    assert.equal(writeRun(dir, record()).written, true);
    const again = writeRun(dir, record());
    assert.equal(again.written, false);
    assert.equal(readdirSync(dir).length, 1);
  });

  it('ids diferentes geram arquivos diferentes', () => {
    const dir = tmp();
    writeRun(dir, record({ id: 'a' }));
    writeRun(dir, record({ id: 'b' }));
    assert.equal(readdirSync(dir).length, 2);
  });

  it('um id que é sufixo de outro não é tratado como duplicado', () => {
    const dir = tmp();
    writeRun(dir, record({ id: 'abc' }));
    assert.equal(writeRun(dir, record({ id: 'bc' })).written, true);
  });

  it('o arquivo gravado volta idêntico na leitura', () => {
    const dir = tmp();
    const rec = toRunRecord(parsedOf([passing('a', 120), flaky('b'), skipped('c')]), { id: 'r1' });
    writeRun(dir, rec);
    assert.deepEqual(loadHistory(dir), [rec]);
  });
});

describe('loadHistory', () => {
  it('pasta vazia devolve lista vazia', () => {
    assert.deepEqual(loadHistory(tmp()), []);
  });

  it('ordena por data, não pelo nome do arquivo', () => {
    const dir = tmp();
    put(dir, 'a.json', record({ id: 'tarde', startTime: '2026-10-03T00:00:00.000Z' }));
    put(dir, 'b.json', record({ id: 'cedo', startTime: '2026-10-01T00:00:00.000Z' }));
    assert.deepEqual(loadHistory(dir).map((r) => r.id), ['cedo', 'tarde']);
  });

  it('descarta duplicatas pelo id', () => {
    const dir = tmp();
    put(dir, 'a.json', record({ id: 'x' }));
    put(dir, 'b.json', record({ id: 'x' }));
    assert.equal(loadHistory(dir).length, 1);
  });

  it('ignora arquivos que não são .json', () => {
    const dir = tmp();
    put(dir, 'LEIAME.md', '# oi');
    put(dir, 'a.json', record());
    assert.equal(loadHistory(dir).length, 1);
  });

  it('pasta inexistente é um erro explícito', () => {
    assert.throws(() => loadHistory(join(tmp(), 'nao-existe')), /não encontrada/);
  });

  it('um arquivo corrompido derruba a leitura e diz qual é', () => {
    const dir = tmp();
    put(dir, 'ok.json', record());
    put(dir, 'quebrado.json', '{ nao e json');
    assert.throws(() => loadHistory(dir), /quebrado\.json: não é um JSON válido/);
  });

  it('valida o conteúdo de cada execução', () => {
    const casos = [
      [{ schema: 2 }, /schema 2 não suportado/],
      [{ id: '../x' }, /"id"/],
      [{ startTime: 'ontem' }, /"startTime"/],
      [{ startTime: undefined }, /"startTime"/],
      [{ tests: 'x' }, /"tests"/],
      [{ tests: [{ id: 't', title: 'a', status: 'quebrado' }] }, /status desconhecido/],
      [{ tests: [{ title: 'a', status: 'passed' }] }, /sem "id"/],
      [{ tests: [null] }, /sem "id"/],
    ];
    for (const [override, esperado] of casos) {
      const dir = tmp();
      put(dir, 'x.json', record(override));
      assert.throws(() => loadHistory(dir), esperado, JSON.stringify(override));
    }
  });

  it('JSON que não é objeto é recusado', () => {
    const dir = tmp();
    put(dir, 'x.json', 'null');
    assert.throws(() => loadHistory(dir), /não é um objeto/);
  });

  it('o histórico de exemplo é válido: 30 execuções de 42 testes', () => {
    const runs = loadHistory(new URL('../data/sample/history', import.meta.url).pathname);
    assert.equal(runs.length, 30);
    assert.ok(runs.every((r) => r.tests.length === 42));
    // a última execução do histórico é o relatório de exemplo da Fase 1
    const sample = parseReport(JSON.parse(readFileSync(new URL('../data/sample/playwright-report.json', import.meta.url))));
    assert.deepEqual(
      runs.at(-1).tests.map((t) => [t.id, t.status, t.durationMs]),
      sample.tests.map((t) => [t.id, t.status, t.durationMs]),
    );
  });
});
