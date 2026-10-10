// Lê o JSON do reporter do Playwright e devolve uma lista plana de testes.
//
// Formato de entrada (resumido):
//   suites[]            -> um suite por arquivo; suites aninhadas são blocos describe
//     specs[]           -> cada spec tem tests[] (um por projeto)
//       tests[].results -> uma entrada por tentativa (retry 0, 1, 2...)

const STATUS_FROM_PLAYWRIGHT = {
  expected: 'passed',
  unexpected: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
};

export class ReportFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportFormatError';
  }
}

// Quando o reporter não preenche test.status, deduz pelo resultado das tentativas.
function deriveStatus(test) {
  const results = test.results ?? [];
  if (results.length === 0) return 'skipped';
  const last = results[results.length - 1].status;
  if (results.every((r) => r.status === 'skipped')) return 'skipped';
  if (last === 'passed') return results.length > 1 ? 'flaky' : 'passed';
  return 'failed';
}

function firstErrorLine(results) {
  for (const result of results) {
    const message = result.errors?.[0]?.message ?? result.error?.message;
    if (message) {
      // Remove códigos ANSI de cor que o Playwright inclui nas mensagens.
      const clean = String(message).replace(/\u001b\[[0-9;]*m/g, '').trim();
      return clean.split('\n')[0];
    }
  }
  return null;
}

function toRecord(spec, test, describePath, file) {
  const results = test.results ?? [];
  const last = results[results.length - 1];
  const status = STATUS_FROM_PLAYWRIGHT[test.status] ?? deriveStatus(test);
  const project = test.projectName ?? test.projectId ?? 'default';
  return {
    id: `${spec.id ?? `${file}:${spec.line ?? 0}`}:${project}`,
    title: String(spec.title ?? '(sem título)'),
    suite: describePath.join(' › '),
    file,
    line: spec.line ?? null,
    project,
    status,
    // Duração da última tentativa: é o que representa o teste "como ele é".
    durationMs: status === 'skipped' ? 0 : (last?.duration ?? 0),
    // Custo total no CI, somando todas as tentativas.
    totalMs: results.reduce((sum, r) => sum + (r.duration ?? 0), 0),
    attempts: results.filter((r) => r.status !== 'skipped').length,
    error: status === 'failed' || status === 'flaky' ? firstErrorLine(results) : null,
  };
}

function walk(suite, depth, describePath, file, out) {
  const here = depth === 0 ? file : suite.file ?? file;
  // Depth 0 é o arquivo; os níveis abaixo são blocos describe.
  const path = depth === 0 ? describePath : [...describePath, suite.title];
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      out.push(toRecord(spec, test, path, here));
    }
  }
  for (const child of suite.suites ?? []) {
    walk(child, depth + 1, path, here, out);
  }
}

export function parseReport(report) {
  if (report === null || typeof report !== 'object' || !Array.isArray(report.suites)) {
    throw new ReportFormatError(
      'Formato inválido: esperava um relatório JSON do Playwright com a chave "suites". ' +
        'Gere com: npx playwright test --reporter=json',
    );
  }

  const tests = [];
  for (const suite of report.suites) {
    walk(suite, 0, [], suite.file ?? suite.title ?? '(desconhecido)', tests);
  }

  return {
    tests,
    startTime: report.stats?.startTime ?? null,
    wallMs: typeof report.stats?.duration === 'number' ? report.stats.duration : null,
  };
}
