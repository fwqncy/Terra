# Working on Terra (for humans and AI agents)

## Interface rules
Follow the [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines). In this codebase that means:

- **Keyboard first.** Every pointer interaction needs a keyboard path (see the colour wheel, chart crosshairs and the Ops facility list). Keep `:focus-visible` rings visible.
- **URL as state.** Tabs, filters, sort, pagination, maps and modes are query params read through `withComponentInputBinding()` inputs. Never keep them only in a signal.
- **Links are links** (`routerLink` on `<a>`). Buttons only perform actions.
- **No `transition: all`.** Animate `transform`/`opacity`. Respect `ThemeService.reducedMotion()` and `[data-motion='reduce']`.
- **Don't pre-disable actions.** Style unaffordable or unavailable actions (`.is-unaffordable`) and explain on click with a toast.
- **Loading buttons keep their label** and set `aria-busy`. Destructive actions go through `ConfirmService` or offer Undo.
- **Copy:** Title Case for buttons and headings, the ellipsis character (…) for follow-ups, numerals, `Intl` formatting via `core/format.ts`, and ` ` between numbers and units.
- **Status is never colour-only:** icon + label (`.badge--good/warning/serious/critical`).
- **Angular strips whitespace between elements.** Use `{{ ' ' }}` where adjacent inline elements need a real space.

## Colour
- Theme tokens come from `deriveTokens()` in `web/src/app/core/theme.service.ts`. Don't hard-code UI colours; use the CSS variables.
- Text tokens are adjusted until they meet APCA Lc (body 75, secondary 60, muted 45). `theme.spec.ts` enforces this for every preset in both modes.
- Chart series colours are the validated categorical slots (`--series-road/air/sea`), never theme colours.

## Engine
- `web/src/engine` is framework-free ES modules. Add JSDoc types to public APIs (TypeScript consumes them with `allowJs`).
- Anything the server mirrors (logistics sim, economy) must stay in parity. Run `node tools/parity-fixtures.mjs`, then `dotnet test`.
- Run `npm run test:engine` in `web/` after engine changes.

## Checks before you finish
```bash
make test && make e2e
```
