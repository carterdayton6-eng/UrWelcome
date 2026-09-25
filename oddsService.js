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
  // NHL — ESPN boxscore groups
  forwards:  { yardsPrimary: 'player_shots_on_goal', tdPrimary: 'player_goals',  altMarkets: ['player_assists','player_points'] },
  defenses:  { yardsPrimary: 'player_shots_on_goal', tdPrimary: null,            altMarkets: [] },
  goalies:   { yardsPrimary: null,               tdPrimary: null,               altMarkets: [] }, // goalies: no standard sportsbook prop
  // Legacy NHL keys
  skating:   { yardsPrimary: 'player_shots_on_goal', tdPrimary: 'player_goals',  altMarkets: ['player_assists','player_points'] },
  goaltending:{ yardsPrimary: null,               tdPrimary: null,               altMarkets: [] },
  // NBA
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
  goals: 'G', assists: 'A', shotsTotal: 'SOG', plusMinus: '+/-', saves: 'SV',
  points: 'Pts', rebounds: 'Reb',
};

// The primary ESPN stat key per group (used for OVER/UNDER comparison vs prop line)
const PRIMARY_ESPN_KEY = {
  passing:    'passingYards',
  rushing:    'rushingYards',
  receiving:  'receivingYards',
  batting:    'hits',
  pitching:   'strikeouts',
  // NHL
  forwards:   'shotsTotal',
  defenses:   'blockedShots',
  goalies:    'saves',
  // Legacy NHL
  skating:    'points',
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

  // ── Check if two team names match (handles abbreviations, mascots, cities) ──
  _teamsMatch(nameA, nameB) {
    if (!nameA || !nameB) return false;
    const a = this._normalizeTeam(nameA);
    const b = this._normalizeTeam(nameB);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;

    // Check last word (mascot or fighter surname)
    const wordsA = a.split(' ');
    const wordsB = b.split(' ');
    const lastA = wordsA[wordsA.length - 1];
    const lastB = wordsB[wordsB.length - 1];
    if (lastA && lastB && lastA.length > 2 && lastA === lastB) return true;

    // Common city abbreviation aliases
    const cityAliases = {
      'la': 'los angeles',
      'ny': 'new york',
      'tb': 'tampa bay',
      'sf': 'san francisco',
      'gb': 'green bay',
      'kc': 'kansas city',
      'ne': 'new england',
      'no': 'new orleans'
    };
    const expandAliases = s => {
      let res = s;
      for (const [abbr, full] of Object.entries(cityAliases)) {
        res = res.replace(new RegExp(`^${abbr}\\b`), full);
      }
      return res;
    };
    if (expandAliases(a) === expandAliases(b)) return true;

    return false;
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

  // ── Low-level fetch to our API proxy with automatic retries ───────────────
  async _call(endpoint, params = {}, maxRetries = 2) {
    const qs = new URLSearchParams(params).toString();
    const url = `/api/${endpoint}${qs ? '?' + qs : ''}`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        const json = await res.json();
        if (json.remaining) this._quotaRemaining = json.remaining;

        // Success: valid response with data and no error
        if (!json.error && (json.data !== undefined || json.success)) {
          return json;
        }

        // If error and we have retries left, wait and retry
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        return json;
      } catch (err) {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        if (err.name === 'AbortError') return { error: 'Request timed out' };
        return { error: err.message };
      } finally {
        clearTimeout(id);
      }
    }
  }

  // ── Fetch Odds API event list and match an ESPN game ─────────────────────
  // Returns the Odds API event ID string, or null if not found
  async findOddsEventId(sport, espnGame) {
    const espnId = espnGame?.rawEventId || espnGame?.id;
    if (!espnId) return null;

    const cached = this._eventMappingCache.get(espnId);
    if (cached !== undefined) return cached; // null is valid (= not found)

    const oddsPort = ODDS_SPORT_MAP[sport];
    if (!oddsPort) { this._eventMappingCache.set(espnId, null); return null; }

    // Fast path: if live odds are already cached for this sport, match from them
    const cachedOdds = this._currentPropsCache.get(`odds_${sport}`);
    if (cachedOdds && Array.isArray(cachedOdds.data)) {
      const awayName  = espnGame.awayTeam?.name || '';
      const homeName  = espnGame.homeTeam?.name || '';
      const awayShort = espnGame.awayTeam?.short || '';
      const homeShort = espnGame.homeTeam?.short || '';
      for (const ev of cachedOdds.data) {
        const awayMatch = this._teamsMatch(ev.away_team, awayName) || this._teamsMatch(ev.away_team, awayShort);
        const homeMatch = this._teamsMatch(ev.home_team, homeName) || this._teamsMatch(ev.home_team, homeShort);
        const swappedMatch = (this._teamsMatch(ev.away_team, homeName) || this._teamsMatch(ev.away_team, homeShort)) &&
                             (this._teamsMatch(ev.home_team, awayName) || this._teamsMatch(ev.home_team, awayShort));
        if ((awayMatch && homeMatch) || swappedMatch) {
          this._eventMappingCache.set(espnId, ev.id);
          return ev.id;
        }
      }
    }

    // Fetch events from ~2 days around the game date to cover scheduling variance
    const gameDate = espnGame.rawDate ? new Date(espnGame.rawDate) : new Date();
    // Strictly sanitize: The Odds API rejects milliseconds (.000Z)
    const from = new Date(gameDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    const to   = new Date(gameDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

    const result = await this._call('events', {
      sport: oddsPort,
      commenceTimeFrom: from,
      commenceTimeTo: to,
    });

    if (result.error || !result.data) {
      this._eventMappingCache.set(espnId, null);
      return null;
    }

    // Match by flexible team matching + date
    const awayName  = espnGame.awayTeam?.name || '';
    const homeName  = espnGame.homeTeam?.name || '';
    const awayShort = espnGame.awayTeam?.short || '';
    const homeShort = espnGame.homeTeam?.short || '';
    const gameDateStr = gameDate.toISOString().split('T')[0];

    let matched = null;
    for (const ev of result.data) {
      const evDate = (ev.commence_time || '').split('T')[0];
      const awayMatch = this._teamsMatch(ev.away_team, awayName) || this._teamsMatch(ev.away_team, awayShort);
      const homeMatch = this._teamsMatch(ev.home_team, homeName) || this._teamsMatch(ev.home_team, homeShort);
      // Also check swapped home/away (neutral sites, UFC)
      const swappedMatch = (this._teamsMatch(ev.away_team, homeName) || this._teamsMatch(ev.away_team, homeShort)) &&
                           (this._teamsMatch(ev.home_team, awayName) || this._teamsMatch(ev.home_team, awayShort));

      const isTeamsMatch = (awayMatch && homeMatch) || swappedMatch;
      const dateMatch = evDate === gameDateStr;

      if (isTeamsMatch && dateMatch) {
        matched = ev.id;
        break;
      }
      // Fallback: same teams, date within 2 days (handles timezone drift)
      if (isTeamsMatch) {
        const diff = Math.abs(new Date(evDate) - new Date(gameDateStr));
        if (diff <= 2 * 86400000) { matched = ev.id; break; }
      }
    }

    this._eventMappingCache.set(espnId, matched);
    return matched;
  }

  // ── Parse Odds API bookmaker response → normalized player props ────────────
  // Returns: { playerNameNorm: { marketKey: { line, overOdds, underOdds, bookmaker, bookmakers: [] } } }
  _parseProps(eventData) {
    if (!eventData?.bookmakers) return {};
    const result = {};

    const preferredBooks = ['DraftKings', 'FanDuel', 'Caesars', 'BetMGM', 'BetRivers', 'Bovada', 'BetOnline.ag'];
    const sortedBms = [...eventData.bookmakers].sort((a, b) => {
      const titleA = a.title || a.key || '';
      const titleB = b.title || b.key || '';
      const idxA = preferredBooks.indexOf(titleA);
      const idxB = preferredBooks.indexOf(titleB);
      const orderA = idxA === -1 ? 999 : idxA;
      const orderB = idxB === -1 ? 999 : idxB;
      return orderA - orderB;
    });

    for (const bm of sortedBms) {
      const bmName = bm.title || bm.key || 'Sportsbook';
      const isDK = bmName.toLowerCase().includes('draftkings');
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
            result[playerNorm][mKey] = {
              line: null,
              overOdds: null,
              underOdds: null,
              bookmaker: null,
              bookmakers: []
            };
          }

          const prop = result[playerNorm][mKey];
          // If DraftKings is the bookmaker or line is not set yet, set line & bookmaker
          if (prop.line === null || (isDK && prop.bookmaker !== bmName)) {
            prop.line = line;
            prop.bookmaker = bmName;
          }
          if (side === 'over') {
            if (prop.overOdds === null || (isDK && prop.bookmaker === bmName)) {
              prop.overOdds = price;
            }
          }
          if (side === 'under') {
            if (prop.underOdds === null || (isDK && prop.bookmaker === bmName)) {
              prop.underOdds = price;
            }
          }

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

    let result = await this._call('props', { sport: oddsPort, eventId: oddsEventId });
    // Retry once if missing or errored
    if (!result || result.error || !result.data) {
      await new Promise(r => setTimeout(r, 500));
      result = await this._call('props', { sport: oddsPort, eventId: oddsEventId });
    }
    if (!result || result.error || !result.data) {
      return null;
    }

    const parsed = this._parseProps(result.data);
    this._currentPropsCache.set(cacheKey, { data: parsed, ts: Date.now() });
    return parsed;
  }

  // ── Fetch current sportsbook game odds across the league ─────────────────
  async getLiveGameOdds(sport) {
    const oddsPort = ODDS_SPORT_MAP[sport];
    if (!oddsPort) return null;
    const cacheKey = `odds_${sport}`;
    const cached = this._currentPropsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CURRENT_TTL) return cached.data;

    let res = await this._call('odds', { sport: oddsPort });
    if (!res || res.error || !res.data) {
      await new Promise(r => setTimeout(r, 500));
      res = await this._call('odds', { sport: oddsPort });
    }
    if (!res || res.error || !res.data) return null;

    this._currentPropsCache.set(cacheKey, { data: res.data, ts: Date.now() });
    return res.data;
  }

  // ── Match ESPN game to Odds API event and extract verified bookmaker game lines ──
  async getGameOddsForMatchup(sport, espnGame) {
    if (!espnGame) return null;
    const allOdds = await this.getLiveGameOdds(sport);
    if (!allOdds || !Array.isArray(allOdds) || allOdds.length === 0) return null;

    const awayName  = espnGame.awayTeam?.name || '';
    const homeName  = espnGame.homeTeam?.name || '';
    const awayShort = espnGame.awayTeam?.short || '';
    const homeShort = espnGame.homeTeam?.short || '';
    const gameDate = espnGame.rawDate ? new Date(espnGame.rawDate) : null;
    const gameDateStr = gameDate && !isNaN(gameDate.getTime()) ? gameDate.toISOString().split('T')[0] : null;

    let matchedEv = null;

    // 1. Try team match with date proximity
    for (const ev of allOdds) {
      const evDate = (ev.commence_time || '').split('T')[0];
      const awayMatch = this._teamsMatch(ev.away_team, awayName) || this._teamsMatch(ev.away_team, awayShort);
      const homeMatch = this._teamsMatch(ev.home_team, homeName) || this._teamsMatch(ev.home_team, homeShort);
      const swappedMatch = (this._teamsMatch(ev.away_team, homeName) || this._teamsMatch(ev.away_team, homeShort)) &&
                           (this._teamsMatch(ev.home_team, awayName) || this._teamsMatch(ev.home_team, awayShort));

      const isTeamsMatch = (awayMatch && homeMatch) || swappedMatch;
      if (isTeamsMatch) {
        if (!gameDateStr || evDate === gameDateStr) {
          matchedEv = ev;
          break;
        }
        const diff = Math.abs(new Date(evDate) - new Date(gameDateStr));
        if (diff <= 2 * 86400000) {
          matchedEv = ev;
          break;
        }
      }
    }

    // 2. Fallback: match by team names
    if (!matchedEv) {
      for (const ev of allOdds) {
        const awayMatch = this._teamsMatch(ev.away_team, awayName) || this._teamsMatch(ev.away_team, awayShort);
        const homeMatch = this._teamsMatch(ev.home_team, homeName) || this._teamsMatch(ev.home_team, homeShort);
        const swappedMatch = (this._teamsMatch(ev.away_team, homeName) || this._teamsMatch(ev.away_team, homeShort)) &&
                             (this._teamsMatch(ev.home_team, awayName) || this._teamsMatch(ev.home_team, awayShort));
        if ((awayMatch && homeMatch) || swappedMatch) {
          matchedEv = ev;
          break;
        }
      }
    }

    if (!matchedEv || !matchedEv.bookmakers || matchedEv.bookmakers.length === 0) return null;

    // Cache event mapping so getCurrentProps doesn't have to re-fetch
    const espnId = espnGame.rawEventId || espnGame.id;
    if (espnId) {
      this._eventMappingCache.set(espnId, matchedEv.id);
    }

    const preferredBooks = ['DraftKings', 'FanDuel', 'Caesars', 'BetMGM', 'BetRivers', 'Bovada', 'BetOnline.ag'];
    const sortedBms = [...matchedEv.bookmakers].sort((a, b) => {
      const idxA = preferredBooks.indexOf(a.title);
      const idxB = preferredBooks.indexOf(b.title);
      const orderA = idxA === -1 ? 999 : idxA;
      const orderB = idxB === -1 ? 999 : idxB;
      return orderA - orderB;
    });

    const spreads = [];
    const totals = [];
    const moneylines = [];
    const allSpreads = [];
    const allTotals = [];
    const allMoneylines = [];

    const toDecimal = (american) => {
      const p = Number(american);
      if (isNaN(p) || p === 0) return 1.91;
      return p > 0 ? 1 + (p / 100) : 1 + (100 / Math.abs(p));
    };

    const fmtOdds = (p) => {
      const n = Number(p);
      if (isNaN(n)) return '';
      return n > 0 ? `+${n}` : `${n}`;
    };

    for (const bm of sortedBms) {
      const bmTitle = bm.title || 'Sportsbook';
      for (const m of (bm.markets || [])) {
        if (m.key === 'spreads') {
          for (const out of (m.outcomes || [])) {
            if (out.point !== undefined && out.price !== undefined) {
              const isHome = this._teamsMatch(out.name, homeName) || this._teamsMatch(out.name, homeShort);
              const teamShort = isHome ? (homeShort || homeName) : (awayShort || awayName);
              const entry = {
                team: out.name,
                teamShort,
                isHome,
                point: out.point,
                price: out.price,
                priceStr: fmtOdds(out.price),
                decimal: toDecimal(out.price),
                bookmaker: bmTitle
              };
              allSpreads.push(entry);
              const exists = spreads.some(s => s.isHome === isHome);
              if (!exists) {
                spreads.push(entry);
              }
            }
          }
        } else if (m.key === 'totals') {
          for (const out of (m.outcomes || [])) {
            if (out.point !== undefined && out.price !== undefined) {
              const side = (out.name || '').toLowerCase() === 'over' ? 'Over' : 'Under';
              const entry = {
                side,
                point: out.point,
                price: out.price,
                priceStr: fmtOdds(out.price),
                decimal: toDecimal(out.price),
                bookmaker: bmTitle
              };
              allTotals.push(entry);
              const exists = totals.some(t => t.side === side);
              if (!exists) {
                totals.push(entry);
              }
            }
          }
        } else if (m.key === 'h2h') {
          for (const out of (m.outcomes || [])) {
            if (out.price !== undefined) {
              const isHome = this._teamsMatch(out.name, homeName) || this._teamsMatch(out.name, homeShort);
              const teamShort = isHome ? (homeShort || homeName) : (awayShort || awayName);
              const entry = {
                team: out.name,
                teamShort,
                isHome,
                price: out.price,
                priceStr: fmtOdds(out.price),
                decimal: toDecimal(out.price),
                bookmaker: bmTitle
              };
              allMoneylines.push(entry);
              const exists = moneylines.some(ml => ml.isHome === isHome);
              if (!exists) {
                moneylines.push(entry);
              }
            }
          }
        }
      }
    }

    return {
      eventId: matchedEv.id,
      spreads,
      totals,
      moneylines,
      allSpreads,
      allTotals,
      allMoneylines,
      bookmakers: sortedBms.map(b => b.title)
    };
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
    const snapshotISO = snapshotDate.toISOString().replace(/\.\d+Z$/, 'Z');

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
    const oppName  = completedGame.opponentName || '';
    const teamName = completedGame.teamName || '';
    const dateStr  = gameDateObj.toISOString().split('T')[0];

    let oddsEventId = null;
    for (const ev of (eventsResult.data.data || [])) {
      const evDate   = (ev.commence_time || '').split('T')[0];
      // Match either direction — away/home assignment depends on the game
      const teamsMatch = (this._teamsMatch(ev.away_team, oppName) && this._teamsMatch(ev.home_team, teamName)) ||
                         (this._teamsMatch(ev.away_team, teamName) && this._teamsMatch(ev.home_team, oppName));
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
    const book = prop.bookmaker || (prop.bookmakers && prop.bookmakers[0]?.name) || 'Sportsbook';
    return {
      line: prop.line,
      overOdds: over,
      underOdds: under,
      rawOverOdds: prop.overOdds,
      rawUnderOdds: prop.underOdds,
      bookmaker: book,
      bookmakers: prop.bookmakers || []
    };
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
