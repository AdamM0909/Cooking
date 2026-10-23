# Browser checks

End-to-end checks that drive the real site in a headless browser. They complement the fast unit tests in
`tests/` (which CI runs on every pull request) and are run by hand before a release.

| File | What it proves |
| --- | --- |
| `core-flows.cjs` | Paste to save, photo upload, tags, shopping list merge, cook mode with timers, share link, backup, offline reload |
| `paste-flows.cjs` | A real pasted recipe plus a method in several layouts; footer version; update banner |
| `security.cjs` | Script injection through every field stays inert, hostile backups and addresses are handled, no prototype pollution |
| `failure-modes.cjs` | Damaged, blocked or full browser storage; missing data files; 100 recipes with photos |
| `accessibility.cjs` | axe-core finds no violations on any screen, light or dark, phone or desktop |
| `keyboard-and-layout.cjs` | Everything works by keyboard; no sideways scrolling from 320 to 1920 px; reduced motion is honoured |
| `round-trips.cjs` | Paste, save, edit, backup, restore, export, share and delete leave the data exact |

## Run them

```
npm install --no-save playwright-core axe-core    # once
npm run serve &                                    # http://localhost:8000
CHROMIUM=/path/to/chromium npm run e2e             # or leave CHROMIUM unset if Playwright's browser is installed
npm run e2e -- security                            # just one
```

`KITCHEN_URL` points at a different address, for example the published site (note that the checks write recipes
into the browser profile they create, never into the site itself).
