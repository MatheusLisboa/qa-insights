#!/usr/bin/env node
// Uso: node src/cli.mjs <relatorio.json> [--out docs/index.html] [--title "Título"] [--note "Aviso"]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { computeMetrics } from './metrics.mjs';
import { parseReport, ReportFormatError } from './parse.mjs';
import { renderDashboard } from './render.mjs';

const USAGE = `Uso: qa-insights <relatorio.json> [opções]

Opções:
  --out <arquivo>    Página HTML de saída (padrão: qa-insights.html)
  --title <texto>    Título do dashboard (padrão: QA Insights)
  --note <texto>     Aviso exibido no topo (ex.: "dados sintéticos")
  --slowest <n>      Quantos testes lentos listar (padrão: 10)
  -h, --help         Mostra esta ajuda`;

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'qa-insights.html' },
      title: { type: 'string', default: 'QA Insights' },
      note: { type: 'string', default: '' },
      slowest: { type: 'string', default: '10' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (err) {
  fail(`${err.message}\n\n${USAGE}`);
}

const { values, positionals } = args;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (positionals.length !== 1) fail(`informe exatamente um arquivo de relatório.\n\n${USAGE}`);

const slowest = Number.parseInt(values.slowest, 10);
if (!Number.isInteger(slowest) || slowest < 1) fail('--slowest precisa ser um inteiro maior que zero.');

const input = positionals[0];
let raw;
try {
  raw = readFileSync(input, 'utf8');
} catch (err) {
  fail(`não consegui ler "${input}": ${err.code ?? err.message}`);
}

let json;
try {
  json = JSON.parse(raw);
} catch {
  fail(`"${input}" não é um JSON válido.`);
}

let metrics;
try {
  metrics = computeMetrics(parseReport(json), { slowest });
} catch (err) {
  if (err instanceof ReportFormatError) fail(err.message);
  throw err;
}

const html = renderDashboard(metrics, { title: values.title, note: values.note, source: basename(input) });
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, html);

const { totals } = metrics;
console.log(
  `${values.out} gerado: ${totals.total} testes, ${totals.failed} falhas, ${totals.flaky} flaky, ${totals.skipped} ignorados.`,
);
