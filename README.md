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

## Faction scan (officers)

Optional. If your key has faction access and your faction role has API access, a "Faction scan"
panel appears after Analyze. It pools every member's attacks so one member's open fight can help
identify a stealthed hit on another. The first run can take a long time, so the page shows an
estimate first and only starts when you press Start (you can cancel; fetched logs are kept).
Everything stays on your device: nothing is uploaded and there is no server.

## Run the tests

    npm test

(Node 20+; no dependencies.)

## Run locally

    python -m http.server 8765

(on Windows you may need `py -m http.server 8765`)

then open http://localhost:8765/.

## Releasing a change

Bump the `?v=` number on the `<script>` tag in `index.html` and on every `import` in `src/`
(all to the same new value) so visitors' browsers load the new code instead of a cached copy.
`npm test` fails if they don't match.
