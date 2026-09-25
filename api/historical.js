// api/historical.js — Historical odds for completed games from The Odds API
// Server-side only. ODDS_API_KEY never reaches the browser.
//
// Two modes:
//   ?mode=events  → list historical events at a timestamp (for ESPN→OddsAPI matching)
//   ?mode=odds    → get odds snapshot for a specific historical event
//
// Historical completed-game data never changes — CDN cache is very long.
// This prevents repeat API credit usage on the same game.
//
// IMPORTANT: Historical player props available from May 3, 2023 onward.
// Do NOT assume the current line was the historical line — always use this endpoint.

const SPORT_MAP = {
  nfl:   'americanfootball_nfl',
  mlb:   'baseball_mlb',
  nba:   'basketball_nba',
  nhl:   'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
  ufc:   'mma_mixed_martial_arts',
};

// Only request markets that the research page actually shows
const DEFAULT_MARKETS = {
  nfl:   'player_pass_yds,player_pass_tds,player_rush_yds,player_reception_yds,player_receptions',
  mlb:   'batter_hits,batter_total_bases,pitcher_strikeouts',
  nba:   'player_points,player_rebounds,player_assists',
  nhl:   'player_shots_on_goal,player_goals,player_points',
  ncaaf: 'player_pass_yds,player_rush_yds',
  ufc:   '',
};

export default async function handler(req, res) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server configuration error — ODDS_API_KEY not set' });

  const { sport, mode, eventId, date, markets } = req.query;
  const oddsKey = SPORT_MAP[sport];
  if (!oddsKey) return res.status(400).json({ error: `Unsupported sport: ${sport}` });
  if (!date)    return res.status(400).json({ error: 'date parameter required (ISO 8601, e.g. 2026-09-20T12:00:00Z)' });

  const marketsToUse = markets || DEFAULT_MARKETS[sport] || '';

  try {
    if (mode === 'events') {
      // Step 1: list events active at this historical timestamp
      // Used to find the Odds API event ID for an ESPN completed game
      const params = new URLSearchParams({ apiKey: key, date, dateFormat: 'iso' });
      const r = await fetch(`https://api.the-odds-api.com/v4/historical/sports/${oddsKey}/events?${params}`);
      const remaining = r.headers.get('x-requests-remaining') || '?';
      if (!r.ok) return res.status(r.status).json({ error: await r.text(), remaining });
      const data = await r.json();
      // Historical event lists don't change — 24-hour CDN cache
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
      return res.status(200).json({ data, remaining });
    }

    if (mode === 'odds') {
      // Step 2: get odds snapshot for a specific historical event
      if (!eventId) return res.status(400).json({ error: 'eventId required for odds mode' });
      if (!marketsToUse) {
        return res.status(200).json({ data: null, note: 'No prop markets configured for this sport' });
      }
      const params = new URLSearchParams({
        apiKey: key,
        date,
        dateFormat: 'iso',
        markets: marketsToUse,
        oddsFormat: 'american',
      });
      const url = `https://api.the-odds-api.com/v4/historical/sports/${oddsKey}/events/${eventId}/odds?${params}`;
      const r = await fetch(url);
      const remaining = r.headers.get('x-requests-remaining') || '?';

      if (r.status === 404 || r.status === 422) {
        return res.status(200).json({ data: null, note: `Historical odds unavailable (HTTP ${r.status})`, remaining });
      }
      if (!r.ok) return res.status(r.status).json({ error: await r.text(), remaining });

      const data = await r.json();
      // Completed game data is immutable — 7-day CDN cache to prevent duplicate API credit spend
      res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');
      return res.status(200).json({ data, remaining });
    }

    return res.status(400).json({ error: 'mode must be "events" or "odds"' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
