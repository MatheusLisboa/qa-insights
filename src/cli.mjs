#!/usr/bin/env node
// Dois comandos:
//   qa-insights [relatorio.json] [--history <pasta>] ...   gera o dashboard
//   qa-insights ingest <relatorio.json> --history <pasta>  guarda a execução no histórico

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { computeFlakiness } from './flakiness.mjs';
import { HistoryFormatError, loadHistory, runIdFor, toRunRecord, writeRun } from './history.mjs';
import { computeMetrics } from './metrics.mjs';
import { computeTrends } from './trends.mjs';
import { parseReport, ReportFormatError } from './parse.mjs';
import { renderDashboard } from './render.mjs';

const USAGE = `Uso:
  qa-insights [relatorio.json] [opções]            Gera o dashboard
  qa-insights ingest <relatorio.json> --history <pasta> [opções]
                                                   Guarda a execução no histórico

Dashboard:
  --out <arquivo>      Página HTML de saída (padrão: qa-insights.html)
  --title <texto>      Título (padrão: QA Insights)
  --note <texto>       Aviso exibido no topo (ex.: "dados sintéticos")
  --slowest <n>        Quantos testes lentos listar (padrão: 10)
  --history <pasta>    Inclui a análise de instabilidade do histórico. Sem
                       <relatorio.json>, usa a última execução do histórico.
  --window <n>         Quantas execuções recentes analisar (padrão: 20)

Ingestão:
  --history <pasta>    Pasta do histórico (obrigatória)
  --run-id <id>        Identificador da execução (padrão: hash do relatório)
  --branch <nome>      Branch em que a execução rodou
  --commit <sha>       Commit testado

  -h, --help           Mostra esta ajuda`;

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

function positiveInt(value, flag, min = 1) {
  const n = Number.parseInt(value, 10);
  if (!/^\d+$/.test(String(value)) || n < min) fail(`${flag} precisa ser um inteiro maior ou igual a ${min}.`);
  return n;
}

function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    fail(`não consegui ler "${path}": ${err.code ?? err.message}`);
  }
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    fail(`"${path}" não é um JSON válido.`);
  }
}

function parseOrFail(json) {
  try {
    return parseReport(json);
  } catch (err) {
    if (err instanceof ReportFormatError) fail(err.message);
    throw err;
  }
}

function loadOrFail(dir) {
  try {
    return loadHistory(dir);
  } catch (err) {
    if (err instanceof HistoryFormatError) fail(err.message);
    throw err;
  }
}

function ingest(values, files) {
  if (files.length !== 1) fail(`informe exatamente um arquivo de relatório para ingerir.\n\n${USAGE}`);
  if (!values.history) fail('ingest exige --history <pasta>.');
  const { raw, json } = readJson(files[0]);
  const parsed = parseOrFail(json);
  let record;
  try {
    record = toRunRecord(parsed, {
      id: values['run-id'] ?? runIdFor(raw),
      branch: values.branch ?? null,
      commit: values.commit ?? null,
    });
  } catch (err) {
    if (err instanceof HistoryFormatError) fail(err.message);
    throw err;
  }
  const { written, path } = writeRun(values.history, record);
  console.log(
    written
      ? `Execução ${record.id} gravada em ${path} (${record.tests.length} testes).`
      : `Execução ${record.id} já estava no histórico (${path}); nada a fazer.`,
  );
}

function dashboard(values, files) {
  if (files.length > 1) fail(`informe no máximo um arquivo de relatório.\n\n${USAGE}`);
  if (files.length === 0 && !values.history) fail(`informe um relatório ou --history <pasta>.\n\n${USAGE}`);
  const slowest = positiveInt(values.slowest, '--slowest');
  const window = positiveInt(values.window, '--window');

  const runs = values.history ? loadOrFail(values.history) : null;

  let parsed;
  let source;
  if (files.length === 1) {
    parsed = parseOrFail(readJson(files[0]).json);
    source = basename(files[0]);
  } else {
    if (runs.length === 0) fail(`o histórico em "${values.history}" está vazio; rode "ingest" primeiro.`);
    const latest = runs[runs.length - 1];
    parsed = { tests: latest.tests, startTime: latest.startTime, wallMs: latest.wallMs };
    source = `histórico (${runs.length} ${runs.length === 1 ? 'execução' : 'execuções'})`;
  }

  const metrics = computeMetrics(parsed, { slowest });
  const flakiness = runs ? computeFlakiness(runs, { window }) : null;
  const trends = runs ? computeTrends(runs, { window }) : null;
  const html = renderDashboard(metrics, { title: values.title, note: values.note, source, flakiness, trends });
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, html);

  const { totals } = metrics;
  let line = `${values.out} gerado: ${totals.total} testes, ${totals.failed} falhas, ${totals.flaky} flaky, ${totals.skipped} ignorados.`;
  if (flakiness) {
    line += ` Histórico: ${flakiness.runsAnalyzed} execuções, ${flakiness.counts.unstable} instáveis, ${flakiness.counts.persistent} falhas persistentes.`;
  }
  console.log(line);
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
      window: { type: 'string', default: '20' },
      history: { type: 'string' },
      'run-id': { type: 'string' },
      branch: { type: 'string' },
      commit: { type: 'string' },
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

if (positionals[0] === 'ingest') ingest(values, positionals.slice(1));
else dashboard(values, positionals);
