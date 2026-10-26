#!/bin/bash
# Arrête le Bureau qui tourne en arrière-plan (démarré par « réveille Max »).
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:$PATH"
if ! command -v node > /dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
cd "$(dirname "$0")/.." || exit 1
eval "$(npx --no-install tsx server/infos.ts)"
FICHIER="$DONNEES/serveur.pid"

if [ ! -f "$FICHIER" ]; then
  echo "Le Bureau n'est pas allumé."
  exit 0
fi
PID="$(cat "$FICHIER")"
if ! kill -0 "$PID" 2> /dev/null; then
  rm -f "$FICHIER"
  echo "Le Bureau n'était pas allumé."
  exit 0
fi
kill "$PID"
for _ in $(seq 1 20); do
  kill -0 "$PID" 2> /dev/null || break
  sleep 0.5
done
kill -0 "$PID" 2> /dev/null && kill -9 "$PID"
rm -f "$FICHIER"
echo "Le Bureau est arrêté."
