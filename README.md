# UrWelcome — Sports Betting Research Terminal

> **Core Purpose:** *"What bets are available for this game, and how have they performed recently?"*

**UrWelcome** is a minimal, fast, and neutral sports betting research terminal for upcoming **NFL**, **MLB**, and **NHL** games. Inspired by the clean, data-dense UX of professional financial and sports research terminals.

**UrWelcome is strictly an informational research tool.** It does not accept wagers, place bets, handle deposits, or predict the future. The user makes all research and betting decisions.

---

## 🌟 Key Features & Customizations

### 1. Pinned Favorite Teams Hub (`★ MY TEAMS`) — Yellow/Gold Glow
* **Permanent Home Top Section:** Next upcoming games for your favorite teams are permanently pinned at the top:
  * 🏈 **New England Patriots** (NFL) — Next matchup, kickoff time, venue, records, spread/total/ML summary.
  * 🏒 **Boston Bruins** (NHL) — Next matchup, puck drop time, venue, records, puck line/total/ML summary.
  * ⚾ **Boston Red Sox** (MLB) — Next matchup, Fenway Park date/time, run line/total/ML summary.
* **Warm Yellow/Gold Terminal Glow:** Features glowing gold borders, badges, and card hover effects (`box-shadow: 0 0 28px rgba(251, 191, 36, 0.2)`).
* **One-Click Direct Access:** Clicking any pinned card immediately launches that game's research page (`Research Bets →`).

### 2. Mathematically Analyzed 5-Leg Parlays (+335 to +600 Odds)
Every single game across NFL, MLB, and NHL features a dedicated **PARLAY RESEARCH · MATHEMATICALLY VERIFIED** card:
* **Target Odds Range:** All 5-leg parlays are mathematically constrained between **`+335` and `+600`** odds.
* **Optimization Goal:** Selects individual bets with the **highest probability of hitting** (85%–100% individual hit rates in recent 10 games) while maximizing payout within the target window.
* **Exact Multiplier Calculation:**
  $$\text{Cumulative Multiplier } M = \prod_{i=1}^5 M_i$$
  $$\text{American Odds } = +(M - 1) \times 100$$
* **DraftPicks vs. Fliff Comparison:** Side-by-side odds comparison with `BEST VALUE` highlighting.
* **One-Click Copy:** `📋 Copy Parlay Slip` button copies the exact breakdown to the clipboard with confirmation toast (`✓ Copied to Clipboard!`).

### 3. Glowing Blue Cursor Hover Effects
* Hovering over any game card, bet card, parlay card, stat box, sportsbook tag, or navigation button illuminates a custom **blue glow matching the dark terminal background** (`box-shadow: 0 0 24px rgba(56, 189, 248, 0.35)`).

### 4. Prominent Player Names on Prop Cards
* Player names are the dominant bold header on all player prop cards (e.g. `JOSH ALLEN`, `DAVID PASTRNAK`, `AARON JUDGE`, `DRAKE MAYE`), followed by the specific market line.

### 5. Exact Line Hit Rate Analysis (Bold 7/10 Format)
* Displays Last 3, Last 5, and Last 10 hit rates in high-contrast monospace format:
  * **Last 3:** `2/3 (67%)`
  * **Last 5:** `4/5 (80%)`
  * **Last 10:** `7/10 (70%)`
* **Dynamic Line Steppers (`[-]` / `[+]`):** Adjust lines in real-time to recalculate hit rates and game logs on the fly.
* **Expandable 10-Game Audit Table:** `▼ View 10-Game Results` expands a verified audit log with real team names, actual stats, differentials, and checkmarks (`✓` / `✕`).

---

## 🏗️ Codebase Structure

```
/Users/carterdayton/.gemini/antigravity/scratch/sports-betting-research/
├── index.html        # Complete standalone bundle (Zero-CORS, works everywhere)
├── styles.css        # Dark terminal stylesheet with gold glow and blue hover glows
├── liveService.js    # Live data service with 94-team directory & player prop generators
├── data.js           # Research data layer & mathematical parlay odds calculation
├── app.js            # UrWelcome controller, event handling & dynamic recalculator
├── server.pl         # Perl HTTP server on port 8080 (0.0.0.0 binding)
└── README.md         # Product documentation
```

---

## 🚀 Live Access

* **Local Terminal Server:** [http://localhost:8080/](http://localhost:8080/)
* **Same Wi-Fi Network Link:** `http://192.168.1.152:8080/`
* **Direct File:** [index.html](file:///Users/carterdayton/.gemini/antigravity/scratch/sports-betting-research/index.html)
