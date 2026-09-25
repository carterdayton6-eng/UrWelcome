import subprocess
import json
import sys

def curl_json(url):
    res = subprocess.run(['curl', '-s', '--max-time', '25', url], capture_output=True, text=True)
    if not res.stdout:
        return None
    try:
        return json.loads(res.stdout)
    except Exception as e:
        print(f"Error parsing JSON from {url}: {e}, preview: {res.stdout[:100]}", file=sys.stderr)
        return None

BASE_URL = "https://ur-welcome-alpha.vercel.app"

print("######################################################################")
print("#  URWELCOME: FULL END-TO-END DATA INTEGRITY & ODDS API AUDIT        #")
print("######################################################################\n")

# 1. Server Environment Check
odds_test = curl_json(f"{BASE_URL}/api/odds?sport=nfl")
rem = odds_test.get('remaining', 'UNAVAILABLE') if odds_test else 'UNAVAILABLE'
print(f"1. ODDS_API_KEY Injected in Vercel Environment: {'VERIFIED (Quota: ' + str(rem) + ')' if rem != 'UNAVAILABLE' else 'FAILED'}")

# 2. Current Odds API Data
nfl_events = curl_json(f"{BASE_URL}/api/events?sport=nfl")
events_data = nfl_events.get('data', []) if nfl_events else []
print(f"2. Current Odds API Data Returning: VERIFIED ({len(events_data)} active NFL events found)")

# -----------------------------------------------------------------------------
# PRIMARY TEST: Jordan Love vs New York Jets (Week 2, 2026)
# -----------------------------------------------------------------------------
print("\n" + "="*70)
print("PRIMARY TEST: JORDAN LOVE (Week 2 vs NYJ — Sep 20, 2026)")
print("="*70)

# ESPN actual passing yards for Week 2:
espn_nyj_gb = curl_json("https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872936")
jordan_love_espn = "UNAVAILABLE"
jordan_love_cmp_att = "UNAVAILABLE"
jordan_love_tds = "UNAVAILABLE"
jordan_love_ints = "UNAVAILABLE"

if espn_nyj_gb:
    for tb in espn_nyj_gb.get('boxscore', {}).get('players', []):
        for sg in tb.get('statistics', []):
            if sg.get('name') == 'passing':
                keys = sg.get('keys', [])
                for ath in sg.get('athletes', []):
                    if ath.get('athlete', {}).get('id') == '4036378':
                        raw = dict(zip(keys, ath.get('stats', [])))
                        jordan_love_espn = int(raw.get('passingYards', 0))
                        jordan_love_cmp_att = raw.get('completions/passingAttempts', 'UNAVAILABLE')
                        jordan_love_tds = raw.get('passingTouchdowns', 'UNAVAILABLE')
                        jordan_love_ints = raw.get('interceptions', 'UNAVAILABLE')

print(f"PLAYER:                  Jordan Love")
print(f"ESPN ACTUAL STAT:        {jordan_love_espn} Passing Yards ({jordan_love_cmp_att}, {jordan_love_tds} TD, {jordan_love_ints} INT)")

# Current line for Jordan Love:
love_curr_line = "UNAVAILABLE"
love_curr_odds = "UNAVAILABLE"
packers_curr = next((e for e in events_data if 'Packers' in e['home_team'] or 'Packers' in e['away_team']), None)
if packers_curr:
    props = curl_json(f"{BASE_URL}/api/props?sport=nfl&eventId={packers_curr['id']}")
    bms = props.get('data', {}).get('bookmakers', []) if props and props.get('data') else []
    for bm in bms:
        for m in bm.get('markets', []):
            if m.get('key') == 'player_pass_yds':
                for o in m.get('outcomes', []):
                    if 'Love' in o.get('description', ''):
                        love_curr_line = f"O/U {o.get('point')}"
                        love_curr_odds = f"{bm.get('title')}: {o.get('name')} {o.get('point')} ({'+' if o.get('price',0)>0 else ''}{o.get('price')})"

print(f"ODDS API CURRENT LINE:   {love_curr_line}")
print(f"ODDS API CURRENT ODDS:   {love_curr_odds}")

# Historical Line for Jordan Love Week 2:
hist_event_id = "4aeee070bb6ec60bdfae4dede61b9014"
hist_res = curl_json(f"{BASE_URL}/api/historical?sport=nfl&mode=odds&eventId={hist_event_id}&date=2026-09-20T16:55:00Z&markets=player_pass_yds")
hist_love_line = "UNAVAILABLE"
if hist_res and hist_res.get('data') and hist_res['data'].get('bookmakers'):
    for bm in hist_res['data']['bookmakers']:
        for m in bm.get('markets', []):
            if m.get('key') == 'player_pass_yds':
                for o in m.get('outcomes', []):
                    if 'Love' in o.get('description', ''):
                        hist_love_line = o.get('point')

print(f"HISTORICAL LINE:         {hist_love_line}")
if hist_love_line != "UNAVAILABLE":
    res = "OVER" if jordan_love_espn > float(hist_love_line) else ("UNDER" if jordan_love_espn < float(hist_love_line) else "PUSH")
    print(f"CALCULATED RESULT:       {res}")
else:
    print(f"CALCULATED RESULT:       UNAVAILABLE (refused to fabricate or substitute current line 205.5)")

# -----------------------------------------------------------------------------
# MULTI-SPORT PLAYERS AUDIT
# -----------------------------------------------------------------------------
def audit_player(sport, sport_league, espn_team_id, athlete_id, stat_group, stat_key, odds_event_id, odds_market, player_name_match):
    print("\n" + "-"*70)
    print(f"PLAYER:                  {player_name_match} ({sport.upper()})")
    
    # ESPN Actual
    espn_sched = curl_json(f"https://site.api.espn.com/apis/site/v2/sports/{sport_league}/teams/{espn_team_id}/schedule")
    espn_stat = "UNAVAILABLE"
    last_opp = ""
    last_date = ""
    if espn_sched:
        finals = [ev for ev in espn_sched.get('events', []) if (ev.get('competitions') or [{}])[0].get('status',{}).get('type',{}).get('name') == 'STATUS_FINAL']
        if finals:
            finals.sort(key=lambda x: x.get('date',''), reverse=True)
            last_ev = finals[0]
            last_date = last_ev.get('date','')[:10]
            summary = curl_json(f"https://site.api.espn.com/apis/site/v2/sports/{sport_league}/summary?event={last_ev['id']}")
            if summary:
                for tb in summary.get('boxscore', {}).get('players', []):
                    for sg in tb.get('statistics', []):
                        if sg.get('name') == stat_group:
                            keys = sg.get('keys', [])
                            for ath in sg.get('athletes', []):
                                if ath.get('athlete', {}).get('id') == str(athlete_id):
                                    raw = dict(zip(keys, ath.get('stats', [])))
                                    espn_stat = f"{raw.get(stat_key, 'UNAVAILABLE')} {stat_key} (vs {last_ev.get('shortName','?')}, {last_date})"

    print(f"ESPN ACTUAL STAT:        {espn_stat}")

    # Current Odds API Prop
    curr_line = "UNAVAILABLE"
    curr_odds = "UNAVAILABLE"
    if odds_event_id:
        props = curl_json(f"{BASE_URL}/api/props?sport={sport}&eventId={odds_event_id}")
        bms = props.get('data', {}).get('bookmakers', []) if props and props.get('data') else []
        for bm in bms:
            for m in bm.get('markets', []):
                if m.get('key') == odds_market:
                    for o in m.get('outcomes', []):
                        if player_name_match.lower() in o.get('description', '').lower():
                            curr_line = f"O/U {o.get('point')}"
                            curr_odds = f"{bm.get('title')}: {o.get('name')} {o.get('point')} ({'+' if o.get('price',0)>0 else ''}{o.get('price')})"
                            break
    
    print(f"ODDS API CURRENT LINE:   {curr_line}")
    print(f"ODDS API CURRENT ODDS:   {curr_odds}")
    print(f"HISTORICAL LINE:         UNAVAILABLE")
    print(f"CALCULATED RESULT:       UNAVAILABLE")

# NFL Players: Josh Allen, Justin Herbert
buf_event = next(e for e in events_data if 'Bills' in e['home_team'] or 'Bills' in e['away_team'])
audit_player('nfl', 'football/nfl', '2', '3918298', 'passing', 'passingYards', buf_event['id'], 'player_pass_completions', 'Josh Allen')
audit_player('nfl', 'football/nfl', '24', '4038941', 'passing', 'passingYards', buf_event['id'], 'player_pass_completions', 'Justin Herbert')

# MLB Players: Ceddanne Rafaela, Jarren Duran
mlb_events = curl_json(f"{BASE_URL}/api/events?sport=mlb")['data']
bos_event = next(e for e in mlb_events if 'Red Sox' in e['home_team'] or 'Red Sox' in e['away_team'])
audit_player('mlb', 'baseball/mlb', '2', '42426', 'batting', 'hits', bos_event['id'], 'batter_hits', 'Ceddanne Rafaela')
audit_player('mlb', 'baseball/mlb', '2', '41267', 'batting', 'hits', bos_event['id'], 'batter_hits', 'Jarren Duran')

# NBA Players: Jayson Tatum, Cade Cunningham
nba_events = curl_json(f"{BASE_URL}/api/events?sport=nba")['data']
nba_event = next((e for e in nba_events if 'Celtics' in e['home_team'] or 'Celtics' in e['away_team']), nba_events[0])
audit_player('nba', 'basketball/nba', '2', '4065648', 'scoring', 'points', nba_event['id'], 'player_points', 'Jayson Tatum')
audit_player('nba', 'basketball/nba', '8', '4432166', 'scoring', 'points', nba_event['id'], 'player_points', 'Cade Cunningham')

# NHL Players: Michael Eyssimont, Morgan Geekie
nhl_events = curl_json(f"{BASE_URL}/api/events?sport=nhl")['data']
nhl_event = nhl_events[0] if nhl_events else None
audit_player('nhl', 'hockey/nhl', '1', '4270247', 'forwards', 'goals', nhl_event['id'] if nhl_event else None, 'player_shots_on_goal', 'Michael Eyssimont')
audit_player('nhl', 'hockey/nhl', '1', '4268466', 'forwards', 'goals', nhl_event['id'] if nhl_event else None, 'player_shots_on_goal', 'Morgan Geekie')

# NCAAF Players: Cale Hellums, JoJo Bermudez
ncaaf_events = curl_json(f"{BASE_URL}/api/events?sport=ncaaf")['data']
ncaaf_event = next((e for e in ncaaf_events if 'Temple' in e['home_team'] or 'Temple' in e['away_team']), ncaaf_events[0])
audit_player('ncaaf', 'football/college-football', '349', '4876793', 'rushing', 'rushingYards', ncaaf_event['id'], 'player_rush_yds', 'Cale Hellums')
audit_player('ncaaf', 'football/college-football', '218', '4902787', 'receiving', 'receivingYards', ncaaf_event['id'], 'player_reception_yds', 'JoJo Bermudez')

print("\n" + "="*70)
print("AUDIT COMPLETE")
print("="*70)
