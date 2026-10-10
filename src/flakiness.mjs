// Instabilidade (flakiness) por teste, a partir do histórico de execuções.
//
// Definição, na janela das últimas N execuções:
//
//   Em cada execução em que o teste rodou (não foi ignorado), ele é considerado
//   INCONSISTENTE se:
//     (a) terminou "flaky": falhou e passou num retry da própria execução; ou
//     (b) o resultado virou em relação à execução anterior em que rodou
//         (verde -> vermelho ou vermelho -> verde).
//
//   taxa de instabilidade = execuções inconsistentes / execuções em que rodou
//
// Classificação (nesta ordem):
//   insuficiente  rodou menos de minRuns vezes na janela
//   persistente   está vermelho há persistentStreak execuções seguidas ou mais e
//                 virou de resultado no máximo uma vez (a quebra que iniciou a
//                 sequência): é uma falha determinística, não instabilidade
//   instável      pelo menos minInconsistent execuções inconsistentes E taxa >=
//                 unstableThreshold. Um evento isolado (um retry, uma virada) não
//                 é padrão; o mínimo evita falso positivo em histórico curto
//   estável       o resto
export const DEFAULTS = { window: 20, minRuns: 5, unstableThreshold: 0.1, persistentStreak: 3, minInconsistent: 2 };

const isOk = (status) => status !== 'failed';

export function classify({ executed, rate, inconsistent, flips, failStreak }, opts = DEFAULTS) {
  if (executed < opts.minRuns) return 'insufficient';
  if (failStreak >= opts.persistentStreak && flips <= 1) return 'persistent';
  if (inconsistent >= opts.minInconsistent && rate >= opts.unstableThreshold) return 'unstable';
  return 'stable';
}

export function computeFlakiness(runs, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const windowRuns = runs.slice(-opts.window);

  const byTest = new Map();
  windowRuns.forEach((run, runIndex) => {
    for (const t of run.tests) {
      if (!byTest.has(t.id)) {
        byTest.set(t.id, { id: t.id, title: t.title, suite: t.suite, file: t.file, project: t.project, cells: new Array(windowRuns.length).fill(null) });
      }
      const entry = byTest.get(t.id);
      // O cadastro do teste (título, arquivo) acompanha a execução mais recente.
      entry.title = t.title;
      entry.suite = t.suite;
      entry.file = t.file;
      entry.cells[runIndex] = t.status;
    }
  });

  const tests = [...byTest.values()].map((entry) => {
    const executedCells = entry.cells.filter((c) => c !== null && c !== 'skipped');
    let inconsistent = 0;
    let flips = 0;
    let previous = null;
    for (const status of executedCells) {
      const flipped = previous !== null && isOk(status) !== isOk(previous);
      if (flipped) flips += 1;
      if (status === 'flaky' || flipped) inconsistent += 1;
      previous = status;
    }

    let failStreak = 0;
    for (let i = executedCells.length - 1; i >= 0 && executedCells[i] === 'failed'; i -= 1) failStreak += 1;

    const executed = executedCells.length;
    const rate = executed === 0 ? null : inconsistent / executed;
    const metrics = { executed, rate: rate ?? 0, inconsistent, flips, failStreak };
    return {
      id: entry.id,
      title: entry.title,
      suite: entry.suite,
      file: entry.file,
      project: entry.project,
      cells: entry.cells,
      executed,
      flakyRuns: executedCells.filter((c) => c === 'flaky').length,
      failedRuns: executedCells.filter((c) => c === 'failed').length,
      flips,
      inconsistentRuns: inconsistent,
      rate,
      failStreak,
      label: executed === 0 ? 'skipped' : classify(metrics, opts),
    };
  });

  const order = { unstable: 0, persistent: 1, stable: 2, insufficient: 3, skipped: 4 };
  tests.sort(
    (a, b) =>
      order[a.label] - order[b.label] ||
      (b.rate ?? 0) - (a.rate ?? 0) ||
      b.failStreak - a.failStreak ||
      a.title.localeCompare(b.title),
  );

  const count = (label) => tests.filter((t) => t.label === label).length;
  return {
    window: opts.window,
    runsAnalyzed: windowRuns.length,
    runs: windowRuns.map((r) => ({ id: r.id, startTime: r.startTime })),
    thresholds: {
      minRuns: opts.minRuns,
      unstable: opts.unstableThreshold,
      persistentStreak: opts.persistentStreak,
      minInconsistent: opts.minInconsistent,
    },
    counts: {
      unstable: count('unstable'),
      persistent: count('persistent'),
      stable: count('stable'),
      insufficient: count('insufficient'),
    },
    tests,
  };
}
