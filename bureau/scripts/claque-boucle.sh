#!/bin/bash
# L'écoute des claquements, lancée par l'app « Max Oreille » (qui a le droit d'utiliser le micro) : relancée si elle s'arrête.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"
if ! command -v node > /dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
cd "$(dirname "$0")/.." || exit 1
JOURNAL="$HOME/Library/Logs/Bureau-claque.log"
while true; do
  echo "— $(date '+%d/%m %H:%M:%S') l'écoute démarre (app Max Oreille)" >> "$JOURNAL"
  ./node_modules/.bin/tsx server/claque.ts >> "$JOURNAL" 2>&1
  sleep 5
done
