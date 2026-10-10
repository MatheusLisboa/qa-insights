// Gera o dashboard como uma única página HTML autocontida (sem CDN, sem build).
// Todo texto vindo do relatório passa por esc(): títulos de teste e mensagens de
// erro são dados não confiáveis.

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function fmtMs(ms) {
  if (ms === null || ms === undefined) return '–';
  if (ms < 1000) return `${nf0.format(Math.round(ms))} ms`;
  if (ms < 60000) return `${nf1.format(ms / 1000)} s`;
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)} min ${totalSec % 60} s`;
}

export function fmtPct0(ratio) {
  return ratio === null || ratio === undefined ? '–' : `${nf0.format(Math.round(ratio * 100))}%`;
}

export function fmtPct(ratio) {
  return ratio === null || ratio === undefined ? '–' : `${nf1.format(ratio * 100)}%`;
}

// Determinístico de propósito: não depende do fuso do computador que gera a página.
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]} UTC` : null;
}

const STATUS = {
  passed: { icon: '✓', label: 'Passou', plural: 'Passaram' },
  flaky: { icon: '!', label: 'Flaky', plural: 'Flaky' },
  failed: { icon: '✕', label: 'Falhou', plural: 'Falharam' },
  skipped: { icon: '–', label: 'Ignorado', plural: 'Ignorados' },
};

const badge = (status) =>
  `<span class="badge"><span class="dot s-${status}" aria-hidden="true">${STATUS[status].icon}</span>${STATUS[status].label}</span>`;

function tile(label, value, status, hint) {
  const icon = status ? `<span class="dot s-${status}" aria-hidden="true">${STATUS[status].icon}</span>` : '';
  return `<div class="tile"><div class="tile-label">${icon}${esc(label)}</div><div class="tile-value">${esc(value)}</div>${
    hint ? `<div class="tile-hint">${esc(hint)}</div>` : ''
  }</div>`;
}

function slowestChart(m) {
  if (m.slowest.length === 0) return '';
  const max = m.slowest[0].durationMs || 1;
  const rows = m.slowest
    .map((t) => {
      const pct = Math.max(1, (t.durationMs / max) * 100);
      const tip = [
        fmtMs(t.durationMs),
        t.title,
        `${t.suite || t.file} · ${t.attempts} ${t.attempts === 1 ? 'tentativa' : 'tentativas'} · ${STATUS[t.status].label}`,
      ].join('\n');
      const mark = t.status === 'passed' ? '' : `<span class="dot s-${t.status}" aria-hidden="true">${STATUS[t.status].icon}</span>`;
      return `<li class="row">
  <div class="row-label"><span class="row-title" title="${esc(t.title)}">${mark}${esc(t.title)}</span><span class="row-sub">${esc(t.suite || t.file)}</span></div>
  <div class="track"><div class="bar" tabindex="0" style="width:${pct.toFixed(2)}%" data-tip="${esc(tip)}" aria-label="${esc(`${t.title}: ${fmtMs(t.durationMs)}`)}"></div></div>
  <div class="row-value">${fmtMs(t.durationMs)}</div>
</li>`;
    })
    .join('\n');
  return `<figure class="card">
  <figcaption><h2>Testes mais lentos</h2><p>Duração da última tentativa de cada teste. Os ${m.slowest.length} maiores valores.</p></figcaption>
  <ol class="rows">${rows}</ol>
</figure>`;
}

function suiteChart(m) {
  if (m.bySuite.length === 0) return '';
  const maxTotal = Math.max(...m.bySuite.map((s) => s.total));
  const order = ['passed', 'flaky', 'failed', 'skipped'];
  const legend = order
    .map((s) => `<li><span class="swatch s-${s}"></span><span class="dot s-${s}" aria-hidden="true">${STATUS[s].icon}</span>${STATUS[s].plural}</li>`)
    .join('');
  const rows = m.bySuite
    .map((s) => {
      const segs = order
        .filter((k) => s[k] > 0)
        .map((k) => {
          const tip = [`${s[k]} de ${s.total} ${s.total === 1 ? 'teste' : 'testes'}`, STATUS[k].plural, s.name].join('\n');
          return `<div class="seg s-${k}" tabindex="0" style="flex:${s[k]} 0 0" data-tip="${esc(tip)}" aria-label="${esc(`${s.name}: ${s[k]} ${STATUS[k].plural.toLowerCase()}`)}"></div>`;
        })
        .join('');
      const width = (s.total / maxTotal) * 100;
      return `<li class="row">
  <div class="row-label"><span class="row-title" title="${esc(s.name)}">${esc(s.name)}</span><span class="row-sub">${s.total} ${s.total === 1 ? 'teste' : 'testes'}</span></div>
  <div class="track"><div class="stack" style="width:${width.toFixed(2)}%">${segs}</div></div>
  <div class="row-value">${fmtPct(s.passRate)}</div>
</li>`;
    })
    .join('\n');
  return `<figure class="card">
  <figcaption><h2>Resultado por suíte</h2><p>Uma barra por arquivo de teste, da pior taxa de sucesso para a melhor. O valor à direita é a taxa de sucesso.</p></figcaption>
  <ul class="legend" aria-label="Legenda">${legend}</ul>
  <ol class="rows">${rows}</ol>
</figure>`;
}

function problemList(m) {
  const items = [...m.failures, ...m.flaky];
  if (items.length === 0) {
    return `<section class="card"><h2>Falhas e testes instáveis</h2><p class="empty">Nenhuma falha nem teste instável nesta execução.</p></section>`;
  }
  const cards = items
    .map(
      (t) => `<li class="problem">
  <div class="problem-head">${badge(t.status)}<strong>${esc(t.title)}</strong></div>
  <div class="row-sub">${esc(t.file)}${t.line ? `:${t.line}` : ''} · ${esc(t.project)} · ${t.attempts} ${t.attempts === 1 ? 'tentativa' : 'tentativas'}</div>
  ${t.error ? `<pre class="err">${esc(t.error)}</pre>` : ''}
</li>`,
    )
    .join('\n');
  return `<section class="card">
  <h2>Falhas e testes instáveis</h2>
  <p class="sub">Flaky = falhou e depois passou em um retry. Falhou = esgotou todas as tentativas.</p>
  <ul class="problems">${cards}</ul>
</section>`;
}

function testsTable(m) {
  const rows = m.tests
    .map((t) => {
      const text = `${t.title} ${t.suite} ${t.file} ${t.project} ${STATUS[t.status].label}`.toLowerCase();
      return `<tr data-status="${t.status}" data-text="${esc(text)}">
  <td>${badge(t.status)}</td>
  <td><div>${esc(t.title)}</div><div class="row-sub">${esc(t.suite)}</div></td>
  <td class="mono">${esc(t.file)}</td>
  <td>${esc(t.project)}</td>
  <td class="num">${t.status === 'skipped' ? '–' : fmtMs(t.durationMs)}</td>
  <td class="num">${t.status === 'skipped' ? '–' : t.attempts}</td>
</tr>`;
    })
    .join('\n');
  const chips = [['all', 'Todos'], ...Object.entries(STATUS).map(([k, v]) => [k, v.plural])]
    .map(([k, label]) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${k === 'all'}">${label}</button>`)
    .join('');
  return `<section class="card" id="tests">
  <h2>Todos os testes</h2>
  <div class="filters">
    <div class="chips" role="group" aria-label="Filtrar por status">${chips}</div>
    <input type="search" id="q" placeholder="Buscar por título, suíte ou arquivo" aria-label="Buscar testes">
    <span class="count" id="count" aria-live="polite"></span>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>Status</th><th>Teste</th><th>Arquivo</th><th>Projeto</th><th class="num">Duração</th><th class="num">Tentativas</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</section>`;
}


const CELL_GLYPH = { flaky: '!', failed: '✕' };
const CELL_LABEL = { passed: 'Passou', flaky: 'Flaky', failed: 'Falhou', skipped: 'Ignorado', none: 'Sem dados' };

function fmtShortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : '';
}

function runStrip(test, runs) {
  const cells = test.cells
    .map((status, i) => {
      const kind = status ?? 'none';
      const tip = [CELL_LABEL[kind], test.title, `Execução de ${fmtDate(runs[i].startTime)}`].join('\n');
      return `<span class="cell c-${kind}" data-tip="${esc(tip)}" aria-hidden="true">${CELL_GLYPH[kind] ?? ''}</span>`;
    })
    .join('');
  const tally = {};
  for (const status of test.cells) tally[status ?? 'none'] = (tally[status ?? 'none'] ?? 0) + 1;
  const summary = Object.entries(tally)
    .map(([k, n]) => `${n} ${CELL_LABEL[k].toLowerCase()}`)
    .join(', ');
  return `<div class="strip" role="img" aria-label="${esc(`Últimas ${test.cells.length} execuções: ${summary}`)}">${cells}</div>`;
}

function historySection(f, top = 10) {
  if (!f) return '';
  const range =
    f.runs.length > 0 ? `${fmtDate(f.runs[0].startTime)} a ${fmtDate(f.runs[f.runs.length - 1].startTime)}` : '';
  const head = `<h2>Instabilidade nas últimas ${f.runsAnalyzed} execuções</h2>
  <p class="sub">${range ? `${esc(range)}. ` : ''}Um teste é <em>instável</em> quando termina flaky ou muda de resultado entre execuções em pelo menos ${fmtPct0(
    f.thresholds.unstable,
  )} das vezes em que roda (e em ao menos ${f.thresholds.minInconsistent} execuções). Quem falha ${f.thresholds.persistentStreak} ou mais vezes seguidas sem ter alternado antes é uma <em>falha persistente</em>, não instabilidade.</p>`;

  if (f.runsAnalyzed < f.thresholds.minRuns) {
    return `<section class="card">${head}<p class="empty">O histórico tem apenas ${f.runsAnalyzed} ${
      f.runsAnalyzed === 1 ? 'execução' : 'execuções'
    }. São necessárias pelo menos ${f.thresholds.minRuns} para calcular a instabilidade com algum critério.</p></section>`;
  }

  const tiles = `<div class="tiles">
    ${tile('Instáveis', nf0.format(f.counts.unstable), 'flaky')}
    ${tile('Falhas persistentes', nf0.format(f.counts.persistent), 'failed')}
    ${tile('Estáveis', nf0.format(f.counts.stable), 'passed')}
    ${tile('Execuções analisadas', nf0.format(f.runsAnalyzed), null, `janela de até ${f.window}`)}
  </div>`;

  const problems = f.tests.filter((t) => t.label === 'unstable' || t.label === 'persistent').slice(0, top);
  if (problems.length === 0) {
    return `<section class="card">${head}${tiles}<p class="empty">Nenhum teste instável nem com falha persistente nesta janela.</p></section>`;
  }

  const legend = ['passed', 'flaky', 'failed', 'skipped', 'none']
    .map((k) => `<li><span class="cell c-${k} legend-cell" aria-hidden="true">${CELL_GLYPH[k] ?? ''}</span>${CELL_LABEL[k]}</li>`)
    .join('');

  const rows = problems
    .map((t) => {
      const unstable = t.label === 'unstable';
      const status = unstable ? 'flaky' : 'failed';
      const value = unstable
        ? `<strong>${fmtPct0(t.rate)}</strong><span>das execuções inconsistentes</span>`
        : `<strong>${t.failStreak}</strong><span>falhas seguidas</span>`;
      return `<li class="unstable-row">
  <div class="row-label">
    <span class="row-title" title="${esc(t.title)}"><span class="badge"><span class="dot s-${status}" aria-hidden="true">${
        STATUS[status].icon
      }</span>${unstable ? 'Instável' : 'Falha persistente'}</span>${esc(t.title)}</span>
    <span class="row-sub">${esc(t.file)} · ${t.executed} execuções · ${t.flakyRuns} flaky · ${t.failedRuns} falhas · ${t.flips} ${
        t.flips === 1 ? 'virada' : 'viradas'
      }</span>
  </div>
  <div class="metric">${value}</div>
  <div class="strip-wrap">${runStrip(t, f.runs)}<div class="strip-axis"><span>${fmtShortDate(f.runs[0].startTime)}</span><span>${fmtShortDate(
        f.runs[f.runs.length - 1].startTime,
      )}</span></div></div>
</li>`;
    })
    .join('\n');

  const more =
    f.counts.unstable + f.counts.persistent > problems.length
      ? `<p class="sub">Mostrando os ${problems.length} primeiros de ${f.counts.unstable + f.counts.persistent}.</p>`
      : '';

  return `<section class="card">${head}${tiles}
  <ul class="legend" aria-label="Legenda da faixa de execuções">${legend}</ul>
  <ol class="unstable-list">${rows}</ol>${more}
</section>`;
}

const CSS = `
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --series-1: #2a78d6; --track: #eceae4;
  --good: #0ca30c; --warning: #fab219; --critical: #d03b3b; --skipped: #898781;
  --on-good: #0b0b0b; --on-warning: #0b0b0b; --on-critical: #ffffff; --on-skipped: #0b0b0b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    --series-1: #3987e5; --track: #262624;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
  --series-1: #3987e5; --track: #262624;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1080px; margin: 0 auto; padding: 24px 16px 48px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 16px; margin: 0 0 4px; }
p { margin: 0; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.meta, .sub, .row-sub, figcaption p, .tile-hint, .count { color: var(--ink-2); font-size: 13px; }
.note { border: 1px solid var(--border); border-left: 4px solid var(--series-1); background: var(--surface); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: var(--ink-2); }
button, input { font: inherit; color: inherit; }
.theme { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin: 0; }
.hero { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 24px; }
.hero-value { font-size: 56px; font-weight: 650; line-height: 1.05; }
.hero-label { font-size: 13px; color: var(--ink-2); }
.hero-text { color: var(--ink-2); max-width: 46ch; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 16px; }
.tile { border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
.tile-label { font-size: 13px; color: var(--ink-2); display: flex; align-items: center; gap: 6px; }
.tile-value { font-size: 26px; font-weight: 600; margin-top: 2px; }
.dot { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; font-size: 11px; font-weight: 700; line-height: 1; flex: none; }
.dot.s-passed { background: var(--good); color: var(--on-good); }
.dot.s-flaky { background: var(--warning); color: var(--on-warning); }
.dot.s-failed { background: var(--critical); color: var(--on-critical); }
.dot.s-skipped { background: var(--skipped); color: var(--on-skipped); }
.badge { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; white-space: nowrap; }
.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 16px; }
.rows { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 10px; }
.row { display: grid; grid-template-columns: minmax(0, 1fr) 4.5rem; align-items: center; gap: 4px 12px; }
.row-label { display: grid; min-width: 0; grid-column: 1 / -1; }
.row-title { display: flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-value { text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; }
.track { height: 16px; display: flex; align-items: center; }
.bar { height: 16px; background: var(--series-1); border-radius: 0 4px 4px 0; }
.stack { height: 16px; display: flex; gap: 2px; }
.seg { min-width: 4px; }
.seg:first-child { border-radius: 0; }
.seg:last-child { border-radius: 0 4px 4px 0; }
.seg.s-passed { background: var(--good); } .seg.s-flaky { background: var(--warning); }
.seg.s-failed { background: var(--critical); } .seg.s-skipped { background: var(--skipped); }
.bar:hover, .seg:hover { filter: brightness(1.15); }
.bar:focus-visible, .seg:focus-visible, .chip:focus-visible, input:focus-visible, .theme:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 0; margin: 10px 0 0; font-size: 13px; }
.legend li { display: flex; align-items: center; gap: 6px; }
.swatch { width: 12px; height: 12px; border-radius: 2px; }
.swatch.s-passed { background: var(--good); } .swatch.s-flaky { background: var(--warning); }
.swatch.s-failed { background: var(--critical); } .swatch.s-skipped { background: var(--skipped); }
.problems { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 10px; }
.problem { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: grid; gap: 4px; }
.problem-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.err { margin: 4px 0 0; padding: 8px 10px; border-radius: 6px; background: var(--track); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.empty { color: var(--ink-2); margin-top: 8px; }
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 12px 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid var(--border); background: transparent; border-radius: 999px; padding: 4px 12px; cursor: pointer; font-size: 13px; }
.chip[aria-pressed="true"] { background: var(--ink); color: var(--surface); border-color: var(--ink); }
input[type="search"] { border: 1px solid var(--border); background: transparent; border-radius: 8px; padding: 6px 10px; min-width: 240px; flex: 1 1 240px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--grid); vertical-align: top; }
th { font-size: 12px; color: var(--ink-2); font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mono { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink-2); }
tr[hidden] { display: none; }
footer { color: var(--muted); font-size: 12px; }
#tip { position: fixed; z-index: 10; pointer-events: none; background: var(--ink); color: var(--surface); border-radius: 8px; padding: 8px 10px; font-size: 12px; max-width: 320px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
#tip .v { font-size: 15px; font-weight: 650; }
#tip .l { opacity: 0.85; overflow-wrap: anywhere; }
.unstable-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 14px; }
.unstable-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 16px; align-items: start; border-top: 1px solid var(--grid); padding-top: 12px; }
.unstable-row:first-child { border-top: 0; padding-top: 0; }
.unstable-row .row-label { grid-column: 1; }
.unstable-row .row-title { flex-wrap: wrap; }
.unstable-row .row-sub { white-space: normal; }
.metric { grid-column: 2; grid-row: 1; text-align: right; display: grid; line-height: 1.2; }
.metric strong { font-size: 22px; font-weight: 650; }
.metric span { font-size: 12px; color: var(--ink-2); }
.strip-wrap { grid-column: 1 / -1; }
.strip { display: flex; gap: 2px; }
.strip-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 3px; }
.cell { flex: 1 1 0; max-width: 28px; min-width: 8px; height: 20px; border-radius: 3px; display: grid; place-items: center; font-size: 11px; font-weight: 700; line-height: 1; }
.cell.c-passed { background: var(--good); color: var(--on-good); }
.cell.c-flaky { background: var(--warning); color: var(--on-warning); }
.cell.c-failed { background: var(--critical); color: var(--on-critical); }
.cell.c-skipped { background: var(--skipped); color: var(--on-skipped); }
.cell.c-none { background: transparent; border: 1px dashed var(--axis); }
.cell:hover { filter: brightness(1.15); }
.legend-cell { flex: none; width: 14px; height: 14px; font-size: 9px; }
@media (max-width: 560px) {
  .grid-2 { grid-template-columns: 1fr; }
  .hero-value { font-size: 48px; }
}
`;

const SCRIPT = `
(function () {
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  try { var saved = localStorage.getItem('qa-insights-theme'); if (saved) root.dataset.theme = saved; } catch (e) {}
  document.getElementById('theme').addEventListener('click', function () {
    var now = root.dataset.theme || (mq.matches ? 'dark' : 'light');
    var next = now === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('qa-insights-theme', next); } catch (e) {}
  });

  var tip = document.getElementById('tip');
  function show(el, x, y) {
    var lines = el.dataset.tip.split('\\n');
    tip.replaceChildren();
    lines.forEach(function (line, i) {
      var d = document.createElement('div');
      d.className = i === 0 ? 'v' : 'l';
      d.textContent = line;
      tip.appendChild(d);
    });
    tip.hidden = false;
    var left = Math.min(x + 12, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = (y + 16) + 'px';
  }
  function hide() { tip.hidden = true; }
  document.addEventListener('pointermove', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else hide();
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return;
    var r = el.getBoundingClientRect();
    show(el, r.left, r.bottom - 12);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });

  var rows = Array.prototype.slice.call(document.querySelectorAll('#tests tbody tr'));
  var count = document.getElementById('count');
  var q = document.getElementById('q');
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var status = 'all';
  function apply() {
    var term = q.value.trim().toLowerCase();
    var n = 0;
    rows.forEach(function (r) {
      var ok = (status === 'all' || r.dataset.status === status) && r.dataset.text.indexOf(term) !== -1;
      r.hidden = !ok;
      if (ok) n += 1;
    });
    count.textContent = 'Mostrando ' + n + ' de ' + rows.length;
  }
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      status = c.dataset.filter;
      chips.forEach(function (o) { o.setAttribute('aria-pressed', String(o === c)); });
      apply();
    });
  });
  q.addEventListener('input', apply);
  apply();
})();
`;

export function renderDashboard(metrics, { title = 'QA Insights', note = '', source = '', flakiness = null } = {}) {
  const t = metrics.totals;
  const date = fmtDate(metrics.startTime);
  const meta = [source && `Origem: ${source}`, date && `Execução: ${date}`].filter(Boolean).join(' · ');

  const body =
    t.total === 0
      ? `<section class="card"><h2>Nenhum teste encontrado</h2><p class="empty">O relatório é válido, mas não contém testes.</p></section>`
      : `<section class="card">
  <div class="hero">
    <div><div class="hero-value">${fmtPct(t.passRate)}</div><div class="hero-label">Taxa de sucesso</div></div>
    <p class="hero-text">${t.passed + t.flaky} de ${t.executed} testes executados terminaram verdes${
        t.flaky ? `, ${t.flaky} só após retry` : ''
      }. Na primeira tentativa, a taxa foi de ${fmtPct(metrics.firstAttemptRate)}.</p>
  </div>
  <div class="tiles">
    ${tile('Executados', nf0.format(t.executed), null, `de ${t.total} no total`)}
    ${tile('Falharam', nf0.format(t.failed), 'failed')}
    ${tile('Flaky', nf0.format(t.flaky), 'flaky', 'passaram após retry')}
    ${tile('Ignorados', nf0.format(t.skipped), 'skipped')}
    ${tile('Duração da execução', fmtMs(metrics.duration.wallMs), null, `média por teste ${fmtMs(metrics.duration.meanMs)}`)}
    ${tile('p95 por teste', fmtMs(metrics.duration.p95Ms), null, `mediana ${fmtMs(metrics.duration.medianMs)}`)}
  </div>
</section>
<div class="grid-2">
${slowestChart(metrics)}
${suiteChart(metrics)}
</div>
${historySection(flakiness)}
${problemList(metrics)}
${testsTable(metrics)}`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <div class="top">
    <div><h1>${esc(title)}</h1><p class="meta">${esc(meta)}</p></div>
    <button type="button" class="theme" id="theme">Alternar tema</button>
  </div>
  ${note ? `<p class="note" role="note">${esc(note)}</p>` : ''}
  ${body}
  <footer>Gerado por qa-insights a partir de um relatório JSON do Playwright.</footer>
</main>
<div id="tip" role="tooltip" hidden></div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
