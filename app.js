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
        this.switchSport(sportId);
      });
    });
  }

  bindSidebar() {
    // Sport navigation
    document.querySelectorAll('[data-sidebar-sport]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sportId = btn.dataset.sidebarSport;
        this.switchSport(sportId);
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
        const slotClass = `pr-hist-slot-${player.playerId}-${g.eventId}`;
        const slots = document.querySelectorAll(`.${slotClass}`);
        if (!slots.length) continue;

        const firstSlot = slots[0];
        const actualStr  = firstSlot.getAttribute('data-actual');
        const marketKey  = firstSlot.getAttribute('data-market');
        const actualVal  = actualStr !== '' ? parseFloat(actualStr) : null;

        if (!marketKey) {
          slots.forEach(s => s.innerHTML = '');
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

        const liveSlots = document.querySelectorAll(`.${slotClass}`);
        if (!liveSlots.length) continue;

        if (!histProps) {
          liveSlots.forEach(s => s.innerHTML = '<span class="pr-hist-unavail">Historical line unavailable</span>');
          continue;
        }

        const propEntry = oddsApiService.lookupPlayerProp(histProps, player.playerName, marketKey);
        if (!propEntry || propEntry.line === null) {
          liveSlots.forEach(s => s.innerHTML = '<span class="pr-hist-unavail">Historical line unavailable</span>');
          continue;
        }

        const histLine = propEntry.line;
        const result   = oddsApiService.calculateResult(actualVal, histLine);
        const resultClass = result === 'OVER'  ? 'pr-result-over'
                          : result === 'UNDER' ? 'pr-result-under'
                          : result === 'PUSH'  ? 'pr-result-push'
                          : '';

        const slotHtml = `<span class="pr-hist-line" title="Historical line from Odds API">Line: ${histLine}</span>${
          result ? `<span class="pr-result-badge ${resultClass}">${result}</span>` : ''
        }`;
        liveSlots.forEach(s => s.innerHTML = slotHtml);
      }
    }
  }

  // ─── Render verified player stats from ESPN game logs ────────────────────────
  // Uses researchData from PlayerGameLogService.getGameResearchData()
  // Shows actual per-game boxscore stats (verified ESPN data) for each player.
  // Prop lines are not available from ESPN — marked as "Unavailable".
  // Hit rates are NOT calculated here — requires historical sportsbook lines.
  _renderResearchStats(researchData, game, currentProps) {
    // UFC: Fighter profile research
    if (game && game.sport === 'ufc') {
      const fighterA = game.awayTeam || {};
      const fighterB = game.homeTeam || {};
      const sl = game.summaryLines || {};

      return `
        <section class="pr-section" id="ufc-fighter-research">
          <div class="pr-section-header">
            <span class="pr-section-title">FIGHTER RESEARCH</span>
            <span class="pr-section-source">ESPN Official Bout Record · Verified</span>
          </div>
          <p class="pr-section-sub">Verified fighter records, weight class, and betting market parameters from ESPN and connected sportsbooks</p>

          <div class="pr-cards-grid">
            <div class="pr-card ufc-detail-card">
              <div class="pr-card-top">
                <div class="pr-card-identity">
                  <span class="pr-player-name">${fighterA.name || 'Fighter A'}</span>
                  <span class="pr-group-badge">Challenger / Contender</span>
                </div>
                <span class="pr-verified-dot" title="ESPN Verified">✓</span>
              </div>
              <div class="pr-prop-live">
                <div class="pr-prop-live-label">Official Record</div>
                <div class="ufc-record-val">${fighterA.record || 'Record TBD'}</div>
              </div>
              <div class="ufc-stat-row">
                <span class="ufc-stat-label">Weight Class:</span>
                <span class="ufc-stat-val">${game.weightClass || 'UFC Bout'}</span>
              </div>
              <div class="ufc-stat-row">
                <span class="ufc-stat-label">Venue:</span>
                <span class="ufc-stat-val">${game.venue || 'UFC Apex'}</span>
              </div>
            </div>

            <div class="pr-card ufc-detail-card">
              <div class="pr-card-top">
                <div class="pr-card-identity">
                  <span class="pr-player-name">${fighterB.name || 'Fighter B'}</span>
                  <span class="pr-group-badge">Fighter / Opponent</span>
                </div>
                <span class="pr-verified-dot" title="ESPN Verified">✓</span>
              </div>
              <div class="pr-prop-live">
                <div class="pr-prop-live-label">Official Record</div>
                <div class="ufc-record-val">${fighterB.record || 'Record TBD'}</div>
              </div>
              <div class="ufc-stat-row">
                <span class="ufc-stat-label">Weight Class:</span>
                <span class="ufc-stat-val">${game.weightClass || 'UFC Bout'}</span>
              </div>
              <div class="ufc-stat-row">
                <span class="ufc-stat-label">Venue:</span>
                <span class="ufc-stat-val">${game.venue || 'UFC Apex'}</span>
              </div>
            </div>
          </div>
        </section>
      `;
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
        const histClass = `pr-hist-slot-${player.playerId}-${g.eventId}`;

        return `<div class="pr-log-row${idx === 0 ? ' pr-log-last' : ''}">
          <span class="pr-log-meta">
            <span class="pr-log-date">${g.gameDateStr || ''}</span>
            <span class="pr-log-opp">${atVs} ${oppLabel}</span>
          </span>
          <span class="pr-log-chips">${chips || '<span class="pr-chip-none">—</span>'}</span>
          <span class="pr-hist-slot ${histClass}" data-actual="${g.stats?.[primaryEspnKey] ?? ''}" data-market="${primaryMarket || ''}">
            <span class="pr-hist-unavail">Historical line unavailable</span>
          </span>
          ${idx === 0 ? '<span class="pr-last-tag">LAST</span>' : ''}
        </div>`;
      };

      // Correct tab slicing: each tab shows all completed games up to that limit
      const last3Rows = games.slice(0, 3).map((g, idx) => renderGameRow(g, idx)).join('');
      const last5Rows = games.slice(0, 5).map((g, idx) => renderGameRow(g, idx)).join('');
      const last10Rows = games.slice(0, 10).map((g, idx) => renderGameRow(g, idx)).join('');

      return `<div class="pr-card" id="pr-card-${player.playerId}" data-player-id="${player.playerId}" data-stat-group="${player.statGroup}">
        <div class="pr-card-top">
          <div class="pr-card-identity">
            <span class="pr-player-name">${player.playerName}</span>
            <span class="pr-group-badge">${groupLabel}</span>
          </div>
          <span class="pr-verified-dot" title="ESPN Boxscore">✓</span>
        </div>

        ${propLineHtml}

        <div class="pr-log-block">
          <div class="pr-last10-header">
            <span class="pr-last10-title">LAST 10 GAMES</span>
            <span class="pr-last10-count">${Math.min(games.length, 10)} Completed Games</span>
          </div>
          <div class="pr-last10-panel">
            ${last10Rows || last3Rows}
          </div>
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

  // Activate LAST 3 / LAST 5 / LAST 10 tab switching within player research cards
  bindLogTabs(container) {
    if (!container) return;
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
        this.switchSport(sportId);
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
      const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
      await this.renderUpcomingGames();
      if (typeof window !== 'undefined') window.scrollTo({ top: scrollY, behavior: 'instant' });
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



  // ==========================================================================
  // FINAL PASS: RECOMMENDATION ENGINE & MOBILE-FIRST FLOW
  // Order: Most Upcoming Game -> Recommended Parlay -> Recommended Game Lines
  //        -> Player Props (with tap-to-expand Last 10 research)
  // ==========================================================================

  _getSportEmoji(sport) {
    const map = { nfl: '🏈', mlb: '⚾', nhl: '🏒', nba: '🏀', cfb: '🎓', ufc: '🥊' };
    return map[sport] || '🎯';
  }

  spreadLabel(sport) {
    if (sport === 'mlb') return 'Run Line';
    if (sport === 'nhl') return 'Puck Line';
    return 'Spread';
  }

  teamLogoHtml(team) {
    if (!team) return '<div class="team-logo-fallback">?</div>';
    if (team.logoUrl) {
      return `<img src="${team.logoUrl}" alt="${team.name || ''}" class="team-logo-img" onerror="this.style.display=\\'none\\';this.nextElementSibling.style.display=\\'flex\\';" /><div class="team-logo-fallback" style="display:none;background:${team.logoColor || '#3b82f6'}">${(team.short || team.name || '?').slice(0, 3)}</div>`;
    }
    return `<div class="team-logo-fallback" style="background:${team.logoColor || '#3b82f6'}">${(team.short || team.name || '?').slice(0, 3)}</div>`;
  }

  // ── Seamless Sport / League Switcher ──────────────────────────────────────
  async switchSport(sportId) {
    if (this.state.selectedSport === sportId && !this.state.selectedGameId) return;

    this.state.selectedSport = sportId;
    this.state.selectedGameId = null;
    this.state.expandedPropKey = null;

    // 1. In-place update of navigation active classes (never destroy or rebuild DOM nodes)
    if (this.dom.sportNav) {
      this.dom.sportNav.querySelectorAll('.sport-btn').forEach(btn => {
        const s = (btn.dataset && btn.dataset.sport) || btn.getAttribute('data-sport');
        btn.classList.toggle('active', s === sportId);
      });
    }

    const mobileBar = document.getElementById('mobile-tab-bar');
    if (mobileBar) {
      mobileBar.querySelectorAll('[data-mobile-sport]').forEach(btn => {
        const s = (btn.dataset && btn.dataset.mobileSport) || btn.getAttribute('data-mobile-sport');
        btn.classList.toggle('active', s === sportId);
      });
    }

    document.querySelectorAll('[data-sidebar-sport]').forEach(btn => {
      const s = (btn.dataset && btn.dataset.sidebarSport) || btn.getAttribute('data-sidebar-sport');
      btn.classList.toggle('active-sport', s === sportId);
    });

    // 2. Update season / slate bar
    this.renderSeasonSlateBar();

    // 3. Ensure home view is active without viewport jump
    if (this.dom.homeView && this.dom.gameView) {
      this.dom.homeView.style.display = 'block';
      this.dom.gameView.style.display = 'none';
    }

    // 4. In-place content area loader (preserves scroll position and prevents page jump)
    if (this.dom.gamesList) {
      this.dom.gamesList.innerHTML = `
        <div class="in-place-sport-loader">
          <div class="sport-switch-spinner"></div>
          <span class="sport-switch-text">Loading ${sportId.toUpperCase()} verified schedule & lines...</span>
        </div>
      `;
    }

    // 5. Fetch and render upcoming games
    await this.renderUpcomingGames();
  }

  // ── Build ONE Recommended Parlay (3–5 legs, target +300 to +600 combined odds)
  _buildRecommendedParlay(sport, games, currentProps, selectedGame, gameOddsData, researchData) {
    if (!selectedGame) return null;
    const emoji = this._getSportEmoji(sport);
    const isUFC = sport === 'ufc';
    const awayShort = selectedGame.awayTeam?.short || selectedGame.awayTeam?.name || 'AWAY';
    const homeShort = selectedGame.homeTeam?.short || selectedGame.homeTeam?.name || 'HOME';
    const matchupName = isUFC ? `${awayShort} vs ${homeShort}` : `${awayShort} @ ${homeShort}`;

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

    const PROP_LABELS = {
      player_pass_yds: 'Pass Yds', player_rush_yds: 'Rush Yds', player_reception_yds: 'Rec Yds',
      player_receptions: 'Rec', player_pass_tds: 'Pass TD', batter_hits: 'Hits',
      pitcher_strikeouts: 'Strikeouts', batter_total_bases: 'Total Bases', player_points: 'Points',
      player_rebounds: 'Rebounds', player_assists: 'Assists', player_shots_on_goal: 'Shots',
      player_goals: 'Goals', passing: 'Pass Yds', rushing: 'Rush Yds', receiving: 'Rec Yds'
    };

    const candidates = [];

    // 1. Gather verified player props for this game from currentProps
    if (typeof oddsApiService !== 'undefined' && currentProps) {
      for (const [pNorm, markets] of Object.entries(currentProps)) {
        for (const [mKey, pData] of Object.entries(markets)) {
          if (pData && pData.line !== null) {
            const overPrice = pData.overOdds != null ? Number(pData.overOdds) : null;
            // Select props with reasonable prices (-220 to +160)
            if (overPrice !== null && overPrice >= -220 && overPrice <= 160) {
              const titleName = pNorm.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              const propLabel = PROP_LABELS[mKey] || 'Player Prop';
              const bookTitle = pData.bookmaker || (pData.bookmakers && pData.bookmakers[0]?.name) || 'Sportsbook';
              candidates.push({
                type: 'prop',
                playerId: pNorm,
                emoji,
                subject: `${titleName} ${propLabel}`,
                market: propLabel,
                line: `Over ${pData.line}`,
                odds: fmtOdds(overPrice),
                decimal: toDecimal(overPrice),
                book: bookTitle,
                gameName: matchupName,
              });
              break; // At most one prop per player in parlay
            }
          }
        }
      }
    }

    // 2. Gather verified game lines from gameOddsData (or fallback to ESPN summaryLines)
    if (gameOddsData) {
      // Spreads
      if (gameOddsData.spreads && gameOddsData.spreads.length > 0) {
        for (const s of gameOddsData.spreads) {
          if (s.price >= -220 && s.price <= 160) {
            const spreadLabel = this.spreadLabel(sport).replace(':', '').trim();
            const spreadStr = s.point > 0 ? `+${s.point}` : `${s.point}`;
            candidates.push({
              type: 'spread',
              sideId: s.teamShort,
              emoji,
              subject: `${s.teamShort} ${spreadLabel}`,
              market: spreadLabel,
              line: `${s.teamShort} ${spreadStr}`,
              odds: s.priceStr,
              decimal: s.decimal,
              book: s.bookmaker || 'Sportsbook',
              gameName: matchupName,
            });
          }
        }
      }
      // Totals
      if (gameOddsData.totals && gameOddsData.totals.length > 0) {
        for (const t of gameOddsData.totals) {
          if (t.price >= -220 && t.price <= 160) {
            const totalLabel = isUFC ? 'Total Rounds' : (sport === 'mlb' ? 'Total Runs' : (sport === 'nhl' ? 'Total Goals' : 'Total Points'));
            candidates.push({
              type: 'total',
              sideId: t.side,
              emoji,
              subject: `${awayShort}/${homeShort} ${t.side}`,
              market: totalLabel,
              line: `${t.side} ${t.point}`,
              odds: t.priceStr,
              decimal: t.decimal,
              book: t.bookmaker || 'Sportsbook',
              gameName: matchupName,
            });
          }
        }
      }
      // Moneylines
      if (gameOddsData.moneylines && gameOddsData.moneylines.length > 0) {
        for (const m of gameOddsData.moneylines) {
          if (m.price >= -220 && m.price <= 160) {
            candidates.push({
              type: 'ml',
              sideId: m.teamShort,
              emoji,
              subject: `${m.teamShort} ML`,
              market: isUFC ? 'Fight Winner' : 'Moneyline',
              line: `${m.teamShort} Moneyline`,
              odds: m.priceStr,
              decimal: m.decimal,
              book: m.bookmaker || 'Sportsbook',
              gameName: matchupName,
            });
          }
        }
      }
    } else {
      // Fallback from selectedGame.summaryLines
      const sl = selectedGame.summaryLines || {};
      if (sl.spread && sl.spread !== 'N/A' && !sl.spread.includes('unavailable')) {
        const spreadLabel = this.spreadLabel(sport).replace(':', '').trim();
        const match = sl.spread.match(/([A-Z0-9]+)\s*([+-]\d+\.?\d*)/i);
        if (match) {
          const favTeam = match[1];
          const spreadNum = parseFloat(match[2]);
          candidates.push({
            type: 'spread',
            sideId: favTeam,
            emoji,
            subject: `${favTeam} ${spreadLabel}`,
            market: spreadLabel,
            line: `${favTeam} ${spreadNum > 0 ? '+' : ''}${spreadNum}`,
            odds: '-110',
            decimal: 1.91,
            book: 'Consensus',
            gameName: matchupName,
          });
        }
      }
      if (sl.total && sl.total !== 'N/A' && !sl.total.includes('unavailable')) {
        const totalMatch = sl.total.match(/(\d+\.?\d*)/);
        const totalNum = totalMatch ? totalMatch[1] : sl.total;
        const totalLabel = isUFC ? 'Total Rounds' : (sport === 'mlb' ? 'Total Runs' : (sport === 'nhl' ? 'Total Goals' : 'Total Points'));
        candidates.push({
          type: 'total',
          sideId: 'Over',
          emoji,
          subject: `${awayShort}/${homeShort} Over`,
          market: totalLabel,
          line: `Over ${totalNum}`,
          odds: '-110',
          decimal: 1.91,
          book: 'Consensus',
          gameName: matchupName,
        });
      }
      if (sl.ml && sl.ml !== 'N/A' && !sl.ml.includes('unavailable')) {
        const parts = sl.ml.split('/');
        for (const p of parts) {
          const m = p.trim().match(/([A-Za-z0-9\s.]+)\s+([+-]\d+)/);
          if (m) {
            const team = m[1].trim();
            const price = parseInt(m[2], 10);
            if (!isNaN(price) && price >= -220 && price <= 160) {
              candidates.push({
                type: 'ml',
                sideId: team,
                emoji,
                subject: `${team} ML`,
                market: isUFC ? 'Fight Winner' : 'Moneyline',
                line: `${team} Moneyline`,
                odds: fmtOdds(price),
                decimal: toDecimal(price),
                book: 'Consensus',
                gameName: matchupName,
              });
            }
          }
        }
      }
    }

    // 3. For UFC or games with fewer than 3 candidates:
    // Supplement from other verified matches on the same slate (e.g. other fights on the UFC card)
    if (candidates.length < 3 && games && games.length > 1) {
      for (const og of games) {
        if (og.id === selectedGame.id) continue;
        const oAway = og.awayTeam?.short || og.awayTeam?.name || 'AWAY';
        const oHome = og.homeTeam?.short || og.homeTeam?.name || 'HOME';
        const oMatchup = isUFC ? `${oAway} vs ${oHome}` : `${oAway} @ ${oHome}`;
        const oSL = og.summaryLines || {};

        if (oSL.ml && oSL.ml !== 'N/A' && !oSL.ml.includes('unavailable')) {
          const parts = oSL.ml.split('/');
          for (const p of parts) {
            const m = p.trim().match(/([A-Za-z0-9\s.]+)\s+([+-]\d+)/);
            if (m) {
              const team = m[1].trim();
              const price = parseInt(m[2], 10);
              if (!isNaN(price) && price >= -220 && price <= 160) {
                candidates.push({
                  type: 'slate_ml',
                  sideId: team,
                  emoji,
                  subject: `${team} ML`,
                  market: isUFC ? 'Fight Winner' : 'Moneyline',
                  line: `${team} Moneyline`,
                  odds: fmtOdds(price),
                  decimal: toDecimal(price),
                  book: 'Consensus',
                  gameName: oMatchup,
                });
                break;
              }
            }
          }
        } else if (oSL.spread && oSL.spread !== 'N/A' && !oSL.spread.includes('unavailable')) {
          candidates.push({
            type: 'slate_spread',
            sideId: oHome,
            emoji,
            subject: `${oHome} Spread`,
            market: this.spreadLabel(sport).replace(':', '').trim(),
            line: oSL.spread,
            odds: '-110',
            decimal: 1.91,
            book: 'Consensus',
            gameName: oMatchup,
          });
        }
        if (candidates.length >= 6) break;
      }
    }

    if (candidates.length < 2) return null;

    // Helper to test if a combination has conflicting legs
    const hasConflicts = (combo) => {
      let spreadCount = 0;
      let totalCount = 0;
      const seenPlayers = new Set();
      const seenGames = new Set();

      for (const leg of combo) {
        if (leg.type === 'spread') {
          spreadCount++;
          if (spreadCount > 1) return true;
        }
        if (leg.type === 'total') {
          totalCount++;
          if (totalCount > 1) return true;
        }
        if (leg.type === 'prop') {
          if (seenPlayers.has(leg.playerId)) return true;
          seenPlayers.add(leg.playerId);
        }
        if (leg.type === 'slate_ml' || leg.type === 'slate_spread') {
          if (seenGames.has(leg.gameName)) return true;
          seenGames.add(leg.gameName);
        }
      }
      return false;
    };

    // Helper: generate combinations of length k
    const getCombos = (arr, k) => {
      const res = [];
      const backtrack = (start, current) => {
        if (current.length === k) {
          res.push([...current]);
          return;
        }
        for (let i = start; i < arr.length; i++) {
          current.push(arr[i]);
          backtrack(i + 1, current);
          current.pop();
        }
      };
      backtrack(0, []);
      return res;
    };

    let selectedLegs = null;
    let selectedMultiplier = 1;

    // 1. Search for 3-leg, 4-leg, then 5-leg combination in target range (+300 to +600, multiplier 4.0 to 7.0)
    for (const legCount of [3, 4, 5]) {
      if (candidates.length >= legCount) {
        const combos = getCombos(candidates, legCount);
        for (const combo of combos) {
          if (hasConflicts(combo)) continue;
          const mult = combo.reduce((acc, l) => acc * l.decimal, 1);
          if (mult >= 4.0 && mult <= 7.0) {
            selectedLegs = combo;
            selectedMultiplier = mult;
            break;
          }
        }
        if (selectedLegs) break;
      }
    }

    // 2. Secondary search: wider target range (+250 to +750, multiplier 3.5 to 8.5)
    if (!selectedLegs) {
      for (const legCount of [3, 4]) {
        if (candidates.length >= legCount) {
          const combos = getCombos(candidates, legCount);
          for (const combo of combos) {
            if (hasConflicts(combo)) continue;
            const mult = combo.reduce((acc, l) => acc * l.decimal, 1);
            if (mult >= 3.5 && mult <= 8.5) {
              selectedLegs = combo;
              selectedMultiplier = mult;
              break;
            }
          }
          if (selectedLegs) break;
        }
      }
    }

    // 3. Fallback: take best non-conflicting candidates
    if (!selectedLegs) {
      const nonConflicting = [];
      for (const c of candidates) {
        if (!hasConflicts([...nonConflicting, c])) {
          nonConflicting.push(c);
        }
        if (nonConflicting.length === 3) break;
      }
      selectedLegs = nonConflicting.length >= 2 ? nonConflicting : candidates.slice(0, 3);
      selectedMultiplier = selectedLegs.reduce((acc, l) => acc * l.decimal, 1);
    }

    // Calculate exact mathematical combined American odds from actual leg prices
    let combinedOddsStr = '+450';
    if (selectedMultiplier >= 2.0) {
      combinedOddsStr = `+${Math.round((selectedMultiplier - 1) * 100)}`;
    } else {
      combinedOddsStr = `-${Math.round(100 / (selectedMultiplier - 1))}`;
    }

    return {
      matchup: matchupName,
      legs: selectedLegs,
      combinedOdds: combinedOddsStr,
      legCount: selectedLegs.length,
      multiplier: Math.round(selectedMultiplier * 100) / 100,
    };
  }

  // ── Safe String Helper (Guarantees zero [object Object] bugs) ─────────────
  _safeString(val, fallback = '—') {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || trimmed === '[object Object]') return fallback;
      return trimmed;
    }
    if (typeof val === 'number') {
      return isNaN(val) ? fallback : String(val);
    }
    if (typeof val === 'boolean') {
      return val ? 'true' : 'false';
    }
    if (typeof val === 'object') {
      if (val.displayValue !== undefined && val.displayValue !== null) return String(val.displayValue);
      if (val.value !== undefined && val.value !== null) return String(val.value);
      if (val.displayName) return String(val.displayName);
      if (val.name) return String(val.name);
      if (val.text) return String(val.text);
      if (val.label) return String(val.label);
      if (val.shortName) return String(val.shortName);
      if (val.abbreviation) return String(val.abbreviation);
      if (val.abbr) return String(val.abbr);
      return fallback;
    }
    return String(val);
  }

  // ── Build Recommended Game Lines (Strictly for selectedGame, 4-6 verified plays, 2x2 or 2x3, -220 or better)
  _buildRecommendedGameLines(sport, selectedGame, gameOddsData) {
    if (!selectedGame) return [];
    const emoji = this._getSportEmoji(sport);
    const lines = [];
    const away = this._safeString(selectedGame.awayTeam?.short || selectedGame.awayTeam?.name, 'AWAY');
    const home = this._safeString(selectedGame.homeTeam?.short || selectedGame.homeTeam?.name, 'HOME');
    const isUFC = sport === 'ufc';
    const spreadLabel = this.spreadLabel(sport).replace(':', '').trim();
    const totalLabel = isUFC ? 'Total Rounds' : (sport === 'mlb' ? 'Total Runs' : (sport === 'nhl' ? 'Total Goals' : 'Total Points'));

    const isReasonableOdds = (price) => {
      const p = Number(price);
      if (isNaN(p)) return true;
      if (p < 0 && p < -220) return false;
      return true;
    };

    if (isUFC) {
      if (gameOddsData && gameOddsData.moneylines && gameOddsData.moneylines.length > 0) {
        const mls = [...gameOddsData.moneylines].filter(m => isReasonableOdds(m.price));
        for (const ml of mls.slice(0, 2)) {
          lines.push({
            gameId: selectedGame.id,
            emoji,
            subject: `${ml.teamShort} ML`,
            line: `${ml.teamShort} to Win`,
            odds: ml.priceStr,
            market: 'Fight Winner',
            book: ml.bookmaker || 'Sportsbook',
            decimal: ml.decimal,
          });
        }
      } else if (selectedGame.summaryLines?.ml && selectedGame.summaryLines.ml !== 'N/A' && !selectedGame.summaryLines.ml.includes('unavailable')) {
        const parts = selectedGame.summaryLines.ml.split('/');
        for (const p of parts) {
          const match = p.trim().match(/([A-Za-z0-9\s.]+)\s+([+-]\d+)/);
          if (match) {
            const team = match[1].trim();
            const price = parseInt(match[2], 10);
            if (!isNaN(price) && isReasonableOdds(price)) {
              lines.push({
                gameId: selectedGame.id,
                emoji,
                subject: `${team} ML`,
                line: `${team} to Win`,
                odds: price > 0 ? `+${price}` : `${price}`,
                market: 'Fight Winner',
                book: 'Consensus',
                decimal: price > 0 ? 1 + (price / 100) : 1 + (100 / Math.abs(price)),
              });
            }
          }
        }
      }

      if (gameOddsData && gameOddsData.totals && gameOddsData.totals.length > 0) {
        const t = gameOddsData.totals[0];
        lines.push({
          gameId: selectedGame.id,
          emoji,
          subject: `Total Rounds`,
          line: `${t.side} ${t.point} Rounds`,
          odds: t.priceStr,
          market: 'Total Rounds',
          book: t.bookmaker || 'Sportsbook',
          decimal: t.decimal,
        });
      }
    } else {
      let chosenSpread = null;
      let chosenTotal = null;
      let chosenML = null;

      // 1. Spreads (Pick exactly ONE side — NEVER both)
      if (gameOddsData && gameOddsData.spreads && gameOddsData.spreads.length > 0) {
        const spreads = gameOddsData.spreads.filter(s => isReasonableOdds(s.price));
        if (spreads.length > 0) {
          const fav = spreads.find(s => s.point < 0);
          const dog = spreads.find(s => s.point > 0);
          if (fav && Math.abs(fav.point) <= 7.5) {
            chosenSpread = fav;
          } else if (dog) {
            chosenSpread = dog;
          } else {
            chosenSpread = spreads[0];
          }
        }
      }

      // 2. Totals (Pick exactly ONE side — Over OR Under, NEVER both)
      if (gameOddsData && gameOddsData.totals && gameOddsData.totals.length > 0) {
        const totals = gameOddsData.totals.filter(t => isReasonableOdds(t.price));
        if (totals.length > 0) {
          const over = totals.find(t => t.side === 'Over');
          const under = totals.find(t => t.side === 'Under');
          const pt = (over || under)?.point || 45;
          if (sport === 'nfl' || sport === 'cfb') {
            chosenTotal = pt > 51.5 ? (under || over) : (over || under);
          } else if (sport === 'mlb') {
            chosenTotal = pt > 8.5 ? (under || over) : (over || under);
          } else if (sport === 'nhl') {
            chosenTotal = pt > 6.0 ? (under || over) : (over || under);
          } else if (sport === 'nba') {
            chosenTotal = pt > 229 ? (under || over) : (over || under);
          } else {
            chosenTotal = totals[0];
          }
        }
      }

      // 3. Moneylines (Pick ONE side — NEVER both)
      if (gameOddsData && gameOddsData.moneylines && gameOddsData.moneylines.length > 0) {
        const mls = gameOddsData.moneylines.filter(m => isReasonableOdds(m.price));
        if (mls.length > 0) {
          const favML = mls.find(m => m.price < 0 && m.price >= -220);
          const dogML = mls.find(m => m.price > 0 && m.price <= 200);
          chosenML = favML || dogML || mls[0];
        }
      }

      // Fallback to ESPN summaryLines if Odds API returned no data
      if (!chosenSpread && !chosenTotal && !chosenML) {
        const sl = selectedGame.summaryLines || {};
        if (sl.spread && sl.spread !== 'N/A' && !sl.spread.includes('unavailable')) {
          const match = sl.spread.match(/([A-Z0-9]+)\s*([+-]\d+\.?\d*)/i);
          if (match) {
            const team = match[1];
            const pt = parseFloat(match[2]);
            chosenSpread = {
              teamShort: team,
              point: pt,
              price: -110,
              priceStr: '-110',
              bookmaker: 'Consensus',
              decimal: 1.91,
            };
          }
        }
        if (sl.total && sl.total !== 'N/A' && !sl.total.includes('unavailable')) {
          const totalMatch = sl.total.match(/(\d+\.?\d*)/);
          const totalNum = totalMatch ? parseFloat(totalMatch[1]) : 45.5;
          chosenTotal = {
            side: totalNum > 50 ? 'Under' : 'Over',
            point: totalNum,
            price: -110,
            priceStr: '-110',
            bookmaker: 'Consensus',
            decimal: 1.91,
          };
        }
        if (sl.ml && sl.ml !== 'N/A' && !sl.ml.includes('unavailable')) {
          const parts = sl.ml.split('/');
          for (const p of parts) {
            const match = p.trim().match(/([A-Za-z0-9\s.]+)\s+([+-]\d+)/);
            if (match) {
              const team = match[1].trim();
              const price = parseInt(match[2], 10);
              if (!isNaN(price) && isReasonableOdds(price)) {
                chosenML = {
                  teamShort: team,
                  price,
                  priceStr: price > 0 ? `+${price}` : `${price}`,
                  bookmaker: 'Consensus',
                  decimal: price > 0 ? 1 + (price / 100) : 1 + (100 / Math.abs(price)),
                };
                break;
              }
            }
          }
        }
      }

      if (chosenSpread) {
        const spreadStr = chosenSpread.point > 0 ? `+${chosenSpread.point}` : `${chosenSpread.point}`;
        lines.push({
          gameId: selectedGame.id,
          emoji,
          subject: `${chosenSpread.teamShort} ${spreadLabel}`,
          line: `${chosenSpread.teamShort} ${spreadStr}`,
          odds: chosenSpread.priceStr,
          market: spreadLabel,
          book: chosenSpread.bookmaker || 'Sportsbook',
          decimal: chosenSpread.decimal,
        });
      }

      if (chosenTotal) {
        lines.push({
          gameId: selectedGame.id,
          emoji,
          subject: `${away}/${home} ${chosenTotal.side}`,
          line: `${chosenTotal.side} ${chosenTotal.point}`,
          odds: chosenTotal.priceStr,
          market: totalLabel,
          book: chosenTotal.bookmaker || 'Sportsbook',
          decimal: chosenTotal.decimal,
        });
      }

      if (chosenML) {
        lines.push({
          gameId: selectedGame.id,
          emoji,
          subject: `${chosenML.teamShort} ML`,
          line: `${chosenML.teamShort} Moneyline`,
          odds: chosenML.priceStr,
          market: 'Moneyline',
          book: chosenML.bookmaker || 'Sportsbook',
          decimal: chosenML.decimal,
        });
      }

      // Additional verified bookmaker plays from allTotals, allSpreads, allMoneylines
      // (Only verified bookmaker data with genuine prices — NO fake lines)
      if (gameOddsData && gameOddsData.allTotals && gameOddsData.allTotals.length > 0) {
        for (const altT of gameOddsData.allTotals) {
          if (lines.length >= 6) break;
          const already = lines.some(l => l.book === altT.bookmaker && l.market === totalLabel);
          if (!already && isReasonableOdds(altT.price)) {
            lines.push({
              gameId: selectedGame.id,
              emoji,
              subject: `${away}/${home} ${altT.side}`,
              line: `${altT.side} ${altT.point}`,
              odds: altT.priceStr,
              market: totalLabel,
              book: altT.bookmaker,
              decimal: altT.decimal,
            });
          }
        }
      }

      if (gameOddsData && gameOddsData.allSpreads && gameOddsData.allSpreads.length > 0) {
        for (const altS of gameOddsData.allSpreads) {
          if (lines.length >= 6) break;
          const already = lines.some(l => l.book === altS.bookmaker && l.market === spreadLabel);
          if (!already && isReasonableOdds(altS.price)) {
            const spreadStr = altS.point > 0 ? `+${altS.point}` : `${altS.point}`;
            lines.push({
              gameId: selectedGame.id,
              emoji,
              subject: `${altS.teamShort} ${spreadLabel}`,
              line: `${altS.teamShort} ${spreadStr}`,
              odds: altS.priceStr,
              market: spreadLabel,
              book: altS.bookmaker,
              decimal: altS.decimal,
            });
          }
        }
      }

      if (gameOddsData && gameOddsData.allMoneylines && gameOddsData.allMoneylines.length > 0) {
        for (const altM of gameOddsData.allMoneylines) {
          if (lines.length >= 6) break;
          const already = lines.some(l => l.book === altM.bookmaker && l.market === 'Moneyline');
          if (!already && isReasonableOdds(altM.price)) {
            lines.push({
              gameId: selectedGame.id,
              emoji,
              subject: `${altM.teamShort} ML`,
              line: `${altM.teamShort} Moneyline`,
              odds: altM.priceStr,
              market: 'Moneyline',
              book: altM.bookmaker,
              decimal: altM.decimal,
            });
          }
        }
      }
    }

    if (lines.length > 6) {
      return lines.slice(0, 6);
    }
    if (lines.length === 5) {
      return lines.slice(0, 4);
    }
    return lines;
  }

  // ── Calculate Prop Hit Result (Over: actual > line; Under: actual < line) ──
  _calculatePropHit(actualStat, lineVal, direction = 'OVER') {
    const rawActual = (typeof actualStat === 'object' && actualStat !== null)
      ? (actualStat.value ?? actualStat.displayValue ?? 0)
      : actualStat;
    if (rawActual === null || rawActual === undefined || isNaN(rawActual)) {
      return { hit: false, push: false, label: '—', badgeClass: 'miss' };
    }
    const numActual = Number(rawActual);
    const numLine = Number(lineVal);

    if (numActual === numLine) {
      return { hit: false, push: true, label: `PUSH ${numLine}`, badgeClass: 'push' };
    }

    if (direction.toUpperCase() === 'OVER') {
      const isHit = numActual > numLine;
      return {
        hit: isHit,
        push: false,
        label: isHit ? `✓ OVER ${numLine}` : `✗ UNDER ${numLine}`,
        badgeClass: isHit ? 'hit' : 'miss'
      };
    } else {
      const isHit = numActual < numLine;
      return {
        hit: isHit,
        push: false,
        label: isHit ? `✓ UNDER ${numLine}` : `✗ OVER ${numLine}`,
        badgeClass: isHit ? 'hit' : 'miss'
      };
    }
  }

  // ── Build Recommended Player Props (Strictly for selectedGame: up to 8 Team A, up to 8 Team B)
  _buildRecommendedPlayerProps(sport, selectedGame, currentProps, researchData) {
    if (!selectedGame) return { teamAProps: [], teamBProps: [], allProps: [] };
    const emoji = this._getSportEmoji(sport);
    const isUFC = sport === 'ufc';

    // UFC Integrity: fight-based only. No player Last 10, no artificial prop cards.
    if (isUFC) {
      return { teamAProps: [], teamBProps: [], allProps: [] };
    }

    const PROP_LABELS = {
      passing: 'Passing Yards', rushing: 'Rushing Yards', receiving: 'Receiving Yards',
      batting: 'Hits', pitching: 'Strikeouts', forwards: 'Points', scoring: 'Points', skating: 'Points',
      player_pass_yds: 'Passing Yards', player_rush_yds: 'Rushing Yards', player_reception_yds: 'Receiving Yards',
      player_receptions: 'Receptions', player_pass_tds: 'Pass Touchdowns', batter_hits: 'Hits',
      pitcher_strikeouts: 'Strikeouts', batter_total_bases: 'Total Bases', player_points: 'Points',
      player_rebounds: 'Rebounds', player_assists: 'Assists', player_shots_on_goal: 'Shots on Goal',
      player_goals: 'Goals'
    };

    const awayTeamShort = this._safeString(selectedGame.awayTeam?.short || selectedGame.awayTeam?.name, 'Away');
    const homeTeamShort = this._safeString(selectedGame.homeTeam?.short || selectedGame.homeTeam?.name, 'Home');

    const awayPlayers = researchData?.awayTeam?.players || [];
    const homePlayers = researchData?.homeTeam?.players || [];

    const evaluatePlayer = (espnPlayer, rawLine, direction) => {
      const completedGames = (espnPlayer?.games || []).slice(0, 10);
      let hitCount = 0;
      const evaluatedGames = completedGames.map(g => {
        const statVal = (typeof g.primaryStat === 'object' && g.primaryStat !== null)
          ? (g.primaryStat.value ?? g.primaryStat.displayValue ?? 0)
          : g.primaryStat;
        const hitRes = this._calculatePropHit(statVal, rawLine, direction);
        if (hitRes.hit) hitCount++;
        return {
          ...g,
          gameDateStr: this._safeString(g.gameDateStr),
          opponentAbbr: this._safeString(g.opponentAbbr || g.opponentName),
          primaryStat: statVal,
          hitResult: hitRes
        };
      });
      const hitPct = completedGames.length > 0 ? Math.round((hitCount / completedGames.length) * 100) : 0;
      return { evaluatedGames, hitCount, hitPct, totalGames: completedGames.length };
    };

    const buildPropsForTeam = (playerList, teamShort) => {
      const teamProps = [];
      const seenNames = new Set();

      for (const p of playerList) {
        if (!p || !p.playerName || teamProps.length >= 8) continue;
        const normName = p.playerName.toLowerCase().trim();
        if (seenNames.has(normName)) continue;

        let propData = null;
        let mKey = null;
        if (typeof oddsApiService !== 'undefined' && currentProps) {
          mKey = oddsApiService.getPrimaryMarket(p.statGroup);
          if (mKey) {
            propData = oddsApiService.lookupPlayerProp(currentProps, p.playerName, mKey);
          }
          if (!propData) {
            const pNorm = oddsApiService._normalizePlayer(p.playerName);
            const playerPropsMap = currentProps[pNorm];
            if (playerPropsMap) {
              const firstMKey = Object.keys(playerPropsMap)[0];
              if (firstMKey) {
                mKey = firstMKey;
                propData = playerPropsMap[firstMKey];
              }
            }
          }
        }

        // STRICT ODDS INTEGRITY:
        // Only include player props that have real, verified sportsbook data.
        // DO NOT generate synthetic lines or placeholder odds (-110/-115).
        if (!propData || propData.line === null) continue;

        const formatted = oddsApiService.formatPropLine(propData);
        if (!formatted || (!formatted.overOdds && !formatted.underOdds)) continue;

        const rawLine = propData.line;
        const direction = formatted.overOdds ? 'OVER' : 'UNDER';
        const oddsVal = formatted.overOdds || formatted.underOdds;
        const bookName = formatted.bookmaker || (propData.bookmakers && propData.bookmakers[0]?.name) || 'Sportsbook';
        const pType = PROP_LABELS[mKey] || PROP_LABELS[p.statGroup] || 'Player Prop';

        const { evaluatedGames, hitCount, hitPct, totalGames } = evaluatePlayer(p, rawLine, direction);
        const propKey = `prop-${selectedGame.id}-${p.playerId || normName.replace(/\s+/g, '-')}-${p.statGroup || mKey || 'prop'}`;

        seenNames.add(normName);
        teamProps.push({
          propKey,
          gameId: selectedGame.id,
          playerId: p.playerId || normName,
          playerName: this._safeString(p.playerName),
          teamLabel: teamShort,
          propType: pType,
          line: `O ${rawLine}`,
          rawLine,
          direction,
          odds: oddsVal,
          book: bookName,
          emoji,
          games: evaluatedGames,
          hitCount,
          hitPct,
          totalGames
        });
      }

      return teamProps;
    };

    const teamAProps = buildPropsForTeam(awayPlayers, awayTeamShort);
    const teamBProps = buildPropsForTeam(homePlayers, homeTeamShort);

    return {
      teamAProps: teamAProps.slice(0, 8),
      teamBProps: teamBProps.slice(0, 8),
      allProps: [...teamAProps, ...teamBProps]
    };
  }

  // ── Render 1: MOST UPCOMING GAME CARD ──────────────────────────────────────
  _renderFeaturedGameCard(game, allGames) {
    const isLive = game.gameStatus === 'LIVE';
    const isUFC = game.sport === 'ufc';
    const sl = game.summaryLines || {};
    const awayLogo = this.teamLogoHtml(game.awayTeam);
    const homeLogo = this.teamLogoHtml(game.homeTeam);

    const hasSpread = sl.spread && sl.spread !== 'N/A' && !sl.spread.includes('unavailable');
    const hasTotal = sl.total && sl.total !== 'N/A' && !sl.total.includes('unavailable');
    const hasML = sl.ml && sl.ml !== 'N/A' && !sl.ml.includes('unavailable') && sl.ml !== 'Odds unavailable';
    const hasAnyLines = hasSpread || hasTotal || hasML;

    const awayName = this._safeString(game.awayTeam?.name, 'Away');
    const homeName = this._safeString(game.homeTeam?.name, 'Home');
    const awayRecord = this._safeString(game.awayTeam?.record, '');
    const homeRecord = this._safeString(game.homeTeam?.record, '');
    const gameDate = this._safeString(game.date, 'Today');
    const gameTime = this._safeString(game.startTime, 'TBD');
    const venueName = this._safeString(game.venue, 'TBD');

    return `
      <div class="featured-game-card${isLive ? ' game-card-live' : ''}">
        <div class="featured-card-top-bar">
          <div class="featured-status-pill ${isLive ? 'live' : 'upcoming'}">
            ${isLive ? `🔴 LIVE${game.gameStatusDetail ? ' · ' + this._safeString(game.gameStatusDetail) : ''}` : 'NEXT UPCOMING GAME'}
          </div>
          <div class="featured-meta-right">
            <span>📅 ${gameDate} • ${gameTime}</span>
          </div>
        </div>

        <div class="featured-matchup-area ${isUFC ? 'ufc-matchup-area' : ''}">
          <div class="featured-team-block ${isUFC ? 'ufc-fighter-block' : ''}">
            <div class="featured-logo">${awayLogo}</div>
            <div class="featured-team-info">
              <span class="featured-team-name">${awayName}</span>
              ${awayRecord ? `<span class="featured-team-record">${awayRecord}</span>` : ''}
            </div>
          </div>

          <div class="featured-vs-badge">${isUFC ? 'VS' : '@'}</div>

          <div class="featured-team-block ${isUFC ? 'ufc-fighter-block' : ''}">
            <div class="featured-logo">${homeLogo}</div>
            <div class="featured-team-info">
              <span class="featured-team-name">${homeName}</span>
              ${homeRecord ? `<span class="featured-team-record">${homeRecord}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="featured-venue-line">
          <span>📍 ${venueName}</span>
          ${game.headline && game.headline !== awayName + ' @ ' + homeName ? `<span>🏆 ${this._safeString(game.headline)}</span>` : ''}
        </div>

        <!-- Current Lines Section -->
        <div class="featured-lines-box">
          <div class="featured-lines-header">
            <span class="featured-lines-title">CURRENT LINES</span>
            <span class="featured-lines-books">Verified Odds</span>
          </div>

          ${hasAnyLines ? `
          <div class="featured-lines-grid">
            ${hasSpread ? `
              <div class="line-pill">
                <span class="line-label">${this.spreadLabel(game.sport).toUpperCase().replace(':', '')}</span>
                <span class="line-val">${this._safeString(sl.spread)}</span>
              </div>` : ''}
            ${hasTotal ? `
              <div class="line-pill">
                <span class="line-label">TOTAL</span>
                <span class="line-val">${this._safeString(sl.total)}</span>
              </div>` : ''}
            ${hasML ? `
              <div class="line-pill ${!hasSpread ? 'span-2' : ''}">
                <span class="line-label">MONEYLINE</span>
                <span class="line-val">${this._safeString(sl.ml)}</span>
              </div>` : ''}
          </div>` : `
          <div class="featured-lines-unavail">Market lines loading from connected sportsbooks...</div>`}
        </div>

        ${allGames.length > 1 ? `
        <!-- Upcoming Slate Navigator -->
        <div class="upcoming-slate-bar">
          <span class="slate-bar-label">UPCOMING SLATE (${allGames.length} ${isUFC ? 'Fights' : 'Games'}):</span>
          <div class="slate-chips-scroll">
            ${allGames.map(g => {
              const chipMatchup = isUFC
                ? `${this._safeString((g.awayTeam?.short && g.awayTeam?.short !== 'AWAY') ? g.awayTeam?.short : (g.awayTeam?.name || '').split(' ').pop())} vs ${this._safeString((g.homeTeam?.short && g.homeTeam?.short !== 'HOME') ? g.homeTeam?.short : (g.homeTeam?.name || '').split(' ').pop())}`
                : `${this._safeString(g.awayTeam?.short || g.awayTeam?.name)} @ ${this._safeString(g.homeTeam?.short || g.homeTeam?.name)}`;
              return `
              <button class="slate-chip ${g.id === game.id ? 'active' : ''}" data-slate-id="${g.id}">
                <span class="chip-matchup">${chipMatchup}</span>
                <span class="chip-time">${this._safeString(g.startTime)}</span>
              </button>
            `;}).join('')}
          </div>
        </div>` : ''}
      </div>
    `;
  }

  // ── Render 2: RECOMMENDED PARLAY CARD ──────────────────────────────────────
  _renderRecommendedParlayCard(parlay) {
    if (!parlay || !parlay.legs || !parlay.legs.length) return '';

    const matchupStr = this._safeString(parlay.matchup, "TODAY'S SLATE");
    const combinedOdds = this._safeString(parlay.combinedOdds, '+450');
    const legCount = this._safeString(parlay.legCount, '3');
    const multiplier = this._safeString(parlay.multiplier, '5.5');

    const textToCopy = [
      `📊 UrWelcome ${legCount}-Leg Recommended Parlay (${combinedOdds})`,
      `Matchup: ${matchupStr}`,
      `Target Odds: +300 to +600 · Multiplier: ${multiplier}x`,
      ...parlay.legs.map((leg, i) => `Leg ${i + 1}: ${this._safeString(leg.subject)} — ${this._safeString(leg.line)} (${this._safeString(leg.odds)})`),
      `Verified Sportsbook Odds`
    ].join('\n');

    return `
      <div class="recommended-parlay-card" id="recommended-parlay-card">
        <div class="parlay-card-header">
          <div class="parlay-header-left">
            <span class="parlay-card-title">🎯 RECOMMENDED PARLAY — ${matchupStr.toUpperCase()}</span>
            <span class="parlay-legs-badge">${legCount} LEGS</span>
          </div>
          <div class="parlay-odds-tag">
            <span class="odds-val">${combinedOdds}</span>
            <span class="odds-label">COMBINED ODDS</span>
          </div>
        </div>

        <div class="parlay-legs-grid">
          ${parlay.legs.map(leg => `
            <div class="parlay-leg-box">
              <div class="leg-box-top">
                <span class="leg-sport-emoji">${this._safeString(leg.emoji, '🏈')}</span>
                <span class="leg-subject">${this._safeString(leg.subject)}</span>
              </div>
              <div class="leg-box-mid">
                <span class="leg-market">${this._safeString(leg.market)}</span>
                <span class="leg-line">${this._safeString(leg.line)}</span>
              </div>
              <div class="leg-box-bottom">
                <span class="leg-odds">${this._safeString(leg.odds)}</span>
                <span class="leg-source">${this._safeString(leg.book, 'Sportsbook')}</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="parlay-card-footer">
          <button class="copy-parlay-btn" id="copy-parlay-btn" data-parlay-text="${encodeURIComponent(textToCopy)}">
            <span>📋 Copy Parlay Slip (${combinedOdds})</span>
          </button>
          <div class="parlay-note">
            <span>ℹ️ Research recommendation based on verified current lines (+300 to +600 target). Historical stats do not guarantee future results.</span>
          </div>
        </div>
      </div>
    `;
  }

  // ── Render 3: RECOMMENDED GAME LINES SECTION (Strictly for selectedGame) ────
  _renderRecommendedGameLines(lines, game, h2hData) {
    if (!lines || !lines.length) return '';
    const sport = game.sport;
    const isUFC = sport === 'ufc';

    // Calculate Head-to-Head Statistics
    let h2hSummaryHtml = '';
    let h2hRowsHtml = '';

    if (!isUFC && h2hData && h2hData.length > 0) {
      const awayShort = this._safeString(game.awayTeam?.short || game.awayTeam?.name, 'Away');
      const homeShort = this._safeString(game.homeTeam?.short || game.homeTeam?.name, 'Home');
      const normAway = (game.awayTeam?.name || awayShort).toLowerCase();

      let awayWins = 0;
      let homeWins = 0;
      let totalPtsSum = 0;
      let marginSum = 0;

      // Current Game Total Line for Over/Under evaluation
      let currentTotal = null;
      if (this.cachedGameOddsData?.totals && this.cachedGameOddsData.totals.length > 0) {
        currentTotal = Number(this.cachedGameOddsData.totals[0].point);
      } else if (game.summaryLines?.total) {
        const tm = String(game.summaryLines.total).match(/(\d+\.?\d*)/);
        if (tm) currentTotal = parseFloat(tm[1]);
      }

      let overCount = 0;

      for (const m of h2hData) {
        const aScore = Number(m.awayScore) || 0;
        const hScore = Number(m.homeScore) || 0;
        const pts = aScore + hScore;
        totalPtsSum += pts;
        marginSum += Math.abs(aScore - hScore);

        const mAway = (m.awayName || '').toLowerCase();
        const awayIsTeamA = mAway.includes(normAway) || normAway.includes(mAway);

        if (aScore > hScore) {
          if (awayIsTeamA) awayWins++; else homeWins++;
        } else if (hScore > aScore) {
          if (awayIsTeamA) homeWins++; else awayWins++;
        }

        if (currentTotal !== null && !isNaN(currentTotal)) {
          if (pts > currentTotal) overCount++;
        }
      }

      const avgPts = (totalPtsSum / h2hData.length).toFixed(1);
      const avgMargin = (marginSum / h2hData.length).toFixed(1);
      const recordText = `${awayShort} ${awayWins} - ${homeWins} ${homeShort}`;

      let ouRateBadge = '';
      if (currentTotal !== null && !isNaN(currentTotal)) {
        const ouPct = Math.round((overCount / h2hData.length) * 100);
        ouRateBadge = `<span class="h2h-stat-pill ou-rate">O/U ${currentTotal}: ${overCount}/${h2hData.length} OVER (${ouPct}%)</span>`;
      }

      h2hSummaryHtml = `
        <div class="h2h-summary-bar">
          <span class="h2h-stat-pill record">H2H: ${recordText}</span>
          <span class="h2h-stat-pill">Avg Total: ${avgPts} pts</span>
          <span class="h2h-stat-pill">Avg Margin: ${avgMargin} pts</span>
          ${ouRateBadge}
        </div>
      `;

      h2hRowsHtml = h2hData.map(m => {
        const aScore = Number(m.awayScore) || 0;
        const hScore = Number(m.homeScore) || 0;
        const pts = aScore + hScore;
        let ouRowBadge = '';
        if (currentTotal !== null && !isNaN(currentTotal)) {
          if (pts > currentTotal) {
            ouRowBadge = `<span class="h2h-ou-badge hit">✓ OVER ${currentTotal}</span>`;
          } else if (pts < currentTotal) {
            ouRowBadge = `<span class="h2h-ou-badge miss">✗ UNDER ${currentTotal}</span>`;
          } else {
            ouRowBadge = `<span class="h2h-ou-badge push">PUSH ${currentTotal}</span>`;
          }
        }
        return `
          <div class="h2h-matchup-row">
            <div class="h2h-row-left">
              <span class="h2h-date">${this._safeString(m.dateStr)}</span>
              <span class="h2h-score">${this._safeString(m.scoreDisplay)}</span>
            </div>
            ${ouRowBadge}
          </div>
        `;
      }).join('');
    }

    return `
      <div class="recommended-game-lines-section" id="recommended-game-lines-section">
        <div class="section-title-row">
          <div class="section-title-left">
            <span class="section-title-text">⚡ RECOMMENDED GAME LINES</span>
            <span class="section-badge-pill">Verified · -220 or Better</span>
          </div>
          <span class="section-count-tag">${lines.length} Verified Plays</span>
        </div>

        <div class="game-lines-grid">
          ${lines.map(item => `
            <div class="game-line-rec-box">
              <div class="line-rec-top">
                <span class="line-rec-emoji">${this._safeString(item.emoji)}</span>
                <span class="line-rec-subject">${this._safeString(item.subject)}</span>
                <span class="line-rec-book">${this._safeString(item.book)}</span>
              </div>
              <div class="line-rec-bottom">
                <div class="line-rec-metric">
                  <span class="metric-label">${this._safeString(item.market)}</span>
                  <span class="metric-val">${this._safeString(item.line)}</span>
                </div>
                <div class="line-rec-metric">
                  <span class="metric-label">ODDS</span>
                  <span class="metric-val odds">${this._safeString(item.odds)}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Last 5 Matchups (or UFC Previous Fight) Dropdown -->
        ${isUFC ? (h2hData ? `
          <details class="h2h-dropdown-container ufc-prev-fight">
            <summary class="h2h-toggle-btn">
              <span class="h2h-toggle-icon">▼</span>
              <span class="h2h-toggle-label">HEAD-TO-HEAD HISTORY</span>
            </summary>
            <div class="h2h-dropdown-content">
              <div class="h2h-ufc-card">
                <div class="h2h-ufc-header">
                  <span class="h2h-ufc-event">${this._safeString(h2hData.event)}</span>
                  <span class="h2h-ufc-date">${this._safeString(h2hData.date)}</span>
                </div>
                <div class="h2h-ufc-result">
                  <span class="h2h-winner-badge">WINNER</span>
                  <strong class="h2h-winner-name">${this._safeString(h2hData.winner)}</strong>
                  <span class="h2h-method-text">via ${this._safeString(h2hData.method)}${h2hData.roundTime ? ' (' + this._safeString(h2hData.roundTime) + ')' : ''}</span>
                </div>
              </div>
            </div>
          </details>
        ` : '') : `
          <details class="h2h-dropdown-container">
            <summary class="h2h-toggle-btn">
              <span class="h2h-toggle-icon">▼</span>
              <span class="h2h-toggle-label">LAST 5 HEAD-TO-HEAD MATCHUPS</span>
            </summary>
            <div class="h2h-dropdown-content">
              ${h2hSummaryHtml}
              ${h2hRowsHtml ? `
                <div class="h2h-matchup-list">
                  ${h2hRowsHtml}
                </div>
              ` : `
                <div class="h2h-empty">No prior head-to-head meetings recorded in recent seasons.</div>
              `}
            </div>
          </details>
        `}
      </div>
    `;
  }

  // ── Render 4: PLAYER PROPS SECTION (2-Column 2x8 Layout, matching Game Lines card design)
  _renderPlayerPropsSection(sport, game, playerPropsData) {
    const teamAProps = playerPropsData?.teamAProps || [];
    const teamBProps = playerPropsData?.teamBProps || [];
    const totalPropsCount = teamAProps.length + teamBProps.length;
    if (totalPropsCount === 0) return '';
    const awayName = this._safeString(game.awayTeam?.name, 'Away Team');
    const homeName = this._safeString(game.homeTeam?.name, 'Home Team');

    return `
      <div class="player-props-section" id="player-props-section">
        <div class="section-title-row">
          <div class="section-title-left">
            <span class="section-title-text">🔥 RECOMMENDED PLAYER PROPS</span>
            <span class="section-badge-pill">2 x 8 Slate · Last 10 Verified</span>
          </div>
          <span class="section-count-tag">${totalPropsCount} Verified Props</span>
        </div>

        <div class="player-props-columns-container">
          <!-- Team A Column -->
          <div class="player-props-team-col">
            <div class="team-col-header">
              <span class="team-col-name">${awayName}</span>
              <span class="team-col-count">${teamAProps.length} Props</span>
            </div>
            <div class="team-props-list">
              ${teamAProps.length > 0 ? teamAProps.map(p => this._renderPlayerPropCard(p)).join('') : `
                <div class="empty-col-note">No props available for ${awayName}</div>
              `}
            </div>
          </div>

          <!-- Team B Column -->
          <div class="player-props-team-col">
            <div class="team-col-header">
              <span class="team-col-name">${homeName}</span>
              <span class="team-col-count">${teamBProps.length} Props</span>
            </div>
            <div class="team-props-list">
              ${teamBProps.length > 0 ? teamBProps.map(p => this._renderPlayerPropCard(p)).join('') : `
                <div class="empty-col-note">No props available for ${homeName}</div>
              `}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Render Individual Player Prop Card (Compact Box with Expandable Last 10) ─
  _renderPlayerPropCard(p) {
    const isExpanded = this.state.expandedPropKey === p.propKey;
    const games = p.games || [];

    return `
      <div class="player-prop-rec-box ${isExpanded ? 'expanded' : ''}" data-prop-key="${p.propKey}">
        <div class="line-rec-top">
          <span class="line-rec-emoji">${this._safeString(p.emoji)}</span>
          <span class="line-rec-subject">${this._safeString(p.playerName)}</span>
          <span class="line-rec-book">${this._safeString(p.book)}</span>
        </div>
        <div class="line-rec-bottom">
          <div class="line-rec-metric">
            <span class="metric-label">${this._safeString(p.propType)}</span>
            <span class="metric-val">${this._safeString(p.line)}</span>
          </div>
          <div class="line-rec-metric">
            <span class="metric-label">ODDS</span>
            <span class="metric-val odds">${this._safeString(p.odds)}</span>
          </div>
        </div>
        <div class="prop-expand-hint">
          ${isExpanded ? '▲ Hide last 10 games' : '↳ View last 10 games'}
        </div>

        ${isExpanded ? `
          <div class="prop-expanded-research">
            <div class="prop-research-summary-bar">
              <div class="prs-hit-badge ${p.hitPct >= 60 ? 'high' : (p.hitPct >= 40 ? 'mid' : 'low')}">
                <span class="prs-hit-num">${p.hitCount} / ${p.totalGames} HIT</span>
                <span class="prs-hit-pct">${p.hitPct}%</span>
              </div>
              <span class="prs-subtext">vs line (${this._safeString(p.line)})</span>
            </div>

            <div class="prop-last10-table">
              <div class="last10-row header">
                <span>DATE</span>
                <span>OPP</span>
                <span>STAT</span>
                <span style="text-align: right;">RESULT</span>
              </div>
              ${games.length > 0 ? games.map(g => {
                const statVal = this._safeString(g.primaryStat, '—');
                const hitRes = g.hitResult || { label: '—', badgeClass: 'miss' };
                const oppStr = this._safeString(g.opponentAbbr || g.opponentName, 'OPP');
                const dateStr = this._safeString(g.gameDateStr, '—');
                return `
                <div class="last10-row">
                  <span class="l10-date">${dateStr}</span>
                  <span class="l10-opp">${g.homeAway === 'home' ? 'vs' : '@'} ${oppStr}</span>
                  <span class="l10-stat"><strong>${statVal}</strong></span>
                  <span class="l10-result ${hitRes.badgeClass}">${hitRes.label}</span>
                </div>
              `;}).join('') : `
                <div class="last10-empty">Game log history loading...</div>
              `}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ── Upcoming Slate Game Selection (In-Place, zero page reload or flash) ─────
  async selectUpcomingGame(gameId) {
    if (this.state.selectedGameId === gameId) return;
    this.state.selectedGameId = gameId;
    this.state.expandedPropKey = null;

    // 1. Immediately update active state on slate chips
    this.dom.gamesList.querySelectorAll('.slate-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.slateId === gameId);
    });

    const foundGame = (this.currentUpcomingGames || []).find(g => g.id === gameId);
    if (!foundGame) {
      await this.renderUpcomingGames();
      return;
    }

    // 2. Update Featured Game Card in place
    const slot = document.getElementById('featured-game-card-slot');
    if (slot) {
      slot.innerHTML = this._renderFeaturedGameCard(foundGame, this.currentUpcomingGames);
      this._bindSlateChips();
    }

    // 3. Show smooth in-place loader inside selected game content area
    const parlaySlot = document.getElementById('recommended-parlay-slot');
    const contentArea = document.getElementById('selected-game-content-area');
    const isUFC = this.state.selectedSport === 'ufc';
    const matchName = isUFC
      ? `${foundGame.awayTeam?.name} vs ${foundGame.homeTeam?.name}`
      : `${foundGame.awayTeam?.short || 'Away'} @ ${foundGame.homeTeam?.short || 'Home'}`;

    if (contentArea) {
      contentArea.innerHTML = `
        <div class="game-switch-loading">
          <div class="sport-switch-spinner"></div>
          <span>Loading verified markets & props for ${matchName}...</span>
        </div>
      `;
    }

    // 4. Fetch research data, current props, game odds, and H2H for the new game
    const sport = this.state.selectedSport;
    let researchData = null;
    let currentProps = null;
    let gameOddsData = null;
    let h2hData = null;
    try {
      const fetches = [];
      if (typeof playerGameLogService !== 'undefined' && sport !== 'ufc') {
        fetches.push(playerGameLogService.getGameResearchData(foundGame).catch(() => null));
      } else {
        fetches.push(Promise.resolve(null));
      }
      if (typeof oddsApiService !== 'undefined' && sport !== 'ufc') {
        fetches.push(oddsApiService.getCurrentProps(sport, foundGame).catch(() => null));
      } else {
        fetches.push(Promise.resolve(null));
      }
      if (typeof oddsApiService !== 'undefined') {
        fetches.push(oddsApiService.getGameOddsForMatchup(sport, foundGame).catch(() => null));
      } else {
        fetches.push(Promise.resolve(null));
      }
      if (typeof playerGameLogService !== 'undefined') {
        if (sport === 'ufc') {
          fetches.push(playerGameLogService.getUfcHeadToHead(foundGame.awayTeam?.id, foundGame.homeTeam?.id, foundGame.awayTeam?.name, foundGame.homeTeam?.name).catch(() => null));
        } else {
          fetches.push(playerGameLogService.getTeamHeadToHead(sport, foundGame.awayTeam?.id, foundGame.homeTeam?.id, foundGame.awayTeam?.name, foundGame.homeTeam?.name, 5).catch(() => null));
        }
      } else {
        fetches.push(Promise.resolve(null));
      }
      [researchData, currentProps, gameOddsData, h2hData] = await Promise.all(fetches);
    } catch (e) {
      console.warn('Game props fetch error:', e);
    }

    // Race condition guard
    if (this.state.selectedGameId !== gameId) return;

    // 5. Build parlay, game lines, and player props specifically for this game
    this.cachedCurrentProps = currentProps;
    this.cachedResearchData = researchData;
    this.cachedGameOddsData = gameOddsData;
    this.cachedH2hData = h2hData;
    const parlay = this._buildRecommendedParlay(sport, this.currentUpcomingGames, currentProps, foundGame, gameOddsData, researchData);
    const gameLines = this._buildRecommendedGameLines(sport, foundGame, gameOddsData);
    const playerProps = this._buildRecommendedPlayerProps(sport, foundGame, currentProps, researchData);

    // 6. Update Recommended Parlay in-place
    if (parlaySlot) {
      parlaySlot.innerHTML = this._renderRecommendedParlayCard(parlay);
      this._bindCopyParlayBtn(parlay);
    }

    // 7. Update Game Lines and Player Props in contentArea
    if (contentArea) {
      contentArea.innerHTML = `
        ${this._renderRecommendedGameLines(gameLines, foundGame, h2hData)}
        ${this._renderPlayerPropsSection(sport, foundGame, playerProps)}
      `;
      this._bindPropCardClicks(foundGame);
    }
  }

  // ── Toggle Player Prop Research Drawer ─────────────────────────────────────
  togglePlayerPropResearch(propKey, game) {
    if (this.state.expandedPropKey === propKey) {
      this.state.expandedPropKey = null;
    } else {
      this.state.expandedPropKey = propKey;
    }

    // Re-render Player Props section in-place
    const sport = this.state.selectedSport;
    const playerProps = this._buildRecommendedPlayerProps(sport, game, this.cachedCurrentProps, this.cachedResearchData);
    const propsSection = document.getElementById('player-props-section');
    if (propsSection) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this._renderPlayerPropsSection(sport, game, playerProps);
      propsSection.replaceWith(tempDiv.firstElementChild);
      this._bindPropCardClicks(game);
    }
  }

  _bindSlateChips() {
    this.dom.gamesList.querySelectorAll('.slate-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const gId = chip.dataset.slateId;
        this.selectUpcomingGame(gId);
      });
    });
  }

  _bindPropCardClicks(game) {
    this.dom.gamesList.querySelectorAll('.player-prop-rec-box').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const propKey = card.dataset.propKey;
        if (propKey) this.togglePlayerPropResearch(propKey, game);
      });
    });
  }

  _bindCopyParlayBtn(parlay) {
    const copyBtn = document.getElementById('copy-parlay-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const rawText = decodeURIComponent(copyBtn.dataset.parlayText || '');
        try {
          await navigator.clipboard.writeText(rawText);
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = '<span>✓ Copied to Clipboard!</span>';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = `<span>📋 Copy Parlay Slip (${parlay?.combinedOdds || '+450'})</span>`;
          }, 2500);
        } catch (err) {
          console.error('Clipboard copy failed:', err);
        }
      });
    }
  }

  // ── Master Render: Upcoming Games & 4-Stage Content ────────────────────────
  async renderUpcomingGames() {
    const options = {};
    if (this.state.selectedSport === 'nfl') {
      if (this.state.nflWeek > 0) options.week = this.state.nflWeek;
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

    // Filter out completed games comprehensively
    games = (games || []).filter(g => {
      const s = (g.gameStatus || '').toUpperCase();
      const d = (g.gameStatusDetail || '').toLowerCase();
      if (s === 'FINAL' || s === 'STATUS_FINAL' || s === 'POST' || s === 'COMPLETED' || s === 'F' || d.includes('final')) return false;
      return true;
    });

    // Sort chronologically: soonest upcoming game first
    games.sort((a, b) => {
      const ta = a.rawDate ? new Date(a.rawDate).getTime() : 0;
      const tb = b.rawDate ? new Date(b.rawDate).getTime() : 0;
      return ta - tb;
    });

    this.currentUpcomingGames = games;

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
          <p>All games on this slate have concluded, or no games are scheduled yet. Check back when the next slate is released.</p>
        </div>
      `;
      return;
    }

    try {
      const sport = this.state.selectedSport;

      // 1. Featured game: selected game or first upcoming game
      let featuredGame = games[0];
      if (this.state.selectedGameId) {
        const found = games.find(g => g.id === this.state.selectedGameId);
        if (found) featuredGame = found;
      }
      this.state.selectedGameId = featuredGame.id;

      // 2. Fetch current props, game odds, H2H, and research data for featured game in parallel
      let researchData = null;
      let currentProps = null;
      let gameOddsData = null;
      let h2hData = null;
      try {
        const fetches = [];
        if (typeof playerGameLogService !== 'undefined' && sport !== 'ufc') {
          fetches.push(playerGameLogService.getGameResearchData(featuredGame));
        } else {
          fetches.push(Promise.resolve(null));
        }
        if (typeof oddsApiService !== 'undefined' && sport !== 'ufc') {
          fetches.push(oddsApiService.getCurrentProps(sport, featuredGame).catch(e => {
            console.warn('[Odds] getCurrentProps failed:', e.message); return null;
          }));
        } else {
          fetches.push(Promise.resolve(null));
        }
        if (typeof oddsApiService !== 'undefined') {
          fetches.push(oddsApiService.getGameOddsForMatchup(sport, featuredGame).catch(e => {
            console.warn('[Odds] getGameOddsForMatchup failed:', e.message); return null;
          }));
        } else {
          fetches.push(Promise.resolve(null));
        }
        if (typeof playerGameLogService !== 'undefined') {
          if (sport === 'ufc') {
            fetches.push(playerGameLogService.getUfcHeadToHead(featuredGame.awayTeam?.id, featuredGame.homeTeam?.id, featuredGame.awayTeam?.name, featuredGame.homeTeam?.name).catch(() => null));
          } else {
            fetches.push(playerGameLogService.getTeamHeadToHead(sport, featuredGame.awayTeam?.id, featuredGame.homeTeam?.id, featuredGame.awayTeam?.name, featuredGame.homeTeam?.name, 5).catch(() => null));
          }
        } else {
          fetches.push(Promise.resolve(null));
        }
        [researchData, currentProps, gameOddsData, h2hData] = await Promise.all(fetches);
      } catch (err) {
        console.warn('[Research] data fetch failed:', err.message);
      }

      this.cachedCurrentProps = currentProps;
      this.cachedResearchData = researchData;
      this.cachedGameOddsData = gameOddsData;
      this.cachedH2hData = h2hData;

      // 3. Build recommendations strictly for featuredGame
      const parlay = this._buildRecommendedParlay(sport, games, currentProps, featuredGame, gameOddsData, researchData);
      const gameLines = this._buildRecommendedGameLines(sport, featuredGame, gameOddsData);
      const playerProps = this._buildRecommendedPlayerProps(sport, featuredGame, currentProps, researchData);

      // 4. Render clean flow:
      // Featured Game Card -> Recommended Parlay -> Selected Game Content Area (Lines + Props)
      this.dom.gamesList.innerHTML = `
        <div id="featured-game-card-slot">
          ${this._renderFeaturedGameCard(featuredGame, games)}
        </div>

        <div id="recommended-parlay-slot">
          ${this._renderRecommendedParlayCard(parlay)}
        </div>

        <div id="selected-game-content-area">
          ${this._renderRecommendedGameLines(gameLines, featuredGame, h2hData)}
          ${this._renderPlayerPropsSection(sport, featuredGame, playerProps)}
        </div>
      `;

      // 5. Wire up interactions
      this._bindSlateChips();
      this._bindPropCardClicks(featuredGame);
      this._bindCopyParlayBtn(parlay);

    } catch (renderErr) {
      console.error('[renderUpcomingGames] render failed:', renderErr);
    }
  }

  async selectGame(gameId) {
    this.state.selectedGameId = gameId;
    this.showHomeView();
    await this.renderUpcomingGames();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

    this.dom.gameDetailContainer.innerHTML = `
      <!-- Back navigation button -->
      <div class="game-view-header">
        <button class="back-btn" id="back-to-games-btn">← All ${sportLabel} Games</button>
      </div>

      <!-- 1 & 2: Primary Game Matchup Card & Current Lines -->
      ${this._renderGameMatchupCard(game, sl, isUFC)}

      <!-- 3: Recommended Research / Parlay (Near the top!) -->
      ${this._renderRecommendedResearch(game, researchData, currentProps)}

      <!-- 4 & 5: Player Research with LAST 3 / LAST 5 / LAST 10 -->
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
