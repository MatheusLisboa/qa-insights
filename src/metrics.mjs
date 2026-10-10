// Cálculo das métricas a partir dos testes já normalizados por parse.mjs.
//
// Definições (documentadas também no README):
//   executados          = total - ignorados
//   taxa de sucesso     = (passaram + flaky) / executados
//                         "flaky" conta como sucesso porque terminou verde após retry.
//   sucesso 1ª tentativa = passaram sem retry / executados
//   p95                 = método do ranking mais próximo (nearest-rank)

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function ratio(part, whole) {
  return whole === 0 ? null : part / whole;
}

function tally(tests) {
  const counts = { total: tests.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const t of tests) counts[t.status] += 1;
  const executed = counts.total - counts.skipped;
  return {
    ...counts,
    executed,
    passRate: ratio(counts.passed + counts.flaky, executed),
  };
}

export function computeMetrics(parsed, { slowest = 10 } = {}) {
  const { tests, wallMs, startTime } = parsed;
  const totals = tally(tests);

  const ran = tests.filter((t) => t.status !== 'skipped');
  const durations = ran.map((t) => t.durationMs);

  const bySuiteMap = new Map();
  for (const t of tests) {
    if (!bySuiteMap.has(t.file)) bySuiteMap.set(t.file, []);
    bySuiteMap.get(t.file).push(t);
  }
  const bySuite = [...bySuiteMap.entries()]
    .map(([name, group]) => {
      const groupDurations = group.filter((t) => t.status !== 'skipped').map((t) => t.durationMs);
      return { name, ...tally(group), meanMs: mean(groupDurations) };
    })
    // Pior suíte primeiro; suítes sem testes executados vão para o fim.
    .sort((a, b) => {
      if (a.passRate === null && b.passRate === null) return a.name.localeCompare(b.name);
      if (a.passRate === null) return 1;
      if (b.passRate === null) return -1;
      return a.passRate - b.passRate || a.name.localeCompare(b.name);
    });

  const byDurationDesc = [...ran].sort((a, b) => b.durationMs - a.durationMs || a.id.localeCompare(b.id));

  return {
    startTime,
    totals,
    firstAttemptRate: ratio(
      ran.filter((t) => t.status === 'passed').length,
      totals.executed,
    ),
    duration: {
      wallMs,
      meanMs: mean(durations),
      medianMs: median(durations),
      p95Ms: percentile(durations, 95),
      maxMs: durations.length ? Math.max(...durations) : null,
    },
    bySuite,
    slowest: byDurationDesc.slice(0, slowest),
    failures: tests.filter((t) => t.status === 'failed'),
    flaky: tests.filter((t) => t.status === 'flaky'),
    tests,
  };
}
