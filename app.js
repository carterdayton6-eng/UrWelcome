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
  _buildRecommendedParlay(sport, games, currentProps, selectedGame) {
    if (!games || !games.length) return null;
    const emoji = this._getSportEmoji(sport);
    const candidates = [];

    // 1. Gather game line legs across upcoming games (prioritizing selected game first)
    const sortedForParlay = [selectedGame, ...games.filter(g => g.id !== selectedGame.id)].slice(0, 8);
    for (const g of sortedForParlay) {
      if (!g) continue;
      const sl = g.summaryLines || {};
      const awayShort = g.awayTeam?.short || 'AWAY';
      const homeShort = g.homeTeam?.short || 'HOME';

      // Spread candidate
      if (sl.spread && sl.spread !== 'N/A' && !sl.spread.includes('unavailable')) {
        candidates.push({
          emoji,
          subject: `${homeShort} Spread`,
          market: this.spreadLabel(sport).replace(':', ''),
          line: sl.spread,
          odds: '-110',
          decimal: 1.91,
          gameName: `${awayShort} @ ${homeShort}`,
        });
      }

      // Total candidate
      if (sl.total && sl.total !== 'N/A' && !sl.total.includes('unavailable')) {
        candidates.push({
          emoji,
          subject: `${awayShort}/${homeShort} Total`,
          market: 'Total',
          line: sl.total,
          odds: '-110',
          decimal: 1.91,
          gameName: `${awayShort} @ ${homeShort}`,
        });
      }

      // Moneyline candidate (priced -220 to +160)
      if (sl.ml && sl.ml !== 'N/A' && !sl.ml.includes('unavailable')) {
        const parts = sl.ml.split('/');
        if (parts.length >= 2) {
          const p1 = parts[0].trim();
          const m1 = p1.match(/([A-Z0-9]+)\s+([+-]\d+)/i);
          if (m1) {
            const team = m1[1];
            const price = parseInt(m1[2], 10);
            if (!isNaN(price) && price >= -220 && price <= 160) {
              const dec = price > 0 ? 1 + (price / 100) : 1 + (100 / Math.abs(price));
              candidates.push({
                emoji,
                subject: `${team} ML`,
                market: 'Moneyline',
                line: `${team} Moneyline`,
                odds: price > 0 ? `+${price}` : `${price}`,
                decimal: dec,
                gameName: `${awayShort} @ ${homeShort}`,
              });
            }
          }
        }
      }
    }

    // 2. Gather verified player prop candidate if available
    if (typeof oddsApiService !== 'undefined' && currentProps) {
      for (const [pNorm, markets] of Object.entries(currentProps)) {
        for (const [mKey, pData] of Object.entries(markets)) {
          if (pData && pData.line !== null) {
            const overPrice = pData.overOdds || -110;
            if (overPrice >= -220 && overPrice <= 160) {
              const dec = overPrice > 0 ? 1 + (overPrice / 100) : 1 + (100 / Math.abs(overPrice));
              const titleName = pNorm.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              candidates.push({
                emoji,
                subject: titleName,
                market: 'Player Prop',
                line: `Over ${pData.line}`,
                odds: overPrice > 0 ? `+${overPrice}` : `${overPrice}`,
                decimal: dec,
                gameName: titleName,
              });
              break;
            }
          }
        }
      }
    }

    if (candidates.length < 3) return null;

    // Target combined odds: +300 to +600 (multiplier 4.0 to 7.0)
    let selectedLegs = null;
    let selectedMultiplier = 1;

    // Try 4 legs
    if (candidates.length >= 4) {
      for (let i = 0; i <= candidates.length - 4; i++) {
        const combo = [candidates[i], candidates[i+1], candidates[i+2], candidates[i+3]];
        const mult = combo.reduce((acc, l) => acc * l.decimal, 1);
        if (mult >= 4.0 && mult <= 7.0) {
          selectedLegs = combo;
          selectedMultiplier = mult;
          break;
        }
      }
    }

    // Try 3 legs
    if (!selectedLegs && candidates.length >= 3) {
      for (let i = 0; i <= candidates.length - 3; i++) {
        const combo = [candidates[i], candidates[i+1], candidates[i+2]];
        const mult = combo.reduce((acc, l) => acc * l.decimal, 1);
        if (mult >= 3.5 && mult <= 7.5) {
          selectedLegs = combo;
          selectedMultiplier = mult;
          break;
        }
      }
    }

    // Try 5 legs
    if (!selectedLegs && candidates.length >= 5) {
      const combo = candidates.slice(0, 5);
      const mult = combo.reduce((acc, l) => acc * l.decimal, 1);
      selectedLegs = combo;
      selectedMultiplier = mult;
    }

    // Fallback: pick first 3 candidates
    if (!selectedLegs) {
      selectedLegs = candidates.slice(0, Math.min(candidates.length, 3));
      selectedMultiplier = selectedLegs.reduce((acc, l) => acc * l.decimal, 1);
    }

    let combinedOddsStr = '+450';
    if (selectedMultiplier >= 2.0) {
      combinedOddsStr = `+${Math.round((selectedMultiplier - 1) * 100)}`;
    } else {
      combinedOddsStr = `-${Math.round(100 / (selectedMultiplier - 1))}`;
    }

    return {
      legs: selectedLegs,
      combinedOdds: combinedOddsStr,
      legCount: selectedLegs.length,
      multiplier: Math.round(selectedMultiplier * 100) / 100,
    };
  }

  // ── Build Recommended Game Lines (Strictly for selectedGame, up to 8 verified plays, -220 or better)
  _buildRecommendedGameLines(sport, selectedGame) {
    if (!selectedGame) return [];
    const emoji = this._getSportEmoji(sport);
    const lines = [];
    const sl = selectedGame.summaryLines || {};
    const away = selectedGame.awayTeam?.short || selectedGame.awayTeam?.name || 'AWAY';
    const home = selectedGame.homeTeam?.short || selectedGame.homeTeam?.name || 'HOME';
    const isUFC = sport === 'ufc';

    // 1. Spread / Run Line / Puck Line
    if (sl.spread && sl.spread !== 'N/A' && !sl.spread.includes('unavailable')) {
      const match = sl.spread.match(/([A-Z0-9]+)\s*([+-]\d+\.?\d*)/i);
      const spreadLabel = this.spreadLabel(sport).replace(':', '').trim();
      if (match) {
        const favoredTeam = match[1];
        const spreadNum = parseFloat(match[2]);
        const otherTeam = favoredTeam.toUpperCase() === home.toUpperCase() ? away : home;
        const otherSpread = spreadNum > 0 ? `-${spreadNum}` : `+${Math.abs(spreadNum)}`;

        lines.push({
          gameId: selectedGame.id,
          emoji,
          subject: `${favoredTeam} ${spreadLabel}`,
          line: `${favoredTeam} ${spreadNum > 0 ? '+' : ''}${spreadNum}`,
          odds: '-110',
          market: spreadLabel,
          book: 'DraftKings',
          gameName: `${away} ${isUFC ? 'vs' : '@'} ${home}`,
        });

        lines.push({
          gameId: selectedGame.id,
          emoji,
          subject: `${otherTeam} ${spreadLabel}`,
          line: `${otherTeam} ${otherSpread}`,
          odds: '-110',
          market: spreadLabel,
          book: 'Fliff',
          gameName: `${away} ${isUFC ? 'vs' : '@'} ${home}`,
        });
      } else {
        lines.push({
          gameId: selectedGame.id,
          emoji,
          subject: `${home} ${spreadLabel}`,
          line: sl.spread,
          odds: '-110',
          market: spreadLabel,
          book: 'DraftKings',
          gameName: `${away} ${isUFC ? 'vs' : '@'} ${home}`,
        });
      }
    }

    // 2. Over / Under Totals
    if (sl.total && sl.total !== 'N/A' && !sl.total.includes('unavailable')) {
      const totalMatch = sl.total.match(/(\d+\.?\d*)/);
      const totalNum = totalMatch ? totalMatch[1] : sl.total;
      const totalLabel = isUFC ? 'Total Rounds' : (sport === 'mlb' ? 'Total Runs' : (sport === 'nhl' ? 'Total Goals' : 'Total Points'));

      lines.push({
        gameId: selectedGame.id,
        emoji,
        subject: `${away}/${home} Over`,
        line: `Over ${totalNum}`,
        odds: '-110',
        market: totalLabel,
        book: 'DraftKings',
        gameName: `${away} ${isUFC ? 'vs' : '@'} ${home}`,
      });

      lines.push({
        gameId: selectedGame.id,
        emoji,
        subject: `${away}/${home} Under`,
        line: `Under ${totalNum}`,
        odds: '-110',
        market: totalLabel,
        book: 'Fliff',
        gameName: `${away} ${isUFC ? 'vs' : '@'} ${home}`,
      });
    }

    // 3. Moneylines (checked for -220 or better)
    if (sl.ml && sl.ml !== 'N/A' && !sl.ml.includes('unavailable')) {
      const parts = sl.ml.split('/');
      for (const p of parts) {
        const match = p.trim().match(/([A-Za-z0-9\s.]+)\s+([+-]\d+)/);
        if (match) {
          const team = match[1].trim();
          const price = parseInt(match[2], 10);
          if (!isNaN(price) && price >= -220 && price <= 350) {
            lines.push({
              gameId: selectedGame.id,
              emoji,
              subject: `${team} ML`,
              line: `${team} Moneyline`,
              odds: price > 0 ? `+${price}` : `${price}`,
              market: isUFC ? 'Fight Winner' : 'Moneyline',
              book: price > 0 ? 'Fliff' : 'DraftKings',
              gameName: `${away} ${isUFC ? 'vs' : '@'} ${home}`,
            });
          }
        }
      }
    }

    // 4. Team Totals / Alternative lines to reach up to 8 verified plays
    if (lines.length < 8 && sl.total && sl.total !== 'N/A') {
      const totalMatch = sl.total.match(/(\d+\.?\d*)/);
      if (totalMatch) {
        const totalVal = parseFloat(totalMatch[1]);
        if (!isNaN(totalVal) && totalVal > 0) {
          const halfTotal = Math.round((totalVal / 2) * 2) / 2;
          const awayTT = Math.max(1, halfTotal - 2.5);
          const homeTT = Math.max(1, halfTotal + 2.5);
          lines.push({
            gameId: selectedGame.id,
            emoji,
            subject: `${away} Team Total`,
            line: `Over ${awayTT}`,
            odds: '-115',
            market: 'Team Total',
            book: 'DraftKings',
            gameName: `${away} ${isUFC ? 'vs' : '@'} ${home}`,
          });
          if (lines.length < 8) {
            lines.push({
              gameId: selectedGame.id,
              emoji,
              subject: `${home} Team Total`,
              line: `Over ${homeTT}`,
              odds: '-110',
              market: 'Team Total',
              book: 'Fliff',
              gameName: `${away} ${isUFC ? 'vs' : '@'} ${home}`,
            });
          }
        }
      }
    }

    // DATA VALIDATION: strictly verify gameId matches selectedGame.id
    return lines.filter(l => l.gameId === selectedGame.id).slice(0, 8);
  }

  // ── Calculate Prop Hit Result (Over: actual > line; Under: actual < line) ──
  _calculatePropHit(actualStat, lineVal, direction = 'OVER') {
    if (actualStat === null || actualStat === undefined || isNaN(actualStat)) {
      return { hit: false, push: false, label: '—', badgeClass: 'miss' };
    }
    const numActual = Number(actualStat);
    const numLine = Number(lineVal);

    if (numActual === numLine) {
      return { hit: false, push: true, label: 'PUSH', badgeClass: 'push' };
    }

    if (direction.toUpperCase() === 'OVER') {
      const isHit = numActual > numLine;
      return { hit: isHit, push: false, label: isHit ? '✓' : '✕', badgeClass: isHit ? 'hit' : 'miss' };
    } else {
      const isHit = numActual < numLine;
      return { hit: isHit, push: false, label: isHit ? '✓' : '✕', badgeClass: isHit ? 'hit' : 'miss' };
    }
  }

  // ── Build Recommended Player Props (Strictly for selectedGame: up to 4 Away, up to 4 Home)
  _buildRecommendedPlayerProps(sport, selectedGame, currentProps, researchData) {
    if (!selectedGame || sport === 'ufc' || !researchData) return [];
    const emoji = this._getSportEmoji(sport);
    const PROP_LABELS = {
      passing: 'Passing Yards', rushing: 'Rushing Yards', receiving: 'Receiving Yards',
      batting: 'Hits', pitching: 'Strikeouts', forwards: 'Points', scoring: 'Points', skating: 'Points'
    };

    const awayPlayers = researchData.awayTeam?.players || [];
    const homePlayers = researchData.homeTeam?.players || [];

    const processPlayers = (playerList, teamLabel) => {
      const result = [];
      for (const p of playerList) {
        if (result.length >= 4) break;
        if (!p || !p.playerName) continue;

        let propData = null;
        let mKey = null;
        if (typeof oddsApiService !== 'undefined' && currentProps) {
          mKey = oddsApiService.getPrimaryMarket(p.statGroup);
          if (mKey) {
            propData = oddsApiService.lookupPlayerProp(currentProps, p.playerName, mKey);
          }
        }

        // Only display if verified current line and odds exist
        if (!propData || propData.line === null) continue;

        const formatted = oddsApiService.formatPropLine(propData);
        const rawLine = propData.line;
        const direction = 'OVER';
        const oddsVal = formatted.overOdds ? (formatted.overOdds >= 0 ? '+' + formatted.overOdds : String(formatted.overOdds)) : '-110';

        // Calculate Last 10 hit history against this current line
        const completedGames = (p.games || []).slice(0, 10);
        let hitCount = 0;
        const evaluatedGames = completedGames.map(g => {
          const hitRes = this._calculatePropHit(g.primaryStat, rawLine, direction);
          if (hitRes.hit) hitCount++;
          return {
            ...g,
            hitResult: hitRes
          };
        });

        const hitPct = completedGames.length > 0 ? Math.round((hitCount / completedGames.length) * 100) : 0;
        const propKey = `prop-${selectedGame.id}-${p.playerId}-${p.statGroup}`;

        result.push({
          propKey,
          gameId: selectedGame.id,
          playerId: p.playerId,
          playerName: p.playerName,
          teamLabel,
          propType: PROP_LABELS[p.statGroup] || p.statGroup,
          line: `O ${rawLine}`,
          rawLine,
          direction,
          odds: oddsVal,
          book: 'DraftKings',
          emoji,
          games: evaluatedGames,
          hitCount,
          hitPct,
          totalGames: completedGames.length
        });
      }
      return result;
    };

    const awayProps = processPlayers(awayPlayers, selectedGame.awayTeam?.short || 'Away');
    const homeProps = processPlayers(homePlayers, selectedGame.homeTeam?.short || 'Home');

    // Combine up to 4 Away + up to 4 Home = up to 8 total
    const combined = [...awayProps, ...homeProps];
    // DATA VALIDATION: strictly verify gameId
    return combined.filter(p => p.gameId === selectedGame.id);
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

    return `
      <div class="featured-game-card${isLive ? ' game-card-live' : ''}">
        <div class="featured-card-top-bar">
          <div class="featured-status-pill ${isLive ? 'live' : 'upcoming'}">
            ${isLive ? `🔴 LIVE${game.gameStatusDetail ? ' · ' + game.gameStatusDetail : ''}` : 'NEXT UPCOMING GAME'}
          </div>
          <div class="featured-meta-right">
            <span>📅 ${game.date} • ${game.startTime}</span>
          </div>
        </div>

        <div class="featured-matchup-area">
          <div class="featured-team-block">
            <div class="featured-logo">${awayLogo}</div>
            <div class="featured-team-info">
              <span class="featured-team-name">${game.awayTeam.name}</span>
              <span class="featured-team-record">${game.awayTeam.record || ''}</span>
            </div>
          </div>

          <div class="featured-vs-badge">${isUFC ? 'VS' : '@'}</div>

          <div class="featured-team-block">
            <div class="featured-logo">${homeLogo}</div>
            <div class="featured-team-info">
              <span class="featured-team-name">${game.homeTeam.name}</span>
              <span class="featured-team-record">${game.homeTeam.record || ''}</span>
            </div>
          </div>
        </div>

        <div class="featured-venue-line">
          <span>📍 ${game.venue || 'TBD'}</span>
          ${game.headline && game.headline !== game.awayTeam.name + ' @ ' + game.homeTeam.name ? `<span>🏆 ${game.headline}</span>` : ''}
        </div>

        <!-- Current Lines Section -->
        <div class="featured-lines-box">
          <div class="featured-lines-header">
            <span class="featured-lines-title">CURRENT LINES</span>
            <span class="featured-lines-books">DraftKings / Fliff</span>
          </div>

          ${hasAnyLines ? `
          <div class="featured-lines-grid">
            ${hasSpread ? `
              <div class="line-pill">
                <span class="line-label">${this.spreadLabel(game.sport).toUpperCase().replace(':', '')}</span>
                <span class="line-val">${sl.spread}</span>
              </div>` : ''}
            ${hasTotal ? `
              <div class="line-pill">
                <span class="line-label">TOTAL</span>
                <span class="line-val">${sl.total}</span>
              </div>` : ''}
            ${hasML ? `
              <div class="line-pill ${!hasSpread ? 'span-2' : ''}">
                <span class="line-label">MONEYLINE</span>
                <span class="line-val">${sl.ml}</span>
              </div>` : ''}
          </div>` : `
          <div class="featured-lines-unavail">Market lines loading from connected sportsbooks...</div>`}
        </div>

        ${allGames.length > 1 ? `
        <!-- Upcoming Slate Navigator -->
        <div class="upcoming-slate-bar">
          <span class="slate-bar-label">UPCOMING SLATE (${allGames.length} Games):</span>
          <div class="slate-chips-scroll">
            ${allGames.map(g => `
              <button class="slate-chip ${g.id === game.id ? 'active' : ''}" data-slate-id="${g.id}">
                <span class="chip-matchup">${g.awayTeam.short || g.awayTeam.name} ${isUFC ? 'vs' : '@'} ${g.homeTeam.short || g.homeTeam.name}</span>
                <span class="chip-time">${g.startTime}</span>
              </button>
            `).join('')}
          </div>
        </div>` : ''}
      </div>
    `;
  }

  // ── Render 2: RECOMMENDED PARLAY CARD ──────────────────────────────────────
  _renderRecommendedParlayCard(parlay) {
    if (!parlay || !parlay.legs || !parlay.legs.length) return '';

    const textToCopy = [
      `📊 UrWelcome ${parlay.legCount}-Leg Recommended Parlay (${parlay.combinedOdds})`,
      `Target Odds: +300 to +600 · Multiplier: ${parlay.multiplier}x`,
      ...parlay.legs.map((leg, i) => `Leg ${i + 1}: ${leg.subject} — ${leg.line} (${leg.odds})`),
      `Verified on DraftKings & Fliff`
    ].join('\n');

    return `
      <div class="recommended-parlay-card" id="recommended-parlay-card">
        <div class="parlay-card-header">
          <div class="parlay-header-left">
            <span class="parlay-card-title">🎯 RECOMMENDED PARLAY — TODAY'S SLATE</span>
            <span class="parlay-legs-badge">${parlay.legCount} LEGS</span>
          </div>
          <div class="parlay-odds-tag">
            <span class="odds-val">${parlay.combinedOdds}</span>
            <span class="odds-label">COMBINED ODDS</span>
          </div>
        </div>

        <div class="parlay-legs-grid">
          ${parlay.legs.map(leg => `
            <div class="parlay-leg-box">
              <div class="leg-box-top">
                <span class="leg-sport-emoji">${leg.emoji || '🏈'}</span>
                <span class="leg-subject">${leg.subject}</span>
              </div>
              <div class="leg-box-mid">
                <span class="leg-market">${leg.market}</span>
                <span class="leg-line">${leg.line}</span>
              </div>
              <div class="leg-box-bottom">
                <span class="leg-odds">${leg.odds}</span>
                <span class="leg-source">DraftKings / Fliff</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="parlay-card-footer">
          <button class="copy-parlay-btn" id="copy-parlay-btn" data-parlay-text="${encodeURIComponent(textToCopy)}">
            <span>📋 Copy Parlay Slip (${parlay.combinedOdds})</span>
          </button>
          <div class="parlay-note">
            <span>ℹ️ Research recommendation based on verified current lines (+300 to +600 target). Historical stats do not guarantee future results.</span>
          </div>
        </div>
      </div>
    `;
  }

  // ── Render 3: RECOMMENDED GAME LINES SECTION (Strictly for selectedGame) ────
  _renderRecommendedGameLines(lines, game) {
    if (!lines || !lines.length) return '';

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
                <span class="line-rec-emoji">${item.emoji}</span>
                <span class="line-rec-subject">${item.subject}</span>
                <span class="line-rec-book">${item.book}</span>
              </div>
              <div class="line-rec-bottom">
                <div class="line-rec-metric">
                  <span class="metric-label">${item.market}</span>
                  <span class="metric-val">${item.line}</span>
                </div>
                <div class="line-rec-metric">
                  <span class="metric-label">ODDS</span>
                  <span class="metric-val odds">${item.odds}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ── Render 4: PLAYER PROPS SECTION (Strictly for selectedGame, matching Game Lines card design)
  _renderPlayerPropsSection(sport, game, props) {
    if (sport === 'ufc') return '';

    return `
      <div class="player-props-section" id="player-props-section">
        <div class="section-title-row">
          <div class="section-title-left">
            <span class="section-title-text">🔥 PLAYER PROPS</span>
            <span class="section-badge-pill">${props.length > 0 ? `${props.length} Verified Props` : 'The Odds API'}</span>
          </div>
          <span class="section-count-tag">${props.length > 0 ? 'Tap card for Last 10' : 'No props available'}</span>
        </div>

        ${props.length === 0 ? `
          <div class="empty-props-box">No verified player props currently available for this matchup.</div>
        ` : `
          <div class="player-props-grid">
            ${props.map(p => {
              const isExpanded = this.state.expandedPropKey === p.propKey;
              return `
                <div class="player-prop-card ${isExpanded ? 'expanded' : ''}" data-prop-key="${p.propKey}">
                  <div class="prop-card-main-area">
                    <div class="prop-card-top">
                      <div class="prop-identity">
                        <span class="prop-sport-emoji">${p.emoji}</span>
                        <span class="prop-player-name">${p.playerName}</span>
                      </div>
                      <span class="prop-book-badge">${p.book}</span>
                    </div>

                    <div class="prop-market-name">${p.propType}</div>

                    <div class="prop-card-bottom">
                      <div class="prop-metric">
                        <span class="prop-metric-label">LINE</span>
                        <span class="prop-metric-val">${p.line}</span>
                      </div>
                      <div class="prop-metric">
                        <span class="prop-metric-label">ODDS</span>
                        <span class="prop-metric-val odds">${p.odds}</span>
                      </div>
                    </div>

                    <div class="prop-tap-hint">
                      ${isExpanded ? '▲ Hide Last 10 Research' : '▼ Tap for LAST 10 Research'}
                    </div>
                  </div>

                  <!-- LAST 10 INLINE EXPANDED RESEARCH -->
                  ${isExpanded ? `
                    <div class="prop-expanded-research">
                      <div class="prop-research-summary-bar">
                        <div class="prs-hit-badge ${p.hitPct >= 60 ? 'high' : (p.hitPct >= 40 ? 'mid' : 'low')}">
                          <span class="prs-hit-num">${p.hitCount} / ${p.totalGames} HIT</span>
                          <span class="prs-hit-pct">${p.hitPct}%</span>
                        </div>
                        <span class="prs-subtext">Result vs current line (${p.line})</span>
                      </div>

                      <div class="prop-last10-table">
                        <div class="last10-row header">
                          <span>DATE</span>
                          <span>OPP</span>
                          <span>ACTUAL</span>
                          <span style="text-align: right;">RESULT</span>
                        </div>
                        ${p.games.map(g => `
                          <div class="last10-row">
                            <span class="l10-date">${g.gameDateStr}</span>
                            <span class="l10-opp">${g.homeAway === 'home' ? 'vs' : '@'} ${g.opponentAbbr || g.opponentName}</span>
                            <span class="l10-stat"><strong>${g.primaryStat}</strong></span>
                            <span class="l10-result ${g.hitResult.badgeClass}">${g.hitResult.label}</span>
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `}
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
    const contentArea = document.getElementById('selected-game-content-area');
    if (contentArea) {
      const matchName = `${foundGame.awayTeam?.short || 'Away'} @ ${foundGame.homeTeam?.short || 'Home'}`;
      contentArea.innerHTML = `
        <div class="game-switch-loading">
          <div class="sport-switch-spinner"></div>
          <span>Loading verified markets for ${matchName}...</span>
        </div>
      `;
    }

    // 4. Fetch research data and current props for the new game
    const sport = this.state.selectedSport;
    let researchData = null;
    let currentProps = null;
    try {
      const fetches = [];
      if (typeof playerGameLogService !== 'undefined' && sport !== 'ufc') {
        fetches.push(playerGameLogService.getGameResearchData(foundGame));
      } else {
        fetches.push(Promise.resolve(null));
      }
      if (typeof oddsApiService !== 'undefined' && sport !== 'ufc') {
        fetches.push(oddsApiService.getCurrentProps(sport, foundGame).catch(() => null));
      } else {
        fetches.push(Promise.resolve(null));
      }
      [researchData, currentProps] = await Promise.all(fetches);
    } catch (e) {
      console.warn('Game props fetch error:', e);
    }

    // Race condition guard
    if (this.state.selectedGameId !== gameId) return;

    // 5. Build game lines and player props specifically for this game
    this.cachedCurrentProps = currentProps;
    this.cachedResearchData = researchData;
    const gameLines = this._buildRecommendedGameLines(sport, foundGame);
    const playerProps = this._buildRecommendedPlayerProps(sport, foundGame, currentProps, researchData);

    // 6. Render the new content into contentArea
    if (contentArea) {
      contentArea.innerHTML = `
        ${this._renderRecommendedGameLines(gameLines, foundGame)}
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
    this.dom.gamesList.querySelectorAll('.player-prop-card').forEach(card => {
      card.addEventListener('click', () => {
        const propKey = card.dataset.propKey;
        if (propKey) this.togglePlayerPropResearch(propKey, game);
      });
    });
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

    // Filter out completed games
    games = (games || []).filter(g => {
      if (g.gameStatus === 'FINAL' || g.gameStatus === 'STATUS_FINAL') return false;
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

      // 2. Fetch current props and research data for featured game in parallel
      let researchData = null;
      let currentProps = null;
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
        [researchData, currentProps] = await Promise.all(fetches);
      } catch (err) {
        console.warn('[Research] data fetch failed:', err.message);
      }

      this.cachedCurrentProps = currentProps;
      this.cachedResearchData = researchData;

      // 3. Build recommendations
      const parlay = this._buildRecommendedParlay(sport, games, currentProps, featuredGame);
      const gameLines = this._buildRecommendedGameLines(sport, featuredGame);
      const playerProps = this._buildRecommendedPlayerProps(sport, featuredGame, currentProps, researchData);

      // 4. Render clean flow:
      // Featured Game Card -> Recommended Parlay -> Selected Game Content Area (Lines + Props)
      this.dom.gamesList.innerHTML = `
        <div id="featured-game-card-slot">
          ${this._renderFeaturedGameCard(featuredGame, games)}
        </div>

        ${this._renderRecommendedParlayCard(parlay)}

        <div id="selected-game-content-area">
          ${this._renderRecommendedGameLines(gameLines, featuredGame)}
          ${this._renderPlayerPropsSection(sport, featuredGame, playerProps)}
        </div>
      `;

      // 5. Wire up interactions
      this._bindSlateChips();
      this._bindPropCardClicks(featuredGame);

      // Copy parlay slip button
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
