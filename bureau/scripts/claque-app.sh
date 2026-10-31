#!/bin/bash
# Les trois claquements, sans Terminal ouvert : une petite app invisible, « Max Oreille », dans ~/Applications.
# Pourquoi une app ? macOS ne donne le micro qu'aux apps qu'il connaît : un programme lancé en arrière-plan (launchd)
# reçoit du silence, sans rien demander. L'app, elle, demande l'accès au micro une fois (tu dis OK), et se lance à
# chaque ouverture de session (éléments de connexion).
#   npm run claque-installer      npm run claque-statut      npm run claque-desinstaller
set -u
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Max Oreille.app"
JOURNAL="$HOME/Library/Logs/Bureau-claque.log"
ANCIEN="$HOME/Library/LaunchAgents/fr.bureau.claque.plist"

arreter() {
  pkill -f "Max Oreille.app" > /dev/null 2>&1
  pkill -f "scripts/claque-boucle.sh" > /dev/null 2>&1
  pkill -f "scripts/claque.command" > /dev/null 2>&1
  pkill -f "server/claque.ts" > /dev/null 2>&1
}
retirer_ancien() {
  # l'ancien service launchd (sans micro) : retiré
  launchctl bootout "gui/$(id -u)/fr.bureau.claque" > /dev/null 2>&1
  rm -f "$ANCIEN"
}
retirer_connexion() {
  osascript -e 'tell application "System Events" to delete (every login item whose name is "Max Oreille")' > /dev/null 2>&1
}

case "${1:-}" in
  installer)
    [ "$(uname)" = "Darwin" ] || { echo "Ça ne marche que sur Mac."; exit 1; }
    command -v ffmpeg > /dev/null 2>&1 || [ -x /opt/homebrew/bin/ffmpeg ] || [ -x /usr/local/bin/ffmpeg ] || { echo "❌ Il faut ffmpeg : brew install ffmpeg"; exit 1; }
    chmod +x "$RACINE/scripts/claque-boucle.sh"
    arreter
    retirer_ancien
    retirer_connexion
    mkdir -p "$HOME/Applications" "$(dirname "$JOURNAL")"
    rm -rf "$APP"
    # 1. l'app : un petit AppleScript qui lance la boucle d'écoute et reste ouvert (sans icône dans le Dock)
    osacompile -o "$APP" -e "do shell script \"/bin/bash \" & quoted form of \"$RACINE/scripts/claque-boucle.sh\"" || { echo "❌ osacompile a échoué."; exit 1; }
    PL="$APP/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier fr.bureau.max-oreille" "$PL" 2> /dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string fr.bureau.max-oreille" "$PL"
    /usr/libexec/PlistBuddy -c "Add :CFBundleName string Max Oreille" "$PL" 2> /dev/null
    /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PL"
    /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string Max écoute tes trois claquements de mains pour s'allumer. Le son reste sur ton Mac." "$PL"
    # 2. signée sur ce Mac (sinon macOS ne retient pas l'autorisation du micro)
    codesign --force --deep -s - "$APP" > /dev/null 2>&1 || echo "⚠️  codesign a échoué (l'app marchera, mais macOS pourrait redemander le micro)."
    # 3. lancée à chaque ouverture de session
    osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$APP\", hidden:true, name:\"Max Oreille\"}" > /dev/null 2>&1 \
      || echo "⚠️  Je n'ai pas pu l'ajouter aux éléments de connexion : Réglages Système › Général › Ouverture › ajoute « Max Oreille » (dans ton dossier Applications perso)."
    # 4. lancée maintenant
    : > "$JOURNAL"
    open -g "$APP"
    echo "✅ « Max Oreille » est installée et lancée."
    echo "👉 Si macOS te demande « Max Oreille souhaite accéder au micro » : clique sur OK."
    echo "   (Pas de question ? Réglages Système › Confidentialité et sécurité › Microphone › coche « Max Oreille ».)"
    for _ in $(seq 1 15); do
      sleep 1
      grep -q "J'écoute les claquements" "$JOURNAL" 2> /dev/null && break
    done
    sleep 6
    if grep -q "Je n'entends rien" "$JOURNAL" 2> /dev/null; then
      echo "❌ Le micro est muet pour l'app : autorise « Max Oreille » dans Réglages › Confidentialité › Microphone, puis relance npm run claque-installer."
    elif grep -q "J'écoute les claquements" "$JOURNAL" 2> /dev/null; then
      echo "✅ L'écoute tourne : ferme le Terminal et claque trois fois (une seconde entre chaque) pour essayer."
    else
      echo "⚠️  L'écoute n'a pas encore démarré. Ce que dit le journal :"
      tail -n 8 "$JOURNAL" 2> /dev/null | sed 's/^/   /'
    fi
    ;;
  statut)
    echo "— App : $([ -d "$APP" ] && echo "installée ($APP)" || echo "PAS installée (npm run claque-installer)")"
    echo "— Écoute : $(pgrep -f "server/claque.ts" > /dev/null && echo "en marche" || echo "ARRÊTÉE (ouvre « Max Oreille » ou relance npm run claque-installer)")"
    echo "— Les 15 dernières lignes du journal ($JOURNAL) :"
    tail -n 15 "$JOURNAL" 2> /dev/null || echo "(vide)"
    ;;
  desinstaller)
    arreter
    retirer_ancien
    retirer_connexion
    rm -rf "$APP"
    echo "✅ L'écoute des claquements est retirée."
    ;;
  *) echo "Usage : claque-app.sh installer|statut|desinstaller"; exit 1 ;;
esac
