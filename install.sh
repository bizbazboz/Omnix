#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  Omnix TUI installer
#  Pure bash, no dependencies (no dialog/whiptail). Run: sudo bash install-omnix.sh
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REPO_URL="https://github.com/bizbazboz/Omnix.git"

# ── Settings (editable in the UI) ─────────────────────────────────────────────
BASE_DIR="/srv/Omnix"
REPO_DIR="${BASE_DIR}/repo"
REPO_CUSTOM=0
HTTP_PORT="${HTTP_PORT:-8080}"
BIND_ADDRESS="0.0.0.0"
IMAGE="ghcr.io/bizbazboz/omnix:latest"
BRANCH="main"

# ── Root / TTY handling ───────────────────────────────────────────────────────
if (( EUID != 0 )); then
  if command -v sudo >/dev/null 2>&1 && [[ -f $0 ]]; then
    exec sudo -E bash "$0" "$@"
  fi
  echo "Run this script as root: sudo bash install-omnix.sh" >&2
  exit 1
fi

if [[ ! -t 0 ]]; then
  if [[ -r /dev/tty ]]; then exec </dev/tty; else
    echo "This installer needs an interactive terminal." >&2; exit 1
  fi
fi

# ── Look & feel ───────────────────────────────────────────────────────────────
RST=$'\e[0m'; BOLD=$'\e[1m'; DIM=$'\e[2m'
CYAN=$'\e[38;5;45m'; GREEN=$'\e[38;5;78m'; RED=$'\e[38;5;203m'
YEL=$'\e[38;5;221m'; GREY=$'\e[38;5;244m'; PURP=$'\e[38;5;141m'
SEL=$'\e[48;5;25m\e[38;5;255m\e[1m'

W=$(tput cols 2>/dev/null || echo 80); W=$((W - 4))
(( W > 70 )) && W=70
(( W < 40 )) && W=40
RULE=""; for ((i = 0; i < W; i++)); do RULE+="─"; done

BANNER=(
'  ___   __  __  _   _  ___ __  __'
' / _ \ |  \/  || \ | ||_ _|\ \/ /'
'| | | || |\/| ||  \| | | |  \  / '
'| |_| || |  | || |\  | | |  /  \ '
' \___/ |_|  |_||_| \_||___|/_/\_\'
)

LOG="/tmp/omnix-install-$(date +%Y%m%d-%H%M%S).log"
: > "$LOG"
NOTICE=""

have() { command -v "$1" >/dev/null 2>&1; }
ln()   { printf '%s\e[K\n' "$*"; }

cleanup() { printf '\e[?25h%s' "$RST"; }
trap cleanup EXIT
trap 'cleanup; echo; echo "Interrupted."; pkill -P $$ 2>/dev/null; exit 130' INT TERM

quit() { cleanup; echo; echo "Installation cancelled."; exit 0; }

header() {
  printf '\e[?25l\e[H'
  local colors=(51 45 39 33 99) i=0 line
  ln ""
  for line in "${BANNER[@]}"; do
    ln "  $(printf '\e[38;5;%sm' "${colors[i]}")${BOLD}${line}${RST}"
    i=$((i + 1))
  done
  ln "  ${GREY}container deployment installer${RST}"
  ln "  ${GREY}${RULE}${RST}"
  ln "  ${PURP}◆ ${BOLD}${1:-}${RST}"
  ln ""
}

footer() { ln ""; ln "  ${DIM}${1:-}${RST}"; printf '\e[J'; }

# ── Input primitives ──────────────────────────────────────────────────────────
readkey() {
  local k rest=""
  IFS= read -rsn1 k || { echo esc; return; }
  if [[ $k == $'\e' ]]; then
    IFS= read -rsn2 -t 0.05 rest || true
    case $rest in
      '[A') echo up ;;   '[B') echo down ;;
      '[C') echo right ;; '[D') echo left ;;
      *)    echo esc ;;
    esac
  elif [[ -z $k ]]; then echo enter
  elif [[ $k == $'\x7f' || $k == $'\b' ]]; then echo bksp
  else echo "$k"; fi
}

# menu TITLE SUBTITLE(multi-line ok) ITEMS...   -> MENU_IDX ; returns 1 on Esc
MENU_IDX=0
menu() {
  local title=$1 sub=$2; shift 2
  local items=("$@") n=$# sel=${MENU_DEFAULT:-0} key i l
  MENU_DEFAULT=0
  while true; do
    header "$title"
    if [[ -n $sub ]]; then
      while IFS= read -r l; do ln "  $l"; done <<<"$sub"
      ln ""
    fi
    for i in "${!items[@]}"; do
      if (( i == sel )); then ln "  ${SEL} ❯ ${items[i]} ${RST}"
      else ln "     ${items[i]}"; fi
    done
    footer "↑/↓ move · Enter select · Esc back"
    key=$(readkey)
    case $key in
      up|k)   sel=$(( (sel + n - 1) % n )) ;;
      down|j) sel=$(( (sel + 1) % n )) ;;
      enter)  MENU_IDX=$sel; return 0 ;;
      esc|q)  return 1 ;;
    esac
  done
}

INPUT=""
text_input() {  # TITLE PROMPT DEFAULT
  header "$1"
  ln "  $2"
  if [[ -n $NOTICE ]]; then ln "  ${RED}✖ ${NOTICE}${RST}"; NOTICE=""; fi
  ln ""
  printf '\e[J'
  printf '  %s❯%s \e[?25h' "$CYAN" "$RST"
  IFS= read -r -e -i "${3:-}" INPUT || INPUT=""
  printf '\e[?25l'
}

# Interactive folder browser -> BROWSED ; returns 1 if cancelled
BROWSED=""
browse_dir() {
  local cur=$1 sel=0 off=0 rows=10 key n i d name
  while [[ ! -d $cur && $cur != "/" ]]; do cur=$(dirname "$cur"); done
  local entries
  while true; do
    entries=("✔  Use this folder" "+  New folder here…" "↑  Parent folder")
    while IFS= read -r d; do entries+=("▸ $d"); done < <(
      find "$cur" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f\n' 2>/dev/null | sort -f)
    n=${#entries[@]}
    (( sel >= n )) && sel=$((n - 1))
    (( sel < off )) && off=$sel
    (( sel >= off + rows )) && off=$((sel - rows + 1))

    header "Choose a folder"
    ln "  ${GREY}Location${RST}  ${BOLD}${CYAN}${cur}${RST}"
    ln ""
    if (( off > 0 )); then ln "     ${GREY}↑ more${RST}"; else ln ""; fi
    for ((i = off; i < off + rows && i < n; i++)); do
      if (( i == sel )); then ln "  ${SEL} ❯ ${entries[i]} ${RST}"
      else ln "     ${entries[i]}"; fi
    done
    for (( ; i < off + rows; i++)); do ln ""; done
    if (( off + rows < n )); then ln "     ${GREY}↓ more${RST}"; else ln ""; fi
    footer "↑/↓ move · Enter open/select · ← parent · n new folder · Esc cancel"

    key=$(readkey)
    case $key in
      up|k)   sel=$(( (sel + n - 1) % n )) ;;
      down|j) sel=$(( (sel + 1) % n )) ;;
      left|bksp) cur=$(dirname "$cur"); sel=0; off=0 ;;
      n) sel=1; key=enter ;&
      enter)
        case $sel in
          0) BROWSED=$cur; return 0 ;;
          1) text_input "New folder" "Name of the folder to create in ${cur}" ""
             name=${INPUT//\//}
             if [[ -n $name ]] && mkdir -p "$cur/$name" 2>/dev/null; then cur="$cur/$name"; fi
             sel=0; off=0 ;;
          2) cur=$(dirname "$cur"); sel=0; off=0 ;;
          *) name=${entries[sel]#▸ }
             if [[ $cur == "/" ]]; then cur="/$name"; else cur="$cur/$name"; fi
             sel=0; off=0 ;;
        esac ;;
      esc|q) return 1 ;;
    esac
  done
}

PICKED=""
path_pick() {  # TITLE CURRENT
  menu "$1" "Current: ${BOLD}$2${RST}" "Browse folders…" "Type a path…" "Back" || return 1
  case $MENU_IDX in
    0) browse_dir "$2" || return 1; PICKED=$BROWSED ;;
    1) text_input "$1" "Enter an absolute path" "$2"
       [[ -n $INPUT ]] || return 1
       PICKED=$INPUT ;;
    *) return 1 ;;
  esac
  PICKED=$(realpath -m -- "$PICKED")
}

# ── System helpers (run inside install steps) ─────────────────────────────────
PM=""
detect_pm() {
  local p
  for p in apt-get dnf yum pacman apk zypper; do
    if have "$p"; then PM=$p; return; fi
  done
}

pkg_install() {
  export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
  case $PM in
    apt-get) apt-get update -y && apt-get install -y "$@" ;;
    dnf)     dnf install -y "$@" ;;
    yum)     yum install -y "$@" ;;
    pacman)  pacman -Sy --noconfirm "$@" ;;
    apk)     apk add --no-cache "$@" ;;
    zypper)  zypper -n install "$@" ;;
    *)       echo "No supported package manager found"; return 1 ;;
  esac
}

start_docker() {
  if have systemctl; then systemctl enable --now docker || true
  else service docker start || rc-service docker start || true; fi
  local t
  for t in $(seq 1 30); do docker info >/dev/null 2>&1 && return 0; sleep 1; done
  echo "Docker daemon did not become ready"; return 1
}

install_docker() {
  case $PM in
    pacman) pkg_install docker docker-compose ;;
    apk)    pkg_install docker docker-cli-compose; rc-update add docker default 2>/dev/null || true ;;
    *)      curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh ;;
  esac || return 1
  start_docker
}

install_compose() {
  pkg_install docker-compose-plugin || pkg_install docker-compose-v2 || pkg_install docker-compose || true
  docker compose version
}

dc() { ( cd "$REPO_DIR" && docker compose -f compose.yml "$@" ); }

git_clone()  { GIT_TERMINAL_PROMPT=0 git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$REPO_DIR"; }
git_update() { GIT_TERMINAL_PROMPT=0 git -C "$REPO_DIR" pull --ff-only; }

write_env() {
  cat > "${BASE_DIR}/omnix.env" <<EOF
# Written by install-omnix.sh. To manage manually:
#   set -a; . ${BASE_DIR}/omnix.env; set +a
#   docker compose -f ${REPO_DIR}/compose.yml up -d
OMNIX_IMAGE=${IMAGE}
OMNIX_DATA_DIR=${BASE_DIR}
BIND_ADDRESS=${BIND_ADDRESS}
HTTP_PORT=${HTTP_PORT}
EOF
}

# Runs a command in the background with an animated spinner + live log tail
run_step() {  # LABEL CMD...
  local label=$1; shift
  ( "$@" ) >>"$LOG" 2>&1 &
  local pid=$! i=0 snip="" max
  local frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
  max=$((W - ${#label} - 8)); (( max < 10 )) && max=10
  while kill -0 "$pid" 2>/dev/null; do
    if (( i % 6 == 0 )); then
      snip=$(tail -n1 "$LOG" 2>/dev/null | tr -d '\r\033' | cut -c1-"$max")
    fi
    printf '\r  %s%s%s %s  %s%s%s\e[K' "$CYAN" "${frames[i % 10]}" "$RST" "$label" "$GREY" "$snip" "$RST"
    i=$((i + 1)); sleep 0.08
  done
  local rc=0; wait "$pid" || rc=$?
  if (( rc == 0 )); then
    printf '\r  %s✔%s %s\e[K\n' "$GREEN" "$RST" "$label"
  else
    printf '\r  %s✖%s %s\e[K\n\n' "$RED" "$RST" "$label"
    ln "  ${RED}Step failed (exit ${rc}). Last log lines:${RST}"
    tail -n 12 "$LOG" | sed "s/^/    ${GREY}/; s/\$/${RST}/"
    echo
    echo "  Full log: $LOG"
    exit 1
  fi
}

# ── Screens ───────────────────────────────────────────────────────────────────
welcome() {
  menu "Welcome" \
"This wizard will deploy ${BOLD}Omnix${RST} with Docker Compose.

  • choose where files live
  • installs git / Docker / Compose if missing
  • clones the repo, pulls the image, starts it" \
    "Begin setup" "Quit"
  (( $? == 0 && MENU_IDX == 0 ))
}

sync_paths() { (( REPO_CUSTOM )) || REPO_DIR="${BASE_DIR}/repo"; }

config_screen() {
  local sel=0 key n=8 i row labels vals
  while true; do
    sync_paths
    labels=("Install folder" "Repository folder" "HTTP port" "Bind address" "Docker image" "Git branch")
    vals=("$BASE_DIR" "$REPO_DIR" "$HTTP_PORT" "$BIND_ADDRESS" "$IMAGE" "$BRANCH")
    header "Step 1/3 · Configure"
    ln "  ${GREY}Pick a setting and press Enter to change it.${RST}"
    ln ""
    for i in 0 1 2 3 4 5; do
      printf -v row '%-18s %s' "${labels[i]}" "${vals[i]:0:$((W - 26))}"
      if (( i == sel )); then ln "  ${SEL} ❯ ${row} ${RST}"
      else ln "     ${GREY}${labels[i]}$(printf '%*s' $((19 - ${#labels[i]})) '')${RST}${CYAN}${vals[i]:0:$((W - 26))}${RST}"; fi
    done
    ln ""
    if (( sel == 6 )); then ln "  ${SEL} ❯ Continue →                ${RST}"; else ln "     ${GREEN}Continue →${RST}"; fi
    if (( sel == 7 )); then ln "  ${SEL} ❯ Cancel                    ${RST}"; else ln "     ${GREY}Cancel${RST}"; fi
    footer "↑/↓ move · Enter edit · Esc quit"

    key=$(readkey)
    case $key in
      up|k)   sel=$(( (sel + n - 1) % n )) ;;
      down|j) sel=$(( (sel + 1) % n )) ;;
      esc|q)  return 1 ;;
      enter)
        case $sel in
          0) path_pick "Install folder (data lives here)" "$BASE_DIR" && BASE_DIR=$PICKED ;;
          1) path_pick "Repository folder" "$REPO_DIR" && { REPO_DIR=$PICKED; REPO_CUSTOM=1; } ;;
          2) while true; do
               text_input "HTTP port" "Port Omnix will listen on (1-65535)" "$HTTP_PORT"
               [[ -z $INPUT ]] && break
               if [[ $INPUT =~ ^[0-9]+$ ]] && (( INPUT >= 1 && INPUT <= 65535 )); then HTTP_PORT=$INPUT; break; fi
               NOTICE="'$INPUT' is not a valid port"
             done ;;
          3) if menu "Bind address" "Who should be able to reach Omnix?" \
                "0.0.0.0     all interfaces (LAN access)" \
                "127.0.0.1   this machine only (reverse proxy)" \
                "Custom…"; then
               case $MENU_IDX in
                 0) BIND_ADDRESS="0.0.0.0" ;;
                 1) BIND_ADDRESS="127.0.0.1" ;;
                 2) text_input "Bind address" "IPv4 address to bind to" "$BIND_ADDRESS"
                    [[ $INPUT =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && BIND_ADDRESS=$INPUT ;;
               esac
             fi ;;
          4) text_input "Docker image" "Image to pull" "$IMAGE";   [[ -n $INPUT ]] && IMAGE=$INPUT ;;
          5) text_input "Git branch" "Branch to clone" "$BRANCH";  [[ -n $INPUT ]] && BRANCH=$INPUT ;;
          6) return 0 ;;
          7) return 1 ;;
        esac ;;
    esac
  done
}

# Preflight state
NEED_PKGS=(); NEED_DOCKER=0; START_DOCKER=0; NEED_COMPOSE=0; UPDATE=0
PORT_BUSY=0; FREE_MB=0; REPO_BAD=0

preflight() {
  NEED_PKGS=(); NEED_DOCKER=0; START_DOCKER=0; NEED_COMPOSE=0; UPDATE=0; PORT_BUSY=0; REPO_BAD=0
  detect_pm
  have git  || NEED_PKGS+=(git)
  have curl || NEED_PKGS+=(curl)
  if have docker; then
    docker info >/dev/null 2>&1 || START_DOCKER=1
    docker compose version >/dev/null 2>&1 || NEED_COMPOSE=1
  else
    NEED_DOCKER=1
  fi
  if have ss && ss -ltn 2>/dev/null | awk -v p=":${HTTP_PORT}" '$4 ~ p"$" {f=1} END{exit !f}'; then PORT_BUSY=1; fi
  local probe=$BASE_DIR
  while [[ ! -d $probe && $probe != "/" ]]; do probe=$(dirname "$probe"); done
  FREE_MB=$(df -Pm "$probe" 2>/dev/null | awk 'NR==2{print $4}'); FREE_MB=${FREE_MB:-0}
  if [[ -e $REPO_DIR ]]; then
    if [[ -d $REPO_DIR/.git ]]; then UPDATE=1; else REPO_BAD=1; fi
  fi
}

review() {  # 0=install 1=back 2=cancel
  local ip host plan="" os="Linux"
  [[ -r /etc/os-release ]] && os=$(. /etc/os-release; echo "${PRETTY_NAME:-Linux}")
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  host=${ip:-YOUR-CASAOS-IP}
  [[ $BIND_ADDRESS == "127.0.0.1" ]] && host="localhost"

  ok()   { plan+="${GREEN}✔${RST} $1"$'\n'; }
  warn() { plan+="${YEL}!${RST} $1"$'\n'; }
  bad()  { plan+="${RED}✖${RST} $1"$'\n'; }

  ok "System: ${os}"
  have git  && ok "git installed"  || warn "git will be installed"
  have curl && ok "curl installed" || warn "curl will be installed"
  if (( NEED_DOCKER )); then warn "Docker Engine will be installed"
  else
    ok "Docker installed"
    (( START_DOCKER )) && warn "Docker daemon will be started"
    (( NEED_COMPOSE )) && warn "Compose plugin will be installed" || ok "Docker Compose available"
  fi
  (( PORT_BUSY )) && warn "Port ${HTTP_PORT} is already in use" || ok "Port ${HTTP_PORT} is free"
  (( FREE_MB < 2048 )) && warn "Only ${FREE_MB} MB free (2 GB+ recommended)" || ok "${FREE_MB} MB free disk space"
  if (( UPDATE )); then warn "Existing repo found: will git pull + redeploy"
  elif (( REPO_BAD )); then bad "${REPO_DIR} exists and is not a git repo"; fi
  if (( ${#NEED_PKGS[@]} || NEED_DOCKER || NEED_COMPOSE )) && [[ -z $PM ]]; then
    bad "No supported package manager; install prerequisites manually"
    REPO_BAD=1
  fi

  local sub
  sub="Install folder  ${CYAN}${BASE_DIR}${RST}
Repository      ${CYAN}${REPO_DIR}${RST}
Image           ${CYAN}${IMAGE}${RST}
Open            ${GREEN}http://${host}:${HTTP_PORT}${RST}

${plan%$'\n'}"

  if (( REPO_BAD )); then
    menu "Step 2/3 · Review" "$sub" "Back to settings" "Cancel" || return 2
    (( MENU_IDX == 0 )) && return 1 || return 2
  fi
  menu "Step 2/3 · Review" "$sub" "Install now" "Back to settings" "Cancel" || return 1
  case $MENU_IDX in 0) return 0 ;; 1) return 1 ;; *) return 2 ;; esac
}

install() {
  export OMNIX_IMAGE="$IMAGE" OMNIX_DATA_DIR="$BASE_DIR" BIND_ADDRESS HTTP_PORT
  export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

  header "Step 3/3 · Installing"
  printf '\e[J'
  ln "  ${GREY}Log: ${LOG}${RST}"
  ln ""

  (( ${#NEED_PKGS[@]} )) && run_step "Installing ${NEED_PKGS[*]}" pkg_install "${NEED_PKGS[@]}"
  if (( NEED_DOCKER )); then run_step "Installing Docker Engine" install_docker
  elif (( START_DOCKER )); then run_step "Starting Docker daemon" start_docker; fi
  (( NEED_COMPOSE )) && run_step "Installing Docker Compose plugin" install_compose

  run_step "Preparing ${BASE_DIR}" mkdir -p "$BASE_DIR"
  if (( UPDATE )); then run_step "Updating repository" git_update
  else run_step "Cloning repository (${BRANCH})" git_clone; fi
  run_step "Validating compose file"  dc config --quiet
  run_step "Pulling image"            dc pull
  run_step "Starting containers"      dc up -d --no-build --pull always --remove-orphans
  run_step "Saving settings"          write_env

  local ip host
  ip=$(hostname -I 2>/dev/null | awk '{print $1}'); host=${ip:-YOUR-CASAOS-IP}
  [[ $BIND_ADDRESS == "127.0.0.1" ]] && host="localhost"
  echo
  ln "  ${GREEN}${BOLD}🚀 Omnix deployed!${RST}"
  ln ""
  ln "  Open        ${BOLD}${CYAN}http://${host}:${HTTP_PORT}${RST}"
  ln "  Data        ${BASE_DIR}"
  ln "  Repository  ${REPO_DIR}"
  ln "  Settings    ${BASE_DIR}/omnix.env"
  ln "  Logs        docker compose -f ${REPO_DIR}/compose.yml logs -f"
  echo
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  printf '\e[2J'
  welcome || quit
  while true; do
    config_screen || quit
    preflight
    review
    case $? in
      0) break ;;
      2) quit ;;
    esac
  done
  install
  cleanup
}

main "$@"