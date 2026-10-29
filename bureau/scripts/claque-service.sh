#!/bin/bash
# Lance (ou retire) l'écoute des claquements de mains à chaque ouverture de session :
#   npm run claque-installer      npm run claque-desinstaller
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:$PATH"
if ! command -v node > /dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
# Charge le service ; « Bootstrap failed: 5 » arrive quand l'ancien n'est pas encore déchargé : on attend, puis on réessaie à l'ancienne.
charger() {
  launchctl bootout "gui/$(id -u)/$NOM" > /dev/null 2>&1
  launchctl unload "$PLIST" > /dev/null 2>&1
  sleep 2
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2> /dev/null && return 0
  sleep 2
  launchctl load -w "$PLIST" 2> /dev/null && return 0
  echo "⚠️  macOS refuse de charger le service. Essaie de te déconnecter puis reconnecter, ou lance : npm run claque-desinstaller puis npm run claque-installer."
  return 1
}
NOM="fr.bureau.claque"
PLIST="$HOME/Library/LaunchAgents/$NOM.plist"
JOURNAL="$HOME/Library/Logs/Bureau-claque.log"

case "${1:-}" in
  installer)
    if [ "${2:-}" = "terminal" ]; then
      # mode de secours : le Terminal (qui a le droit d'utiliser le micro) lance l'écoute, dans une fenêtre cachée
      if [ "$(uname)" != "Darwin" ]; then echo "Ça ne marche que sur Mac."; exit 1; fi
      mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$JOURNAL")"
      cat > "$PLIST" <<PLISTE
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$NOM</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/open</string><string>-g</string><string>-j</string><string>-a</string><string>Terminal</string><string>$RACINE/scripts/claque.command</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLISTE
      pkill -f "server/claque.ts" > /dev/null 2>&1
      charger && echo "✅ C'est en place (mode Terminal caché) : claque trois fois. Il se relance à chaque ouverture de session."
      echo "   Si macOS demande d'autoriser le Terminal à utiliser le micro, accepte."
      exit 0
    fi
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
    charger && echo "✅ C'est en place : claque trois fois dans tes mains pour allumer Max (il se relance à chaque ouverture de session)."
    echo "   Journal : $JOURNAL (il dit s'il n'entend rien : le micro doit être autorisé)."
    ;;
  statut)
    echo "— Service : $(launchctl print "gui/$(id -u)/$NOM" > /dev/null 2>&1 && echo "installé" || echo "PAS installé (npm run claque-installer)")"
    echo "— Programme d'écoute : $(pgrep -f "server/claque.ts" > /dev/null && echo "en marche" || echo "ARRÊTÉ")"
    echo "— Les 15 dernières lignes du journal ($JOURNAL) :"
    tail -n 15 "$JOURNAL" 2> /dev/null || echo "(vide)"
    ;;
  desinstaller)
    pkill -f "scripts/claque.command" > /dev/null 2>&1
    launchctl bootout "gui/$(id -u)/$NOM" > /dev/null 2>&1
    rm -f "$PLIST"
    echo "✅ L'écoute des claquements est retirée."
    ;;
  *) echo "Usage : claque-service.sh installer [terminal]|statut|desinstaller"; exit 1 ;;
esac
