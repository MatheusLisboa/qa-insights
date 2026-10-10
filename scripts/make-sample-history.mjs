#!/usr/bin/env node
// Gera um histórico SINTÉTICO de 30 execuções (uma a cada 12 horas) para a loja
// virtual fictícia, passando cada relatório pelo mesmo caminho de ingestão da CLI.
//
// Cada teste tem um "perfil" de comportamento, para que a análise de instabilidade
// tenha o que encontrar:
//   - alguns testes são instáveis (passam após retry com frequências diferentes);
//   - um teste falha de forma intermitente mesmo com retry;
//   - um teste quebrou numa execução específica e continua quebrado (regressão);
//   - um teste de API tem um bug que vem desde a execução 12 (falha persistente);
//   - os demais são estáveis, com um raro retry ocasional (1%).
// A última execução é idêntica ao relatório de data/sample/playwright-report.json.

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { parseReport } from '../src/parse.mjs';
import { runIdFor, toRunRecord, writeRun } from '../src/history.mjs';
import { buildReport, DEFAULT_SEED, DEFAULT_START, prng } from './sample-lib.mjs';

const OUT = process.argv[2] ?? 'data/sample/history';
const RUNS = 30;
const STEP_MS = 12 * 60 * 60 * 1000;

// Probabilidades por teste: [flaky, falha com retries esgotados].
const PROFILES = {
  'sugere termos ao digitar (autocomplete)': [0.3, 0.02],
  'calcula o frete por CEP': [0.2, 0],
  'envia e-mail de recuperação de senha': [0.15, 0],
  'emite confirmação por e-mail': [0.1, 0.4],
};
const RARE_RETRY = 0.01;
const COUPON_BROKEN_FROM = 24;
const API_BUG_FROM = 12;

function outcomeForRun(runIndex) {
  const draw = prng(77000 + runIndex);
  return (title, planned) => {
    const u = draw(); // um sorteio por teste, sempre na mesma ordem
    if (planned === 'skip') return 'skip';
    if (title === 'aplica cupom válido') return runIndex >= COUPON_BROKEN_FROM ? 'fail' : 'pass';
    if (title === 'GET /orders/:id de outro usuário retorna 403') return runIndex >= API_BUG_FROM ? 'fail' : 'pass';
    const [pFlaky, pFail] = PROFILES[title] ?? [RARE_RETRY, 0];
    if (u < pFail) return title === 'emite confirmação por e-mail' ? 'timeout' : 'fail';
    if (u < pFail + pFlaky) return 'flaky';
    return 'pass';
  };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (let i = 0; i < RUNS; i += 1) {
  const last = i === RUNS - 1;
  const report = buildReport({
    seed: last ? DEFAULT_SEED : 1000 + i,
    start: DEFAULT_START - (RUNS - 1 - i) * STEP_MS,
    // A última execução usa o plano original, igual ao relatório de exemplo.
    outcomeFor: last ? undefined : outcomeForRun(i),
  });
  const raw = JSON.stringify(report);
  const record = toRunRecord(parseReport(report), { id: runIdFor(raw), branch: 'main' });
  writeRun(OUT, record);
}

// Confere que a última execução bate com o relatório de exemplo da Fase 1.
const sample = JSON.parse(readFileSync('data/sample/playwright-report.json', 'utf8'));
const lastRecord = toRunRecord(parseReport(sample), { id: 'conferencia' });
console.log(`Histórico de exemplo gravado em ${OUT} (${RUNS} execuções, ${lastRecord.tests.length} testes cada).`);
