# Shopkeeper – bazaar manager for Torn

A Tampermonkey userscript that gives you a full overview of your bazaar, suggests prices with an automatic safety floor and lets you **prepare changes anywhere (even while flying)** and **apply them in Torn with one click**.

**Install:** open [shopkeeper.user.js](https://raw.githubusercontent.com/skur-commits/torn-scripts/main/shopkeeper.user.js) with Tampermonkey installed and press *Install*. Updates arrive automatically.

*(The author's own copy is `toppzy-bazaar-manager.user.js` – «Toppzy Manager» in Tampermonkey. It is the same script; `shopkeeper.user.js` is built from it with `python3 tools/make-public.py`. Moving from one to the other: ⚙ → 💾 Export, then Import in the other one.)*

**TornPDA (phone):** add the same file as a userscript in TornPDA. The script sees that it runs in TornPDA, uses your PDA API key automatically and shows the phone layout (one card per item, full screen). Change it under ⚙ → 📱 Layout (Auto / Mobile / Desktop).

## Getting started
1. Create a Torn API key with level **Limited** (Settings → API Keys). Limited is needed to read your own bazaar.
2. Click the 🏪 button in Torn's bottom bar (next to Notes) → 🔑 → paste the key and press *Save key*. The Terms of Service table below is shown in the same place.
3. Your bazaar loads into **🏪 Bazaar list**. Everything you have ever had in your bazaar stays in the list – also when it is sold out (0). Add new items under **➕ Add from inventory** (Scan now, filter by category, sort by name / amount / value).

## Simple and Advanced
- **Simple** (default): only the main numbers – In bazaar, Inv, Price, New price (with the suggestion as a blue ⇐ button), Refill to and Status. On a phone the status is a coloured dot.
- **Advanced**: also Lowest Item Market, Lowest / Avg bazaar, Market and Suggested.

## Buttons
| Button | What it does |
|---|---|
| ▶ Apply (N) | Opens Manage / Add items / Personalize one at a time and fills in all your changes. Then press the big green button in the panel (💾 SAVE CHANGES / ➕ ADD TO BAZAAR / ✔ CHANGE DETAILS) – one click presses Torn's own button once – or press Torn's button yourself (highlighted in yellow). When Torn asks *Are you sure…?* after ADD TO BAZAAR, the panel shows ✔ CONFIRM ADD for that last step. The list updates itself afterwards. Not possible while traveling – your changes are kept |
| 📦 Fill all | Refill all items in your list (amount from Settings: Everything in inventory / All −1 / All but N / %). Items where a shop pays more are skipped |
| 💲 Adjust all prices | Suggested price on all items – also empty ones, so the refill is priced too (your own prices are never touched) |
| Refill to + Max | How many you want in your bazaar **in total**. Max = everything you have. «+N» shows how many will be added |
| 🔓 / 🔒 | Open or close your bazaar (Personalize page) |
| ⚙ (per item) | Own price strategy, **fixed price** (📌 – always this price, e.g. Beer = $1,000) and floor for one item, Reset to default, Remove item |
| ✕ (Advanced) | Empty item: removed from the list at once. Item for sale: asks, then removes it from your bazaar and the list |
| ⟳ · ⚙ · 🔑 · ▁ (top right) | Refresh prices · Settings · API key · Minimize the panel (▢ restores it) |

Outside the bazaar pages (or while traveling) the buttons only prepare changes. On the bazaar pages they fill in right away. The panel stays in a fixed spot at the top right, so it no longer jumps when you switch tabs. If you click while prices are still being checked, the panel shows *Waiting for the price check to finish …* and carries on by itself.

## Prices and floor
- **Suggested** = cheapest seller (Item Market + bazaars) minus $1, by default ignoring the single cheapest listing and never below 90 % of market value (*Balanced*). Other presets: *Sell fast*, *Max profit* (the highest of market value, average bazaar price and the Balanced price, minus $1 – never lower than Balanced), *Custom*.
- **💎 Rare items** (fewer than 5 Item Market listings, e.g. Office Chair): never priced below the cheapest Item Market listing −1 %. Bazaar averages say little for rare items. Turn off or adjust under ⚙ → Advanced. Marked *rare* in Advanced view.
- **📌 Fixed price** (⚙ on the item): always this price – strategy, floor and the rare rule are ignored.
- **🔒 Floor** = never sell below. Automatic on every item: the highest of **a % of the market value you choose** (85 % by default, change it in Settings), **what Torn's shops pay** and **what you paid abroad**. Set your own floor per item with ⚙ (0 = no floor). Hover 🔒 to see which one applies.
- **Sell to shop**: when a shop pays as much as the cheapest seller, the item gets a purple status – sell it in the shop yourself.
- A price you type yourself below the floor turns red, and ▶ Apply asks you to confirm (or use the floor price) first.
- Weapons and armor get no automatic price (quality and bonuses vary).
- Before applying, the script warns you if the market moved since you set the price.

## Backup and moving devices
⚙ → 💾 **Export** gives you all settings, your bazaar list, per-item settings and fixed prices as text (your API key is never included). Paste it into Shopkeeper on another browser or TornPDA and press **Import**.

## Safety
- The script **only fills fields** – you always press *Save changes*, *Add to bazaar*, *Confirm* or *change details* yourself.
- Your API key is stored only in your browser (Tampermonkey) and only sent to `api.torn.com`.
- Bazaar prices of other players come from the free service [weav3r.dev](https://weav3r.dev) (no key is sent). Can be turned off under Settings → Advanced.

### Torn API – Terms of Service
| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
|---|---|---|---|---|
| Only locally in your browser (script storage) | Nobody. Only item IDs (no key, no personal data) are sent to weav3r.dev for public bazaar prices – can be turned off | Personal bazaar management: show your bazaar, inventory and market prices and suggest prices | Stored only in your browser, only sent to api.torn.com, never shared | **Limited** – user (basic, bazaar, inventory), market (itemmarket), torn (items) |

Like the script? Send a Xanax to [Toppzy [4422625]](https://www.torn.com/profiles.php?XID=4422625).

**Closed bazaar:** Torn's API shows no items while your bazaar is closed. The script then keeps the last known amounts and shows «Bazaar closed». Open Bazaar → Manage and the amounts and prices are read straight from Torn's page.

**Torn's rules:** one click = one action. The script never saves, adds or opens anything by itself.

---

# Jumpy – happy-jump helper for Torn

Install: [jumpy.user.js](https://raw.githubusercontent.com/skur-commits/torn-scripts/main/jumpy.user.js) (Tampermonkey, or TornPDA → Userscripts). Open it with the yellow 😊 button in Torn's chat bar (bottom right).

- **Jumps:** 🎮 Console, 🍬 Candy, 📀 eDVD. Settings: Xanax / candy / eDVD per jump, candy type, energy refill, your job and stars (read from the API), Voracity, book, World Diabetes Day, eDVD finisher.
- **Overview:** energy, expected gain, happy → target before Ecstasy with the quarter-hour tick timer, drug and booster cooldowns, **Next jump** countdown, and the items this jump needs (green = in your inventory, red = missing).
- **▶ Start jump** – warns if items are missing. If you already have more than 750 energy, the Xanax step is skipped.
- **Steps** – only the next step can be pressed. Jumpy follows your progress from the API (energy, happy, cooldowns, points); **✓** marks a step done yourself. A warning shows if the first happy step is too close to the next tick.
- **Gym** – the panel shrinks to a strip with energy, happy and the next step (⚡ REFILL → Points).
- **0.1.0:** item buttons open the Items page and mark the item – you press Torn's Use. One-click use comes when the Items page is mapped.

Safety: nothing happens by itself – every action is one click by you on Torn's own pages. API key: Limited, stored only in your browser, only sent to api.torn.com (terms table in ⚙️ Settings).
