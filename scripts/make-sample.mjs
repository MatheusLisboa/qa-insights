#!/usr/bin/env node
// Gera um relatório de exemplo no formato do reporter JSON do Playwright.
//
// ATENÇÃO: os dados são SINTÉTICOS (loja virtual fictícia, semente fixa), então
// rodar o script duas vezes produz exatamente o mesmo arquivo.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildReport } from './sample-lib.mjs';

const OUT = process.argv[2] ?? 'data/sample/playwright-report.json';
const report = buildReport();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
const total = report.stats.expected + report.stats.unexpected + report.stats.flaky + report.stats.skipped;
console.log(`Relatório de exemplo gravado em ${OUT} (${total} testes).`);
