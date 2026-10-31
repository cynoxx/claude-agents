#!/bin/bash
# L'écoute des claquements, lancée dans une fenêtre du Terminal cachée (mode « terminal » de claque-service.sh) :
# le Terminal a déjà le droit d'utiliser le micro, ce qui évite le refus de macOS pour un programme sans fenêtre.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:$PATH"
if ! command -v node > /dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
cd "$(dirname "$0")/.." || exit 1
while true; do
  npx --no-install tsx server/claque.ts 2>&1 | tee -a "$HOME/Library/Logs/Bureau-claque.log"
  sleep 5
done
