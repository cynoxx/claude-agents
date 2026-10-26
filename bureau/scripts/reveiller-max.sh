#!/bin/bash
# « Dis Siri, réveille Max » : démarre le Bureau s'il ne tourne pas, réveille Max et ouvre la page.
# Le raccourci de l'app Raccourcis exécute simplement ce script.
set -u

# Siri et Raccourcis ne chargent pas le profil du Terminal : on ajoute les dossiers habituels de Homebrew et de Node.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:$PATH"
if ! command -v node > /dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
if ! command -v node > /dev/null 2>&1; then
  echo "Node.js est introuvable : installe-le avec « brew install node »." >&2
  exit 1
fi

cd "$(dirname "$0")/.." || exit 1
eval "$(npx --no-install tsx server/infos.ts)"
URL="http://127.0.0.1:$PORT"
JOURNAL="${BUREAU_JOURNAL:-$HOME/Library/Logs/Bureau.log}"
mkdir -p "$(dirname "$JOURNAL")"

if ! curl -fs "$URL/api/sante" > /dev/null 2>&1; then
  # La page n'est reconstruite que si elle manque ou si le code a changé.
  if [ ! -f web/dist/index.html ] || [ -n "$(find web shared -type f -newer web/dist/index.html -not -path 'web/dist/*' | head -1)" ]; then
    npx --no-install vite build --logLevel warn >> "$JOURNAL" 2>&1
  fi
  BUREAU_NO_OPEN=1 nohup npx --no-install tsx server/index.ts >> "$JOURNAL" 2>&1 &
  disown
  for _ in $(seq 1 60); do
    curl -fs "$URL/api/sante" > /dev/null 2>&1 && break
    sleep 0.5
  done
fi

if ! curl -fs "$URL/api/sante" > /dev/null 2>&1; then
  echo "Le Bureau n'a pas démarré. Regarde le journal : $JOURNAL" >&2
  exit 1
fi

JETON="$(cat "$DONNEES/jeton" 2> /dev/null)"
curl -fs -X POST -H "x-bureau-jeton: $JETON" "$URL/api/reveil" > /dev/null 2>&1
"${BUREAU_OUVRIR:-open}" "http://localhost:$PORT"
