// api/events.js — List events from The Odds API for ESPN-to-OddsAPI event matching
// Server-side only. ODDS_API_KEY never reaches the browser.
// Frontend calls: fetch('/api/events?sport=nfl&commenceTimeFrom=ISO&commenceTimeTo=ISO')

const SPORT_MAP = {
  nfl:   'americanfootball_nfl',
  mlb:   'baseball_mlb',
  nba:   'basketball_nba',
  nhl:   'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
  cfb:   'americanfootball_ncaaf',
  ufc:   'mma_mixed_martial_arts',
};

export default async function handler(req, res) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server configuration error — ODDS_API_KEY not set' });

  const { sport, commenceTimeFrom, commenceTimeTo } = req.query;
  const oddsKey = SPORT_MAP[sport];
  if (!oddsKey) return res.status(400).json({ error: `Unsupported sport: ${sport}` });

  // Strictly sanitize ISO format: The Odds API rejects milliseconds (.000Z)
  const cleanFrom = commenceTimeFrom ? commenceTimeFrom.replace(/\.\d+Z$/, 'Z') : null;
  const cleanTo   = commenceTimeTo   ? commenceTimeTo.replace(/\.\d+Z$/, 'Z')   : null;

  const params = new URLSearchParams({ apiKey: key, dateFormat: 'iso' });
  if (cleanFrom) params.set('commenceTimeFrom', cleanFrom);
  if (cleanTo)   params.set('commenceTimeTo',   cleanTo);

  try {
    let r = await fetch(`https://api.the-odds-api.com/v4/sports/${oddsKey}/events?${params}`);

    // Graceful fallback: if date-range request fails, fetch upcoming events without date filter
    if (!r.ok && (cleanFrom || cleanTo)) {
      const fallbackParams = new URLSearchParams({ apiKey: key, dateFormat: 'iso' });
      const rFallback = await fetch(`https://api.the-odds-api.com/v4/sports/${oddsKey}/events?${fallbackParams}`);
      if (rFallback.ok) {
        r = rFallback;
      }
    }

    const remaining = r.headers.get('x-requests-remaining') || '?';
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=30');
    return res.status(200).json({ data, remaining });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
