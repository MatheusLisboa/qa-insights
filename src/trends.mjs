// Série temporal por execução: uma linha de números para cada execução do histórico.
// Reaproveita computeMetrics, então a taxa de sucesso aqui tem exatamente a mesma
// definição do número principal do dashboard.

import { computeMetrics } from './metrics.mjs';

export function computeTrends(runs, { window = 20 } = {}) {
  const points = runs.slice(-window).map((run) => {
    const m = computeMetrics({ tests: run.tests, startTime: run.startTime, wallMs: run.wallMs ?? null }, { slowest: 1 });
    return {
      id: run.id,
      startTime: run.startTime,
      total: m.totals.total,
      executed: m.totals.executed,
      passed: m.totals.passed,
      failed: m.totals.failed,
      flaky: m.totals.flaky,
      skipped: m.totals.skipped,
      passRate: m.totals.passRate,
      firstAttemptRate: m.firstAttemptRate,
      p95Ms: m.duration.p95Ms,
      meanMs: m.duration.meanMs,
      wallMs: m.duration.wallMs,
    };
  });
  return { window, points };
}

// Variação da última execução em relação à anterior que tem valor para a métrica.
// Devolve null se não houver duas execuções comparáveis.
export function lastChange(points, key) {
  const withValue = points.filter((p) => typeof p[key] === 'number');
  if (withValue.length < 2) return null;
  const last = withValue[withValue.length - 1][key];
  const previous = withValue[withValue.length - 2][key];
  return { last, previous, delta: last - previous };
}
