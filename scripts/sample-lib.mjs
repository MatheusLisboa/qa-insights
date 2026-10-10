// Biblioteca do gerador de relatórios SINTÉTICOS no formato do reporter JSON do
// Playwright. Os testes descrevem uma loja virtual fictícia; nada aqui vem de um
// sistema real. Com a mesma semente e as mesmas opções, a saída é idêntica.

export const WORKERS = 4;
export const RETRIES = 2;
export const DEFAULT_SEED = 20261008;
export const DEFAULT_START = Date.parse('2026-10-08T14:00:00.000Z');

// mulberry32: PRNG pequeno e determinístico.
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// outcome: pass | flaky | fail | timeout | skip
export const FILES = [
  {
    file: 'auth/login.spec.ts',
    project: 'chromium',
    groups: [
      {
        title: 'Login',
        tests: [
          ['permite login com credenciais válidas', 1800, 'pass'],
          ['exibe erro com senha inválida', 1500, 'pass'],
          ['bloqueia a conta após 5 tentativas falhas', 4200, 'pass'],
          ['envia e-mail de recuperação de senha', 2600, 'flaky', "Timeout 5000ms exceeded while waiting for locator('[data-testid=toast-success]')"],
          ['encerra a sessão ao fazer logout', 1300, 'pass'],
          ['mantém a sessão com "lembrar de mim"', 2100, 'pass'],
        ],
      },
    ],
  },
  {
    file: 'catalog/search.spec.ts',
    project: 'chromium',
    groups: [
      {
        title: 'Busca',
        tests: [
          ['retorna resultados para termo existente', 1700, 'pass'],
          ['mostra estado vazio para termo inexistente', 1200, 'pass'],
          ['filtra por faixa de preço', 2900, 'pass'],
          ['ordena por menor preço', 2300, 'pass'],
          ['pagina os resultados', 3100, 'pass'],
          ['sugere termos ao digitar (autocomplete)', 3800, 'flaky', "expect(locator).toBeVisible() failed: locator('[role=listbox]') not found"],
        ],
      },
      {
        title: 'Página de produto',
        tests: [
          ['exibe a galeria de imagens', 2000, 'pass'],
          ['seleciona a variação de tamanho', 1600, 'pass'],
          ['mostra aviso de estoque baixo', 1400, 'skip'],
        ],
      },
    ],
  },
  {
    file: 'cart/cart.spec.ts',
    project: 'chromium',
    groups: [
      {
        title: 'Carrinho',
        tests: [
          ['adiciona produto ao carrinho', 1500, 'pass'],
          ['atualiza quantidade e total', 1900, 'pass'],
          ['remove item do carrinho', 1400, 'pass'],
          ['aplica cupom válido', 2200, 'fail', "expect(locator).toHaveText(expected) failed\n\nExpected: '-R$ 20,00'\nReceived: '-R$ 0,00'"],
          ['rejeita cupom expirado', 1800, 'pass'],
          ['persiste o carrinho após recarregar a página', 2700, 'pass'],
        ],
      },
    ],
  },
  {
    file: 'checkout/checkout.spec.ts',
    project: 'chromium',
    groups: [
      {
        title: 'Checkout',
        tests: [
          ['finaliza a compra com cartão válido', 9800, 'pass'],
          ['recusa cartão sem saldo', 6400, 'pass'],
          ['calcula o frete por CEP', 3400, 'flaky', "Timeout 5000ms exceeded while waiting for response '**/api/shipping*'"],
          ['finaliza a compra com Pix', 7200, 'pass'],
          ['valida campos obrigatórios do endereço', 2400, 'pass'],
          ['exibe o resumo do pedido antes de pagar', 2100, 'pass'],
          ['emite confirmação por e-mail', 8800, 'timeout', 'Test timeout of 30000ms exceeded.'],
        ],
      },
    ],
  },
  {
    file: 'account/profile.spec.ts',
    project: 'chromium',
    groups: [
      {
        title: 'Perfil',
        tests: [
          ['atualiza dados pessoais', 2000, 'pass'],
          ['altera a senha', 2800, 'pass'],
          ['adiciona novo endereço', 2500, 'pass'],
          ['exclui endereço', 1700, 'pass'],
          ['lista o histórico de pedidos', 3300, 'pass'],
          ['baixa a nota fiscal em PDF', 5200, 'skip'],
        ],
      },
    ],
  },
  {
    file: 'api/orders.spec.ts',
    project: 'api',
    groups: [
      {
        title: 'API de pedidos',
        tests: [
          ['POST /orders cria um pedido', 320, 'pass'],
          ['POST /orders sem itens retorna 422', 210, 'pass'],
          ['GET /orders/:id retorna o pedido', 180, 'pass'],
          ['GET /orders/:id inexistente retorna 404', 150, 'pass'],
          ['PATCH /orders/:id/cancel cancela o pedido', 260, 'pass'],
          ['GET /orders pagina a listagem', 340, 'pass'],
          ['POST /orders exige autenticação', 140, 'pass'],
          ['GET /orders/:id de outro usuário retorna 403', 170, 'fail', 'Error: expect(received).toBe(expected)\n\nExpected: 403\nReceived: 200'],
        ],
      },
    ],
  },
];


// Mensagens usadas quando um teste que o plano dá como verde precisa falhar.
const DEFAULT_ERRORS = {
  flaky: "Timeout 5000ms exceeded while waiting for locator('[data-testid=ready]')",
  fail: 'expect(received).toBe(expected)\n\nExpected: true\nReceived: false',
  timeout: 'Test timeout of 30000ms exceeded.',
};

/**
 * @param {object} [options]
 * @param {number} [options.seed]       semente do gerador de durações
 * @param {number} [options.start]      instante (ms) de início da execução
 * @param {(title: string, planned: string, file: string) => string} [options.outcomeFor]
 *        permite trocar o resultado planejado de cada teste (usado pelo histórico)
 */
export function buildReport({ seed = DEFAULT_SEED, start = DEFAULT_START, outcomeFor } = {}) {
  const rand = prng(seed);
  const jitter = (base, pct = 0.18) => Math.round(base * (1 + (rand() * 2 - 1) * pct));

  let cursor = start;
  let totalWork = 0;
  const counters = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  let specSeq = 0;

  function makeResult(status, duration, retry, error) {
    const startTime = new Date(cursor).toISOString();
    cursor += duration;
    totalWork += duration;
    return {
      workerIndex: specSeq % WORKERS,
      parallelIndex: specSeq % WORKERS,
      status,
      duration,
      errors: error ? [{ message: error }] : [],
      stdout: [],
      stderr: [],
      retry,
      startTime,
      attachments: [],
    };
  }

  function makeSpec(file, project, line, [title, base, planned, plannedError]) {
    specSeq += 1;
    const outcome = outcomeFor ? outcomeFor(title, planned, file) : planned;
    const error = plannedError ?? DEFAULT_ERRORS[outcome];
    let results;
    let status;
    let ok = true;
    if (outcome === 'skip') {
      results = [{ ...makeResult('skipped', 0, 0), duration: 0 }];
      status = 'skipped';
      counters.skipped += 1;
    } else if (outcome === 'pass') {
      results = [makeResult('passed', jitter(base), 0)];
      status = 'expected';
      counters.expected += 1;
    } else if (outcome === 'flaky') {
      results = [makeResult('failed', jitter(base * 1.6), 0, error), makeResult('passed', jitter(base), 1)];
      status = 'flaky';
      counters.flaky += 1;
    } else {
      const failStatus = outcome === 'timeout' ? 'timedOut' : 'failed';
      results = Array.from({ length: RETRIES + 1 }, (_, i) =>
        makeResult(failStatus, outcome === 'timeout' ? 30000 : jitter(base), i, error),
      );
      status = 'unexpected';
      ok = false;
      counters.unexpected += 1;
    }
    return {
      title,
      ok,
      tags: [],
      id: `s${String(specSeq).padStart(3, '0')}-${Math.round(rand() * 1e6).toString(16)}`,
      file,
      line,
      column: 5,
      tests: [
        {
          timeout: 30000,
          annotations: outcome === 'skip' ? [{ type: 'fixme' }] : [],
          expectedStatus: outcome === 'skip' ? 'skipped' : 'passed',
          projectId: project,
          projectName: project,
          results,
          status,
        },
      ],
    };
  }

  const suites = FILES.map(({ file, project, groups }) => {
    let line = 6;
    return {
      title: file,
      file,
      column: 0,
      line: 0,
      specs: [],
      suites: groups.map((g) => {
        const specs = g.tests.map((t) => {
          line += 7;
          return makeSpec(file, project, line, t);
        });
        line += 4;
        return { title: g.title, file, line: line - 4 - g.tests.length * 7, column: 6, specs, suites: [] };
      }),
    };
  });

  const wallMs = Math.round(totalWork / WORKERS) + 3200;
  return {
    config: {
      configFile: 'playwright.config.ts',
      rootDir: 'tests',
      workers: WORKERS,
      projects: [
        { id: 'chromium', name: 'chromium', retries: RETRIES, timeout: 30000 },
        { id: 'api', name: 'api', retries: RETRIES, timeout: 30000 },
      ],
    },
    suites,
    errors: [],
    stats: { startTime: new Date(start).toISOString(), duration: wallMs, ...counters },
  };
}
