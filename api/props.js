// api/props.js — Current player props for a specific Odds API event
// Server-side only. ODDS_API_KEY never reaches the browser.
// Frontend calls: fetch('/api/props?sport=nfl&eventId=ODDS_API_ID')
// eventId is The Odds API's own event ID (from /api/events matching), NOT an ESPN ID.

const SPORT_MAP = {
  nfl:   'americanfootball_nfl',
  mlb:   'baseball_mlb',
  nba:   'basketball_nba',
  nhl:   'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
  cfb:   'americanfootball_ncaaf',
  ufc:   'mma_mixed_martial_arts',
};

// Only request markets the app actually displays — saves API credits
const DEFAULT_MARKETS = {
  nfl:   'player_pass_yds,player_pass_tds,player_rush_yds,player_reception_yds,player_receptions,player_pass_completions,player_rush_attempts',
  mlb:   'batter_hits,batter_total_bases,batter_home_runs,pitcher_strikeouts',
  nba:   'player_points,player_rebounds,player_assists,player_threes',
  nhl:   'player_shots_on_goal,player_goals,player_points,player_assists',
  ncaaf: 'player_pass_yds,player_pass_tds,player_rush_yds,player_reception_yds',
  cfb:   'player_pass_yds,player_pass_tds,player_rush_yds,player_reception_yds',
  ufc:   '', // UFC props not reliably available
};

export default async function handler(req, res) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server configuration error — ODDS_API_KEY not set' });

  const { sport, eventId, markets } = req.query;
  if (!eventId) return res.status(400).json({ error: 'eventId is required' });

  const oddsKey = SPORT_MAP[sport];
  if (!oddsKey) return res.status(400).json({ error: `Unsupported sport: ${sport}` });

  const marketsToUse = markets || DEFAULT_MARKETS[sport] || '';
  if (!marketsToUse) {
    return res.status(200).json({ data: null, note: 'No prop markets available for this sport' });
  }

  const params = new URLSearchParams({
    apiKey: key,
    regions: 'us',
    markets: marketsToUse,
    oddsFormat: 'american',
    dateFormat: 'iso',
  });

  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${oddsKey}/events/${eventId}/odds?${params}`);
    const remaining = r.headers.get('x-requests-remaining') || '?';

    // Graceful degradation — don't error on missing markets
    if (r.status === 404) {
      return res.status(200).json({ data: null, note: 'Event not found in Odds API' });
    }
    if (r.status === 422) {
      return res.status(200).json({ data: null, note: 'Props market unavailable for this event' });
    }
    if (!r.ok) return res.status(r.status).json({ error: await r.text(), remaining });

    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=30');
    res.setHeader('X-Quota-Remaining', remaining);
    return res.status(200).json({ data, remaining });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
