// Monta relatórios mínimos no formato do reporter JSON do Playwright.

export function result(status, duration = 100, retry = 0, error = null) {
  return {
    status,
    duration,
    retry,
    errors: error ? [{ message: error }] : [],
    startTime: '2026-10-08T14:00:00.000Z',
    attachments: [],
  };
}

// outcome: objeto { status?, results[], project? }
export function spec(title, { status, results, project = 'chromium', line = 10, id } = {}) {
  return {
    title,
    ok: status !== 'unexpected',
    id: id ?? `id-${title}`,
    file: 'x.spec.ts',
    line,
    column: 1,
    tests: [{ projectName: project, projectId: project, results, ...(status ? { status } : {}) }],
  };
}

export const passing = (title, duration = 100, extra = {}) =>
  spec(title, { status: 'expected', results: [result('passed', duration)], ...extra });

export const failing = (title, error = 'boom', duration = 100) =>
  spec(title, {
    status: 'unexpected',
    results: [result('failed', duration, 0, error), result('failed', duration, 1, error)],
  });

export const flaky = (title, duration = 100) =>
  spec(title, {
    status: 'flaky',
    results: [result('failed', duration, 0, 'primeira tentativa'), result('passed', duration, 1)],
  });

export const skipped = (title) => spec(title, { status: 'skipped', results: [result('skipped', 0)] });

// Um arquivo com um bloco describe contendo os specs informados.
export function report(fileSpecs, stats = {}) {
  const entries = Array.isArray(fileSpecs) ? { 'a.spec.ts': fileSpecs } : fileSpecs;
  return {
    config: {},
    suites: Object.entries(entries).map(([file, specs]) => ({
      title: file,
      file,
      specs: [],
      suites: [{ title: 'Grupo', file, specs, suites: [] }],
    })),
    stats: { startTime: '2026-10-08T14:00:00.000Z', duration: 1000, ...stats },
  };
}
