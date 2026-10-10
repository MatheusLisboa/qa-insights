#!/usr/bin/env bash
# Registra uma execução de testes no histórico, guardado num branch dedicado do
# próprio repositório do projeto (padrão: qa-history).
#
# Uso (dentro do repositório do projeto, depois de rodar os testes):
#   scripts/record-history.sh <relatorio.json> [opções]
#
# Opções:
#   --branch <nome>         branch onde o histórico fica (padrão: qa-history)
#   --remote <nome>         remoto Git (padrão: origin)
#   --subdir <pasta>        pasta dentro do branch (padrão: runs)
#   --commit <sha>          commit testado (padrão: $GITHUB_SHA ou HEAD)
#   --source-branch <nome>  branch testado (padrão: $GITHUB_REF_NAME ou o atual)
#
# Garantias:
#   - idempotente: o mesmo relatório gravado duas vezes não cria nada novo;
#   - nunca mexe na árvore de trabalho nem nos branches do projeto (usa um
#     worktree temporário e apaga tudo ao terminar);
#   - se o push for recusado (outra execução gravou ao mesmo tempo), atualiza e
#     tenta de novo, até 3 vezes;
#   - se não conseguir nem consultar o remoto, falha em vez de supor que o branch
#     não existe.
#
# Códigos de saída: 0 ok (inclusive "nada novo"), 1 erro, 2 uso incorreto.

set -euo pipefail

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

REPORT=""
BRANCH="qa-history"
REMOTE="origin"
SUBDIR="runs"
SOURCE_SHA=""
SOURCE_BRANCH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) [ $# -ge 2 ] || usage; BRANCH="$2"; shift 2 ;;
    --remote) [ $# -ge 2 ] || usage; REMOTE="$2"; shift 2 ;;
    --subdir) [ $# -ge 2 ] || usage; SUBDIR="$2"; shift 2 ;;
    --commit) [ $# -ge 2 ] || usage; SOURCE_SHA="$2"; shift 2 ;;
    --source-branch) [ $# -ge 2 ] || usage; SOURCE_BRANCH="$2"; shift 2 ;;
    -h|--help) usage ;;
    -*) echo "Erro: opção desconhecida: $1" >&2; usage ;;
    *) [ -z "$REPORT" ] || usage; REPORT="$1"; shift ;;
  esac
done

[ -n "$REPORT" ] || usage

# Valores que entram em comandos Git e em caminhos: só caracteres seguros.
if ! [[ "$BRANCH" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || [[ "$BRANCH" == *..* ]]; then
  echo "Erro: --branch inválido: $BRANCH" >&2; exit 2
fi
if ! [[ "$SUBDIR" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || [[ "$SUBDIR" == *..* ]]; then
  echo "Erro: --subdir inválido: $SUBDIR" >&2; exit 2
fi
if ! [[ "$REMOTE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "Erro: --remote inválido: $REMOTE" >&2; exit 2
fi

[ -f "$REPORT" ] || { echo "Erro: relatório não encontrado: $REPORT" >&2; exit 1; }
REPORT="$(cd "$(dirname "$REPORT")" && pwd)/$(basename "$REPORT")"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../src/cli.mjs"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Erro: rode dentro de um repositório Git." >&2; exit 1; }
cd "$ROOT"

SOURCE_SHA="${SOURCE_SHA:-${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || true)}}"
SOURCE_BRANCH="${SOURCE_BRANCH:-${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)}}"

# Identidade só para este commit; funciona mesmo sem git config no ambiente.
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-qa-insights[bot]}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-qa-insights@users.noreply.github.com}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$GIT_AUTHOR_NAME}"
export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$GIT_AUTHOR_EMAIL}"

TMP="$(mktemp -d)"
WT="$TMP/wt"
TMP_BRANCH="qa-history-tmp-$$"

drop_worktree() {
  git worktree remove --force "$WT" >/dev/null 2>&1 || true
  git worktree prune >/dev/null 2>&1 || true
  git branch -D "$TMP_BRANCH" >/dev/null 2>&1 || true
  rm -rf "$WT"
}
cleanup() {
  drop_worktree
  rm -rf "$TMP"
}
trap cleanup EXIT

# Deixa $WT apontando para a ponta atual do branch de histórico, ou para uma
# árvore vazia (branch órfão) se ele ainda não existe.
prepare_worktree() {
  drop_worktree
  local rc=0
  git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0)
      git fetch --quiet --no-tags --depth=1 "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"
      git worktree add --quiet --detach "$WT" "refs/remotes/$REMOTE/$BRANCH"
      ;;
    2)
      git worktree add --quiet --detach "$WT" HEAD
      git -C "$WT" checkout --quiet --orphan "$TMP_BRANCH"
      git -C "$WT" rm -rf --quiet . >/dev/null 2>&1 || true
      find "$WT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
      ;;
    *)
      echo "Erro: não consegui consultar o remoto '$REMOTE' (código $rc). Nada foi gravado." >&2
      exit 1
      ;;
  esac
}

MAX_ATTEMPTS=3
attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  prepare_worktree

  node "$CLI" ingest "$REPORT" --history "$WT/$SUBDIR" --branch "$SOURCE_BRANCH" --commit "$SOURCE_SHA" \
    || { echo "Erro: a ingestão falhou; nada foi gravado." >&2; exit 1; }

  git -C "$WT" add -A -- "$SUBDIR"
  if git -C "$WT" diff --cached --quiet; then
    echo "Nada novo para registrar em $BRANCH."
    exit 0
  fi

  NEW_FILE="$(git -C "$WT" diff --cached --name-only | head -n 1)"
  git -C "$WT" commit --quiet -m "chore: registra execução ${NEW_FILE##*/}"

  if git -C "$WT" push --quiet "$REMOTE" "HEAD:refs/heads/$BRANCH"; then
    echo "Execução registrada em $REMOTE/$BRANCH ($NEW_FILE)."
    exit 0
  fi

  echo "Push recusado (tentativa $attempt/$MAX_ATTEMPTS); atualizando o histórico e tentando de novo." >&2
  attempt=$((attempt + 1))
done

echo "Erro: o push foi recusado $MAX_ATTEMPTS vezes seguidas; a execução não foi registrada." >&2
exit 1
