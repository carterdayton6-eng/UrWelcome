// oddsService.js — Frontend service for The Odds API
// Calls our secure server-side /api/* endpoints (key never in this file).
// Handles: event matching, player normalization, props parsing, historical odds.
//
// DATA INTEGRITY CONTRACT:
//   - All prop lines sourced from The Odds API only
//   - All player stats sourced from ESPN only (via PlayerGameLogService)
//   - Historical hit rates ONLY calculated when BOTH verified sources exist
//   - Never fabricate, estimate, or substitute missing data

// ── Sport key mapping (ESPN key → Odds API query param) ────────────────────
const ODDS_SPORT_MAP = {
  nfl:   'nfl',
  mlb:   'mlb',
  nba:   'nba',
  nhl:   'nhl',
  cfb:   'ncaaf',
  ufc:   'ufc',
};

// ── Player prop market keys per sport + stat group ──────────────────────────
// Maps ESPN boxscore stat group → Odds API market key
const PROP_MARKET_MAP = {
  passing:   { yardsPrimary: 'player_pass_yds',  tdPrimary: 'player_pass_tds',   altMarkets: ['player_pass_completions'] },
  rushing:   { yardsPrimary: 'player_rush_yds',  tdPrimary: 'player_rush_tds',   altMarkets: ['player_rush_attempts'] },
  receiving: { yardsPrimary: 'player_reception_yds', tdPrimary: 'player_reception_tds', altMarkets: ['player_receptions'] },
  batting:   { yardsPrimary: 'batter_hits',       tdPrimary: null,               altMarkets: ['batter_total_bases','batter_home_runs'] },
  pitching:  { yardsPrimary: 'pitcher_strikeouts',tdPrimary: null,               altMarkets: ['pitcher_hits_allowed'] },
  forwards:  { yardsPrimary: 'player_shots_on_goal', tdPrimary: 'player_goals',  altMarkets: ['player_assists','player_points'] },
  defenses:  { yardsPrimary: 'player_shots_on_goal', tdPrimary: null,            altMarkets: [] },
  goaltending:{ yardsPrimary: null,               tdPrimary: null,               altMarkets: [] },
  scoring:   { yardsPrimary: 'player_points',     tdPrimary: null,               altMarkets: ['player_rebounds','player_assists'] },
};

// ESPN stat key → friendly label for display
const ESPN_STAT_LABELS = {
  passingYards: 'Pass Yds', rushingYards: 'Rush Yds', receivingYards: 'Rec Yds',
  passingTouchdowns: 'Pass TD', rushingTouchdowns: 'Rush TD', receivingTouchdowns: 'Rec TD',
  receptions: 'Rec', receivingTargets: 'Tgt',
  'completions/passingAttempts': 'Cmp/Att',
  interceptions: 'INT',
  hits: 'H', atBats: 'AB', runs: 'R', RBIs: 'RBI', homeRuns: 'HR', strikeouts: 'K',
  'fullInnings.partInnings': 'IP', earnedRuns: 'ER', walks: 'BB',
  goals: 'G', assists: 'A', shotsTotal: 'SOG', plusMinus: '+/-',
  points: 'Pts', rebounds: 'Reb',
};

// The primary ESPN stat key per group (used for OVER/UNDER comparison vs prop line)
const PRIMARY_ESPN_KEY = {
  passing:    'passingYards',
  rushing:    'rushingYards',
  receiving:  'receivingYards',
  batting:    'hits',
  pitching:   'strikeouts',
  forwards:   'shotsTotal',
  defenses:   'blockedShots',
  scoring:    'points',
};

export class OddsApiService {
  constructor() {
    // In-memory caches (session lifetime)
    this._eventMappingCache = new Map();  // espnEventId → oddsEventId
    this._currentPropsCache = new Map();  // cacheKey → { data, ts }
    this._historicalCache   = new Map();  // cacheKey → data (never expires)
    this._quotaRemaining    = null;

    this.CURRENT_TTL = 5 * 60 * 1000; // 5 minutes
  }

  // ── Normalize team name for matching ──────────────────────────────────────
  _normalizeTeam(name) {
    if (!name) return '';
    return name.toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Normalize player name for matching ────────────────────────────────────
  // Handles Jr., Sr., II, III, apostrophes, hyphens
  _normalizePlayer(name) {
    if (!name) return '';
    return name.toLowerCase()
      .replace(/\s+(jr|sr|ii|iii|iv)\.?\s*$/i, '')
      .replace(/[^a-z ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Low-level fetch to our API proxy ──────────────────────────────────────
  async _call(endpoint, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `/api/${endpoint}${qs ? '?' + qs : ''}`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const json = await res.json();
      if (json.remaining) this._quotaRemaining = json.remaining;
      return json;
    } catch (err) {
      if (err.name === 'AbortError') return { error: 'Request timed out' };
      return { error: err.message };
    } finally {
      clearTimeout(id);
    }
  }

  // ── Fetch Odds API event list and match an ESPN game ─────────────────────
  // Returns the Odds API event ID string, or null if not found
  async findOddsEventId(sport, espnGame) {
    const espnId = espnGame?.rawEventId;
    if (!espnId) return null;

    const cached = this._eventMappingCache.get(espnId);
    if (cached !== undefined) return cached; // null is valid (= not found)

    const oddsPort = ODDS_SPORT_MAP[sport];
    if (!oddsPort) { this._eventMappingCache.set(espnId, null); return null; }

    // Fetch events from ~1 week around the game date to cover scheduling variance
    const gameDate = espnGame.rawDate ? new Date(espnGame.rawDate) : new Date();
    const from = new Date(gameDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const to   = new Date(gameDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const result = await this._call('events', {
      sport: oddsPort,
      commenceTimeFrom: from,
      commenceTimeTo: to,
    });

    if (result.error || !result.data) {
      this._eventMappingCache.set(espnId, null);
      return null;
    }

    // Match by normalized team names + date
    const awayNorm = this._normalizeTeam(espnGame.awayTeam?.name);
    const homeNorm = this._normalizeTeam(espnGame.homeTeam?.name);
    const gameDateStr = gameDate.toISOString().split('T')[0];

    let matched = null;
    for (const ev of result.data) {
      const evDate = (ev.commence_time || '').split('T')[0];
      const awayMatch = this._normalizeTeam(ev.away_team) === awayNorm;
      const homeMatch = this._normalizeTeam(ev.home_team) === homeNorm;
      const dateMatch = evDate === gameDateStr;

      if (awayMatch && homeMatch && dateMatch) {
        matched = ev.id;
        break;
      }
      // Fallback: same teams, date within 1 day (handles timezone drift)
      if (awayMatch && homeMatch) {
        const diff = Math.abs(new Date(evDate) - new Date(gameDateStr));
        if (diff <= 86400000) { matched = ev.id; break; }
      }
    }

    this._eventMappingCache.set(espnId, matched);
    return matched;
  }

  // ── Parse Odds API bookmaker response → normalized player props ────────────
  // Returns: { playerNameNorm: { marketKey: { line, overOdds, underOdds, bookmakers: [] } } }
  _parseProps(eventData) {
    if (!eventData?.bookmakers) return {};
    const result = {};

    for (const bm of eventData.bookmakers) {
      const bmName = bm.title || bm.key || 'Unknown';
      for (const market of (bm.markets || [])) {
        const mKey = market.key;
        for (const outcome of (market.outcomes || [])) {
          // Player props: outcome.description = player name, outcome.name = Over/Under
          const playerRaw = outcome.description || outcome.name;
          if (!playerRaw) continue;

          // Skip if this is a team-level outcome (no description field = h2h/spread/total)
          if (!outcome.description) continue;

          const playerNorm = this._normalizePlayer(playerRaw);
          const line  = outcome.point;
          const price = outcome.price;
          const side  = (outcome.name || '').toLowerCase(); // 'over' or 'under'

          if (!playerNorm || line === undefined) continue;

          if (!result[playerNorm]) result[playerNorm] = {};
          if (!result[playerNorm][mKey]) {
            result[playerNorm][mKey] = { line: null, overOdds: null, underOdds: null, bookmakers: [] };
          }

          const prop = result[playerNorm][mKey];
          // Use the first bookmaker's line as the primary line
          if (prop.line === null) prop.line = line;
          if (side === 'over')  prop.overOdds  = price;
          if (side === 'under') prop.underOdds = price;

          // Track all bookmakers for display
          let bmEntry = prop.bookmakers.find(b => b.name === bmName);
          if (!bmEntry) {
            bmEntry = { name: bmName, line: null, overOdds: null, underOdds: null };
            prop.bookmakers.push(bmEntry);
          }
          bmEntry.line = line;
          if (side === 'over')  bmEntry.overOdds  = price;
          if (side === 'under') bmEntry.underOdds = price;
        }
      }
    }
    return result;
  }

  // ── Get current player props for a game ──────────────────────────────────
  // Returns normalized props map or null
  async getCurrentProps(sport, espnGame) {
    const oddsPort = ODDS_SPORT_MAP[sport];
    if (!oddsPort || !espnGame) return null;

    const oddsEventId = await this.findOddsEventId(sport, espnGame);
    if (!oddsEventId) return null;

    const cacheKey = `props_${sport}_${oddsEventId}`;
    const cached = this._currentPropsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CURRENT_TTL) return cached.data;

    const result = await this._call('props', { sport: oddsPort, eventId: oddsEventId });
    if (result.error || !result.data) {
      return null;
    }

    const parsed = this._parseProps(result.data);
    this._currentPropsCache.set(cacheKey, { data: parsed, ts: Date.now() });
    return parsed;
  }

  // ── Get historical props for a completed game ─────────────────────────────
  // gameDate: ISO date string of the completed game (e.g. "2026-09-20")
  // Returns normalized props map or null
  async getHistoricalProps(sport, completedGame) {
    const oddsPort = ODDS_SPORT_MAP[sport];
    if (!oddsPort || !completedGame?.eventId) return null;

    // Cache key uses ESPN event ID — historical data for a completed game never changes
    const cacheKey = `hist_${sport}_${completedGame.eventId}`;
    if (this._historicalCache.has(cacheKey)) return this._historicalCache.get(cacheKey);

    // Build a snapshot timestamp: game date at 10:00 UTC (morning of game day)
    // This is BEFORE kickoff for most sports — gives us the pre-game line
    const gameDateObj = completedGame.gameDate instanceof Date
      ? completedGame.gameDate
      : new Date(completedGame.gameDate || completedGame.date);

    if (isNaN(gameDateObj.getTime())) {
      this._historicalCache.set(cacheKey, null);
      return null;
    }

    const snapshotDate = new Date(gameDateObj);
    snapshotDate.setUTCHours(13, 0, 0, 0); // 1 PM UTC = 9 AM ET — before most games
    const snapshotISO = snapshotDate.toISOString();

    // Step 1: find the Odds API event ID at this historical timestamp
    const eventsResult = await this._call('historical', {
      sport: oddsPort,
      mode: 'events',
      date: snapshotISO,
    });

    if (eventsResult.error || !eventsResult.data?.data) {
      this._historicalCache.set(cacheKey, null);
      return null;
    }

    // Match: find the event matching this ESPN completed game
    const awayNorm = this._normalizeTeam(completedGame.opponentName); // opponent is "away" relative to team
    const homeNorm = this._normalizeTeam(completedGame.teamName || '');
    const dateStr  = gameDateObj.toISOString().split('T')[0];

    let oddsEventId = null;
    for (const ev of (eventsResult.data.data || [])) {
      const evDate   = (ev.commence_time || '').split('T')[0];
      const awayHist = this._normalizeTeam(ev.away_team);
      const homeHist = this._normalizeTeam(ev.home_team);
      // Match either direction — away/home assignment depends on the game
      const teamsMatch = (awayHist === awayNorm && homeHist === homeNorm) ||
                         (awayHist === homeNorm && homeHist === awayNorm);
      const dateOk     = evDate === dateStr ||
                         Math.abs(new Date(evDate) - new Date(dateStr)) <= 86400000;
      if (teamsMatch && dateOk) { oddsEventId = ev.id; break; }
    }

    if (!oddsEventId) {
      this._historicalCache.set(cacheKey, null);
      return null;
    }

    // Step 2: get odds snapshot for that event
    const oddsResult = await this._call('historical', {
      sport: oddsPort,
      mode:  'odds',
      eventId: oddsEventId,
      date: snapshotISO,
    });

    if (oddsResult.error || !oddsResult.data?.data) {
      this._historicalCache.set(cacheKey, null);
      return null;
    }

    const parsed = this._parseProps(oddsResult.data.data);
    this._historicalCache.set(cacheKey, parsed);
    return parsed;
  }

  // ── Look up a specific player's prop from a parsed props map ──────────────
  // Returns { line, overOdds, underOdds, bookmakers } or null
  lookupPlayerProp(propsMap, playerName, market) {
    if (!propsMap || !playerName || !market) return null;
    const norm = this._normalizePlayer(playerName);
    const playerEntry = propsMap[norm];
    if (!playerEntry) return null;
    return playerEntry[market] || null;
  }

  // ── Format a prop line for display ────────────────────────────────────────
  formatPropLine(prop) {
    if (!prop || prop.line === null) return null;
    const over  = prop.overOdds  != null ? this._fmtOdds(prop.overOdds)  : '';
    const under = prop.underOdds != null ? this._fmtOdds(prop.underOdds) : '';
    return { line: prop.line, overOdds: over, underOdds: under, bookmakers: prop.bookmakers };
  }

  _fmtOdds(n) {
    if (n === null || n === undefined) return '';
    return n >= 0 ? `+${n}` : String(n);
  }

  // ── Calculate OVER/UNDER result ────────────────────────────────────────────
  // actualValue: number (ESPN stat), propLine: number (from Odds API historical)
  // Returns: 'OVER', 'UNDER', 'PUSH', or null
  calculateResult(actualValue, propLine) {
    if (actualValue === null || actualValue === undefined) return null;
    if (propLine    === null || propLine    === undefined) return null;
    const actual = parseFloat(actualValue);
    const line   = parseFloat(propLine);
    if (isNaN(actual) || isNaN(line)) return null;
    if (actual > line)  return 'OVER';
    if (actual < line)  return 'UNDER';
    return 'PUSH';
  }

  // ── Get primary market key for a stat group ───────────────────────────────
  getPrimaryMarket(statGroup) {
    return PROP_MARKET_MAP[statGroup]?.yardsPrimary || null;
  }

  // ── Get primary ESPN stat key for a stat group ────────────────────────────
  getPrimaryEspnKey(statGroup) {
    return PRIMARY_ESPN_KEY[statGroup] || null;
  }

  // ── Remaining API quota ───────────────────────────────────────────────────
  getQuotaRemaining() { return this._quotaRemaining; }

  // ── Clear caches (called on refresh) ─────────────────────────────────────
  clearCurrentCache() {
    this._currentPropsCache.clear();
    this._eventMappingCache.clear();
    // Note: _historicalCache intentionally NOT cleared — completed game data is immutable
  }
}

export const oddsApiService = new OddsApiService();
