import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, computeFlakiness, DEFAULTS } from '../src/flakiness.mjs';

// Atalhos: p = passed, f = failed, x = flaky, s = skipped, _ = teste ausente.
const CODES = { p: 'passed', f: 'failed', x: 'flaky', s: 'skipped' };

// makeRuns({ 'teste A': 'ppfx', 'teste B': 'pppp' }) -> uma execução por caractere.
function makeRuns(tests) {
  const length = Math.max(...Object.values(tests).map((s) => s.length));
  return Array.from({ length }, (_, i) => ({
    id: `run-${String(i).padStart(3, '0')}`,
    startTime: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
    tests: Object.entries(tests)
      .filter(([, seq]) => seq[i] !== undefined && seq[i] !== '_')
      .map(([title, seq]) => ({
        id: `f.spec.ts::G::${title}::chromium`,
        title,
        suite: 'G',
        file: 'f.spec.ts',
        project: 'chromium',
        status: CODES[seq[i]],
      })),
  }));
}

const only = (seq, opts) => computeFlakiness(makeRuns({ t: seq }), opts).tests[0];

describe('computeFlakiness: classificação', () => {
  it('teste sempre verde é estável com taxa 0', () => {
    const t = only('pppppppppp');
    assert.equal(t.label, 'stable');
    assert.equal(t.rate, 0);
  });

  it('flaky em 2 de 10 execuções é instável (20%)', () => {
    const t = only('ppxppppxpp');
    assert.equal(t.label, 'unstable');
    assert.equal(t.rate, 0.2);
    assert.equal(t.flakyRuns, 2);
  });

  it('um retry isolado não é padrão: continua estável mesmo em histórico curto', () => {
    // 1/6 = 16,7% passa do limite de 10%, mas é um único evento.
    assert.equal(only('ppxppp').label, 'stable');
  });

  it('uma regressão recente com 2 falhas seguidas ainda não é instabilidade', () => {
    assert.equal(only('ppppppff').label, 'stable');
  });

  it('regressão com 3 falhas seguidas é falha persistente, mesmo em histórico curto', () => {
    // 1 virada em 10 execuções = 10% (no limite): sem a regra de persistência seria "instável".
    const t = only('pppppppfff');
    assert.equal(t.rate, 0.1);
    assert.equal(t.label, 'persistent');
    assert.equal(t.failStreak, 3);
  });

  it('teste que nunca passou na janela é falha persistente, sem viradas', () => {
    const t = only('ffffff');
    assert.equal(t.label, 'persistent');
    assert.equal(t.flips, 0);
  });

  it('alternar verde e vermelho é instável', () => {
    const t = only('pfpfpfpfpf');
    assert.equal(t.label, 'unstable');
    assert.equal(t.flips, 9);
  });

  it('terminar em 3 falhas depois de alternar não é falha persistente: é instável', () => {
    assert.equal(only('pfpfpfffff').label, 'unstable');
  });

  it('consertar a regressão: vermelho e depois verde conta uma virada e vira estável com janela longa', () => {
    const t = only('pppppppppppppppfffpppppppp');
    // janela padrão (20): 15-3 = últimos 20 = 'ppppp' + 'fff' + 'pppppppp'... 2 viradas = 2/20 = 10%
    assert.equal(t.flips, 2);
    assert.equal(t.label, 'unstable', '2 viradas em 20 (10%) cruzam os dois limites');
  });

  it('com menos de minRuns execuções, é "insufficient"', () => {
    const t = only('pxpf');
    assert.equal(t.executed, 4);
    assert.equal(t.label, 'insufficient');
  });

  it('classify respeita os limites exatos', () => {
    const base = { executed: 10, rate: 0.1, inconsistent: 2, flips: 2, failStreak: 0 };
    assert.equal(classify(base), 'unstable');
    assert.equal(classify({ ...base, rate: 0.099 }), 'stable');
    assert.equal(classify({ ...base, inconsistent: 1 }), 'stable');
    assert.equal(classify({ ...base, executed: DEFAULTS.minRuns - 1 }), 'insufficient');
    assert.equal(classify({ ...base, flips: 1, failStreak: 3, rate: 0.5 }), 'persistent');
    assert.equal(classify({ ...base, flips: 2, failStreak: 3 }), 'unstable');
  });
});

describe('computeFlakiness: contagem', () => {
  it('flaky logo após falha conta uma única vez, mesmo sendo flaky e virada ao mesmo tempo', () => {
    const t = only('pppfx'); // f: virada (1). x: flaky e virada f->ok (1). Total 2, não 3.
    assert.equal(t.inconsistentRuns, 2);
    assert.equal(t.rate, 0.4);
  });

  it('execuções ignoradas não contam como execução nem quebram a sequência', () => {
    const t = only('pssppppp');
    assert.equal(t.executed, 6);
    assert.equal(t.label, 'stable');
  });

  it('virada atravessa execuções ignoradas', () => {
    const t = only('ppppsfs');
    assert.equal(t.flips, 1);
  });

  it('só ignorados: sem execuções, taxa null e rótulo "skipped"', () => {
    const t = only('ssssss');
    assert.equal(t.executed, 0);
    assert.equal(t.rate, null);
    assert.equal(t.label, 'skipped');
  });

  it('teste que apareceu depois só é medido nas execuções em que existe', () => {
    const f = computeFlakiness(makeRuns({ novo: '____pppppp', antigo: 'pppppppppp' }));
    const novo = f.tests.find((t) => t.title === 'novo');
    assert.equal(novo.executed, 6);
    assert.deepEqual(novo.cells.slice(0, 5), [null, null, null, null, 'passed']);
  });

  it('cells tem uma posição por execução da janela, na ordem cronológica', () => {
    const f = computeFlakiness(makeRuns({ t: 'pfxs' }));
    assert.deepEqual(f.tests[0].cells, ['passed', 'failed', 'flaky', 'skipped']);
    assert.equal(f.runs.length, 4);
  });
});

describe('computeFlakiness: janela e agregados', () => {
  it('usa só as últimas N execuções', () => {
    // 20 falhas antigas e 10 verdes recentes: com janela 10, o teste é estável.
    const runs = makeRuns({ t: 'f'.repeat(20) + 'p'.repeat(10) });
    const f = computeFlakiness(runs, { window: 10 });
    assert.equal(f.runsAnalyzed, 10);
    assert.equal(f.tests[0].label, 'stable');
    assert.equal(f.tests[0].failedRuns, 0);
  });

  it('histórico vazio não quebra', () => {
    const f = computeFlakiness([]);
    assert.equal(f.runsAnalyzed, 0);
    assert.deepEqual(f.tests, []);
    assert.deepEqual(f.counts, { unstable: 0, persistent: 0, stable: 0, insufficient: 0 });
  });

  it('ordena instáveis, depois persistentes, depois estáveis; empates por taxa e título', () => {
    const f = computeFlakiness(
      makeRuns({
        'z estável': 'pppppppppp',
        'b persistente': 'ppppppffff',
        'a instável 30%': 'pxpxpxpppp',
        'c instável 20%': 'pxpxpppppp',
      }),
    );
    assert.deepEqual(
      f.tests.map((t) => t.title),
      ['a instável 30%', 'c instável 20%', 'b persistente', 'z estável'],
    );
  });

  it('contagens por rótulo somam o total de testes', () => {
    const f = computeFlakiness(makeRuns({ a: 'pppppp', b: 'pxpxpp', c: 'pppfff', d: 'pp' }));
    const { unstable, persistent, stable, insufficient } = f.counts;
    assert.equal(unstable + persistent + stable + insufficient, f.tests.length);
    assert.deepEqual(f.counts, { unstable: 1, persistent: 1, stable: 1, insufficient: 1 });
  });

  it('título e arquivo acompanham a execução mais recente (teste renomeado)', () => {
    const runs = makeRuns({ t: 'pppppp' });
    runs[5].tests[0].title = 'novo nome';
    const f = computeFlakiness(runs);
    assert.equal(f.tests[0].title, 'novo nome');
  });
});
