# Mugger ID

A small web page for Torn players: paste your own API key and see who has most likely been
stealth-mugging you.

Stealth hides an attacker's name, but the fight log still shows their weapons, damage, fair fight
and timing. Mugger ID compares each stealthed mug with the players who have attacked you openly
and ranks likely suspects as High, Medium or Low. **Suspects are probable, not proof.**

## Your API key

Your API key is stored only on your own device (and only if you tick "remember"). It is never sent
to or stored by this site — it goes straight to api.torn.com, in a request header. There is no
server: this repository is the whole app, so you can check every line.

A **Limited** key is enough.

## Run the tests

    npm test

(Node 20+; no dependencies.)

## Run locally

    python -m http.server 8765

(on Windows you may need `py -m http.server 8765`)

then open http://localhost:8765/.
