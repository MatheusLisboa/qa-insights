import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

const CLI = new URL('../src/cli.mjs', import.meta.url).pathname;
const SAMPLE = new URL('../data/sample/playwright-report.json', import.meta.url).pathname;

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qa-insights-'));
});

const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

describe('cli', () => {
  it('gera o HTML e resume o resultado', () => {
    const out = join(dir, 'ok', 'pagina.html');
    const r = run(SAMPLE, '--out', out, '--title', 'Meu painel');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /42 testes, 3 falhas, 3 flaky, 2 ignorados/);
    assert.ok(existsSync(out), 'criou também a pasta de saída');
    const html = readFileSync(out, 'utf8');
    assert.ok(html.includes('<title>Meu painel</title>'));
    assert.ok(html.includes('92,5%'));
  });

  it('--help sai com 0', () => {
    const r = run('--help');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Uso: qa-insights/);
  });

  it('sem arquivo: erro e código 1', () => {
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /informe exatamente um arquivo/);
  });

  it('arquivo inexistente: mensagem clara e código 1', () => {
    const r = run(join(dir, 'nao-existe.json'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /não consegui ler/);
  });

  it('JSON inválido: mensagem clara e código 1', () => {
    const bad = join(dir, 'quebrado.json');
    writeFileSync(bad, '{ não é json');
    const r = run(bad);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /não é um JSON válido/);
  });

  it('JSON válido mas que não é do Playwright: explica como gerar o certo', () => {
    const other = join(dir, 'outro.json');
    writeFileSync(other, '{"hello":"world"}');
    const r = run(other);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--reporter=json/);
  });

  it('--slowest inválido é recusado', () => {
    for (const valor of ['0', '-3', 'abc']) {
      const r = run(SAMPLE, '--slowest', valor, '--out', join(dir, 'x.html'));
      assert.equal(r.status, 1, `--slowest ${valor}`);
      assert.match(r.stderr, /--slowest/);
    }
  });

  it('opção desconhecida é recusada', () => {
    const r = run(SAMPLE, '--nao-existe');
    assert.equal(r.status, 1);
  });
});
