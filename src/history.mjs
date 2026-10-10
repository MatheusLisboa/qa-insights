// Histórico de execuções: uma pasta com um arquivo JSON compacto por execução.
//
// Por que um arquivo por execução (e não um banco ou um JSON único):
//   - gravar uma execução nova nunca altera as anteriores (sem conflito de merge);
//   - o histórico é legível, versionável e fácil de inspecionar;
//   - o nome do arquivo começa pela data, então ordenar por nome é ordenar no tempo.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SCHEMA_VERSION = 1;
const STATUSES = new Set(['passed', 'failed', 'flaky', 'skipped']);
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export class HistoryFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HistoryFormatError';
  }
}

// O id padrão vem do conteúdo do relatório: ingerir o mesmo arquivo duas vezes
// (ex.: re-execução do CI) gera o mesmo id e não duplica a execução.
export function runIdFor(rawReportText) {
  return createHash('sha256').update(rawReportText).digest('hex').slice(0, 12);
}

export function toRunRecord(parsed, { id, branch = null, commit = null, now = () => new Date() } = {}) {
  if (!RUN_ID_PATTERN.test(String(id ?? ''))) {
    throw new HistoryFormatError(
      `id de execução inválido: "${id}". Use de 1 a 64 caracteres entre letras, números, ponto, hífen e sublinhado.`,
    );
  }
  return {
    schema: SCHEMA_VERSION,
    id,
    startTime: parsed.startTime ?? now().toISOString(),
    branch,
    commit,
    wallMs: parsed.wallMs,
    tests: parsed.tests.map((t) => ({
      id: t.id,
      title: t.title,
      suite: t.suite,
      file: t.file,
      project: t.project,
      status: t.status,
      durationMs: t.durationMs,
      totalMs: t.totalMs,
      attempts: t.attempts,
      ...(t.error ? { error: t.error } : {}),
    })),
  };
}

export function runFileName(record) {
  return `${record.startTime.replace(/[:.]/g, '-')}_${record.id}.json`;
}

export function writeRun(dir, record) {
  mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir).find((name) => name.endsWith(`_${record.id}.json`));
  if (existing) return { written: false, path: join(dir, existing) };
  const path = join(dir, runFileName(record));
  writeFileSync(path, `${JSON.stringify(record)}\n`);
  return { written: true, path };
}

function validate(record, source) {
  const bad = (why) => {
    throw new HistoryFormatError(`${source}: ${why}`);
  };
  if (record === null || typeof record !== 'object') bad('não é um objeto JSON');
  if (record.schema !== SCHEMA_VERSION) bad(`schema ${record.schema} não suportado (esperado ${SCHEMA_VERSION})`);
  if (typeof record.id !== 'string' || !RUN_ID_PATTERN.test(record.id)) bad('campo "id" ausente ou inválido');
  if (typeof record.startTime !== 'string' || Number.isNaN(Date.parse(record.startTime))) {
    bad('campo "startTime" ausente ou não é uma data ISO');
  }
  if (!Array.isArray(record.tests)) bad('campo "tests" ausente');
  for (const t of record.tests) {
    if (t === null || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.title !== 'string') {
      bad('teste sem "id" ou "title"');
    }
    if (!STATUSES.has(t.status)) bad(`status desconhecido "${t.status}" no teste "${t.title}"`);
  }
  return record;
}

// Lê todas as execuções da pasta, em ordem cronológica. Falha com o nome do
// arquivo quando algum está corrompido: um histórico parcial geraria taxas erradas
// sem avisar.
export function loadHistory(dir) {
  if (!existsSync(dir)) throw new HistoryFormatError(`pasta de histórico não encontrada: ${dir}`);
  const runs = [];
  const seen = new Set();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    let record;
    try {
      record = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch {
      throw new HistoryFormatError(`${name}: não é um JSON válido`);
    }
    validate(record, name);
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    runs.push(record);
  }
  return runs.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.id.localeCompare(b.id));
}
