# Toppzy Manager – bazaar manager for Torn

A Tampermonkey userscript that gives you a full overview of your bazaar, suggests prices and lets you **plan changes anywhere (even while flying)** and **apply them in Torn with one click**.

**Install:** open [toppzy-bazaar-manager.user.js](https://raw.githubusercontent.com/skur-commits/torn-scripts/main/toppzy-bazaar-manager.user.js) with Tampermonkey installed and press *Install*. Updates arrive automatically.

## Getting started
1. Create a Torn API key with level **Limited** (Settings → API Keys). Limited is needed to read your own bazaar.
2. Click the 🏪 button in Torn's bottom bar (next to Notes) → 🔑 → paste the key.
3. Your bazaar loads. Everything you have ever had in your bazaar stays in the list – also when it is sold out (0).

## Buttons
| Button | What it does |
|---|---|
| 📝 Plan | Plan mode – set refill amounts per item |
| ▶ Apply plan | Opens Manage / Add items / Personalize one at a time and fills everything in your plan. You press Save yourself |
| 📦 Fill up | Refill your items (amount from Settings: all / all but N / %) |
| 💲 Adjust prices | Only prices, from your price setting (locked prices are never touched) |
| 🔓 / 🔒 | Open or close your bazaar (Personalize page) |
| ⚙ (per item) | Own price strategy and floor for one item + Reset to default |
| ✕ (per item) | Remove all of that item from your bazaar and from the list |

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
