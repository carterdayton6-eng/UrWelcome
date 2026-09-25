#!/usr/bin/env python3
"""
UrWelcome FINAL MASTER PASS — apply all changes via Python string replacement.
Each section is labeled. Run this once then build.
"""
import re, sys

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'  ✓ wrote {path}')

def replace_once(content, old, new, label=''):
    if old not in content:
        print(f'  ✗ MISSING: {label or old[:60]!r}')
        sys.exit(1)
    if content.count(old) > 1:
        print(f'  ✗ AMBIGUOUS ({content.count(old)} hits): {label or old[:60]!r}')
        sys.exit(1)
    print(f'  ✓ replaced: {label or old[:60]!r}')
    return content.replace(old, new)

# ============================================================
# 1. liveService.js — filter STATUS_FINAL, sort by date
# ============================================================
print('\n[1] liveService.js — filter completed games + sort')
ls = read('liveService.js')

# Add a helper method `isCompletedEvent(ev)` to LiveDataService and use it
# to filter events BEFORE calling parseEventToGame.
# Insert after the existing allParsed / parsedGames filter block.

OLD_PARSE_BLOCK = '''      const allParsed = events.map(ev => this.parseEventToGame(ev, sport));
      // DATA VALIDATION: filter out any games where home === away (data artifact)
      const parsedGames = allParsed.filter(g => !g._invalid);
      if (allParsed.length !== parsedGames.length) {
        console.warn(`[LiveService] Filtered out ${allParsed.length - parsedGames.length} invalid matchups for ${sport}`);
      }

      this.cache.games[cacheKey] = {
        timestamp: Date.now(),
        data: parsedGames
      };
      return parsedGames;'''

NEW_PARSE_BLOCK = '''      // Filter out completed (STATUS_FINAL) events — show only UPCOMING and IN_PROGRESS
      // Games tagged LIVE (IN_PROGRESS) are always included
      const activeEvents = events.filter(ev => {
        const st = ev.status && ev.status.type;
        if (!st) return true; // keep if status unknown
        // Exclude only fully completed events
        if (st.completed === true) return false;
        if (st.name === 'STATUS_FINAL' || st.name === 'STATUS_FULL_TIME' ||
            st.name === 'STATUS_END_PERIOD' && st.completed) return false;
        return true;
      });

      const allParsed = activeEvents.map(ev => this.parseEventToGame(ev, sport));
      // DATA VALIDATION: filter out any games where home === away (data artifact)
      const parsedGames = allParsed.filter(g => !g._invalid);
      if (allParsed.length !== parsedGames.length) {
        console.warn(`[LiveService] Filtered out ${allParsed.length - parsedGames.length} invalid matchups for ${sport}`);
      }

      // Sort games chronologically by start time (soonest first)
      parsedGames.sort((a, b) => {
        const ta = a.rawDate ? new Date(a.rawDate).getTime() : 0;
        const tb = b.rawDate ? new Date(b.rawDate).getTime() : 0;
        return ta - tb;
      });

      this.cache.games[cacheKey] = {
        timestamp: Date.now(),
        data: parsedGames
      };
      return parsedGames;'''

ls = replace_once(ls, OLD_PARSE_BLOCK, NEW_PARSE_BLOCK, 'filter STATUS_FINAL + sort')

# Also expose gameStatus (UPCOMING / LIVE / FINAL) on the parsed game object
OLD_RETURN = '''    return {
      id: `live-${sport}-${ev.id}`,
      rawEventId: ev.id,
      sport,
      name: ev.name,
      awayTeam,
      homeTeam,
      date: this.formatGameDate(ev.date),
      rawDate: ev.date,
      startTime: this.formatGameTime(ev.date),
      venue: comp.venue && comp.venue.fullName ? comp.venue.fullName : (isUFC ? 'UFC Apex' : 'TBD'),
      headline: isUFC
        ? (ev._ufcEventName || ev.name || 'UFC Fight Night')
        : (ev.status && ev.status.type ? ev.status.type.description || ev.status.type.detail : 'Scheduled'),
      weightClass,
      summaryLines,
      rawOdds: oddsObj,
      _invalid: homeAwayMatch
    };'''

NEW_RETURN = '''    // Determine game lifecycle status
    const evStatus = ev.status && ev.status.type;
    const isLiveNow = evStatus && (
      evStatus.name === 'STATUS_IN_PROGRESS' ||
      evStatus.name === 'STATUS_HALFTIME' ||
      evStatus.name === 'STATUS_END_PERIOD' ||
      (evStatus.state && evStatus.state === 'in')
    );
    const gameStatus = isLiveNow ? 'LIVE' : 'UPCOMING';
    const gameStatusDetail = evStatus ? (evStatus.shortDetail || evStatus.detail || '') : '';

    return {
      id: `live-${sport}-${ev.id}`,
      rawEventId: ev.id,
      sport,
      name: ev.name,
      awayTeam,
      homeTeam,
      date: this.formatGameDate(ev.date),
      rawDate: ev.date,
      startTime: this.formatGameTime(ev.date),
      venue: comp.venue && comp.venue.fullName ? comp.venue.fullName : (isUFC ? 'UFC Apex' : 'TBD'),
      headline: isUFC
        ? (ev._ufcEventName || ev.name || 'UFC Fight Night')
        : (ev.status && ev.status.type ? ev.status.type.description || ev.status.type.detail : 'Scheduled'),
      gameStatus,
      gameStatusDetail,
      weightClass,
      summaryLines,
      rawOdds: oddsObj,
      _invalid: homeAwayMatch
    };'''

ls = replace_once(ls, OLD_RETURN, NEW_RETURN, 'add gameStatus field to parsed game')

# Also update currentNFLWeek from hardcoded 3 — detect dynamically
OLD_NFL_WEEK = '    this.currentNFLWeek = 3;'
NEW_NFL_WEEK = '''    // currentNFLWeek: dynamically determined from ESPN after first fetch
    this.currentNFLWeek = 0; // 0 = let ESPN scoreboard auto-detect current week (no ?week= param)'''
ls = replace_once(ls, OLD_NFL_WEEK, NEW_NFL_WEEK, 'dynamic NFL week init')

# Update fetchLiveGames NFL URL to omit week param when currentNFLWeek is 0
OLD_NFL_URL = '''      url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2`;'''
NEW_NFL_URL = '''      // If week is 0 or not specified, omit week param → ESPN returns current week automatically
      url = week > 0
        ? `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2`
        : `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2`;'''
ls = replace_once(ls, OLD_NFL_URL, NEW_NFL_URL, 'dynamic NFL week URL')

write('liveService.js', ls)

# ============================================================
# 2. app.js — Part A: state, auto-refresh, game cards
# ============================================================
print('\n[2a] app.js — state + auto-refresh')
app = read('app.js')

# Fix hardcoded nflWeek: 3 → 0 (dynamic)
OLD_STATE = '''      nflWeek: 3,'''
NEW_STATE = '''      nflWeek: 0,  // 0 = current week auto-detected from ESPN'''
app = replace_once(app, OLD_STATE, NEW_STATE, 'state.nflWeek dynamic')

# Improve auto-refresh: clear cache + silently re-render games (preserve scroll/state)
OLD_INTERVAL = '''    // Silent auto-refresh every 15 minutes
    setInterval(() => {
      this.service.clearCache();
    }, 15 * 60 * 1000);'''

NEW_INTERVAL = '''    // Silent auto-refresh every 5 minutes
    // Uses doSilentRefresh which preserves scroll position and selected sport/game
    setInterval(() => this.doSilentRefresh(), 5 * 60 * 1000);'''

app = replace_once(app, OLD_INTERVAL, NEW_INTERVAL, 'auto-refresh 5min silent')

# Add doSilentRefresh method before doRefresh
OLD_DOREFRESH_START = '''  async doRefresh() {'''
NEW_DOREFRESH_START = '''  // Silent background refresh — does not reset scroll, sport, or game state
  async doSilentRefresh() {
    if (this.state.selectedGameId) return; // don't refresh while in game detail view
    try {
      this.service.clearCache();
      // Re-fetch without showing skeleton loader (preserve current DOM)
      const sport = this.state.selectedSport;
      const options = {};
      if (sport === 'nfl') options.week = this.state.nflWeek;
      else if (sport === 'mlb') options.date = this.getDateParamForOffset(this.state.mlbDateOffset);
      else if (sport === 'nhl') options.date = this.getDateParamForOffset(this.state.nhlDateOffset);
      else if (sport === 'nba') options.date = this.getDateParamForOffset(this.state.nbaDateOffset);
      else if (sport === 'cfb' && this.state.cfbWeek > 0) options.week = this.state.cfbWeek;

      const games = await this.service.getUpcomingGames(sport, '', options);
      if (!games || !games.length) return;

      // Remember scroll position
      const scrollY = window.scrollY;

      // Re-render game cards in place
      const newHtml = games.map(g =>
        g.sport === 'ufc' ? this.renderUFCFightCard(g) : this.renderGameCard(g)
      ).join('');

      if (this.dom.gamesList && newHtml) {
        this.dom.gamesList.innerHTML = newHtml;
        this.bindCardClicks(this.dom.gamesList);
      }

      // Update timestamp
      if (this.dom.lastUpdatedText) {
        const now = new Date();
        this.dom.lastUpdatedText.textContent = `Live Feed Connected · ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }

      // Restore scroll position (no jump)
      window.scrollTo({ top: scrollY, behavior: 'instant' });
    } catch (err) {
      console.warn('[SilentRefresh] Failed:', err);
    }
  }

  async doRefresh() {'''

app = replace_once(app, OLD_DOREFRESH_START, NEW_DOREFRESH_START, 'add doSilentRefresh method')

print('\n[2b] app.js — renderGameCard with status pill + live badge')

# Add LIVE / UPCOMING status pill to renderGameCard
OLD_GAME_CARD_RETURN = '''    return `
      <div class="game-card" data-game-id="${game.id}">

        <!-- Col 1: Date + Time -->
        <div class="game-col-datetime">
          <div class="game-date-str">${game.date}</div>
          <div class="game-time-str">${game.startTime}</div>
        </div>'''

NEW_GAME_CARD_RETURN = '''    const isLiveGame = game.gameStatus === 'LIVE';
    const statusPill = isLiveGame
      ? `<span class="game-status-live">🔴 LIVE${game.gameStatusDetail ? ' · ' + game.gameStatusDetail : ''}</span>`
      : '';

    return `
      <div class="game-card${isLiveGame ? ' game-card-live' : ''}" data-game-id="${game.id}">

        <!-- Col 1: Date + Time -->
        <div class="game-col-datetime">
          ${statusPill}
          <div class="game-date-str">${game.date}</div>
          <div class="game-time-str">${game.startTime}</div>
        </div>'''

app = replace_once(app, OLD_GAME_CARD_RETURN, NEW_GAME_CARD_RETURN, 'game card LIVE status pill')

# Add LIVE pill to UFC card too
OLD_UFC_CARD_RETURN = '''    return `
      <div class="ufc-fight-card" data-game-id="${game.id}">

        <!-- UFC Event Header -->
        <div class="ufc-fight-header">
          <span class="ufc-event-label">🥊 ${eventLabel}</span>
          <span class="ufc-fight-datetime">${game.date} · ${game.startTime}</span>
        </div>'''

NEW_UFC_CARD_RETURN = '''    const isUFCLive = game.gameStatus === 'LIVE';
    const ufcStatusPill = isUFCLive
      ? `<span class="game-status-live">🔴 LIVE${game.gameStatusDetail ? ' · ' + game.gameStatusDetail : ''}</span>`
      : '';

    return `
      <div class="ufc-fight-card${isUFCLive ? ' game-card-live' : ''}" data-game-id="${game.id}">

        <!-- UFC Event Header -->
        <div class="ufc-fight-header">
          ${ufcStatusPill}
          <span class="ufc-event-label">🥊 ${eventLabel}</span>
          <span class="ufc-fight-datetime">${game.date} · ${game.startTime}</span>
        </div>'''

app = replace_once(app, OLD_UFC_CARD_RETURN, NEW_UFC_CARD_RETURN, 'UFC card LIVE status pill')

print('\n[2c] app.js — renderSeasonSlateBar NFL: dynamic week label')

# Fix NFL slate bar to show "Current Week" for week 0
OLD_NFL_SLATE_WEEKS = '''      const weeks = [
        { label: 'Week 3 (Live)', val: 3 },
        { label: 'Week 4', val: 4 },'''

NEW_NFL_SLATE_WEEKS = '''      const weeks = [
        { label: 'Current Week', val: 0 },
        { label: 'Week 4', val: 4 },'''

app = replace_once(app, OLD_NFL_SLATE_WEEKS, NEW_NFL_SLATE_WEEKS, 'NFL slate bar week 0 = current')

# Also need to update renderUpcomingGames to not pass week 0
OLD_NFL_OPTIONS = '''    if (this.state.selectedSport === 'nfl') {
      options.week = this.state.nflWeek;
    } else if (this.state.selectedSport === 'mlb') {'''

NEW_NFL_OPTIONS = '''    if (this.state.selectedSport === 'nfl') {
      if (this.state.nflWeek > 0) options.week = this.state.nflWeek;
      // week 0 = current week (no param passed → ESPN auto-detects)
    } else if (this.state.selectedSport === 'mlb') {'''

app = replace_once(app, OLD_NFL_OPTIONS, NEW_NFL_OPTIONS, 'renderUpcomingGames skip week 0')

print('\n[2d] app.js — LAST 3/5/10 as interactive tab buttons')

# Replace the static LAST 3/5/10 section headers with tab buttons using data attributes
# The tab logic uses onclick to toggle sections — no external state needed
OLD_LOG_BLOCK = '''        <div class="pr-log-block">
          <div class="pr-log-title">
            <span>LAST 3</span>
            <span class="pr-log-count">${Math.min(games.length, 3)} of 3 completed</span>
          </div>
          ${last3Rows}

          ${last5Rows ? `
            <div class="pr-log-title" style="margin-top: 10px;">
              <span>LAST 5</span>
              <span class="pr-log-count">${Math.min(games.length, 5)} of 5 completed</span>
            </div>
            ${last5Rows}
          ` : ''}

          ${last10Rows ? `
            <div class="pr-log-title" style="margin-top: 10px;">
              <span>LAST 10</span>
              <span class="pr-log-count">${Math.min(games.length, 10)} of 10 completed</span>
            </div>
            ${last10Rows}
          ` : ''}
        </div>'''

NEW_LOG_BLOCK = '''        <div class="pr-log-block">
          <div class="pr-log-tabs" role="tablist">
            <button class="pr-log-tab active" data-tab="last3" role="tab" aria-selected="true">LAST 3
              <span class="pr-tab-count">${Math.min(games.length, 3)}</span>
            </button>
            ${games.length > 3 ? `<button class="pr-log-tab" data-tab="last5" role="tab" aria-selected="false">LAST 5
              <span class="pr-tab-count">${Math.min(games.length, 5)}</span>
            </button>` : ''}
            ${games.length > 5 ? `<button class="pr-log-tab" data-tab="last10" role="tab" aria-selected="false">LAST 10
              <span class="pr-tab-count">${Math.min(games.length, 10)}</span>
            </button>` : ''}
          </div>
          <div class="pr-log-panel active" data-panel="last3">${last3Rows}</div>
          ${last5Rows ? `<div class="pr-log-panel" data-panel="last5">${last5Rows}</div>` : ''}
          ${last10Rows ? `<div class="pr-log-panel" data-panel="last10">${last10Rows}</div>` : ''}
        </div>'''

app = replace_once(app, OLD_LOG_BLOCK, NEW_LOG_BLOCK, 'LAST 3/5/10 as tab buttons')

# Add tab click logic to bindCardClicks or inject event delegation on pr-log-tabs
# We'll inject it into renderGameDetailPage after research section renders

print('\n[2e] app.js — inject tab-switching delegation for pr-log-tabs')

# Find where we bind game detail clicks and add delegation
OLD_BIND_CARD_CLICKS_DEF = '''  bindCardClicks(container) {'''

NEW_BIND_CARD_CLICKS_DEF = '''  // Activate LAST 3 / LAST 5 / LAST 10 tab switching within pr-card elements
  bindLogTabs(container) {
    container.addEventListener('click', (e) => {
      const tab = e.target.closest('.pr-log-tab');
      if (!tab) return;
      const card = tab.closest('.pr-card');
      if (!card) return;
      const targetPanel = tab.dataset.tab;

      // Deactivate all tabs + panels in this card
      card.querySelectorAll('.pr-log-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      card.querySelectorAll('.pr-log-panel').forEach(p => p.classList.remove('active'));

      // Activate selected tab + panel
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const panel = card.querySelector(`.pr-log-panel[data-panel="${targetPanel}"]`);
      if (panel) panel.classList.add('active');
    });
  }

  bindCardClicks(container) {'''

app = replace_once(app, OLD_BIND_CARD_CLICKS_DEF, NEW_BIND_CARD_CLICKS_DEF, 'bindLogTabs method')

# Call bindLogTabs in the research section after it renders
# Find renderGameDetailPage — after the researchHtml is injected into DOM
OLD_RESEARCH_INJECT = '''      this.loadHistoricalProps(game.sport, researchData);'''
NEW_RESEARCH_INJECT = '''      // Activate tab-switching for pr-log-tab buttons in research cards
      const researchSection = this.dom.gameDetailContainer.querySelector('.pr-section');
      if (researchSection) this.bindLogTabs(researchSection);

      this.loadHistoricalProps(game.sport, researchData);'''

app = replace_once(app, OLD_RESEARCH_INJECT, NEW_RESEARCH_INJECT, 'bindLogTabs after research render')

print('\n[2f] app.js — empty state when all NFL games are completed')

# When games array is empty after filtering (all STATUS_FINAL), show informative message
OLD_NO_GAMES = '''    if (!games || games.length === 0) {
      this.dom.gamesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No games scheduled</div>
          <p>No upcoming games found for this slate.</p>
        </div>
      `;
      return;
    }'''

NEW_NO_GAMES = '''    if (!games || games.length === 0) {
      // For NFL, if week 0 was selected and nothing is upcoming, suggest checking the next week
      const sportName = this.state.selectedSport.toUpperCase();
      this.dom.gamesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No Upcoming ${sportName} Games</div>
          <p>All games on this slate have concluded, or no games are scheduled yet. Try a different week or check back when the next slate is released.</p>
        </div>
      `;
      return;
    }'''

app = replace_once(app, OLD_NO_GAMES, NEW_NO_GAMES, 'better empty-state message')

write('app.js', app)

# ============================================================
# 3. styles.css — LIVE pill, tab buttons, card typography
# ============================================================
print('\n[3] styles.css — add LIVE pill, tab styles, larger player card typography')
css = read('styles.css')

# Append new CSS at end
NEW_CSS = '''

/* ── Game card: LIVE status pill ─────────────────────────────────────────── */
.game-status-live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 7px;
  border-radius: 99px;
  margin-bottom: 4px;
  animation: live-pulse 2s ease-in-out infinite;
}

@keyframes live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.75; }
}

.game-card-live {
  border-left: 3px solid #ef4444;
}

/* ── Player research card: larger typography ─────────────────────────────── */
.pr-player-name {
  font-size: 18px;
  font-weight: 800;
  color: #f1f5f9;
  letter-spacing: -0.01em;
  line-height: 1.1;
}

.pr-group-badge {
  font-size: 11px;
  font-weight: 600;
  background: #1e3a5f;
  color: #60a5fa;
  padding: 2px 8px;
  border-radius: 99px;
  margin-top: 2px;
  display: inline-block;
}

.pr-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 10px;
}

.pr-card-identity {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── LAST 3 / 5 / 10 tab buttons ─────────────────────────────────────────── */
.pr-log-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.pr-log-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #1e293b;
  color: #94a3b8;
  border: 1px solid #334155;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  padding: 5px 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.pr-log-tab:hover {
  background: #273449;
  color: #cbd5e1;
}

.pr-log-tab.active {
  background: #1d4ed8;
  color: #fff;
  border-color: #2563eb;
}

.pr-tab-count {
  background: rgba(255,255,255,0.15);
  color: inherit;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  min-width: 18px;
  text-align: center;
}

/* ── Log panels: only active panel visible ────────────────────────────────── */
.pr-log-panel {
  display: none;
}

.pr-log-panel.active {
  display: block;
}

/* ── Log row improvements for mobile ─────────────────────────────────────── */
.pr-log-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 7px 0;
  border-bottom: 1px solid #1e293b;
  font-size: 13px;
}

.pr-log-last {
  border-left: 2px solid #22d3ee;
  padding-left: 6px;
}

.pr-log-meta {
  display: flex;
  gap: 6px;
  min-width: 90px;
  color: #94a3b8;
  font-size: 12px;
}

.pr-log-date { font-weight: 600; color: #cbd5e1; }
.pr-log-opp  { color: #64748b; }

.pr-log-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}

.pr-chip {
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 12px;
  color: #e2e8f0;
  white-space: nowrap;
}

.pr-chip b {
  color: #f8fafc;
  font-weight: 700;
  margin-left: 3px;
}

.pr-chip-none { color: #475569; font-size: 12px; }

.pr-last-tag {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #22d3ee;
  background: rgba(34,211,238,0.1);
  border: 1px solid rgba(34,211,238,0.3);
  border-radius: 4px;
  padding: 2px 5px;
}

/* ── Historical line slot ─────────────────────────────────────────────────── */
.pr-hist-slot {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #64748b;
  min-width: 100%;
  margin-top: 2px;
}

.pr-hist-unavail { color: #475569; font-style: italic; }
.pr-hist-line    { color: #94a3b8; }

.pr-result-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.05em;
}

.pr-result-over  { background: #14532d; color: #4ade80; }
.pr-result-under { background: #450a0a; color: #f87171; }
.pr-result-push  { background: #1e293b; color: #94a3b8; }

/* ── Mobile-first responsive stacking ────────────────────────────────────── */
@media (max-width: 480px) {
  .pr-cards-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .pr-card {
    padding: 14px 14px;
  }

  .pr-player-name {
    font-size: 16px;
  }

  .pr-log-row {
    font-size: 12px;
  }
}
'''

css += NEW_CSS
write('styles.css', css)

print('\n✅ All changes applied. Run build.py next.')
