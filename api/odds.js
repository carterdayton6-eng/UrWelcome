// api/odds.js — Current game odds from The Odds API
// Server-side only. ODDS_API_KEY never reaches the browser.
// Frontend calls: fetch('/api/odds?sport=nfl')

const SPORT_MAP = {
  nfl:   'americanfootball_nfl',
  mlb:   'baseball_mlb',
  nba:   'basketball_nba',
  nhl:   'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
  ufc:   'mma_mixed_martial_arts',
};

export default async function handler(req, res) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server configuration error — ODDS_API_KEY not set' });

  const { sport, commenceTimeFrom, commenceTimeTo } = req.query;
  const oddsKey = SPORT_MAP[sport];
  if (!oddsKey) return res.status(400).json({ error: `Unsupported sport: ${sport}` });

  const params = new URLSearchParams({
    apiKey: key,
    regions: 'us',
    markets: 'h2h,spreads,totals',
    oddsFormat: 'american',
    dateFormat: 'iso',
  });
  if (commenceTimeFrom) params.set('commenceTimeFrom', commenceTimeFrom);
  if (commenceTimeTo)   params.set('commenceTimeTo',   commenceTimeTo);

  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${oddsKey}/odds?${params}`);
    const remaining = r.headers.get('x-requests-remaining') || '?';
    const used      = r.headers.get('x-requests-used')      || '?';
    if (!r.ok) return res.status(r.status).json({ error: await r.text(), remaining });
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=30');
    res.setHeader('X-Quota-Remaining', remaining);
    res.setHeader('X-Quota-Used', used);
    return res.status(200).json({ data, remaining, used });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
