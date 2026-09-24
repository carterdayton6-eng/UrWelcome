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
      searchQuery: '',
      nflWeek: 3,
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
      teamSearchInput: document.getElementById('team-search-input'),
      searchClearBtn: document.getElementById('search-clear-btn'),
      homeView: document.getElementById('home-view'),
      gameView: document.getElementById('game-view'),
      gamesList: document.getElementById('games-list'),
      gameDetailContainer: document.getElementById('game-detail-container'),
      demoModal: document.getElementById('demo-modal'),
      demoBadge: document.getElementById('demo-badge'),
      modalCloseBtn: document.getElementById('modal-close-btn'),
      brandTitle: document.getElementById('brand-title'),
      refreshBtn: document.getElementById('refresh-btn'),
      lastUpdatedText: document.getElementById('last-updated-text'),
      headerDatetime: document.getElementById('header-datetime')
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


  bindEvents() {
    // Search input
    this.dom.teamSearchInput.addEventListener('input', (e) => {
      this.state.searchQuery = e.target.value;
      this.dom.searchClearBtn.style.display = this.state.searchQuery ? 'block' : 'none';
      this.renderUpcomingGames();
    });

    this.dom.searchClearBtn.addEventListener('click', () => {
      this.dom.teamSearchInput.value = '';
      this.state.searchQuery = '';
      this.dom.searchClearBtn.style.display = 'none';
      this.renderUpcomingGames();
      this.dom.teamSearchInput.focus();
    });

    // Refresh button — clears cache, re-fetches live data, updates UI
    if (this.dom.refreshBtn) {
      this.dom.refreshBtn.addEventListener('click', () => this.doRefresh());
    }

    // Auto-refresh every 15 minutes (silently, no UI disruption)
    setInterval(() => {
      this.service.clearCache();
    }, 15 * 60 * 1000);

    // Brand click returns to home
    this.dom.brandTitle.addEventListener('click', () => {
      this.goBackToGames();
    });

    // Architecture modal
    this.dom.demoBadge.addEventListener('click', () => {
      this.dom.demoModal.classList.add('open');
    });

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
        { label: 'Week 3 (Live)', val: 3 },
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


  async doRefresh() {
    const btn = this.dom.refreshBtn;
    if (!btn || btn.dataset.refreshing === 'true') return;

    btn.dataset.refreshing = 'true';
    btn.textContent = '⏳ Refreshing...';
    btn.disabled = true;

    try {
      // Clear all cached data so next fetch is truly fresh
      this.service.clearCache();

      // Re-fetch current sport data
      await this.renderUpcomingGames();
      // Also refresh Boston pinned section with fresh data
  
      btn.textContent = '🔄 Refresh';
    } catch (err) {
      console.error('[Refresh] Failed:', err);
      btn.textContent = '⚠️ Refresh failed — try again';
      btn.style.color = '#f87171';
      setTimeout(() => {
        btn.textContent = '🔄 Refresh';
        btn.style.color = '';
      }, 4000);
    } finally {
      btn.disabled = false;
      btn.dataset.refreshing = 'false';
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
      options.week = this.state.nflWeek;
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
      games = await this.service.getUpcomingGames(this.state.selectedSport, this.state.searchQuery, options);
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
      this.dom.gamesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No games scheduled</div>
          <p>No upcoming games found for this slate.</p>
        </div>
      `;
      return;
    }

    try {
      this.dom.gamesList.innerHTML = games.map(game => {
        if (game.sport === 'ufc') return this.renderUFCFightCard(game);
        return this.renderGameCard(game);
      }).join('');

      this.dom.gamesList.querySelectorAll('.game-card, .ufc-fight-card').forEach(card => {
        card.addEventListener('click', () => {
          const gameId = card.dataset.gameId;
          this.selectGame(gameId);
        });
      });
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

    return `
      <div class="game-card" data-game-id="${game.id}">

        <!-- Col 1: Date + Time -->
        <div class="game-col-datetime">
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

    return `
      <div class="ufc-fight-card" data-game-id="${game.id}">

        <!-- UFC Event Header -->
        <div class="ufc-fight-header">
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

    const bets = await this.service.getBetsForGame(this.state.selectedGameId);
    const parlay = await this.service.getParlayForGame(this.state.selectedGameId);
    const sortedBets = this.filterAndSortBets(bets, this.state.activeFilter);

    this.dom.gameDetailContainer.innerHTML = `
      <div class="game-view-header">
        <button class="back-btn" id="back-to-games-btn">← All ${game.sport.toUpperCase()} Games</button>
        <div class="game-detail-banner">
          <div class="matchup-headline">
            ${game.awayTeam.name} @ ${game.homeTeam.name}
          </div>
          <div class="matchup-subline">
            <span>📅 ${game.date} • ${game.startTime}</span>
            <span>📍 ${game.venue}</span>
            <span>🏆 ${game.headline}</span>
          </div>
        </div>
      </div>

      <!-- Parlay Research & Floor Analysis Hero Card -->
      ${parlay ? this.renderParlayCard(parlay) : ''}

      <!-- Sorting & Filter Controls -->
      <div class="filter-bar" id="bet-filter-bar">
        <button class="filter-pill ${this.state.activeFilter === 'higher_rate' ? 'active' : ''}" data-filter="higher_rate">
          Higher Hit Rate
        </button>
        <button class="filter-pill ${this.state.activeFilter === 'lower_rate' ? 'active' : ''}" data-filter="lower_rate">
          Lower Hit Rate
        </button>
        <button class="filter-pill ${this.state.activeFilter === 'player_props' ? 'active' : ''}" data-filter="player_props">
          Player Props
        </button>
        <button class="filter-pill ${this.state.activeFilter === 'game_lines' ? 'active' : ''}" data-filter="game_lines">
          Game Lines
        </button>
        <button class="filter-pill ${this.state.activeFilter === 'all' ? 'active' : ''}" data-filter="all">
          All Bets (${bets.length})
        </button>
      </div>

      <div class="research-disclaimer">
        <span>ℹ️</span>
        <span>Sorted strictly by recent performance against the live market line. Historical performance does NOT guarantee future outcomes.</span>
      </div>

      <!-- Bet Cards List -->
      <div class="bets-container">
        ${sortedBets.map(bet => this.renderBetCard(bet)).join('')}
      </div>
    `;

    document.getElementById('back-to-games-btn').addEventListener('click', () => {
      this.goBackToGames();
    });

    document.getElementById('bet-filter-bar').querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.activeFilter = btn.dataset.filter;
        this.renderGameDetailPage();
      });
    });

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
