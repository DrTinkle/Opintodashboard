#!/usr/bin/env sh
# Opintodashboardin asennus macOS:lle ja Linuxille.
# Käyttö:  sh setup.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js puuttuu (vaaditaan versio 18 tai uudempi)."
  if command -v brew >/dev/null 2>&1; then
    printf "Asennetaanko Node.js nyt Homebrew'lla (brew install node)? [k/E] "
    read -r ans || ans=""
    case "$ans" in
      k|K|y|Y) brew install node ;;
      *) echo "Asenna Node.js LTS osoitteesta https://nodejs.org ja aja setup.sh uudelleen."; exit 1 ;;
    esac
  else
    echo "Asenna Node.js LTS osoitteesta https://nodejs.org (tai jakelusi paketinhallinnalla)"
    echo "ja aja setup.sh uudelleen."
    exit 1
  fi
fi

node src/setup.js

printf "Käynnistetäänkö dashboard nyt? [k/E] "
read -r ans || ans=""
case "$ans" in
  k|K|y|Y) exec node src/server.js ;;
  *) echo "Käynnistä myöhemmin komennolla: npm start" ;;
esac
