#!/usr/bin/env python3
"""
dev_server.py — Local development server for UrWelcome
Serves static dist/ files AND proxies /api/* requests to The Odds API.
The ODDS_API_KEY is read from .env.local (never committed to git).

Usage:
  1. Create .env.local with: ODDS_API_KEY=your_key_here
  2. Run: python3 dev_server.py
  3. Open: http://localhost:8080

This simulates what Vercel does in production:
  - /api/odds        → The Odds API current game odds
  - /api/events      → The Odds API event list
  - /api/props       → The Odds API player props
  - /api/historical  → The Odds API historical odds
  - /*               → static files from dist/
"""

import os, json, urllib.request, urllib.parse, http.server, pathlib, sys
from urllib.parse import urlparse, parse_qs

# ── Load .env.local ────────────────────────────────────────────────────────
env_file = pathlib.Path(__file__).parent / '.env.local'
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

ODDS_API_KEY = os.environ.get('ODDS_API_KEY', '')
DIST_DIR     = pathlib.Path(__file__).parent / 'dist'

SPORT_MAP = {
    'nfl':   'americanfootball_nfl',
    'mlb':   'baseball_mlb',
    'nba':   'basketball_nba',
    'nhl':   'icehockey_nhl',
    'ncaaf': 'americanfootball_ncaaf',
    'ufc':   'mma_mixed_martial_arts',
}

def odds_api_call(path, extra_params=None):
    """Proxy a request to The Odds API with the server-side key."""
    params = {'apiKey': ODDS_API_KEY}
    if extra_params:
        params.update(extra_params)
    url = f"https://api.the-odds-api.com{path}?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read()
            status = r.status
            remaining = r.headers.get('x-requests-remaining', '?')
            return status, json.loads(body), remaining
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        return e.code, {'error': body}, '?'
    except Exception as ex:
        return 500, {'error': str(ex)}, '?'

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def log_message(self, format, *args):
        print(f"  {self.address_string()} {format % args}")

    def send_json(self, status, data, extra_headers=None):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self, path, params):
        """Route /api/* requests to The Odds API."""
        if not ODDS_API_KEY:
            return self.send_json(500, {'error': 'ODDS_API_KEY not set in .env.local'})

        segment = path.replace('/api/', '', 1).split('/')[0]  # 'odds', 'events', 'props', 'historical'
        sport_key = params.get('sport', [''])[0]
        odds_sport = SPORT_MAP.get(sport_key)

        if segment in ('odds', 'events', 'props', 'historical') and not odds_sport:
            return self.send_json(400, {'error': f'Unknown sport: {sport_key}'})

        if segment == 'odds':
            extra = {'regions': 'us', 'markets': 'h2h,spreads,totals',
                     'oddsFormat': 'american', 'dateFormat': 'iso'}
            for k in ('commenceTimeFrom', 'commenceTimeTo'):
                if k in params: extra[k] = params[k][0]
            status, data, rem = odds_api_call(f'/v4/sports/{odds_sport}/odds', extra)
            return self.send_json(status, {'data': data, 'remaining': rem},
                                  {'X-Quota-Remaining': rem})

        if segment == 'events':
            extra = {'dateFormat': 'iso'}
            for k in ('commenceTimeFrom', 'commenceTimeTo'):
                if k in params: extra[k] = params[k][0]
            status, data, rem = odds_api_call(f'/v4/sports/{odds_sport}/events', extra)
            return self.send_json(status, {'data': data, 'remaining': rem})

        if segment == 'props':
            event_id = params.get('eventId', [''])[0]
            if not event_id:
                return self.send_json(400, {'error': 'eventId required'})
            DEFAULT_MARKETS = {
                'nfl': 'player_pass_yds,player_pass_tds,player_rush_yds,player_reception_yds,player_receptions,player_pass_completions,player_rush_attempts',
                'mlb': 'batter_hits,batter_total_bases,batter_home_runs,pitcher_strikeouts',
                'nba': 'player_points,player_rebounds,player_assists,player_threes',
                'nhl': 'player_shots_on_goal,player_goals,player_points,player_assists',
                'ncaaf': 'player_pass_yds,player_pass_tds,player_rush_yds',
            }
            markets = params.get('markets', [DEFAULT_MARKETS.get(sport_key, '')])[0]
            if not markets:
                return self.send_json(200, {'data': None, 'note': 'No markets for sport'})
            extra = {'regions': 'us', 'markets': markets, 'oddsFormat': 'american', 'dateFormat': 'iso'}
            status, data, rem = odds_api_call(f'/v4/sports/{odds_sport}/events/{event_id}/odds', extra)
            if status in (404, 422):
                return self.send_json(200, {'data': None, 'note': f'Unavailable ({status})'})
            return self.send_json(status, {'data': data, 'remaining': rem},
                                  {'X-Quota-Remaining': rem})

        if segment == 'historical':
            mode = params.get('mode', [''])[0]
            date = params.get('date', [''])[0]
            if not date:
                return self.send_json(400, {'error': 'date required'})
            DEFAULT_MARKETS = {
                'nfl': 'player_pass_yds,player_pass_tds,player_rush_yds,player_reception_yds,player_receptions',
                'mlb': 'batter_hits,batter_total_bases,pitcher_strikeouts',
                'nba': 'player_points,player_rebounds,player_assists',
                'nhl': 'player_shots_on_goal,player_goals,player_points',
                'ncaaf': 'player_pass_yds,player_rush_yds',
            }
            markets = params.get('markets', [DEFAULT_MARKETS.get(sport_key, '')])[0]

            if mode == 'events':
                status, data, rem = odds_api_call(
                    f'/v4/historical/sports/{odds_sport}/events',
                    {'date': date, 'dateFormat': 'iso'}
                )
                return self.send_json(status, {'data': data, 'remaining': rem})

            if mode == 'odds':
                event_id = params.get('eventId', [''])[0]
                if not event_id:
                    return self.send_json(400, {'error': 'eventId required'})
                if not markets:
                    return self.send_json(200, {'data': None, 'note': 'No markets'})
                extra = {'regions': 'us', 'date': date, 'dateFormat': 'iso', 'markets': markets, 'oddsFormat': 'american'}
                status, data, rem = odds_api_call(
                    f'/v4/historical/sports/{odds_sport}/events/{event_id}/odds', extra
                )
                if status in (404, 422):
                    return self.send_json(200, {'data': None, 'note': f'Unavailable ({status})', 'detail': data})
                return self.send_json(status, {'data': data, 'remaining': rem})

            return self.send_json(400, {'error': 'mode must be events or odds'})

        return self.send_json(404, {'error': f'Unknown API endpoint: {segment}'})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            params = parse_qs(parsed.query)
            return self.handle_api(parsed.path, params)
        # SPA fallback: serve index.html for non-asset routes
        file_path = DIST_DIR / parsed.path.lstrip('/')
        if file_path.is_file():
            return super().do_GET()
        # Serve index.html for SPA navigation
        self.path = '/index.html'
        return super().do_GET()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET')
        self.end_headers()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    if not ODDS_API_KEY:
        print("⚠️  WARNING: ODDS_API_KEY not set.")
        print("   Create .env.local with: ODDS_API_KEY=your_key_here")
        print("   ESPN data will still work. Odds API features will show 'Unavailable'.")
    else:
        print(f"✓  ODDS_API_KEY loaded from .env.local")
    print(f"✓  Serving dist/ on http://localhost:{port}")
    print(f"✓  API proxy: /api/* → The Odds API (server-side key injection)")
    print(f"   Press Ctrl+C to stop\n")
    server = http.server.HTTPServer(('', port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
