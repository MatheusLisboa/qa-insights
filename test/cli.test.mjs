import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

const CLI = new URL('../src/cli.mjs', import.meta.url).pathname;
const SAMPLE = new URL('../data/sample/playwright-report.json', import.meta.url).pathname;
const SAMPLE_HISTORY = new URL('../data/sample/history', import.meta.url).pathname;

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
    assert.match(r.stdout, /Uso:/);
    assert.match(r.stdout, /qa-insights ingest/);
  });

  it('sem arquivo: erro e código 1', () => {
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /informe um relatório ou --history/);
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

  it('mais de um relatório é recusado', () => {
    const r = run(SAMPLE, SAMPLE);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no máximo um arquivo/);
  });

  it('--history sem relatório usa a última execução e inclui a análise de instabilidade', () => {
    const out = join(dir, 'hist', 'p.html');
    const r = run('--history', SAMPLE_HISTORY, '--out', out);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Histórico: 20 execuções, 4 instáveis, 2 falhas persistentes/);
    const html = readFileSync(out, 'utf8');
    assert.ok(html.includes('Instabilidade nas últimas 20 execuções'));
    assert.ok(html.includes('histórico (30 execuções)'));
  });

  it('relatório + --history: mostra o relatório dado e a análise do histórico', () => {
    const out = join(dir, 'ambos.html');
    const r = run(SAMPLE, '--history', SAMPLE_HISTORY, '--window', '10', '--out', out);
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(out, 'utf8');
    assert.ok(html.includes('Origem: playwright-report.json'));
    assert.ok(html.includes('Instabilidade nas últimas 10 execuções'));
  });

  it('sem --history, a página não tem a seção de instabilidade', () => {
    const out = join(dir, 'sem-hist.html');
    assert.equal(run(SAMPLE, '--out', out).status, 0);
    assert.ok(!readFileSync(out, 'utf8').includes('Instabilidade nas últimas'));
  });

  it('--history inexistente, vazio ou corrompido: erro claro e código 1', () => {
    const inexistente = run('--history', join(dir, 'nao-existe'));
    assert.equal(inexistente.status, 1);
    assert.match(inexistente.stderr, /não encontrada/);

    const vazio = join(dir, 'vazio');
    mkdirSync(vazio);
    const rVazio = run('--history', vazio);
    assert.equal(rVazio.status, 1);
    assert.match(rVazio.stderr, /está vazio/);

    const ruim = join(dir, 'ruim');
    mkdirSync(ruim);
    writeFileSync(join(ruim, 'a.json'), 'quebrado');
    const rRuim = run('--history', ruim);
    assert.equal(rRuim.status, 1);
    assert.match(rRuim.stderr, /a\.json: não é um JSON válido/);
  });

  it('--window inválido é recusado', () => {
    for (const valor of ['0', '-1', 'x', '2.5']) {
      const r = run('--history', SAMPLE_HISTORY, '--window', valor, '--out', join(dir, 'w.html'));
      assert.equal(r.status, 1, `--window ${valor}`);
      assert.match(r.stderr, /--window/);
    }
  });
});

describe('cli ingest', () => {
  it('grava a execução e, ao repetir, não duplica', () => {
    const h = join(dir, 'ing');
    const first = run('ingest', SAMPLE, '--history', h, '--branch', 'main', '--commit', 'abc1234');
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /gravada em/);
    const second = run('ingest', SAMPLE, '--history', h);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /já estava no histórico/);
    assert.equal(readdirSync(h).length, 1);
    const rec = JSON.parse(readFileSync(join(h, readdirSync(h)[0]), 'utf8'));
    assert.equal(rec.branch, 'main');
    assert.equal(rec.commit, 'abc1234');
    assert.equal(rec.tests.length, 42);
  });

  it('--run-id explícito permite registrar o mesmo relatório como outra execução', () => {
    const h = join(dir, 'ing-id');
    run('ingest', SAMPLE, '--history', h, '--run-id', 'tentativa-1');
    run('ingest', SAMPLE, '--history', h, '--run-id', 'tentativa-2');
    assert.equal(readdirSync(h).length, 2);
  });

  it('exige --history', () => {
    const r = run('ingest', SAMPLE);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /exige --history/);
  });

  it('exige exatamente um relatório', () => {
    assert.equal(run('ingest', '--history', join(dir, 'x')).status, 1);
    assert.equal(run('ingest', SAMPLE, SAMPLE, '--history', join(dir, 'x')).status, 1);
  });

  it('recusa --run-id perigoso e não cria nada fora da pasta', () => {
    const h = join(dir, 'ing-seguro');
    const r = run('ingest', SAMPLE, '--history', h, '--run-id', '../../fora');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /id de execução inválido/);
    assert.ok(!existsSync(h) || readdirSync(h).length === 0);
  });

  it('relatório inválido é recusado sem gravar nada', () => {
    const h = join(dir, 'ing-invalido');
    const other = join(dir, 'outro2.json');
    writeFileSync(other, '{"hello":"world"}');
    const r = run('ingest', other, '--history', h);
    assert.equal(r.status, 1);
    assert.ok(!existsSync(h));
  });

  it('ingerir e depois gerar o dashboard só pelo histórico funciona de ponta a ponta', () => {
    const h = join(dir, 'ing-e2e');
    run('ingest', SAMPLE, '--history', h);
    const out = join(dir, 'e2e.html');
    const r = run('--history', h, '--out', out);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readFileSync(out, 'utf8').includes('O histórico tem apenas 1 execução'));
  });
});
