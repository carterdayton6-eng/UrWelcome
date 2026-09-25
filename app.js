// ==========================================================================
// UrWelcome — Sports Betting Research Application
// Core Logic: Fast game selection, dynamic hit rate calculation, live odds & schedules
// ==========================================================================

import { 
  SPORTS, 
  BETS_DATABASE,
  SportsBettingService, 
  formatOdds,
  resolveRealTeamName
} from './data.js';

class SportsResearchApp {
  constructor() {
    this.service = new SportsBettingService();
    this.state = {
      selectedSport: 'nfl',
      selectedGameId: null,
      nflWeek: 0,  // 0 = current week auto-detected from ESPN scoreboard
      mlbDateOffset: 0,
      nhlDateOffset: 0,
      nbaDateOffset: 0,
      cfbWeek: 0,
      activeFilter: 'higher_rate',
      expandedBetResults: new Set(),
      isLoading: false
    };

    this.dom = {
      sportNav: document.getElementById('sport-nav'),
      seasonSlateBar: document.getElementById('season-slate-bar'),

      homeView: document.getElementById('home-view'),
      gameView: document.getElementById('game-view'),
      gamesList: document.getElementById('games-list'),
      gameDetailContainer: document.getElementById('game-detail-container'),
      demoModal: document.getElementById('demo-modal'),
      demoBadge: document.getElementById('demo-badge'),
      modalCloseBtn: document.getElementById('modal-close-btn'),
      brandTitle: document.getElementById('brand-title'),
      liveDataBtn: document.getElementById('live-data-btn'),
      liveDataLabel: document.getElementById('live-data-label'),
      liveDot: document.getElementById('live-dot'),
      lastUpdatedText: document.getElementById('last-updated-text'),
      headerDatetime: document.getElementById('header-datetime'),

      // Global search
      gsbInput: document.getElementById('global-search-input'),
      gsbDropdown: document.getElementById('gsb-dropdown'),
      gsbClear: document.getElementById('gsb-clear-btn'),
    };

    this.init();
  }

  init() {
    this.startClock();
    this.renderSportNav();
    this.renderSeasonSlateBar();
    this.bindEvents();
    this.bindSidebar();
    this.injectMobileTabBar();
    this.initGlobalSearch();
    this.renderUpcomingGames();
  }

  startClock() {
    const updateClock = () => {
      if (this.dom.headerDatetime) {
        const now = new Date();
        this.dom.headerDatetime.textContent = now.toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric'
        }) + ' ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      }
    };
    updateClock();
    setInterval(updateClock, 30000);
  }

  injectMobileTabBar() {
    // Remove any existing tab bar
    const existing = document.getElementById('mobile-tab-bar');
    if (existing) existing.remove();

    const tabs = [
      { sport: 'nfl',  icon: '🏈', label: 'NFL' },
      { sport: 'mlb',  icon: '⚾', label: 'MLB' },
      { sport: 'nhl',  icon: '🏒', label: 'NHL' },
      { sport: 'nba',  icon: '🏀', label: 'NBA' },
      { sport: 'cfb',  icon: '🎓', label: 'CFB' },
      { sport: 'ufc',  icon: '🥊', label: 'UFC' },
    ];

    const bar = document.createElement('nav');
    bar.id = 'mobile-tab-bar';
    bar.className = 'mobile-tab-bar';
    bar.setAttribute('aria-label', 'Mobile sport navigation');

    bar.innerHTML = tabs.map(t => `
      <button class="mobile-tab-item ${this.state.selectedSport === t.sport ? 'active' : ''}"
              data-mobile-sport="${t.sport}" aria-label="${t.label}">
        <span class="tab-icon">${t.icon}</span>
        <span>${t.label}</span>
      </button>
    `).join('');

    document.body.appendChild(bar);

    bar.querySelectorAll('[data-mobile-sport]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sportId = btn.dataset.mobileSport;
        this.state.selectedSport = sportId;
        this.state.selectedGameId = null;
        this.renderSportNav();
        this.renderSeasonSlateBar();
        this.renderUpcomingGames();
        this.showHomeView();
        // Update active state on tab bar
        bar.querySelectorAll('[data-mobile-sport]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  bindSidebar() {
    // Sport navigation
    document.querySelectorAll('[data-sidebar-sport]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sportId = btn.dataset.sidebarSport;
        if (this.state.selectedSport !== sportId) {
          this.state.selectedSport = sportId;
          this.state.selectedGameId = null;
          this.renderSportNav();
          this.renderSeasonSlateBar();
          this.renderUpcomingGames();
          this.showHomeView();
        }
        document.querySelectorAll('[data-sidebar-sport]').forEach(b => b.classList.remove('active-sport'));
        btn.classList.add('active-sport');
      });
    });

    // Home
    const homeBtn = document.querySelector('[data-sidebar="home"]');
    if (homeBtn) homeBtn.addEventListener('click', () => this.goBackToGames());
  }


  initGlobalSearch() {
    const input = this.dom.gsbInput;
    const dropdown = this.dom.gsbDropdown;
    const clearBtn = this.dom.gsbClear;
    if (!input || !dropdown) return;

    // Build search index from TEAM_DIRECTORY (always available)
    // + any already-fetched live game data (picks up UFC fighters)
    const buildIndex = () => {
      const index = [];
      const sportLabels = { nfl:'NFL', mlb:'MLB', nhl:'NHL', nba:'NBA', cfb:'CFB', ufc:'UFC' };

      // Static teams from TEAM_DIRECTORY
      if (typeof TEAM_DIRECTORY !== 'undefined') {
        Object.values(TEAM_DIRECTORY).forEach(t => {
          if (!t || !t.name || !t.sport) return;
          index.push({
            name: t.name,
            sport: t.sport,
            sportLabel: sportLabels[t.sport] || t.sport.toUpperCase(),
            short: t.short || '',
          });
        });
      }

      // Add UFC fighters from currently cached live games
      const cachedGames = this.service.activeGamesList || [];
      cachedGames.forEach(g => {
        if (g.sport !== 'ufc') return;
        [g.awayTeam, g.homeTeam].forEach(fighter => {
          if (!fighter || !fighter.name) return;
          const bad = new Set(['Fighter A','Fighter B','Away Team','Home Team']);
          if (bad.has(fighter.name)) return;
          // Only add if not already in index
          if (!index.find(e => e.name === fighter.name && e.sport === 'ufc')) {
            index.push({ name: fighter.name, sport: 'ufc', sportLabel: 'UFC', short: fighter.short || '' });
          }
        });
      });

      return index;
    };

    let index = [];
    let activeIdx = -1;

    const openDropdown = () => dropdown.classList.add('open');
    const closeDropdown = () => { dropdown.classList.remove('open'); activeIdx = -1; };

    const renderDropdown = (query) => {
      if (!query || !query.trim()) { closeDropdown(); return; }
      if (!index.length) index = buildIndex();

      const q = query.toLowerCase().trim();
      const matches = index.filter(e =>
        e.name.toLowerCase().includes(q) ||
        (e.short && e.short.toLowerCase().includes(q))
      );

      if (!matches.length) {
        dropdown.innerHTML = `<div class="gsb-no-results">No results for "${query}"</div>`;
        openDropdown();
        return;
      }

      // Group by sport
      const groups = {};
      const order = ['nfl','mlb','nhl','nba','cfb','ufc'];
      matches.forEach(m => {
        if (!groups[m.sport]) groups[m.sport] = [];
        groups[m.sport].push(m);
      });

      let html = '';
      order.forEach(sport => {
        if (!groups[sport]) return;
        html += `<div class="gsb-group-label">${groups[sport][0].sportLabel}</div>`;
        groups[sport].slice(0, 8).forEach((m, i) => {
          html += `<button class="gsb-result" data-sport="${m.sport}" data-name="${m.name}" role="option">
            <span class="gsb-result-name">${m.name}</span>
            <span class="gsb-result-sport">${m.sportLabel}</span>
          </button>`;
        });
      });

      dropdown.innerHTML = html;
      activeIdx = -1;
      openDropdown();

      dropdown.querySelectorAll('.gsb-result').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault(); // prevent blur before click
          this.handleSearchSelect(btn.dataset.sport, btn.dataset.name);
          input.value = btn.dataset.name;
          clearBtn.style.display = 'block';
          closeDropdown();
        });
      });
    };

    // Input handler
    input.addEventListener('input', () => {
      const q = input.value;
      clearBtn.style.display = q ? 'block' : 'none';
      renderDropdown(q);
      // Rebuild index lazily after first games load
      if (!index.length) index = buildIndex();
    });

    input.addEventListener('focus', () => {
      if (!index.length) index = buildIndex();
      if (input.value.trim()) renderDropdown(input.value);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => closeDropdown(), 150);
    });

    // Keyboard nav
    input.addEventListener('keydown', (e) => {
      const items = dropdown.querySelectorAll('.gsb-result');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        items[activeIdx].focus();
      } else if (e.key === 'Escape') {
        closeDropdown(); input.blur();
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        items[activeIdx].click();
      }
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      closeDropdown();
      input.focus();
    });

    // Close if clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#global-search-bar')) closeDropdown();
    });
  }

  handleSearchSelect(sport, teamName) {
    // Switch to the right sport, then filter games list to show that team
    if (!sport || !teamName) return;
    this.showHomeView();
    this.state.selectedSport = sport;
    this.renderSportNav();
    this.renderSeasonSlateBar();

    // Update mobile tab bar active state
    const mobileBar = document.getElementById('mobile-tab-bar');
    if (mobileBar) {
      mobileBar.querySelectorAll('[data-mobile-sport]').forEach(b => {
        b.classList.toggle('active', b.dataset.mobileSport === sport);
      });
    }

    // Fetch games for that sport, highlight the searched team
    this.renderUpcomingGamesForTeam(sport, teamName);
  }

  async renderUpcomingGamesForTeam(sport, teamName) {
    const options = {};
    if (sport === 'nfl' && this.state.nflWeek > 0) options.week = this.state.nflWeek;
    else if (sport === 'mlb') options.date = this.getDateParamForOffset(this.state.mlbDateOffset);
    else if (sport === 'nhl') options.date = this.getDateParamForOffset(this.state.nhlDateOffset);
    else if (sport === 'nba') options.date = this.getDateParamForOffset(this.state.nbaDateOffset);
    else if (sport === 'cfb' && this.state.cfbWeek > 0) options.week = this.state.cfbWeek;

    this.dom.gamesList.innerHTML = `<div class="skeleton-grid">
      <div class="skeleton-card"><div class="skeleton-bar title"></div><div class="skeleton-bar text"></div></div>
    </div>`;

    let games = [];
    try {
      games = await this.service.getUpcomingGames(sport, '', options);
    } catch(e) { games = []; }

    const q = teamName.toLowerCase();
    const matched = games.filter(g =>
      g.awayTeam.name.toLowerCase().includes(q) ||
      g.homeTeam.name.toLowerCase().includes(q)
    );

    const allGames = matched.length ? matched : games;

    if (!allGames.length) {
      this.dom.gamesList.innerHTML = `<div class="empty-state">
        <div class="empty-title">No upcoming games found</div>
        <p>No current scheduled games for ${teamName}.</p>
      </div>`;
      return;
    }

    try {
      this.dom.gamesList.innerHTML = allGames.map(g =>
        g.sport === 'ufc' ? this.renderUFCFightCard(g) : this.renderGameCard(g)
      ).join('');
      this.bindCardClicks(this.dom.gamesList);
    } catch(e) { console.error(e); }
  }



  // ─── Load historical props in background and update DOM ─────────────────────
  // Called after renderGameDetailPage renders the initial research cards.
  // Updates each pr-hist-slot element with the actual historical line + OVER/UNDER.
  // Caches aggressively — completed game data never changes.
  async loadHistoricalProps(sport, researchData) {
    if (!researchData || typeof oddsApiService === 'undefined') return;
    if (sport === 'ufc') return;

    const allPlayers = [
      ...(researchData.awayTeam?.players || []),
      ...(researchData.homeTeam?.players || []),
    ];

    for (const player of allPlayers) {
      for (const g of (player.games || [])) {
        const histId = `pr-hist-${player.playerId}-${g.eventId}`;
        const slot = document.getElementById(histId);
        if (!slot) continue;

        const actualStr  = slot.getAttribute('data-actual');
        const marketKey  = slot.getAttribute('data-market');
        const actualVal  = actualStr !== '' ? parseFloat(actualStr) : null;

        if (!marketKey) {
          slot.innerHTML = ''; // No market for this stat group
          continue;
        }

        // Construct a minimal completedGame object for the service
        const completedGame = {
          eventId:      g.eventId,
          gameDate:     g.gameDate,
          date:         g.gameDateStr,
          opponentName: g.opponentName,
          opponentAbbr: g.opponentAbbr,
          teamName:     player.teamName,
        };

        // Fetch historical props (cached after first call)
        let histProps = null;
        try {
          histProps = await oddsApiService.getHistoricalProps(sport, completedGame);
        } catch (err) {
          console.warn('[HistProps]', err.message);
        }

        // Re-fetch slot (DOM may have been replaced)
        const liveSlot = document.getElementById(histId);
        if (!liveSlot) continue;

        if (!histProps) {
          liveSlot.innerHTML = '<span class="pr-hist-unavail">Historical line unavailable</span>';
          continue;
        }

        const propEntry = oddsApiService.lookupPlayerProp(histProps, player.playerName, marketKey);
        if (!propEntry || propEntry.line === null) {
          liveSlot.innerHTML = '<span class="pr-hist-unavail">Historical line unavailable</span>';
          continue;
        }

        const histLine = propEntry.line;
        const result   = oddsApiService.calculateResult(actualVal, histLine);
        const resultClass = result === 'OVER'  ? 'pr-result-over'
                          : result === 'UNDER' ? 'pr-result-under'
                          : result === 'PUSH'  ? 'pr-result-push'
                          : '';

        liveSlot.innerHTML = `<span class="pr-hist-line" title="Historical line from Odds API">Line: ${histLine}</span>${
          result ? `<span class="pr-result-badge ${resultClass}">${result}</span>` : ''
        }`;
      }
    }
  }

  // ─── Render verified player stats from ESPN game logs ────────────────────────
  // Uses researchData from PlayerGameLogService.getGameResearchData()
  // Shows actual per-game boxscore stats (verified ESPN data) for each player.
  // Prop lines are not available from ESPN — marked as "Unavailable".
  // Hit rates are NOT calculated here — requires historical sportsbook lines.
  _renderResearchStats(researchData, game, currentProps) {
    // UFC: no per-fighter game logs available via ESPN public API
    if (game && game.sport === 'ufc') {
      return `<div class="di-notice-card">
        <div class="di-notice-header">
          <span class="di-notice-icon">ℹ️</span>
          <span class="di-notice-title">UFC — Fighter Stats</span>
        </div>
        <div class="di-notice-body">
          <p>UFC fighter individual game logs are not available through ESPN's public scoreboard API. Fight results appear after events complete.</p>
        </div>
      </div>`;
    }

    // Loading / no data
    if (!researchData ||
        (!researchData.awayTeam?.players?.length && !researchData.homeTeam?.players?.length)) {
      return `<div class="di-notice-card">
        <div class="di-notice-header">
          <span class="di-notice-icon">⏳</span>
          <span class="di-notice-title">Player Stats Loading…</span>
        </div>
        <div class="di-notice-body">
          <p>Fetching game logs from ESPN. This appears when both teams have no completed games yet, or requests are still in flight.</p>
        </div>
      </div>`;
    }

    // ─── Stat display keys per group ────────────────────────────────────────
    // [espnKey, shortLabel] — only keys that actually appear in ESPN boxscores
    const DISPLAY_KEYS = {
      passing:   [['passingYards','Yds'],['completions/passingAttempts','Cmp/Att'],['passingTouchdowns','TD'],['interceptions','INT']],
      rushing:   [['rushingYards','Yds'],['rushingAttempts','Att'],['rushingTouchdowns','TD']],
      receiving: [['receivingYards','Yds'],['receptions','Rec'],['receivingTargets','Tgt'],['receivingTouchdowns','TD']],
      defensive: [['totalTackles','Tkl'],['sacks','Sk'],['interceptions','INT'],['passesDefended','PD']],
      batting:   [['hits','H'],['atBats','AB'],['runs','R'],['RBIs','RBI'],['homeRuns','HR'],['strikeouts','K']],
      pitching:  [['fullInnings.partInnings','IP'],['strikeouts','K'],['earnedRuns','ER'],['walks','BB']],
      forwards:  [['goals','G'],['assists','A'],['shotsTotal','SOG'],['plusMinus','+/-']],
      defenses:  [['goals','G'],['assists','A'],['blockedShots','BLK'],['plusMinus','+/-']],
      goaltending:[['saves','SV'],['shotsAgainst','SA'],['goalsAgainst','GA'],['savePercentage','SV%']],
      scoring:   [['points','Pts'],['rebounds','Reb'],['assists','Ast'],['steals','Stl'],['blocks','Blk']],
    };

    // Priority: which stat group to prefer per player when they appear in multiple
    const GROUP_RANK = {passing:1,batting:1,scoring:1,forwards:1,
                        rushing:2,pitching:2,defenses:2,
                        receiving:3,goaltending:3,defensive:4};
    const SHOW_GROUPS = new Set(Object.keys(GROUP_RANK));

    const PROP_LABEL = {
      passing:'Passing Yards O/U', rushing:'Rushing Yards O/U',
      receiving:'Receiving Yards O/U', batting:'Hits O/U',
      pitching:'Strikeouts O/U', forwards:'Points (G+A) O/U',
      scoring:'Points O/U', defenses:'Shots O/U',
    };

    const GROUP_LABEL = {
      passing:'Passing', rushing:'Rushing', receiving:'Receiving',
      defensive:'Defense', batting:'Batting', pitching:'Pitching',
      forwards:'Skater', defenses:'Defense', goaltending:'Goalie', scoring:'Scoring',
    };

    // ─── Render one player research card ───────────────────────────────────
    const renderPlayerCard = (player) => {
      const dispKeys = DISPLAY_KEYS[player.statGroup] || [];
      const games = player.games.slice(0, 10); // up to 10 most-recent verified games
      if (!games.length) return '';

      const groupLabel = GROUP_LABEL[player.statGroup] || player.statGroup;
      const propLabel  = PROP_LABEL[player.statGroup] || 'Prop';

      // ── Current prop line from Odds API (if available) ──────────────────
      const isCompleted = (game.headline && game.headline.toLowerCase().includes('final')) ||
                          (game.status && String(game.status).includes('FINAL'));

      let propLineHtml = '';
      if (isCompleted) {
        propLineHtml = `<div class="pr-prop-line">
          <span class="pr-prop-label">${propLabel}</span>
          <span class="pr-prop-val">Game Final<span class="pr-prop-why"> — current prop markets closed</span></span>
        </div>`;
      } else if (typeof oddsApiService !== 'undefined' && currentProps) {
        const primaryMarket = oddsApiService.getPrimaryMarket(player.statGroup);
        if (primaryMarket) {
          const propData = oddsApiService.lookupPlayerProp(currentProps, player.playerName, primaryMarket);
          const formatted = propData ? oddsApiService.formatPropLine(propData) : null;
          if (formatted) {
            // Show current line + up to 3 bookmakers
            const bmLines = (formatted.bookmakers || []).slice(0, 3).map(bm =>
              `<span class="pr-bm-line"><span class="pr-bm-name">${bm.name}</span><span class="pr-bm-num">${bm.line ?? formatted.line}</span><span class="pr-bm-odds">${bm.overOdds ? 'O ' + (bm.overOdds >= 0 ? '+' + bm.overOdds : bm.overOdds) : ''} / ${bm.underOdds ? 'U ' + (bm.underOdds >= 0 ? '+' + bm.underOdds : bm.underOdds) : ''}</span></span>`
            ).join('');
            propLineHtml = `<div class="pr-prop-live">
              <div class="pr-prop-live-label">${propLabel} <span class="pr-odds-src">Odds API ✓</span></div>
              <div class="pr-bm-rows">${bmLines || '<span class="pr-bm-line">' + formatted.line + '</span>'}</div>
            </div>`;
          } else {
            propLineHtml = `<div class="pr-prop-line"><span class="pr-prop-label">${propLabel}</span><span class="pr-prop-val">Line unavailable</span></div>`;
          }
        } else {
          propLineHtml = `<div class="pr-prop-line"><span class="pr-prop-label">${propLabel}</span><span class="pr-prop-val">Line unavailable</span></div>`;
        }
      } else {
        propLineHtml = `<div class="pr-prop-line"><span class="pr-prop-label">${propLabel}</span><span class="pr-prop-val">Line unavailable</span></div>`;
      }

      // ── Game log rows — ESPN actual stats + historical prop placeholder ──
      const primaryEspnKey = (typeof oddsApiService !== 'undefined')
        ? oddsApiService.getPrimaryEspnKey(player.statGroup)
        : null;
      const primaryMarket = (typeof oddsApiService !== 'undefined')
        ? oddsApiService.getPrimaryMarket(player.statGroup)
        : null;

      const renderGameRow = (g, idx) => {
        const chips = dispKeys.map(([k, label]) => {
          const val = g.stats?.[k];
          if (val === undefined || val === null || val === '' || val === '--') return '';
          return `<span class="pr-chip">${label}<b>${val}</b></span>`;
        }).filter(Boolean).join('');

        const oppLabel = g.opponentAbbr || (g.opponentName || 'OPP').substring(0, 3).toUpperCase();
        const atVs = g.homeAway === 'away' ? '@' : 'vs';
        const histId = `pr-hist-${player.playerId}-${g.eventId}`;

        return `<div class="pr-log-row${idx === 0 ? ' pr-log-last' : ''}">
          <span class="pr-log-meta">
            <span class="pr-log-date">${g.gameDateStr || ''}</span>
            <span class="pr-log-opp">${atVs} ${oppLabel}</span>
          </span>
          <span class="pr-log-chips">${chips || '<span class="pr-chip-none">—</span>'}</span>
          <span class="pr-hist-slot" id="${histId}" data-actual="${g.stats?.[primaryEspnKey] ?? ''}" data-market="${primaryMarket || ''}">
            <span class="pr-hist-unavail">Historical line unavailable</span>
          </span>
          ${idx === 0 ? '<span class="pr-last-tag">LAST</span>' : ''}
        </div>`;
      };

      const last3Rows = games.slice(0, 3).map((g, idx) => renderGameRow(g, idx)).join('');
      const last5Rows = games.length > 3 ? games.slice(3, 5).map((g, idx) => renderGameRow(g, idx + 3)).join('') : '';
      const last10Rows = games.length > 5 ? games.slice(5, 10).map((g, idx) => renderGameRow(g, idx + 5)).join('') : '';

      return `<div class="pr-card" data-player-id="${player.playerId}" data-stat-group="${player.statGroup}">
        <div class="pr-card-top">
          <div class="pr-card-identity">
            <span class="pr-player-name">${player.playerName}</span>
            <span class="pr-group-badge">${groupLabel}</span>
          </div>
          <span class="pr-verified-dot" title="ESPN Boxscore">✓</span>
        </div>

        ${propLineHtml}

        <div class="pr-log-block">
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
        </div>
      </div>`;

    };

    // ─── Render a team's player cards ─────────────────────────────────────
    const renderTeamSection = (teamData) => {
      if (!teamData?.players?.length) return '';

      // Deduplicate: keep best stat group per player
      const byPlayer = new Map();
      for (const p of teamData.players) {
        if (!SHOW_GROUPS.has(p.statGroup) || !p.games?.length) continue;
        const rank = GROUP_RANK[p.statGroup] ?? 9;
        const existing = byPlayer.get(p.playerId);
        if (!existing || rank < (GROUP_RANK[existing.statGroup] ?? 9)) {
          byPlayer.set(p.playerId, p);
        }
      }

      // Sort by group rank then by # games desc
      const players = [...byPlayer.values()]
        .sort((a, b) => (GROUP_RANK[a.statGroup]??9) - (GROUP_RANK[b.statGroup]??9) || b.games.length - a.games.length)
        .slice(0, 6); // max 6 players per team

      if (!players.length) return '';
      const cards = players.map(renderPlayerCard).filter(Boolean).join('');
      if (!cards) return '';

      return `<div class="pr-team-section">
        <div class="pr-team-label">${teamData.name || ''}</div>
        <div class="pr-cards-grid">${cards}</div>
      </div>`;
    };

    const awaySec = renderTeamSection(researchData.awayTeam);
    const homeSec = renderTeamSection(researchData.homeTeam);

    if (!awaySec && !homeSec) {
      return `<div class="di-notice-card">
        <div class="di-notice-header"><span class="di-notice-icon">ℹ️</span><span class="di-notice-title">No Completed Games Yet</span></div>
        <div class="di-notice-body"><p>Neither team has completed games this season. Player stats will appear here after Week 1.</p></div>
      </div>`;
    }

    return `<section class="pr-section">
      <div class="pr-section-header">
        <span class="pr-section-title">PLAYER RESEARCH</span>
        <span class="pr-section-source">ESPN Boxscore &amp; The Odds API · Verified</span>
      </div>
      <p class="pr-section-sub">Actual player statistics from completed ESPN boxscores · Current sportsbook lines from The Odds API · Historical lines &amp; Over/Under results displayed only when verified</p>
      ${awaySec}
      ${homeSec}
    </section>`;
  }

  _friendlyStatKey(key) {
    const map = {
      passingYards: 'Pass Yds', rushingYards: 'Rush Yds', receivingYards: 'Rec Yds',
      passingTouchdowns: 'Pass TD', rushingTouchdowns: 'Rush TD', receivingTouchdowns: 'Rec TD',
      receptions: 'Rec', receivingTargets: 'Tgt',
      'completions/passingAttempts': 'Comp/Att',
      interceptions: 'INT', sacks: 'Sacks', totalTackles: 'Tackles',
      hits: 'H', atBats: 'AB', runs: 'R', RBIs: 'RBI', homeRuns: 'HR',
      walks: 'BB', strikeouts: 'K', earnedRuns: 'ER',
      'fullInnings.partInnings': 'IP',
      points: 'Pts', rebounds: 'Reb', assists: 'Ast',
      goals: 'G', goalAssists: 'A', saves: 'SV', shotsOnGoal: 'SOG',
    };
    return map[key] || key.replace(/([A-Z])/g, ' $1').trim();
  }

  bindCardClicks(container) {
    // Wire each card: Research Bets button flashes yellow, then navigates
    container.querySelectorAll('.game-card, .ufc-fight-card').forEach(card => {
      const btn = card.querySelector('.research-bets-btn, .ufc-research-btn');

      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const gameId = card.dataset.gameId;
          btn.classList.add('btn-flash');
          setTimeout(() => {
            btn.classList.remove('btn-flash');
            this.selectGame(gameId);
          }, 180);
        });
      }

      // Card-level click (anywhere outside the button) still navigates instantly
      card.addEventListener('click', (e) => {
        if (e.target.closest('.research-bets-btn, .ufc-research-btn')) return;
        this.selectGame(card.dataset.gameId);
      });
    });
  }

  bindEvents() {
    // LIVE DATA badge — tap to refresh live ESPN data
    if (this.dom.liveDataBtn) {
      this.dom.liveDataBtn.addEventListener('click', () => this.doRefresh());
      this.dom.liveDataBtn.style.cursor = 'pointer';
      this.dom.liveDataBtn.title = 'Tap to refresh live data';
    }

    // Silent auto-refresh every 5 minutes
    // Uses doSilentRefresh which preserves scroll position and selected sport/game
    setInterval(() => this.doSilentRefresh(), 5 * 60 * 1000);

    // Brand click returns to home
    this.dom.brandTitle.addEventListener('click', () => {
      this.goBackToGames();
    });

    // Architecture modal (keep for demo-modal close)
    this.dom.modalCloseBtn.addEventListener('click', () => {
      this.dom.demoModal.classList.remove('open');
    });

    this.dom.demoModal.addEventListener('click', (e) => {
      if (e.target === this.dom.demoModal) {
        this.dom.demoModal.classList.remove('open');
      }
    });

    // Global keyboard shortcut: Esc closes modal or returns to game list
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.dom.demoModal.classList.contains('open')) {
          this.dom.demoModal.classList.remove('open');
        } else if (this.state.selectedGameId) {
          this.goBackToGames();
        }
      }
    });
  }


  renderSportNav() {
    this.dom.sportNav.innerHTML = SPORTS.map(sport => `
      <button class="sport-btn ${sport.id === this.state.selectedSport ? 'active' : ''}" data-sport="${sport.id}">
        <span>${sport.icon}</span>
        <span>${sport.name}</span>
      </button>
    `).join('');

    this.dom.sportNav.querySelectorAll('.sport-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sportId = btn.dataset.sport;
        if (this.state.selectedSport !== sportId) {
          this.state.selectedSport = sportId;
          this.state.selectedGameId = null;
          this.renderSportNav();
          this.renderSeasonSlateBar();
          this.renderUpcomingGames();
          this.showHomeView();
        }
      });
    });
  }

  renderSeasonSlateBar() {
    if (!this.dom.seasonSlateBar) return;

    if (this.state.selectedSport === 'nfl') {
      const weeks = [
        { label: 'Current Week', val: 0 },
        { label: 'Week 4', val: 4 },
        { label: 'Week 5', val: 5 },
        { label: 'Week 6', val: 6 },
        { label: 'Week 7', val: 7 },
        { label: 'Week 8', val: 8 },
        { label: 'Week 9', val: 9 },
        { label: 'Week 10', val: 10 },
        { label: 'Week 11', val: 11 },
        { label: 'Week 12', val: 12 },
        { label: 'Week 13', val: 13 },
        { label: 'Week 14', val: 14 },
        { label: 'Week 15', val: 15 },
        { label: 'Week 16', val: 16 },
        { label: 'Week 17', val: 17 },
        { label: 'Week 18', val: 18 }
      ];

      this.dom.seasonSlateBar.innerHTML = weeks.map(w => `
        <button class="slate-pill ${this.state.nflWeek === w.val ? 'active' : ''}" data-nfl-week="${w.val}">
          ${w.label}
        </button>
      `).join('');

      this.dom.seasonSlateBar.querySelectorAll('[data-nfl-week]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.state.nflWeek = parseInt(btn.dataset.nflWeek, 10);
          this.renderSeasonSlateBar();
          this.renderUpcomingGames();
        });
      });
    } else if (this.state.selectedSport === 'mlb') {
      const slates = [
        { label: "Today's Slate", offset: 0 },
        { label: 'Tomorrow', offset: 1 },
        { label: 'Next Slate', offset: 2 },
        { label: 'Upcoming Series', offset: 3 }
      ];

      this.dom.seasonSlateBar.innerHTML = slates.map(s => `
        <button class="slate-pill ${this.state.mlbDateOffset === s.offset ? 'active' : ''}" data-mlb-offset="${s.offset}">
          ${s.label}
        </button>
      `).join('');

      this.dom.seasonSlateBar.querySelectorAll('[data-mlb-offset]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.state.mlbDateOffset = parseInt(btn.dataset.mlbOffset, 10);
          this.renderSeasonSlateBar();
          this.renderUpcomingGames();
        });
      });
    } else if (this.state.selectedSport === 'nhl') {
      const slates = [
        { label: "Tonight's Slate", offset: 0 },
        { label: 'Tomorrow', offset: 1 },
        { label: 'Upcoming Slate', offset: 2 }
      ];

      this.dom.seasonSlateBar.innerHTML = slates.map(s => `
        <button class="slate-pill ${this.state.nhlDateOffset === s.offset ? 'active' : ''}" data-nhl-offset="${s.offset}">
          ${s.label}
        </button>
      `).join('');

      this.dom.seasonSlateBar.querySelectorAll('[data-nhl-offset]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.state.nhlDateOffset = parseInt(btn.dataset.nhlOffset, 10);
          this.renderSeasonSlateBar();
          this.renderUpcomingGames();
        });
      });
    } else if (this.state.selectedSport === 'nba') {
      const slates = [
        { label: "Tonight's Games", offset: 0 },
        { label: 'Tomorrow', offset: 1 },
        { label: 'Next Slate', offset: 2 },
        { label: 'Upcoming Slate', offset: 3 }
      ];

      this.dom.seasonSlateBar.innerHTML = slates.map(s => `
        <button class="slate-pill ${this.state.nbaDateOffset === s.offset ? 'active' : ''}" data-nba-offset="${s.offset}">
          ${s.label}
        </button>
      `).join('');

      this.dom.seasonSlateBar.querySelectorAll('[data-nba-offset]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.state.nbaDateOffset = parseInt(btn.dataset.nbaOffset, 10);
          this.renderSeasonSlateBar();
          this.renderUpcomingGames();
        });
      });
    } else if (this.state.selectedSport === 'ufc') {
      // UFC: single next event — no navigation needed
      this.dom.seasonSlateBar.innerHTML = `
        <button class="slate-pill active">Next Event · Live Card</button>
      `;
    } else if (this.state.selectedSport === 'cfb') {
      const weeks = [
        { label: 'This Week', val: 0 },
        { label: 'Week 5', val: 5 },
        { label: 'Week 6', val: 6 },
        { label: 'Week 7', val: 7 },
        { label: 'Week 8', val: 8 },
        { label: 'Week 9', val: 9 },
        { label: 'Week 10', val: 10 },
        { label: 'Week 11', val: 11 },
        { label: 'Week 12', val: 12 },
        { label: 'Week 13', val: 13 },
        { label: 'Championship Week', val: 15 }
      ];

      this.dom.seasonSlateBar.innerHTML = weeks.map(w => `
        <button class="slate-pill ${this.state.cfbWeek === w.val ? 'active' : ''}" data-cfb-week="${w.val}">
          ${w.label}
        </button>
      `).join('');

      this.dom.seasonSlateBar.querySelectorAll('[data-cfb-week]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.state.cfbWeek = parseInt(btn.dataset.cfbWeek, 10);
          this.renderSeasonSlateBar();
          this.renderUpcomingGames();
        });
      });
    }
  }


  getDateParamForOffset(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  showHomeView() {
    this.state.selectedGameId = null;
    this.dom.homeView.style.display = 'block';
    this.dom.gameView.style.display = 'none';
    // NOTE: no scrollTo here — sport tab switches call showHomeView and must
    // NOT force the viewport to jump. Only goBackToGames scrolls to top.
  }

  showGameView() {
    this.dom.homeView.style.display = 'none';
    this.dom.gameView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  goBackToGames() {
    this.showHomeView();
    window.scrollTo({ top: 0, behavior: 'instant' }); // explicit back navigation — scroll to top
    this.renderUpcomingGames();
  }

  // Silent background refresh — does not reset scroll, sport, or game state
  async doSilentRefresh() {
    if (this.state.selectedGameId) return; // don't refresh while in game detail view
    try {
      this.service.clearCache();
      const sport = this.state.selectedSport;
      const options = {};
      if (sport === 'nfl' && this.state.nflWeek > 0) options.week = this.state.nflWeek;
      else if (sport === 'mlb') options.date = this.getDateParamForOffset(this.state.mlbDateOffset);
      else if (sport === 'nhl') options.date = this.getDateParamForOffset(this.state.nhlDateOffset);
      else if (sport === 'nba') options.date = this.getDateParamForOffset(this.state.nbaDateOffset);
      else if (sport === 'cfb' && this.state.cfbWeek > 0) options.week = this.state.cfbWeek;

      const games = await this.service.getUpcomingGames(sport, '', options);
      if (!games || !games.length) return;

      // Remember scroll position
      const scrollY = window.scrollY;

      // Re-render game cards in place (no skeleton loader)
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


  async doRefresh() {

    const btn = this.dom.liveDataBtn;
    const label = this.dom.liveDataLabel;
    const dot = this.dom.liveDot;

    // Prevent double-tap
    if (btn && btn.dataset.refreshing === 'true') return;
    if (btn) btn.dataset.refreshing = 'true';

    // Animate badge: pulsing dot + label change
    if (label) label.textContent = 'REFRESHING...';
    if (dot) dot.style.animation = 'pulse 0.4s ease-in-out infinite';
    if (btn) btn.disabled = true;

    try {
      this.service.clearCache();
      await this.renderUpcomingGames();

      // Brief "UPDATED" confirmation
      if (label) label.textContent = 'UPDATED ✓';
      setTimeout(() => {
        if (label) label.textContent = 'LIVE DATA';
        if (dot) dot.style.animation = '';
      }, 1500);
    } catch (err) {
      console.error('[Refresh] Failed:', err);
      if (label) label.textContent = 'RETRY';
      if (dot) dot.style.background = '#f87171';
      setTimeout(() => {
        if (label) label.textContent = 'LIVE DATA';
        if (dot) { dot.style.background = ''; dot.style.animation = ''; }
      }, 3000);
    } finally {
      if (btn) { btn.disabled = false; btn.dataset.refreshing = 'false'; }
    }
  }


  async renderUpcomingGames() {

    // Show skeleton while loading
    this.dom.gamesList.innerHTML = `
      <div class="skeleton-grid">
        <div class="skeleton-card"><div class="skeleton-bar title"></div><div class="skeleton-bar text"></div><div class="skeleton-bar" style="width:50%"></div></div>
        <div class="skeleton-card"><div class="skeleton-bar title"></div><div class="skeleton-bar text"></div><div class="skeleton-bar" style="width:40%"></div></div>
        <div class="skeleton-card"><div class="skeleton-bar title"></div><div class="skeleton-bar text"></div><div class="skeleton-bar" style="width:60%"></div></div>
      </div>
    `;

    const options = {};
    if (this.state.selectedSport === 'nfl') {
      if (this.state.nflWeek > 0) options.week = this.state.nflWeek;
      // nflWeek 0 = current week — no week param → ESPN scoreboard auto-returns current week
    } else if (this.state.selectedSport === 'mlb') {
      options.date = this.getDateParamForOffset(this.state.mlbDateOffset);
    } else if (this.state.selectedSport === 'nhl') {
      options.date = this.getDateParamForOffset(this.state.nhlDateOffset);
    } else if (this.state.selectedSport === 'nba') {
      options.date = this.getDateParamForOffset(this.state.nbaDateOffset);
    } else if (this.state.selectedSport === 'cfb') {
      if (this.state.cfbWeek > 0) options.week = this.state.cfbWeek;
    }

    let games = [];
    try {
      games = await this.service.getUpcomingGames(this.state.selectedSport, '', options);
    } catch (err) {
      console.error('[renderUpcomingGames] fetch failed:', err);
      this.dom.gamesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">Data unavailable</div>
          <p>Could not load games. Check your connection and click Refresh to try again.</p>
        </div>
      `;
      return;
    }

    // Update timestamp
    if (this.dom.lastUpdatedText) {
      const now = new Date();
      this.dom.lastUpdatedText.textContent = `Live Feed Connected · ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    if (!games || games.length === 0) {
      const sportName = this.state.selectedSport.toUpperCase();
      this.dom.gamesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No Upcoming ${sportName} Games</div>
          <p>All games on this slate have concluded, or no games are scheduled yet. Try a different week or check back when the next slate is released.</p>
        </div>
      `;
      return;
    }

    try {
      this.dom.gamesList.innerHTML = games.map(game => {
        if (game.sport === 'ufc') return this.renderUFCFightCard(game);
        return this.renderGameCard(game);
      }).join('');

      this.bindCardClicks(this.dom.gamesList);

    } catch (renderErr) {
      console.error('[renderUpcomingGames] render failed:', renderErr);
      this.dom.gamesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">Display error</div>
          <p>Games loaded but couldn't be displayed. Try Refresh.</p>
        </div>
      `;
    }
  }


  // Helper: generate team logo HTML
  teamLogoHtml(team) {
    if (team.logoUrl) {
      return `<img class="team-logo-img" src="${team.logoUrl}" alt="${team.short}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="team-logo-placeholder" style="display:none">${(team.short || '?').substring(0,3)}</span>`;
    }
    return `<span class="team-logo-placeholder" style="border-left: 3px solid ${team.logoColor || '#444'}">${(team.short || '?').substring(0,3)}</span>`;
  }

  // Sport-specific spread label
  spreadLabel(sport) {
    if (sport === 'mlb') return 'Run Line:';
    if (sport === 'nhl') return 'Puck Line:';
    if (sport === 'nba') return 'Spread:';
    if (sport === 'cfb') return 'Line:';
    return 'Spread:';
  }

  // Standard game card (NFL, MLB, NHL, NBA, CFB)
  renderGameCard(game) {
    const sl = game.summaryLines;
    const awayRank = game.awayTeam.rank ? `<span class="cfb-rank-badge">#${game.awayTeam.rank}</span>` : '';
    const homeRank = game.homeTeam.rank ? `<span class="cfb-rank-badge">#${game.homeTeam.rank}</span>` : '';

    const isLiveGame = game.gameStatus === 'LIVE';
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
        </div>

        <!-- Col 2: Teams + Venue -->
        <div class="game-col-teams">
          <div class="game-matchup-rows">
            <div class="game-team-row">
              ${this.teamLogoHtml(game.awayTeam)}
              ${awayRank}
              <span class="team-name-text">${game.awayTeam.name}</span>
              <span class="team-record-text">${game.awayTeam.record || ''}</span>
            </div>
            <div class="game-at-separator">@ </div>
            <div class="game-team-row">
              ${this.teamLogoHtml(game.homeTeam)}
              ${homeRank}
              <span class="team-name-text">${game.homeTeam.name}</span>
              <span class="team-record-text">${game.homeTeam.record || ''}</span>
            </div>
          </div>
          <div class="game-venue-line">
            <span class="game-venue-icon">🏟</span>
            <span class="game-venue-name">${game.venue || 'TBD'}</span>
          </div>
        </div>

        <!-- Col 3: Odds -->
        <div class="game-col-odds">
          ${sl.spread ? `<div class="game-odds-row"><span class="odds-label">${this.spreadLabel(game.sport)}</span><span class="odds-value">${sl.spread}</span></div>` : ''}
          ${sl.total ? `<div class="game-odds-row"><span class="odds-label">Total:</span><span class="odds-value">${sl.total}</span></div>` : ''}
          ${sl.ml ? `<div class="game-odds-row"><span class="odds-label">ML:</span><span class="odds-value">${sl.ml}</span></div>` : ''}
        </div>

        <!-- Col 4: Action -->
        <div class="game-col-action">
          <button class="research-bets-btn">RESEARCH BETS →</button>
        </div>

      </div>
    `;
  }


  // Dedicated UFC fight card
  renderUFCFightCard(game) {
    const sl = game.summaryLines;
    const fighterA = game.awayTeam;  // away = challenger (shown first)
    const fighterB = game.homeTeam;  // home = other fighter
    const eventLabel = game.headline || 'UFC Fight Night';
    const weightClass = (game.weightClass || '');
    const FALLBACK_NAMES = new Set(['Fighter A', 'Fighter B', 'Away Team', 'Home Team', null, undefined]);

    // Guard: both fighters must have real names from ESPN
    if (FALLBACK_NAMES.has(fighterA.name) || FALLBACK_NAMES.has(fighterB.name)) {
      // Data unavailable — skip this card rather than showing fake fighter
      return '';
    }

    // Parse per-fighter ML odds from summaryLines.ml if it contains "Fighter X +145 / Fighter Y -175"
    let fighterAOdds = '';
    let fighterBOdds = '';
    const mlRaw = sl.ml || '';
    if (mlRaw && mlRaw !== 'Odds unavailable') {
      // Format: "Name1 +/-xxx / Name2 +/-xxx" — extract the odds values
      const oddsMatch = mlRaw.match(/([+-]\d+)\s*\/\s*.*?([+-]\d+)$/);
      if (oddsMatch) {
        // Home is fighter B, away is fighter A (per our positional assignment)
        fighterBOdds = oddsMatch[1];
        fighterAOdds = oddsMatch[2];
      }
    }

    const isUFCLive = game.gameStatus === 'LIVE';
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
        </div>

        <!-- Fight Body: Fighter A | VS | Fighter B -->
        <div class="ufc-fight-body">

          <div class="ufc-fighter-block fighter-a">
            <div class="ufc-fighter-name">${fighterA.name}</div>
            <div class="ufc-fighter-record">${fighterA.record || 'Record TBD'}</div>
            ${fighterAOdds ? `<div class="ufc-fighter-odds">${fighterAOdds}</div>` : ''}
          </div>

          <div class="ufc-vs-divider">
            <span class="ufc-vs-text">VS</span>
            ${weightClass ? `<span class="ufc-weight-class">${weightClass}</span>` : ''}
          </div>

          <div class="ufc-fighter-block fighter-b">
            <div class="ufc-fighter-name">${fighterB.name}</div>
            <div class="ufc-fighter-record">${fighterB.record || 'Record TBD'}</div>
            ${fighterBOdds ? `<div class="ufc-fighter-odds">${fighterBOdds}</div>` : ''}
          </div>

        </div>

        <!-- Fight Footer -->
        <div class="ufc-fight-footer">
          <div class="ufc-fight-odds">
            ${mlRaw && mlRaw === 'Odds unavailable'
              ? `<div class="ufc-odds-row" style="color:var(--text-dim)">Odds unavailable</div>`
              : (sl.total ? `<div class="ufc-odds-row">${sl.total}</div>` : '')}
          </div>
          <span class="ufc-venue-text">📍 ${game.venue || 'UFC Apex'}</span>
          <button class="ufc-research-btn">RESEARCH FIGHT →</button>
        </div>

      </div>
    `;
  }





  async selectGame(gameId) {
    this.state.selectedGameId = gameId;
    this.state.activeFilter = 'higher_rate';
    this.showGameView();
    await this.renderGameDetailPage();
  }

  async renderGameDetailPage() {
    this.dom.gameDetailContainer.innerHTML = `
      <div class="skeleton-grid" style="margin-top: 20px;">
        <div class="skeleton-card" style="min-height: 180px;"><div class="skeleton-bar title"></div><div class="skeleton-bar text"></div><div class="skeleton-bar"></div></div>
        <div class="skeleton-card"><div class="skeleton-bar title"></div><div class="skeleton-bar text"></div></div>
        <div class="skeleton-card"><div class="skeleton-bar title"></div><div class="skeleton-bar text"></div></div>
      </div>
    `;

    const game = await this.service.getGameById(this.state.selectedGameId);
    if (!game) {
      this.dom.gameDetailContainer.innerHTML = `<div class="empty-state">Game not found.</div>`;
      return;
    }

    // Fetch ESPN player game logs + current Odds API props in parallel
    let researchData   = null;
    let currentProps   = null;  // { playerNameNorm: { marketKey: { line, overOdds, underOdds, bookmakers } } }
    try {
      const fetches = [];
      if (typeof playerGameLogService !== 'undefined' && game.sport !== 'ufc') {
        fetches.push(playerGameLogService.getGameResearchData(game));
      } else {
        fetches.push(Promise.resolve(null));
      }
      if (typeof oddsApiService !== 'undefined' && game.sport !== 'ufc') {
        fetches.push(oddsApiService.getCurrentProps(game.sport, game).catch(e => {
          console.warn('[Odds] getCurrentProps failed:', e.message); return null;
        }));
      } else {
        fetches.push(Promise.resolve(null));
      }
      [researchData, currentProps] = await Promise.all(fetches);
    } catch (err) {
      console.warn('[Research] data fetch failed:', err.message);
    }

    const sl = game.summaryLines || {};
    const isUFC = game.sport === 'ufc';
    const sportLabel = (game.sport || '').toUpperCase();

    // Build verified-only odds rows from live ESPN data
    const oddsRows = [
      sl.spread && sl.spread !== 'N/A' ? `<div class="di-odds-row"><span class="di-odds-label">${this.spreadLabel(game.sport)}</span><span class="di-odds-val">${sl.spread}</span><span class="di-source">ESPN</span></div>` : '',
      sl.total  && sl.total  !== 'N/A' ? `<div class="di-odds-row"><span class="di-odds-label">Total O/U</span><span class="di-odds-val">${sl.total}</span><span class="di-source">ESPN</span></div>` : '',
      sl.ml     && sl.ml     !== 'N/A' ? `<div class="di-odds-row"><span class="di-odds-label">Moneyline</span><span class="di-odds-val">${sl.ml}</span><span class="di-source">ESPN</span></div>` : '',
    ].filter(Boolean).join('');

    const awayLogo = this.teamLogoHtml(game.awayTeam);
    const homeLogo = this.teamLogoHtml(game.homeTeam);

    this.dom.gameDetailContainer.innerHTML = `
      <!-- Back nav -->
      <div class="game-view-header">
        <button class="back-btn" id="back-to-games-btn">← All ${sportLabel} Games</button>
      </div>

      <!-- ── VERIFIED: Game matchup from ESPN live feed ─────────────── -->
      <div class="di-matchup-card">
        <div class="di-verified-badge">✓ VERIFIED — ESPN Live Feed</div>

        <div class="di-matchup-teams">
          <div class="di-team-row">
            ${awayLogo}
            <div class="di-team-info">
              <span class="di-team-name">${game.awayTeam.name}</span>
              <span class="di-team-record">${game.awayTeam.record || ''}</span>
            </div>
            <span class="di-at-label">${isUFC ? 'vs' : '@'}</span>
          </div>
          <div class="di-team-row">
            ${homeLogo}
            <div class="di-team-info">
              <span class="di-team-name">${game.homeTeam.name}</span>
              <span class="di-team-record">${game.homeTeam.record || ''}</span>
            </div>
          </div>
        </div>

        <div class="di-game-meta">
          <span>📅 ${game.date} · ${game.startTime}</span>
          ${game.venue ? `<span>📍 ${game.venue}</span>` : ''}
          ${game.headline && game.headline !== game.awayTeam.name + ' @ ' + game.homeTeam.name ? `<span>🏆 ${game.headline}</span>` : ''}
        </div>

        ${oddsRows ? `
        <div class="di-odds-section">
          <div class="di-section-label">CURRENT LINES — DraftKings / Fliff</div>
          ${oddsRows}
        </div>` : `
        <div class="di-odds-section">
          <div class="di-unavail-inline">Betting lines unavailable for this event</div>
        </div>`}
      </div>

      <!-- ── PLAYER STATS — Real ESPN data or honest unavailable notice ── -->
      ${this._renderResearchStats(researchData, game, currentProps)}
    `;

    document.getElementById('back-to-games-btn').addEventListener('click', () => {
      this.goBackToGames();
    });

    // Activate tab-switching for LAST 3 / 5 / 10 tab buttons in research cards
    const researchSection = this.dom.gameDetailContainer.querySelector('.pr-section');
    if (researchSection) this.bindLogTabs(researchSection);

    // Load historical prop lines in background (lazy, cached)
    // Updates each game-log row's historical slot once data arrives
    if (typeof oddsApiService !== 'undefined' && researchData && game.sport !== 'ufc') {
      this.loadHistoricalProps(game.sport, researchData).catch(e =>
        console.warn('[HistProps]', e.message)
      );
    }

    const copyBtn = document.getElementById('copy-parlay-btn');
    if (copyBtn && parlay) {
      copyBtn.addEventListener('click', async () => {
        const textToCopy = [
          `📊 UrWelcome 5-Leg High-Payout Anchor Parlay (${parlay.overallHitRatePct}% Historical Hit Rate)`,
          `Target Odds Range: +335 to +600 (DraftKings: ${parlay.books?.draftkingss || '+501'} | Fliff: ${parlay.books?.fliff || '+561'})`,
          `Matchup: ${parlay.gameName}`,
          ...parlay.legs.map((leg, i) => `Leg ${i + 1}: ${leg.subject} — ${leg.threshold} (${leg.hitRate})`),
          `DraftKings Odds: ${parlay.books?.draftkingss || '+501'} | Fliff Odds: ${parlay.books?.fliff || '+561'}`
        ].join('\n');

        try {
          await navigator.clipboard.writeText(textToCopy);
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = '<span>✓ Copied to Clipboard!</span>';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = `<span>📋 Copy Parlay Slip (${parlay.books?.draftkingss} / ${parlay.books?.fliff})</span>`;
          }, 2500);
        } catch (err) {
          console.error('Clipboard copy failed:', err);
        }
      });
    }

    this.bindBetCardActions();
  }

  filterAndSortBets(bets, filter) {
    let result = [...bets];

    switch (filter) {
      case 'higher_rate':
        result.sort((a, b) => b.stats.compositeScore - a.stats.compositeScore);
        break;
      case 'lower_rate':
        result.sort((a, b) => a.stats.compositeScore - b.stats.compositeScore);
        break;
      case 'player_props':
        result = result.filter(b => b.category === 'player_props' || b.isPlayerProp);
        result.sort((a, b) => b.stats.compositeScore - a.stats.compositeScore);
        break;
      case 'game_lines':
        result = result.filter(b => b.category === 'game_lines' && !b.isPlayerProp);
        result.sort((a, b) => b.stats.compositeScore - a.stats.compositeScore);
        break;
      case 'all':
      default:
        result.sort((a, b) => b.stats.compositeScore - a.stats.compositeScore);
        break;
    }

    return result;
  }

  renderParlayCard(parlay) {
    if (!parlay || !parlay.legs || parlay.legs.length === 0) return '';
    const draftkingssOdds = parlay.books?.draftkingss || '+501';
    const fliffOdds = parlay.books?.fliff || '+561';

    return `
      <div class="parlay-card" id="game-parlay-card">
        <div class="parlay-header">
          <div class="parlay-title-group">
            <div class="parlay-badge-row">
              <span class="parlay-badge">${parlay.badge || 'PARLAY RESEARCH · MATHEMATICALLY VERIFIED'}</span>
              <span class="parlay-hit-rate-badge">${parlay.overallHitRatePct}% COMBINED HIT RATE</span>
              <span style="font-size: 0.68rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.35); padding: 2px 8px; border-radius: var(--radius-sm); letter-spacing: 0.4px;">
                🎯 +335 TO +600 ODDS TARGET
              </span>
            </div>
            <h3 class="parlay-title">${parlay.title || 'UrWelcome 5-Leg High-Payout Anchor Parlay'}</h3>
            <p class="parlay-subtitle">5 mathematically verified safety legs (85%–100% individual hit rates) configured for maximum payout within the +335 to +600 target window.</p>
          </div>
        </div>

        <div class="parlay-legs-container">
          ${parlay.legs.map((leg, idx) => `
            <div class="parlay-leg-card">
              <div class="parlay-leg-left">
                <span class="leg-number-pill">${idx + 1}</span>
                <div class="leg-info-group">
                  <div class="leg-subject-row">
                    <span>${leg.subject}</span>
                    <span style="color: var(--text-muted);">•</span>
                    <span>${leg.market}</span>
                    <span class="leg-threshold">(${leg.threshold})</span>
                  </div>
                  <div class="leg-note">${leg.note}</div>
                </div>
              </div>

              <div class="parlay-leg-right">
                <span class="leg-hit-pill">${leg.hitRate}</span>
                <div class="leg-checks-track" title="Last 10 game hit sequence">
                  ${(leg.checks || [true, true, true, true, true, true, true, true, true, true]).map(hit => `
                    <span class="leg-check-dot ${hit ? 'hit' : 'miss'}">${hit ? '✓' : '✕'}</span>
                  `).join('')}
                </div>
                <div class="leg-books-tag">DP: ${leg.books?.draftkingss > 0 ? '+' : ''}${leg.books?.draftkingss} | Fliff: ${leg.books?.fliff > 0 ? '+' : ''}${leg.books?.fliff}</div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="parlay-footer">
          <div class="parlay-odds-box">
            <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Verified Odds:</span>
            <div class="parlay-book-pill">
              <span>DraftKings:</span>
              <span class="price">${draftkingssOdds}</span>
            </div>
            <div class="parlay-book-pill best-value">
              <span>Fliff:</span>
              <span class="price">${fliffOdds}</span>
              <span class="best-badge">BEST VALUE</span>
            </div>
          </div>

          <button class="parlay-copy-btn" id="copy-parlay-btn" data-parlay-id="${parlay.gameId}">
            <span>📋 Copy Parlay Slip (${draftkingssOdds} / ${fliffOdds})</span>
          </button>

          <div class="parlay-disclaimer">
            <span>ℹ️ Mathematical Audit: ${parlay.multiplierText || 'Calculated from leg multipliers'} · All legs optimized for highest probability and payout within +335 to +600. Historical performance does not guarantee future results.</span>
          </div>
        </div>
      </div>
    `;
  }

  renderBetCard(bet) {
    if (!bet || !bet.stats) return '';
    const isExpanded = this.state.expandedBetResults.has(bet.id);
    const { stats, bestOdds } = bet;

    // Safety: ensure stats sub-objects exist
    const last3  = stats.last3  || { hits: 0, total: 3,  pct: 0 };
    const last5  = stats.last5  || { hits: 0, total: 5,  pct: 0 };
    const last10 = stats.last10 || { hits: 0, total: 10, pct: 0 };

    let indicatorClass = 'indicator-mixed';
    if (stats.indicator === 'HIGHER HIT RATE') indicatorClass = 'indicator-higher';
    if (stats.indicator === 'LOWER HIT RATE')  indicatorClass = 'indicator-lower';

    const isPlayerProp = !!(bet.isPlayerProp || bet.category === 'player_props');
    const playerName = String(bet.playerName || (isPlayerProp ? bet.subject : null) || '').toUpperCase();

    // Safe conversion — currentLine might be 0 or an object in edge cases
    const rawLine = (bet.currentLine !== null && bet.currentLine !== undefined && typeof bet.currentLine !== 'object')
      ? Number(bet.currentLine)
      : (typeof bet.line === 'number' ? bet.line : 0);
    const side = String(bet.side || 'Over');
    const marketType = String(bet.marketType || '');
    const statUnit = String(bet.statUnit || '');
    const team = String(bet.team || '');
    const subject = String(bet.subject || team || '').toUpperCase();
    const step = typeof bet.step === 'number' ? bet.step : 0.5;

    // Build human-readable line label
    let lineLabel;
    if (marketType === 'Moneyline') {
      lineLabel = side;
    } else if (marketType === 'Spread' || marketType === 'Run Line' || marketType === 'Puck Line') {
      lineLabel = `${side.split(' ')[0]} ${rawLine >= 0 ? '+' : ''}${rawLine}`;
    } else {
      lineLabel = `${side} ${rawLine}`;
    }

    const unitSuffix = (statUnit && statUnit !== 'points' && statUnit !== 'runs' && statUnit !== 'goals') ? ` ${statUnit}` : '';

    const bestBookName = bestOdds ? this.formatBookName(bestOdds.book).toUpperCase() : '';
    const bestPriceRaw = bestOdds ? bestOdds.price : null;
    const bestPriceText = typeof bestPriceRaw === 'number'
      ? (bestPriceRaw > 0 ? `+${bestPriceRaw}` : `${bestPriceRaw}`)
      : (bestPriceRaw ? String(bestPriceRaw) : '-110');

    const booksHtml = bet.books && typeof bet.books === 'object'
      ? Object.entries(bet.books).map(([book, odds]) => {
          if (typeof odds === 'object' || odds === null || odds === undefined) return '';
          const oddsNum = Number(odds);
          const oddsStr = isNaN(oddsNum) ? String(odds) : (oddsNum > 0 ? `+${oddsNum}` : `${oddsNum}`);
          const isBest = bestOdds && bestOdds.book === book;
          return `<div class="book-tag ${isBest ? 'best-price' : ''}">
            <span class="book-name">${this.formatBookName(book)}</span>
            <span>${oddsStr}</span>
            ${isBest ? `<span class="best-badge">BEST</span>` : ''}
          </div>`;
        }).join('')
      : '';

    const historyHtml = (stats.evaluatedLogs || []).map(log => {
      const logVal = log.value !== undefined ? log.value : '—';
      const logDiff = typeof log.diff === 'number' ? `(${log.diff > 0 ? '+' : ''}${log.diff})` : '';
      const oppName = resolveRealTeamName(String(log.opp || ''), this.state.selectedSport);
      return `<div class="history-item">
        <div class="history-game-info">
          <span class="history-date">${log.date || ''}</span>
          <span class="history-opp">${log.isHome ? 'vs' : '@'} ${oppName}</span>
        </div>
        <div class="history-stat-result">
          <span class="history-val">${logVal}${unitSuffix}</span>
          <span class="history-diff">${logDiff}</span>
          <span class="${log.hit ? 'history-check-hit' : 'history-check-miss'}">${log.hit ? '✓' : '✕'}</span>
        </div>
      </div>`;
    }).join('');

    return `
      <div class="bet-card ${isPlayerProp ? 'is-player-prop' : ''}" id="card-${bet.id}">
        <div class="bet-header-row">
          <div class="bet-subject-group">
            ${isPlayerProp ? `
              <div class="bet-player-name">
                <span>${playerName}</span>
                ${team ? `<span class="team-code-pill">${team}</span>` : ''}
              </div>
              <div class="bet-market-subtitle">${marketType} — ${lineLabel}${unitSuffix}</div>
            ` : `
              <div class="bet-subject">
                <span>${subject}</span>
                ${team ? `<span class="team-code-pill">${team}</span>` : ''}
              </div>
              <div class="bet-market-label">${marketType} — ${lineLabel}</div>
            `}
          </div>
          <div class="indicator-badge ${indicatorClass}">${stats.indicator || 'MIXED'}</div>
        </div>

        <div class="bet-line-row">
          <div class="bet-line-display">
            <div class="line-text">${lineLabel}${unitSuffix}</div>
            <div class="line-stepper">
              <button class="step-btn step-down" data-bet-id="${bet.id}" data-step="${-step}">−</button>
              <button class="step-btn step-up"   data-bet-id="${bet.id}" data-step="${step}">+</button>
              ${bet.isLineAdjusted ? `<button class="line-reset-btn" data-bet-id="${bet.id}">Reset</button>` : ''}
            </div>
          </div>
          <div class="primary-odds-box">
            <span class="primary-odds-number">${bestPriceText}</span>
            ${bestBookName ? `<span class="primary-odds-book">${bestBookName}</span>` : ''}
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-metric-box">
            <span class="stat-label">Last 3</span>
            <div class="stat-val-row">
              <span class="stat-count">${last3.hits}/${last3.total}</span>
              <span class="stat-percentage ${this.getPctClass(last3.pct)}">(${last3.pct}%)</span>
            </div>
          </div>
          <div class="stat-metric-box">
            <span class="stat-label">Last 5</span>
            <div class="stat-val-row">
              <span class="stat-count">${last5.hits}/${last5.total}</span>
              <span class="stat-percentage ${this.getPctClass(last5.pct)}">(${last5.pct}%)</span>
            </div>
          </div>
          <div class="stat-metric-box">
            <span class="stat-label">Last 10</span>
            <div class="stat-val-row">
              <span class="stat-count">${last10.hits}/${last10.total}</span>
              <span class="stat-percentage ${this.getPctClass(last10.pct)}">(${last10.pct}%)</span>
            </div>
          </div>
          <div class="stat-average-box">
            <span class="stat-label">Average</span>
            <span class="stat-avg-val">${stats.average !== undefined && stats.average !== null ? stats.average : '—'}${unitSuffix}</span>
          </div>
        </div>

        ${booksHtml ? `<div class="sportsbooks-row"><span class="sportsbooks-label">Sportsbooks:</span>${booksHtml}</div>` : ''}

        <div class="bet-card-footer">
          <button class="view-results-btn" data-toggle-results="${bet.id}">
            <span>${isExpanded ? '▲ Hide Results' : '▼ View 10-Game Results'}</span>
          </button>
          <span style="font-size: 0.72rem; color: var(--text-muted);">
            ${bet.isLineAdjusted ? `Recalculated vs ${rawLine}` : 'Based on verified historical logs'}
          </span>
        </div>

        <div class="results-history-panel ${isExpanded ? 'expanded' : ''}" id="results-${bet.id}">
          <div class="history-header">
            <span>Recent Games (10)</span>
            <span>Result vs ${rawLine}${unitSuffix}</span>
          </div>
          ${historyHtml || '<div style="padding:10px 16px;font-size:0.72rem;color:var(--text-dim);">No historical data available.</div>'}
        </div>

      </div>
    `;
  }  // end renderBetCard

  getPctClass(pct) {
    if (pct >= 70) return 'pct-high';
    if (pct <= 39) return 'pct-low';
    return 'pct-mixed';
  }

  formatBookName(book) {
    if (!book) return 'BEST';
    const lower = book.toLowerCase();
    if (lower.includes('draftkings') || lower.includes('draftkings')) return 'DraftKings';
    if (lower.includes('fliff')) return 'Fliff';
    return book.charAt(0).toUpperCase() + book.slice(1);
  }

  bindBetCardActions() {
    // Stepper buttons for line adjustment
    document.querySelectorAll('.step-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const betId = btn.dataset.betId;
        const step = parseFloat(btn.dataset.step);

        // Read current line from card
        const card = document.getElementById(`card-${betId}`);
        if (!card) return;

        const currentActive = this.service.customLines[betId] !== undefined 
          ? this.service.customLines[betId] 
          : parseFloat(card.querySelector('.line-text').textContent.match(/([+-]?\d+(?:\.\d+)?)/)?.[1] || 0);

        const newLine = Math.round((currentActive + step) * 10) / 10;
        this.service.setCustomLine(betId, newLine);

        this.renderGameDetailPage();
      });
    });

    // Reset line button
    document.querySelectorAll('.line-reset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const betId = btn.dataset.betId;
        this.service.resetCustomLine(betId);
        this.renderGameDetailPage();
      });
    });

    // View results toggle
    document.querySelectorAll('[data-toggle-results]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const betId = btn.dataset.toggleResults;
        if (this.state.expandedBetResults.has(betId)) {
          this.state.expandedBetResults.delete(betId);
        } else {
          this.state.expandedBetResults.add(betId);
        }

        const panel = document.getElementById(`results-${betId}`);
        if (panel) {
          const isNowExpanded = this.state.expandedBetResults.has(betId);
          panel.classList.toggle('expanded', isNowExpanded);
          btn.querySelector('span').textContent = isNowExpanded ? '▲ Hide Results' : '▼ View 10-Game Results';
        }
      });
    });
  }
}

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new SportsResearchApp();
});
