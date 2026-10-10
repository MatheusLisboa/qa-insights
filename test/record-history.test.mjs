// Testes do scripts/record-history.sh contra remotos Git LOCAIS (repositórios bare
// em pastas temporárias): nada aqui toca a rede nem um repositório real.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const SCRIPT = new URL('../scripts/record-history.sh', import.meta.url).pathname;
const SAMPLE = new URL('../data/sample/playwright-report.json', import.meta.url).pathname;

const available = ['git', 'bash'].every((bin) => spawnSync(bin, ['--version']).status === 0);

// Ambiente isolado: sem git config global/de sistema, ou seja, SEM identidade
// configurada, como num runner de CI recém-criado.
const baseEnv = (home) => ({
  PATH: process.env.PATH,
  HOME: home,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
});

function git(cwd, args, env, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} falhou:\n${r.stderr}`);
  return r;
}

// Cria: remoto bare + projeto clonado (opcionalmente raso) com um commit em main.
function scenario({ shallow = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'record-history-'));
  const env = baseEnv(base);
  const remote = join(base, 'remote.git');
  git(base, ['init', '--quiet', '--bare', '--initial-branch=main', remote], env);

  const seed = join(base, 'seed');
  git(base, ['clone', '--quiet', `file://${remote}`, seed], env, { allowFail: true });
  git(seed, ['checkout', '--quiet', '-B', 'main'], env);
  writeFileSync(join(seed, 'README.md'), '# projeto de teste\n');
  git(seed, ['add', '.'], env);
  git(seed, ['-c', 'user.name=Teste', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'inicial'], env);
  git(seed, ['push', '--quiet', 'origin', 'main'], env);

  const clone = (name) => {
    const dir = join(base, name);
    git(base, ['clone', '--quiet', ...(shallow ? ['--depth', '1'] : []), `file://${remote}`, dir], env);
    return dir;
  };
  return { base, env, remote, proj: clone('proj'), clone };
}

const record = (s, args, cwd = s.proj, extraEnv = {}) =>
  spawnSync('bash', [SCRIPT, ...args], { cwd, env: { ...s.env, ...extraEnv }, encoding: 'utf8' });

const remoteGit = (s, args) => git(s.remote, args, s.env, { allowFail: true });
const branchExists = (s, name = 'qa-history') => remoteGit(s, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).status === 0;
const commitCount = (s, name = 'qa-history') => Number(remoteGit(s, ['rev-list', '--count', name]).stdout.trim());
const filesOn = (s, name = 'qa-history') => remoteGit(s, ['ls-tree', '-r', '--name-only', name]).stdout.trim().split('\n').filter(Boolean);

// Uma segunda "execução": mesmo relatório com outro horário de início (outro id).
function variantReport(dir, startTime) {
  const json = JSON.parse(readFileSync(SAMPLE, 'utf8'));
  json.stats.startTime = startTime;
  const path = join(dir, `report-${startTime.replace(/[^0-9]/g, '')}.json`);
  writeFileSync(path, JSON.stringify(json));
  return path;
}

function installHook(s, body) {
  const hook = join(s.remote, 'hooks', 'pre-receive');
  mkdirSync(join(s.remote, 'hooks'), { recursive: true });
  writeFileSync(hook, `#!/bin/sh\n${body}\n`);
  chmodSync(hook, 0o755);
}

describe('record-history.sh', { skip: !available && 'git/bash indisponíveis' }, () => {
  it('primeira execução: cria o branch de histórico só com a pasta runs/', () => {
    const s = scenario();
    const r = record(s, [SAMPLE]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Execução registrada em origin\/qa-history/);
    assert.ok(branchExists(s));
    const files = filesOn(s);
    assert.equal(files.length, 1);
    assert.match(files[0], /^runs\/.+\.json$/);
    assert.ok(!files.includes('README.md'), 'arquivos do projeto não vazam para o branch de histórico');
  });

  it('grava os metadados da execução testada: branch e commit do projeto', () => {
    const s = scenario();
    record(s, [SAMPLE]);
    const file = filesOn(s)[0];
    const rec = JSON.parse(remoteGit(s, ['show', `qa-history:${file}`]).stdout);
    assert.equal(rec.branch, 'main');
    assert.equal(rec.commit, git(s.proj, ['rev-parse', 'HEAD'], s.env).stdout.trim());
    assert.equal(rec.tests.length, 42);
  });

  it('usa GITHUB_SHA e GITHUB_REF_NAME quando existem (como no Actions)', () => {
    const s = scenario();
    record(s, [SAMPLE], s.proj, { GITHUB_SHA: 'abc123def456', GITHUB_REF_NAME: 'feature/x' });
    const rec = JSON.parse(remoteGit(s, ['show', `qa-history:${filesOn(s)[0]}`]).stdout);
    assert.equal(rec.commit, 'abc123def456');
    assert.equal(rec.branch, 'feature/x');
  });

  it('funciona sem identidade Git configurada e assina como bot', () => {
    const s = scenario();
    assert.equal(record(s, [SAMPLE]).status, 0);
    assert.equal(remoteGit(s, ['log', '-1', '--format=%an', 'qa-history']).stdout.trim(), 'qa-insights[bot]');
  });

  it('funciona em clone raso, como o checkout padrão do Actions', () => {
    const s = scenario({ shallow: true });
    assert.equal(git(s.proj, ['rev-parse', '--is-shallow-repository'], s.env).stdout.trim(), 'true');
    const r = record(s, [SAMPLE]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(branchExists(s));
  });

  it('é idempotente: o mesmo relatório de novo não cria commit', () => {
    const s = scenario();
    record(s, [SAMPLE]);
    const before = commitCount(s);
    const again = record(s, [SAMPLE]);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /Nada novo para registrar/);
    assert.equal(commitCount(s), before);
    assert.equal(filesOn(s).length, 1);
  });

  it('acumula execuções diferentes no branch existente, em commits separados', () => {
    const s = scenario();
    record(s, [SAMPLE]);
    const second = variantReport(s.base, '2026-10-09T14:00:00.000Z');
    const third = variantReport(s.base, '2026-10-10T14:00:00.000Z');
    assert.equal(record(s, [second]).status, 0);
    assert.equal(record(s, [third]).status, 0);
    assert.equal(filesOn(s).length, 3);
    assert.equal(commitCount(s), 3);
  });

  it('dois projetos clonados gravando em sequência não perdem execuções', () => {
    const s = scenario();
    const outro = s.clone('proj2');
    record(s, [SAMPLE]);
    // "outro" nunca viu o branch de histórico localmente
    const r = record(s, [variantReport(s.base, '2026-10-09T14:00:00.000Z')], outro);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(filesOn(s).length, 2);
  });

  it('não altera o projeto: árvore de trabalho, branches e worktrees ficam como estavam', () => {
    const s = scenario();
    writeFileSync(join(s.proj, 'rascunho.txt'), 'não commitado');
    writeFileSync(join(s.proj, 'README.md'), '# editado e não commitado\n');
    const before = git(s.proj, ['status', '--porcelain'], s.env).stdout;
    assert.equal(record(s, [SAMPLE]).status, 0);
    assert.equal(git(s.proj, ['status', '--porcelain'], s.env).stdout, before);
    assert.equal(readFileSync(join(s.proj, 'rascunho.txt'), 'utf8'), 'não commitado');
    assert.equal(readFileSync(join(s.proj, 'README.md'), 'utf8'), '# editado e não commitado\n');
    const branches = git(s.proj, ['branch', '--format=%(refname:short)'], s.env).stdout.trim().split('\n');
    assert.deepEqual(branches, ['main']);
    assert.equal(git(s.proj, ['worktree', 'list'], s.env).stdout.trim().split('\n').length, 1);
  });

  it('tenta de novo quando o push é recusado uma vez', () => {
    const s = scenario();
    const marker = join(s.base, 'ja-recusou');
    installHook(s, `if [ ! -f "${marker}" ]; then touch "${marker}"; echo "recusado de propósito" >&2; exit 1; fi`);
    const r = record(s, [SAMPLE]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /tentativa 1\/3/);
    assert.equal(filesOn(s).length, 1);
    assert.equal(commitCount(s), 1, 'a tentativa recusada não deixa commit duplicado');
  });

  it('desiste depois de 3 tentativas e não grava nada', () => {
    const s = scenario();
    installHook(s, 'echo "sempre recusado" >&2; exit 1');
    const r = record(s, [SAMPLE]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /recusado 3 vezes/);
    assert.ok(!branchExists(s));
  });

  it('remoto inacessível: falha com mensagem clara, sem supor que o branch não existe', () => {
    const s = scenario();
    git(s.proj, ['remote', 'set-url', 'origin', 'file:///nao/existe/de/jeito/nenhum.git'], s.env);
    const r = record(s, [SAMPLE]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /não consegui consultar o remoto/);
  });

  it('relatório inválido: falha sem gravar nada', () => {
    const s = scenario();
    const ruim = join(s.base, 'ruim.json');
    writeFileSync(ruim, '{"nao":"playwright"}');
    const r = record(s, [ruim]);
    assert.equal(r.status, 1);
    assert.ok(!branchExists(s));
  });

  it('relatório inexistente: erro claro', () => {
    const s = scenario();
    const r = record(s, [join(s.base, 'nao-existe.json')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /relatório não encontrado/);
  });

  it('sem argumentos mostra o uso e sai com 2', () => {
    const s = scenario();
    const r = record(s, []);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Uso \(dentro do repositório/);
  });

  it('recusa valores perigosos em --branch, --subdir e --remote (código 2)', () => {
    const s = scenario();
    const casos = [
      ['--branch', '-x'],
      ['--branch', 'a..b'],
      ['--branch', 'a b'],
      ['--branch', ''],
      ['--branch', '$(touch /tmp/pwned)'],
      ['--subdir', '../fora'],
      ['--subdir', 'a/b'],
      ['--subdir', '.hidden/..'],
      ['--remote', '-oProxyCommand=x'],
    ];
    for (const caso of casos) {
      const r = record(s, [SAMPLE, ...caso]);
      assert.equal(r.status, 2, `deveria recusar ${caso.join(' ')}`);
    }
    assert.ok(!branchExists(s));
    assert.ok(!existsSync('/tmp/pwned'));
  });

  it('opções --branch e --subdir personalizadas são respeitadas', () => {
    const s = scenario();
    const r = record(s, [SAMPLE, '--branch', 'meu-historico', '--subdir', 'execucoes']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(branchExists(s, 'meu-historico'));
    assert.ok(!branchExists(s, 'qa-history'));
    assert.match(filesOn(s, 'meu-historico')[0], /^execucoes\//);
  });

  it('fora de um repositório Git: erro claro', () => {
    const s = scenario();
    const solto = mkdtempSync(join(tmpdir(), 'sem-git-'));
    const r = record(s, [SAMPLE], solto, { GIT_CEILING_DIRECTORIES: tmpdir() });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /dentro de um repositório Git/);
  });

  it('o histórico gravado é lido pelo próprio dashboard (ponta a ponta)', () => {
    const s = scenario();
    for (let i = 1; i <= 6; i += 1) {
      const day = String(i).padStart(2, '0');
      assert.equal(record(s, [variantReport(s.base, `2026-10-${day}T14:00:00.000Z`)]).status, 0);
    }
    const checkout = join(s.base, 'historico');
    git(s.base, ['clone', '--quiet', '--branch', 'qa-history', `file://${s.remote}`, checkout], s.env);
    const cli = new URL('../src/cli.mjs', import.meta.url).pathname;
    const out = join(s.base, 'site', 'index.html');
    const r = spawnSync(process.execPath, [cli, '--history', join(checkout, 'runs'), '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Histórico: 6 execuções/);
    assert.ok(readFileSync(out, 'utf8').includes('Tendência nas últimas 6 execuções'));
  });
});
