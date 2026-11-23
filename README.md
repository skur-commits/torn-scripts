# Toppzy Manager – bazaar manager for Torn

A Tampermonkey userscript that gives you a full overview of your bazaar, suggests prices and lets you **plan changes anywhere (even while flying)** and **apply them in Torn with one click**.

**Install:** open [toppzy-bazaar-manager.user.js](https://raw.githubusercontent.com/skur-commits/torn-scripts/main/toppzy-bazaar-manager.user.js) with Tampermonkey installed and press *Install*. Updates arrive automatically.

## Getting started
1. Create a Torn API key with level **Limited** (Settings → API Keys). Limited is needed to read your own bazaar.
2. Click the 🏪 button in Torn's bottom bar (next to Notes) → 🔑 → paste the key.
3. Your bazaar loads into **🏪 Bazaar list**. Everything you have ever had in your bazaar stays in the list – also when it is sold out (0). Add new items under **➕ Add from inventory** (Scan now, filter by category, sort by name / amount / value).

## Buttons
| Button | What it does |
|---|---|
| 📝 Planmode | Prepare everything (prices and refill amounts per item) – nothing happens in Torn until you apply |
| ▶ Apply plan | Opens Manage / Add items / Personalize one at a time and fills everything in your plan. You press Torn's own button (SAVE CHANGES / ADD TO BAZAAR / change details), which is highlighted in yellow. Not possible while traveling – your plan is kept |
| 📦 Fill up | Refill the items in your list (amount from Settings: Fill all / Fill all −1 / All but N / %) |
| 💲 Adjust prices | Only prices, from your price setting – also for empty items, so the refill is priced too (locked prices are never touched) |
| 🔓 / 🔒 | Open or close your bazaar (Personalize page) |
| ⚙ (per item) | Own price strategy and floor for one item + Reset to default |
| ✕ (per item) | Empty item: removed from the list at once. Item for sale: asks, then removes it from your bazaar and the list |
| ⟳ (top right) | Refresh prices – shows how long ago it was last done |

Outside the bazaar pages (or while traveling) the quick buttons add to your plan. On the bazaar pages they fill in right away.

## Prices
- **Suggested** = cheapest seller (Item Market + bazaars) minus $1, by default ignoring the single cheapest listing and never below 90 % of market value (*Balanced*). Other presets: *Sell fast*, *Max profit*, *Custom*.
- **Change price** = your own price (locked). **⇐** copies the suggestion.
- **Floor** = never sell below. Automatic for items you have seen in a shop abroad, or set it per item.
- Weapons and armor get no automatic price (quality and bonuses vary).
- Before applying, the script warns you if the market moved since you planned.

## Safety
- The script **only fills fields** – you always press *Save changes*, *Add to bazaar* or *change details* yourself.
- Your API key is stored only in your browser (Tampermonkey) and only sent to `api.torn.com`.
- Bazaar prices of other players come from the free service [weav3r.dev](https://weav3r.dev) (no key is sent). Can be turned off under Settings → Advanced.

Like the script? Send a Xanax to [Toppzy [4422625]](https://www.torn.com/profiles.php?XID=4422625).
