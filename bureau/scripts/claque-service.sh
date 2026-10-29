#!/bin/bash
# Lance (ou retire) l'écoute des claquements de mains à chaque ouverture de session :
#   npm run claque-installer      npm run claque-desinstaller
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:$PATH"
if ! command -v node > /dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
NOM="fr.bureau.claque"
PLIST="$HOME/Library/LaunchAgents/$NOM.plist"
JOURNAL="$HOME/Library/Logs/Bureau-claque.log"

case "${1:-}" in
  installer)
    if [ "$(uname)" != "Darwin" ]; then echo "Ça ne marche que sur Mac."; exit 1; fi
    NODE_BIN="$(dirname "$(command -v node)")"
    mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$JOURNAL")"
    cat > "$PLIST" <<PLISTE
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$NOM</string>
  <key>ProgramArguments</key><array>
    <string>$RACINE/node_modules/.bin/tsx</string><string>$RACINE/server/claque.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$RACINE</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$JOURNAL</string>
  <key>StandardErrorPath</key><string>$JOURNAL</string>
</dict></plist>
PLISTE
    launchctl bootout "gui/$(id -u)/$NOM" > /dev/null 2>&1
    launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "✅ C'est en place : claque trois fois dans tes mains pour allumer Max (il se relance à chaque ouverture de session)."
    echo "   Journal : $JOURNAL (il dit s'il n'entend rien : le micro doit être autorisé)."
    ;;
  desinstaller)
    launchctl bootout "gui/$(id -u)/$NOM" > /dev/null 2>&1
    rm -f "$PLIST"
    echo "✅ L'écoute des claquements est retirée."
    ;;
  *) echo "Usage : claque-service.sh installer|desinstaller"; exit 1 ;;
esac
