const planConfig = {
  monthly: { label: "Monthly", fee: 499, durationDays: 30 },
  yearly: { label: "Yearly", fee: 4999, durationDays: 365 },
};

const prizePercentages = [
  { matches: 5, label: "5-Number Match", percent: 0.4, jackpot: true },
  { matches: 4, label: "4-Number Match", percent: 0.35, jackpot: false },
  { matches: 3, label: "3-Number Match", percent: 0.25, jackpot: false },
];

const defaultCharities = [
  {
    id: "charity-juniors",
    name: "First Tee Juniors",
    description: "Introduces golf and life skills to young players from underserved schools.",
    impact: "184 junior coaching grants funded",
  },
  {
    id: "charity-greens",
    name: "Green Fairways Trust",
    description: "Protects local golf greens and community parks with sustainable maintenance.",
    impact: "11 community courses restored",
  },
  {
    id: "charity-caddies",
    name: "Caddie Futures Fund",
    description: "Supports education bursaries for caddies and their families.",
    impact: "62 family bursaries awarded",
  },
];

let state = createInitialState();
let supabaseClient = null;
const els = {
  authSection: document.getElementById("authSection"),
  authEntryActions: document.getElementById("authEntryActions"),
  openSubscriberAuthButton: document.getElementById("openSubscriberAuthButton"),
  openAdminAuthButton: document.getElementById("openAdminAuthButton"),
  backToAccessButtonsFromUser: document.getElementById("backToAccessButtonsFromUser"),
  backToAccessButtonsFromAdmin: document.getElementById("backToAccessButtonsFromAdmin"),
  subscriberAuthFlow: document.getElementById("subscriberAuthFlow"),
  adminAuthFlow: document.getElementById("adminAuthFlow"),
  authToggles: [...document.querySelectorAll(".auth-toggle")],
  authPanels: [...document.querySelectorAll(".auth-panel")],
  loginForm: document.getElementById("loginForm"),
  signupForm: document.getElementById("signupForm"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  logoutButton: document.getElementById("logoutButton"),
  authMessageBox: document.getElementById("authMessageBox"),
  activeModeLabel: document.getElementById("activeModeLabel"),
  seedDemoButton: document.getElementById("seedDemoButton"),
  becomeSubscriberButton: document.getElementById("becomeSubscriberButton"),
  switchAdminButton: document.getElementById("switchAdminButton"),
  headlineStats: document.getElementById("headlineStats"),
  nextDrawDate: document.getElementById("nextDrawDate"),
  latestWinningNumbers: document.getElementById("latestWinningNumbers"),
  jackpotSummary: document.getElementById("jackpotSummary"),
  planCards: document.getElementById("planCards"),
  publicCharityGrid: document.getElementById("publicCharityGrid"),
  subscriptionForm: document.getElementById("subscriptionForm"),
  subscriptionCharitySelect: document.getElementById("subscriptionCharitySelect"),
  scoreForm: document.getElementById("scoreForm"),
  scoreUserSelect: document.getElementById("scoreUserSelect"),
  dashboardUserSelect: document.getElementById("dashboardUserSelect"),
  subscriberSummary: document.getElementById("subscriberSummary"),
  recentScores: document.getElementById("recentScores"),
  userDrawHistory: document.getElementById("userDrawHistory"),
  charityHighlights: document.getElementById("charityHighlights"),
  prizeBreakdown: document.getElementById("prizeBreakdown"),
  drawForm: document.getElementById("drawForm"),
  drawTargetLabel: document.getElementById("drawTargetLabel"),
  drawTargetInput: document.getElementById("drawTargetInput"),
  drawResults: document.getElementById("drawResults"),
  winnerTable: document.getElementById("winnerTable"),
  userTable: document.getElementById("userTable"),
  analyticsCards: document.getElementById("analyticsCards"),
  toast: document.getElementById("toast"),
  panelTabs: [...document.querySelectorAll(".panel-tab")],
  panels: [...document.querySelectorAll(".workspace-panel")],
};

bootstrap();

async function bootstrap() {
  try {
    bindEvents();
    initializeSupabase();
    await restoreAuthSession();
    await loadAppData();
    state.authGateDismissed = true;
    render();
  } catch (error) {
    updateAuthMessage(`Bootstrap error: ${error.message || error}`);
  }
}

function bindEvents() {
  els.loginForm?.addEventListener("submit", handleLoginSubmit);
  els.signupForm?.addEventListener("submit", handleSignupSubmit);
  els.adminLoginForm?.addEventListener("submit", handleAdminLoginSubmit);
  els.openSubscriberAuthButton?.addEventListener("click", () => openAuthFlow("subscriber"));
  els.openAdminAuthButton?.addEventListener("click", () => openAuthFlow("admin"));
  els.backToAccessButtonsFromUser?.addEventListener("click", closeAuthFlow);
  els.backToAccessButtonsFromAdmin?.addEventListener("click", closeAuthFlow);
  els.authToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => setAuthView(toggle.dataset.authView));
  });
  els.logoutButton?.addEventListener("click", handleLogout);

  els.becomeSubscriberButton?.addEventListener("click", () => {
    openAuthFlow("subscriber", "signup");
    document.getElementById("signupFormPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  els.switchAdminButton?.addEventListener("click", () => {
    openAuthFlow("admin");
    els.adminLoginForm?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  els.panelTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchPanel(tab.dataset.panel));
  });

  els.subscriptionForm?.addEventListener("submit", handleSubscriptionSubmit);
  els.scoreForm?.addEventListener("submit", handleScoreSubmit);
  els.drawForm?.addEventListener("submit", handleDrawSubmit);
  els.drawForm?.mode?.addEventListener("change", updateDrawModeUI);
  els.dashboardUserSelect?.addEventListener("change", renderSubscriberDashboard);
  els.userTable?.addEventListener("click", handleUserTableClick);
  els.winnerTable?.addEventListener("click", handleWinnerTableClick);
}

function saveState() {}

async function restoreAuthSession() {
  if (!supabaseClient) {
    state.session = null;
    return;
  }

  try {
    const { data } = await supabaseClient.auth.getSession();
    await syncSupabaseSession(data.session?.user || null);
  } catch {
    state.session = null;
    state.authGateDismissed = false;
  }
}

function createInitialState() {
  return {
    currentMode: "public",
    session: null,
    authGateDismissed: false,
    hideSignup: false,
    authFlow: null,
    jackpotCarryOver: 0,
    metrics: {
      totalSubscribers: 0,
      activeSubscribers: 0,
      totalRevenue: 0,
      charityTotal: 0,
    },
    charities: [...defaultCharities],
    users: [],
    scores: [],
    draws: [],
  };
}

function createUser({ id, name, email, club, plan, charityId, contributionPercent, numbers, startsAt }) {
  const fee = planConfig[plan].fee;
  const endsAt = addDays(startsAt, planConfig[plan].durationDays);

  return {
    id,
    name,
    email,
    club,
    role: "subscriber",
    plan,
    fee,
    charityId,
    contributionPercent,
    numbers,
    startsAt,
    endsAt,
    status: new Date(endsAt) >= new Date() ? "active" : "inactive",
  };
}

function addDays(dateString, days) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function render() {
  renderAuthState();
  renderHeaderStats();
  renderPlans();
  renderPublicCharities();
  populateSelects();
  renderSubscriberDashboard();
  renderCharityHighlights();
  renderPrizeBreakdown();
  renderDrawResults();
  renderWinnerTable();
  renderUserTable();
  renderAnalytics();
  hydrateDrawForm();
  applyCurrentMode();
}

function renderAuthState() {
  if (els.authSection) {
    els.authSection.style.display = state.session ? "none" : "grid";
  }

  if (els.logoutButton) {
    els.logoutButton.style.display = state.session ? "inline-flex" : "none";
    els.logoutButton.textContent = "Logout";
  }

  const signupToggle = els.authToggles.find((toggle) => toggle.dataset.authView === "signup");
  if (signupToggle) {
    signupToggle.style.display = state.hideSignup ? "none" : "inline-flex";
  }

  if (state.hideSignup) {
    setAuthView("login");
  }

  if (!state.session && els.authEntryActions && els.subscriberAuthFlow && els.adminAuthFlow) {
    const activeFlow = state.authFlow || null;
    els.authEntryActions.classList.toggle("hidden", Boolean(activeFlow));
    els.subscriberAuthFlow.classList.toggle("hidden", activeFlow !== "subscriber");
    els.adminAuthFlow.classList.toggle("hidden", activeFlow !== "admin");
  }
}

function initializeSupabase() {
  const config = window.SUPABASE_CONFIG || {};
  const hasConfig = config.url && config.anonKey
    && !config.url.includes("YOUR_SUPABASE_URL")
    && !config.anonKey.includes("YOUR_SUPABASE_ANON_KEY");

  if (!window.supabase || !hasConfig) {
    if (els.seedDemoButton) {
      els.seedDemoButton.style.display = "none";
    }
    updateAuthMessage("Configure Supabase in `supabase-config.js` to enable login and signup.");
    return;
  }

  supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  if (els.seedDemoButton) {
    els.seedDemoButton.style.display = "none";
  }
  updateAuthMessage("Supabase connected. Use Sign Up to create your first account, then log in.");
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    Promise.resolve(syncSupabaseSession(session?.user || null))
      .then(() => loadAppData())
      .then(() => {
        render();
      });
  });
}

async function syncSupabaseSession(user) {
  if (!supabaseClient) {
    state.session = null;
    return;
  }

  if (!user) {
    state.session = null;
    return;
  }

  let profile = null;
  try {
    const { data } = await supabaseClient
      .from("profiles")
      .select("role, full_name, email")
      .eq("id", user.id)
      .maybeSingle();
    profile = data;
  } catch {
    profile = null;
  }

  const role = profile?.role === "admin" ? "admin" : "subscriber";
    state.session = {
      role,
      email: profile?.email || user.email,
    name: profile?.full_name || user.user_metadata?.name || user.email,
    isEmailVerified: Boolean(user.email_confirmed_at),
    userId: user.id,
    };
    state.currentMode = role === "admin" ? "admin" : "subscriber";
    state.authGateDismissed = true;
    state.authFlow = null;
}

function updateAuthMessage(message) {
  if (els.authMessageBox) {
    els.authMessageBox.textContent = message;
  }
}

function setAuthView(view) {
  if (!els.authPanels.length || !els.authToggles.length) return;
  const resolvedView = view === "signup" && state.hideSignup ? "login" : view;
  els.authToggles.forEach((toggle) => toggle.classList.toggle("active", toggle.dataset.authView === resolvedView));
  els.authPanels.forEach((panel) => {
    const panelView = panel.id === "signupFormPanel" ? "signup" : "login";
    panel.classList.toggle("active", panelView === resolvedView);
  });
}

function openAuthFlow(flow, authView = "login") {
  state.authFlow = flow;
  if (flow === "subscriber") {
    setAuthView(authView);
  }
  renderAuthState();
}

function closeAuthFlow() {
  state.authFlow = null;
  renderAuthState();
}

async function loadAppData() {
  if (!supabaseClient) {
    state.charities = [...defaultCharities];
    state.users = [];
    state.scores = [];
    state.draws = [];
    state.jackpotCarryOver = 0;
    state.metrics = {
      totalSubscribers: 0,
      activeSubscribers: 0,
      totalRevenue: 0,
      charityTotal: 0,
    };
    return;
  }

  const charities = await fetchCharities();
  const draws = await fetchDraws();
  const allSubscriptions = await fetchSubscriptions();
  let profiles = [];
  let subscriptions = [];
  let scores = [];
  let winners = [];

  if (state.session?.role === "admin") {
    profiles = await fetchProfiles();
    subscriptions = await fetchSubscriptions();
    scores = await fetchScores();
    winners = await fetchWinnerVerifications();
  } else if (state.session?.role === "subscriber" && state.session?.userId) {
    profiles = await fetchProfiles(state.session.userId);
    subscriptions = await fetchSubscriptions(state.session.userId);
    scores = await fetchScores(state.session.userId);
    winners = await fetchWinnerVerifications(state.session.userId);
  }

  state.charities = normalizeCharities(charities);
  state.users = normalizeUsers(profiles, subscriptions);
  state.scores = normalizeScores(scores);
  state.draws = normalizeDraws(draws, winners, state.users);
  state.jackpotCarryOver = state.draws.at(-1)?.jackpotCarryOver ?? 0;
  state.metrics = calculateMetrics(allSubscriptions);

  if (!state.users.length && state.session?.role === "subscriber" && state.session?.userId) {
    state.users = [createProfileOnlyUser()];
  }

  saveState();
}

async function fetchCharities() {
  const { data, error } = await supabaseClient
    .from("charities")
    .select("id, name, description, impact, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchDraws() {
  let response = await supabaseClient
    .from("draws")
    .select("id, label, mode, winning_numbers, prize_pool, jackpot_carry_over, draw_date")
    .order("draw_date", { ascending: true });

  if (response.error && String(response.error.message || "").includes("jackpot_carry_over")) {
    response = await supabaseClient
      .from("draws")
      .select("id, label, mode, winning_numbers, prize_pool, draw_date")
      .order("draw_date", { ascending: true });
  }

  if (response.error) throw response.error;
  return response.data || [];
}

async function fetchProfiles(userId) {
  let query = supabaseClient
    .from("profiles")
    .select("id, email, full_name, club, role")
    .order("created_at", { ascending: true });
  if (userId) query = query.eq("id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function fetchSubscriptions(userId) {
  let query = supabaseClient
    .from("subscriptions")
    .select("id, user_id, plan, fee, charity_id, contribution_percent, lucky_numbers, status, starts_at, ends_at, created_at")
    .order("created_at", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function fetchScores(userId) {
  let query = supabaseClient
    .from("scores")
    .select("id, user_id, score, played_on, proof_note, created_at")
    .order("played_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function fetchWinnerVerifications(userId) {
  let query = supabaseClient
    .from("winner_verifications")
    .select("id, draw_id, user_id, matches, base_matches, weighted_boost, score_weight, payout, verification_status, payment_status, created_at")
    .order("created_at", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  let response = await query;

  if (response.error && /base_matches|weighted_boost|score_weight/i.test(String(response.error.message || ""))) {
    let fallbackQuery = supabaseClient
      .from("winner_verifications")
      .select("id, draw_id, user_id, matches, payout, verification_status, payment_status, created_at")
      .order("created_at", { ascending: false });
    if (userId) fallbackQuery = fallbackQuery.eq("user_id", userId);
    response = await fallbackQuery;
  }

  if (response.error) throw response.error;
  return response.data || [];
}

function normalizeCharities(rows) {
  if (!rows.length) return [...defaultCharities];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    impact: row.impact || "Impact details coming soon",
  }));
}

function normalizeUsers(profiles, subscriptions) {
  const latestSubscriptionByUser = new Map();
  subscriptions.forEach((subscription) => {
    if (!latestSubscriptionByUser.has(subscription.user_id)) {
      latestSubscriptionByUser.set(subscription.user_id, subscription);
    }
  });

  return profiles.map((profile) => {
    const subscription = latestSubscriptionByUser.get(profile.id);
    const plan = subscription?.plan || "monthly";
    const startsAt = subscription?.starts_at || new Date().toISOString().slice(0, 10);
    const endsAt = subscription?.ends_at || addDays(startsAt, planConfig[plan].durationDays);
    return {
      id: profile.id,
      subscriptionId: subscription?.id || null,
      name: profile.full_name,
      email: profile.email,
      club: profile.club || "Golf Club Pending",
      role: profile.role === "admin" ? "admin" : "subscriber",
      plan,
      fee: Number(subscription?.fee ?? planConfig[plan].fee),
      charityId: subscription?.charity_id || null,
      contributionPercent: Number(subscription?.contribution_percent ?? 10),
      numbers: Array.isArray(subscription?.lucky_numbers) ? subscription.lucky_numbers : [],
      startsAt,
      endsAt,
      status: subscription?.status || (new Date(endsAt) >= new Date() ? "active" : "inactive"),
    };
  });
}

function normalizeScores(rows) {
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    score: Number(row.score),
    date: row.played_on,
    proof: row.proof_note || "",
    createdAt: row.created_at,
  }));
}

function normalizeDraws(draws, winners, users) {
  const userMap = new Map(users.map((user) => [user.id, user]));
  const winnersByDraw = winners.reduce((map, winner) => {
    const list = map.get(winner.draw_id) || [];
    list.push({
      id: winner.id,
      userId: winner.user_id,
      userName: userMap.get(winner.user_id)?.name || "Subscriber",
      matches: winner.matches,
      baseMatches: winner.base_matches ?? winner.matches,
      weightedBoost: winner.weighted_boost ?? 0,
      scoreWeight: winner.score_weight ?? 1,
      payout: Number(winner.payout || 0),
      verificationStatus: winner.verification_status,
      paymentStatus: winner.payment_status,
      date: winner.created_at,
    });
    map.set(winner.draw_id, list);
    return map;
  }, new Map());

  return draws.map((draw) => ({
    id: draw.id,
    label: draw.label,
    mode: draw.mode,
    winningNumbers: Array.isArray(draw.winning_numbers) ? draw.winning_numbers : [],
    prizePool: Number(draw.prize_pool || 0),
    jackpotCarryOver: Number(draw.jackpot_carry_over || 0),
    date: draw.draw_date,
    results: (winnersByDraw.get(draw.id) || []).sort((a, b) => b.matches - a.matches || a.userName.localeCompare(b.userName)),
  }));
}

function createProfileOnlyUser() {
  return {
    id: state.session.userId,
    subscriptionId: null,
    name: state.session.name,
    email: state.session.email,
    club: "Golf Club Pending",
    role: state.session.role,
    plan: "monthly",
    fee: planConfig.monthly.fee,
    charityId: null,
    contributionPercent: 10,
    numbers: [],
    startsAt: new Date().toISOString().slice(0, 10),
    endsAt: addDays(new Date().toISOString().slice(0, 10), planConfig.monthly.durationDays),
    status: "inactive",
  };
}

function calculateMetrics(subscriptions) {
  const normalized = subscriptions.map((subscription) => ({
    status: subscription.status || "inactive",
    fee: Number(subscription.fee || 0),
    contributionPercent: Number(subscription.contribution_percent || 10),
  }));

  return {
    totalSubscribers: normalized.length,
    activeSubscribers: normalized.filter((subscription) => subscription.status === "active").length,
    totalRevenue: roundMoney(normalized.reduce((sum, subscription) => sum + subscription.fee, 0)),
    charityTotal: roundMoney(normalized.reduce(
      (sum, subscription) => sum + (subscription.fee * (subscription.contributionPercent / 100)),
      0
    )),
  };
}

function renderHeaderStats() {
  const activeUsers = state.metrics?.activeSubscribers ?? 0;
  const totalSubscribers = state.metrics?.totalSubscribers ?? 0;
  const totalRevenue = state.metrics?.totalRevenue ?? 0;
  const charityTotal = state.metrics?.charityTotal ?? 0;
  const nextDraw = getNextDrawDate();
  const latestDraw = state.draws.at(-1);

  els.headlineStats.innerHTML = `
    <div class="metric-card">
      <span class="mini-pill">Active Subscribers</span>
      <strong>${activeUsers}</strong>
      <p>${totalSubscribers} total subscribers tracked across the platform.</p>
    </div>
    <div class="metric-card">
      <span class="mini-pill">Revenue</span>
      <strong>${formatCurrency(totalRevenue)}</strong>
      <p>Total subscription revenue tracked in this workspace.</p>
    </div>
    <div class="metric-card">
      <span class="mini-pill">Charity Impact</span>
      <strong>${formatCurrency(charityTotal)}</strong>
      <p>Projected donations generated by subscriber contributions.</p>
    </div>
  `;

  els.nextDrawDate.textContent = formatDate(nextDraw);
  els.latestWinningNumbers.innerHTML = (latestDraw?.winningNumbers || [3, 7, 12, 18, 24])
    .map((number) => `<span class="ball">${number}</span>`)
    .join("");
  els.jackpotSummary.textContent = `Current jackpot pool: ${formatCurrency(calculatePrizePool())} including ${formatCurrency(state.jackpotCarryOver)} rollover.`;
}

function renderPlans() {
  els.planCards.innerHTML = Object.entries(planConfig)
    .map(([key, plan]) => `
      <article class="plan-card">
        <span class="mini-pill">${key === "yearly" ? "Best Value" : "Flexible Entry"}</span>
        <h4>${plan.label} Access</h4>
        <p class="price">${formatCurrency(plan.fee)}</p>
        <p>${key === "yearly" ? "Save compared to monthly billing and keep uninterrupted draw access." : "Fast subscription flow for new users joining mid-season."}</p>
        <p>${key === "yearly" ? "Renews every 365 days" : "Renews every 30 days"}</p>
      </article>
    `)
    .join("");
}

function renderPublicCharities() {
  els.publicCharityGrid.innerHTML = state.charities
    .map((charity) => `
      <article class="charity-card">
        <span class="mini-pill">Verified Charity</span>
        <h4>${charity.name}</h4>
        <p>${charity.description}</p>
        <strong>${charity.impact}</strong>
      </article>
    `)
    .join("");
}

function populateSelects() {
  const charityOptions = state.charities
    .map((charity) => `<option value="${charity.id}">${charity.name}</option>`)
    .join("");
  const userOptions = state.users
    .map((user) => `<option value="${user.id}">${user.name}</option>`)
    .join("");

  els.subscriptionCharitySelect.innerHTML = charityOptions;
  els.scoreUserSelect.innerHTML = userOptions;
  els.dashboardUserSelect.innerHTML = userOptions;

  if (!els.dashboardUserSelect.value && state.users[0]) {
    els.dashboardUserSelect.value = state.users[0].id;
  }

  if (!els.scoreForm.date.value) {
    els.scoreForm.date.value = new Date().toISOString().slice(0, 10);
  }
}

function renderSubscriberDashboard() {
  const selectedUser = state.users.find((user) => user.id === els.dashboardUserSelect.value) || state.users[0];
  if (!selectedUser) return;

  els.dashboardUserSelect.value = selectedUser.id;
  const userScores = state.scores.filter((score) => score.userId === selectedUser.id).sort(sortByDateDesc);
  const charity = state.charities.find((entry) => entry.id === selectedUser.charityId);
  const averageScore = userScores.length
    ? (userScores.reduce((sum, entry) => sum + entry.score, 0) / userScores.length).toFixed(1)
    : "--";
  const drawHistory = state.draws
    .filter((draw) => draw.results.some((result) => result.userId === selectedUser.id))
    .sort(sortByDateDesc)
    .slice(0, 5);

  els.subscriberSummary.innerHTML = `
    <article class="summary-card">
      <span class="mini-pill">Status</span>
      <strong>${titleCase(selectedUser.status)}</strong>
      <p>${planConfig[selectedUser.plan].label} plan until ${formatDate(selectedUser.endsAt)}</p>
    </article>
    <article class="summary-card">
      <span class="mini-pill">Charity</span>
      <strong>${charity?.name || "Unassigned"}</strong>
      <p>${selectedUser.contributionPercent}% of each payment contributes to this cause.</p>
    </article>
    <article class="summary-card">
      <span class="mini-pill">Golf Scores</span>
      <strong>${userScores.length} recorded</strong>
      <p>Average score ${averageScore} across the last 5 dated entries.</p>
    </article>
  `;

  els.recentScores.innerHTML = userScores.length
    ? userScores.map((entry) => `
        <article class="score-item">
          <div class="status-row">
            <strong>${entry.score}</strong>
            <span class="mini-pill">${formatDate(entry.date)}</span>
          </div>
          <p>${entry.proof}</p>
        </article>
      `).join("")
    : `<div class="empty-state">No scores yet for this subscriber.</div>`;

  els.userDrawHistory.innerHTML = drawHistory.length
    ? drawHistory.map((draw) => {
        const result = draw.results.find((item) => item.userId === selectedUser.id);
        return `
          <article class="history-item">
            <div class="status-row">
              <strong>${draw.label}</strong>
              <span class="tier-badge">${result.matches} matches</span>
            </div>
            <p>Payout: ${formatCurrency(result.payout)} | Status: ${titleCase(result.paymentStatus)}</p>
          </article>
        `;
      }).join("")
    : `<div class="empty-state">This subscriber has not appeared in a published draw yet.</div>`;
}

function renderCharityHighlights() {
  const breakdown = state.charities.map((charity) => {
    const users = state.users.filter((user) => user.charityId === charity.id);
    const amount = roundMoney(users.reduce((sum, user) => sum + (user.fee * (user.contributionPercent / 100)), 0));
    return { charity, amount, supporters: users.length };
  });

  els.charityHighlights.innerHTML = breakdown
    .map(({ charity, amount, supporters }) => `
      <article class="charity-card">
        <h4>${charity.name}</h4>
        <p>${supporters} subscribers backing this cause.</p>
        <strong>${formatCurrency(amount)} projected contribution</strong>
      </article>
    `)
    .join("");
}

function renderPrizeBreakdown() {
  const prizePool = calculatePrizePool();
  els.prizeBreakdown.innerHTML = prizePercentages
    .map((tier) => `
      <article class="prize-tier">
        <div class="status-row">
          <strong>${tier.label}</strong>
          <span class="tier-badge">${Math.round(tier.percent * 100)}%</span>
        </div>
        <p>${formatCurrency(roundMoney(prizePool * tier.percent))} ${tier.jackpot ? "with rollover enabled if unclaimed" : "shared equally across verified winners"}</p>
      </article>
    `)
    .join("");
}

function hydrateDrawForm() {
  if (!els.drawForm.date.value) {
    els.drawForm.date.value = getNextDrawDate();
  }

  if (!els.drawForm.label.value) {
    const date = new Date(getNextDrawDate());
    els.drawForm.label.value = `${date.toLocaleString("en-US", { month: "long" })} ${date.getFullYear()} draw`;
  }

  updateDrawModeUI();
}

function updateDrawModeUI() {
  if (!els.drawForm || !els.drawTargetInput || !els.drawTargetLabel) return;
  const mode = els.drawForm.mode?.value || "weighted";

  if (mode === "random") {
    els.drawTargetLabel.textContent = "Random draw";
    els.drawTargetInput.value = "";
    els.drawTargetInput.placeholder = "Random winner will be selected automatically";
    els.drawTargetInput.required = false;
    els.drawTargetInput.disabled = true;
    return;
  }

  els.drawTargetLabel.textContent = "Target golf score";
  els.drawTargetInput.disabled = false;
  els.drawTargetInput.required = true;
  els.drawTargetInput.placeholder = "36";
  if (!els.drawTargetInput.value) {
    els.drawTargetInput.value = "36";
  }
}

function renderDrawResults() {
  const latestDraw = state.draws.at(-1);

  if (!latestDraw) {
    els.drawResults.innerHTML = `<div class="empty-state">No draw has been run yet.</div>`;
    return;
  }

  const winners = latestDraw.results.filter((result) => result.matches >= 3);
  const drawDescriptor = latestDraw.mode === "weighted"
    ? `Target golf score: ${latestDraw.winningNumbers?.[0] ?? "--"}`
    : "Random winner selection";
  els.drawResults.innerHTML = `
    <article class="result-card">
      <div class="status-row">
        <strong>${latestDraw.label}</strong>
        <span class="mini-pill">${titleCase(latestDraw.mode)} mode</span>
      </div>
      <div class="balls">${latestDraw.winningNumbers.map((number) => `<span class="ball">${number}</span>`).join("")}</div>
      <p>${drawDescriptor}</p>
      <p>${winners.length} winners qualified for payout across all tiers.</p>
    </article>
    ${winners.map((winner) => `
      <article class="draw-row">
        <div class="status-row">
          <strong>${winner.userName}</strong>
          <span class="tier-badge">${winner.matches} matches</span>
        </div>
        <p>Payout ${formatCurrency(winner.payout)} | Verification ${titleCase(winner.verificationStatus)} | Payment ${titleCase(winner.paymentStatus)}${winner.weightedBoost ? " | Score boost applied" : ""}</p>
      </article>
    `).join("") || `<div class="empty-state">No winners qualified in the latest draw.</div>`}
  `;
}

function renderWinnerTable() {
  const winnerRows = state.draws
    .flatMap((draw) => draw.results.map((result) => ({ ...result, drawLabel: draw.label, drawId: draw.id })))
    .filter((result) => result.matches >= 3)
    .sort(sortByDateDesc);

  if (!winnerRows.length) {
    els.winnerTable.innerHTML = `<div class="empty-state">Winner verification queue is empty.</div>`;
    return;
  }

  els.winnerTable.innerHTML = `
    <div class="table winner-table">
      <div class="table-head">
        <span>Winner</span>
        <span>Draw</span>
        <span>Matches</span>
        <span>Payment</span>
        <span>Action</span>
      </div>
      ${winnerRows.map((winner) => `
        <div class="table-row">
          <span>${winner.userName}</span>
          <span>${winner.drawLabel}</span>
          <span>${winner.matches}</span>
          <span>${titleCase(winner.paymentStatus)}</span>
          <button class="small-button" data-action="toggle-payment" data-draw-id="${winner.drawId}" data-user-id="${winner.userId}" type="button">
            ${winner.paymentStatus === "paid" ? "Mark Pending" : "Mark Paid"}
          </button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderUserTable() {
  els.userTable.innerHTML = `
    <div class="table">
      <div class="table-head">
        <span>User</span>
        <span>Plan</span>
        <span>Status</span>
        <span>Renewal</span>
        <span>Action</span>
      </div>
      ${state.users.map((user) => `
        <div class="table-row">
          <span>${user.name}</span>
          <span>${titleCase(user.plan)}</span>
          <span>${titleCase(user.status)}</span>
          <span>${formatDate(user.endsAt)}</span>
          <button class="small-button" data-action="toggle-status" data-user-id="${user.id}" type="button">
            ${user.status === "active" ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAnalytics() {
  const activeUsers = getActiveUsers();
  const totalRevenue = state.users.reduce((sum, user) => sum + user.fee, 0);
  const totalScores = state.scores.length;
  const averageScore = totalScores ? Math.round(state.scores.reduce((sum, item) => sum + item.score, 0) / totalScores) : 0;
  const paidWinners = state.draws.flatMap((draw) => draw.results).filter((result) => result.paymentStatus === "paid").length;

  els.analyticsCards.innerHTML = `
    <article class="analytics-card">
      <span class="mini-pill">Subscribers</span>
      <strong>${activeUsers.length}/${state.users.length}</strong>
      <p>Active subscribers versus total registered users.</p>
    </article>
    <article class="analytics-card">
      <span class="mini-pill">Average Score</span>
      <strong>${averageScore || "--"}</strong>
      <p>Rolling average across the most recent retained entries.</p>
    </article>
    <article class="analytics-card">
      <span class="mini-pill">Revenue</span>
      <strong>${formatCurrency(totalRevenue)}</strong>
      <p>Current subscription revenue recorded by the platform.</p>
    </article>
    <article class="analytics-card">
      <span class="mini-pill">Draws Published</span>
      <strong>${state.draws.length}</strong>
      <p>Historical monthly draw cycles preserved for auditing.</p>
    </article>
    <article class="analytics-card">
      <span class="mini-pill">Paid Winners</span>
      <strong>${paidWinners}</strong>
      <p>Verified winners already moved to paid status.</p>
    </article>
    <article class="analytics-card">
      <span class="mini-pill">Charity Total</span>
      <strong>${formatCurrency(calculateCharityTotal())}</strong>
      <p>Projected donation amount calculated from subscriber preferences.</p>
    </article>
  `;
}

async function handleSubscriptionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const plan = formData.get("plan");
  const startsAt = new Date().toISOString().slice(0, 10);

  if (supabaseClient && state.session?.userId) {
    try {
      const email = formData.get("email").trim().toLowerCase();
      let targetUserId = state.session.userId;

      if (state.session.role === "admin") {
        const matchedUser = state.users.find((user) => user.email === email);
        if (!matchedUser) {
          throw new Error("Admin subscription setup needs an existing subscriber email.");
        }
        targetUserId = matchedUser.id;
      }

      const club = formData.get("club").trim();
      const name = formData.get("name").trim();
      if (targetUserId === state.session.userId) {
        const { error: profileError } = await supabaseClient
          .from("profiles")
          .update({ full_name: name, club })
          .eq("id", targetUserId);
        if (profileError) throw profileError;
      }

      const charityId = String(formData.get("charityId"));
      const { error } = await supabaseClient
        .from("subscriptions")
        .insert({
          user_id: targetUserId,
          plan,
          fee: planConfig[plan].fee,
          charity_id: isUuid(charityId) ? charityId : null,
          contribution_percent: Number(formData.get("contributionPercent")),
          lucky_numbers: generateDrawNumbers(),
          status: "active",
          starts_at: startsAt,
          ends_at: addDays(startsAt, planConfig[plan].durationDays),
        });
      if (error) throw error;

      await loadAppData();
      render();
      els.dashboardUserSelect.value = targetUserId;
      renderSubscriberDashboard();
      form.reset();
      showToast(`${name} is now an active ${planConfig[plan].label.toLowerCase()} subscriber.`);
      return;
    } catch (error) {
      updateAuthMessage(error.message || "Subscription save failed.");
      showToast(error.message || "Subscription save failed.");
      return;
    }
  }

  const user = createUser({
    id: crypto.randomUUID(),
    name: formData.get("name").trim(),
    email: formData.get("email").trim().toLowerCase(),
    club: formData.get("club").trim(),
    plan,
    charityId: formData.get("charityId"),
    contributionPercent: Number(formData.get("contributionPercent")),
    numbers: generateDrawNumbers(),
    startsAt,
  });

  state.users.unshift(user);
  saveState();
  form.reset();
  render();
  els.dashboardUserSelect.value = user.id;
  renderSubscriberDashboard();
  showToast(`${user.name} is now an active ${planConfig[user.plan].label.toLowerCase()} subscriber.`);
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(event.currentTarget);
  const email = String(formData.get("email")).trim().toLowerCase();
  const password = String(formData.get("password"));

  try {
    if (!supabaseClient) {
      throw new Error("Configure Supabase in `supabase-config.js` first.");
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;

    await syncSupabaseSession(data.user);
    await loadAppData();
    saveState();
    render();
    const linkedUser = state.users.find((user) => user.email === data.user.email);
    if (linkedUser) {
      els.dashboardUserSelect.value = linkedUser.id;
      renderSubscriberDashboard();
    }
    form?.reset();
    updateAuthMessage(data.user.email_confirmed_at
      ? "Login successful."
      : "Login successful. Check your email confirmation status in Supabase.");
    showToast(`Logged in as ${state.session.role === "admin" ? "administrator" : "subscriber"}.`);
  } catch (error) {
    updateAuthMessage(error.message || "Login failed.");
    showToast(error.message || "Login failed.");
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(event.currentTarget);
  const name = String(formData.get("name")).trim();
  const email = String(formData.get("email")).trim().toLowerCase();
  const club = "New Member Club";
  const password = String(formData.get("password"));

  try {
    if (!supabaseClient) {
      throw new Error("Configure Supabase in `supabase-config.js` first.");
    }

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          club,
          role: "user",
        },
      },
    });
    if (error) throw error;

    const authUser = data.user;
    const hasSession = Boolean(data.session);

    if (hasSession) {
      await syncSupabaseSession(authUser);
      await loadAppData();
    } else {
      state.session = null;
      state.currentMode = "public";
    }

    state.hideSignup = true;
    state.authFlow = null;
    saveState();
    render();
    const linkedUser = hasSession ? state.users.find((user) => user.email === email) : null;
    if (linkedUser) {
      els.dashboardUserSelect.value = linkedUser.id;
      renderSubscriberDashboard();
    }
    form?.reset();
    setAuthView("login");
    updateAuthMessage(hasSession
      ? "Account created successfully. You are now logged in."
      : "Account created. Check your email and confirm your account, then log in.");
    showToast(hasSession ? "Signup complete." : "Signup complete. Confirm your email, then log in.");
  } catch (error) {
    updateAuthMessage(error.message || "Signup failed.");
    showToast(error.message || "Signup failed.");
  }
}

async function handleAdminLoginSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const email = String(formData.get("email")).trim().toLowerCase();
  const password = String(formData.get("password"));

  try {
    if (!supabaseClient) {
      throw new Error("Configure Supabase in `supabase-config.js` first.");
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;

    await syncSupabaseSession(data.user);
    await loadAppData();
    if (state.session?.role !== "admin") {
      await supabaseClient.auth.signOut();
      state.session = null;
      await loadAppData();
      render();
      throw new Error("This account exists, but it is not marked as admin in Supabase.");
    }

    saveState();
    render();
    form?.reset();
    updateAuthMessage("Administrator login successful.");
    showToast("Logged in as administrator.");
  } catch (error) {
    updateAuthMessage(error.message || "Administrator login failed.");
    showToast(error.message || "Administrator login failed.");
  }
}

async function handleLogout() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  state.session = null;
  state.authGateDismissed = false;
  state.hideSignup = false;
  state.authFlow = null;
  await loadAppData();
  saveState();
  state.currentMode = "public";
  render();
  showToast("Session ended.");
}

async function handleScoreSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const score = Number(formData.get("score"));
  const userId = formData.get("userId");
  const date = formData.get("date");
  const proof = formData.get("proof").trim();

  if (score < 1 || score > 45) {
    showToast("Score must stay between 1 and 45.");
    return;
  }

  if (!date) {
    showToast("Each golf score must include a date.");
    return;
  }

  if (supabaseClient && state.session?.userId) {
    try {
      const { error: insertError } = await supabaseClient
        .from("scores")
        .insert({
          user_id: userId,
          score,
          played_on: date,
          proof_note: proof,
        });
      if (insertError) throw insertError;

      const { data: latestScores, error: fetchError } = await supabaseClient
        .from("scores")
        .select("id")
        .eq("user_id", userId)
        .order("played_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (fetchError) throw fetchError;

      const extraIds = (latestScores || []).slice(5).map((entry) => entry.id);
      if (extraIds.length) {
        const { error: deleteError } = await supabaseClient
          .from("scores")
          .delete()
          .in("id", extraIds);
        if (deleteError) throw deleteError;
      }

      await loadAppData();
      render();
      els.dashboardUserSelect.value = userId;
      renderSubscriberDashboard();
      form.reset();
      els.scoreForm.date.value = new Date().toISOString().slice(0, 10);
      showToast("Score saved. Only the last 5 scores are retained automatically.");
      return;
    } catch (error) {
      const message = /scores_score_check|check constraint|violates check constraint/i.test(String(error.message || ""))
        ? "Golf score save failed because Supabase still has the old score rule. Re-run the latest schema SQL."
        : (error.message || "Golf score save failed.");
      updateAuthMessage(message);
      showToast(message);
      return;
    }
  }

  addScore({
    userId,
    score,
    date,
    proof,
  }, true);

  saveState();
  render();
  els.dashboardUserSelect.value = userId;
  renderSubscriberDashboard();
  form.reset();
  els.scoreForm.date.value = new Date().toISOString().slice(0, 10);
}

function addScore({ userId, score, date, proof }, notify) {
  const userScores = state.scores
    .filter((entry) => entry.userId === userId)
    .sort(sortByDateDesc);

  state.scores.push({
    id: crypto.randomUUID(),
    userId,
    score,
    date,
    proof,
  });

  if (userScores.length >= 5) {
    const oldest = [...userScores].sort(sortByDateAsc)[0];
    state.scores = state.scores.filter((entry) => entry.id !== oldest.id);
  }

  if (notify) {
    showToast("Score saved. Only the last 5 scores are retained automatically.");
  }
}

async function handleDrawSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const mode = formData.get("mode");
  const targetScore = mode === "weighted" ? Number(formData.get("winningNumbers")) : null;

  if (mode === "weighted" && (!Number.isInteger(targetScore) || targetScore < 1 || targetScore > 45)) {
    showToast("Weighted draw needs one target golf score between 1 and 45.");
    return;
  }

  const payload = {
    mode,
    label: formData.get("label").trim(),
    winningNumbers: mode === "weighted" ? [targetScore] : [],
    date: formData.get("date"),
  };

  if (supabaseClient && state.session?.role === "admin") {
    try {
      const outcome = buildDrawOutcome(payload);
      let drawResponse = await supabaseClient
        .from("draws")
        .insert({
          label: outcome.label,
          mode: outcome.mode,
          winning_numbers: outcome.winningNumbers,
          prize_pool: outcome.prizePool,
          jackpot_carry_over: outcome.jackpotCarryOver,
          draw_date: outcome.date,
        })
        .select("id")
        .single();

      if (
        drawResponse.error
        && /jackpot_carry_over|schema cache|column/i.test(String(drawResponse.error.message || ""))
      ) {
        drawResponse = await supabaseClient
          .from("draws")
          .insert({
            label: outcome.label,
            mode: outcome.mode,
            winning_numbers: outcome.winningNumbers,
            prize_pool: outcome.prizePool,
            draw_date: outcome.date,
          })
          .select("id")
          .single();
      }

      if (drawResponse.error) throw drawResponse.error;
      const drawRow = drawResponse.data;

      if (outcome.results.length) {
        let winnerResponse = await supabaseClient
          .from("winner_verifications")
          .insert(outcome.results.map((result) => ({
            draw_id: drawRow.id,
            user_id: result.userId,
            matches: result.matches,
            base_matches: result.baseMatches,
            weighted_boost: result.weightedBoost,
            score_weight: result.scoreWeight,
            payout: result.payout,
            verification_status: result.verificationStatus,
            payment_status: result.paymentStatus,
          })));

        if (
          winnerResponse.error
          && /base_matches|weighted_boost|score_weight|schema cache|column/i.test(String(winnerResponse.error.message || ""))
        ) {
          winnerResponse = await supabaseClient
            .from("winner_verifications")
            .insert(outcome.results.map((result) => ({
              draw_id: drawRow.id,
              user_id: result.userId,
              matches: result.matches,
              payout: result.payout,
              verification_status: result.verificationStatus,
              payment_status: result.paymentStatus,
            })));
        }

        if (winnerResponse.error) throw winnerResponse.error;
      }

      await loadAppData();
      render();
      form.reset();
      hydrateDrawForm();
      showToast(`Draw published with ${outcome.results.filter((entry) => entry.matches >= 3).length} qualifying winners.`);
      return;
    } catch (error) {
      const message = /schema cache|column/i.test(String(error.message || ""))
        ? "Draw publish failed because Supabase schema is still old. Run the latest schema SQL and refresh."
        : (error.message || "Draw publish failed.");
      updateAuthMessage(message);
      showToast(message);
      return;
    }
  }

  runDraw(payload, true);

  saveState();
  render();
  form.reset();
  hydrateDrawForm();
}

function runDraw({ mode, label, winningNumbers, date }, notify) {
  const outcome = buildDrawOutcome({ mode, label, winningNumbers, date });
  state.jackpotCarryOver = outcome.jackpotCarryOver;
  state.draws.push({
    id: crypto.randomUUID(),
    label: outcome.label,
    mode: outcome.mode,
    winningNumbers: outcome.winningNumbers,
    date: outcome.date,
    prizePool: outcome.prizePool,
    jackpotCarryOver: outcome.jackpotCarryOver,
    results: outcome.results,
  });

  if (notify) {
    const qualifyingCount = outcome.results.filter((entry) => entry.matches >= 3).length;
    showToast(`Draw published with ${qualifyingCount} qualifying winners.`);
  }
}

function buildDrawOutcome({ mode, label, winningNumbers, date }) {
  const prizePool = calculatePrizePool();
  const activeUsers = getActiveUsers();
  let nextJackpotCarryOver = state.jackpotCarryOver;
  const targetScore = Number(winningNumbers?.[0] || 0);

  if (!activeUsers.length) {
    return {
      label,
      mode,
      winningNumbers,
      date,
      prizePool,
      jackpotCarryOver: nextJackpotCarryOver,
      results: [],
    };
  }

  if (mode === "random") {
    const winnerIndex = Math.floor(Math.random() * activeUsers.length);
    const winnerId = activeUsers[winnerIndex]?.id;
    const results = activeUsers.map((user) => ({
      id: crypto.randomUUID(),
      userId: user.id,
      userName: user.name,
      baseMatches: user.id === winnerId ? 5 : 0,
      weightedBoost: 0,
      scoreWeight: 1,
      matches: user.id === winnerId ? 5 : 0,
      verificationStatus: "pending",
      paymentStatus: "pending",
      payout: user.id === winnerId ? prizePool : 0,
      date,
    }));

    nextJackpotCarryOver = 0;
    return {
      label,
      mode,
      winningNumbers: [],
      date,
      prizePool,
      jackpotCarryOver: nextJackpotCarryOver,
      results: results.sort((a, b) => b.matches - a.matches || a.userName.localeCompare(b.userName)),
    };
  }

  const resultDrafts = activeUsers.map((user) => {
    const recentScores = state.scores
      .filter((entry) => entry.userId === user.id)
      .sort(sortByDateDesc)
      .slice(0, 5);
    const closestScore = recentScores.length
      ? recentScores.reduce((best, entry) => {
          if (!best) return entry;
          const currentGap = Math.abs(entry.score - targetScore);
          const bestGap = Math.abs(best.score - targetScore);
          return currentGap < bestGap ? entry : best;
        }, null)
      : null;
    const difference = closestScore ? Math.abs(closestScore.score - targetScore) : 99;
    const matches = difference === 0 ? 5 : difference <= 1 ? 4 : difference <= 2 ? 3 : 0;
    return {
      id: crypto.randomUUID(),
      userId: user.id,
      userName: user.name,
      baseMatches: closestScore?.score ?? 0,
      weightedBoost: 0,
      scoreWeight: closestScore ? Math.max(1, 10 - difference) : 1,
      matches,
      verificationStatus: "pending",
      paymentStatus: "pending",
      payout: 0,
      date,
    };
  });

  prizePercentages.forEach((tier) => {
    const matchingResults = resultDrafts.filter((result) => result.matches === tier.matches);
    const tierAmount = roundMoney(prizePool * tier.percent);

    if (!matchingResults.length) {
      if (tier.jackpot) nextJackpotCarryOver += tierAmount;
      return;
    }

    const perWinner = roundMoney(tierAmount / matchingResults.length);
    matchingResults.forEach((result) => {
      result.payout = perWinner;
    });

    if (tier.jackpot) nextJackpotCarryOver = 0;
  });

  return {
    label,
    mode,
    winningNumbers,
    date,
    prizePool,
    jackpotCarryOver: nextJackpotCarryOver,
    results: resultDrafts.sort((a, b) => b.matches - a.matches || a.userName.localeCompare(b.userName)),
  };
}

async function handleUserTableClick(event) {
  const button = event.target.closest("button[data-action='toggle-status']");
  if (!button) return;

  const user = state.users.find((entry) => entry.id === button.dataset.userId);
  if (!user) return;

  if (supabaseClient && state.session?.role === "admin" && user.subscriptionId) {
    try {
      const nextStatus = user.status === "active" ? "inactive" : "active";
      const payload = { status: nextStatus };
      if (nextStatus === "active") {
        payload.ends_at = addDays(new Date().toISOString().slice(0, 10), planConfig[user.plan].durationDays);
      }

      const { error } = await supabaseClient
        .from("subscriptions")
        .update(payload)
        .eq("id", user.subscriptionId);
      if (error) throw error;

      await loadAppData();
      render();
      showToast(`${user.name} is now ${nextStatus}.`);
      return;
    } catch (error) {
      updateAuthMessage(error.message || "Subscription status update failed.");
      showToast(error.message || "Subscription status update failed.");
      return;
    }
  }

  user.status = user.status === "active" ? "inactive" : "active";
  if (user.status === "active") {
    user.endsAt = addDays(new Date().toISOString().slice(0, 10), planConfig[user.plan].durationDays);
  }
  saveState();
  render();
  showToast(`${user.name} is now ${user.status}.`);
}

async function handleWinnerTableClick(event) {
  const button = event.target.closest("button[data-action='toggle-payment']");
  if (!button) return;

  const draw = state.draws.find((entry) => entry.id === button.dataset.drawId);
  const winner = draw?.results.find((entry) => entry.userId === button.dataset.userId);
  if (!winner) return;

  if (supabaseClient && state.session?.role === "admin" && winner.id) {
    try {
      const verificationStatus = winner.verificationStatus === "verified" ? "pending" : "verified";
      const paymentStatus = winner.paymentStatus === "paid" ? "pending" : "paid";
      const { error } = await supabaseClient
        .from("winner_verifications")
        .update({
          verification_status: verificationStatus,
          payment_status: paymentStatus,
        })
        .eq("id", winner.id);
      if (error) throw error;

      await loadAppData();
      render();
      showToast(`${winner.userName} payment status updated to ${paymentStatus}.`);
      return;
    } catch (error) {
      updateAuthMessage(error.message || "Winner update failed.");
      showToast(error.message || "Winner update failed.");
      return;
    }
  }

  winner.verificationStatus = winner.verificationStatus === "verified" ? "pending" : "verified";
  winner.paymentStatus = winner.paymentStatus === "paid" ? "pending" : "paid";
  saveState();
  render();
  showToast(`${winner.userName} payment status updated to ${winner.paymentStatus}.`);
}

function calculatePrizePool() {
  const basePool = getActiveUsers().reduce((sum, user) => sum + (user.fee * 0.25), 0);
  return roundMoney(basePool + state.jackpotCarryOver);
}

function calculateCharityTotal() {
  return roundMoney(state.users.reduce((sum, user) => sum + (user.fee * (user.contributionPercent / 100)), 0));
}

function getActiveUsers() {
  return state.users.filter((user) => user.status === "active");
}

function getNextDrawDate() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function parseNumbers(rawValue) {
  const values = String(rawValue)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item));

  if (values.length !== 5 || new Set(values).size !== 5 || values.some((value) => value < 1 || value > 25)) {
    return null;
  }

  return values.sort((a, b) => a - b);
}

function generateDrawNumbers() {
  const values = new Set();
  while (values.size < 5) {
    values.add(Math.floor(Math.random() * 25) + 1);
  }
  return [...values].sort((a, b) => a - b);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function sortByDateDesc(a, b) {
  return new Date(b.date) - new Date(a.date);
}

function sortByDateAsc(a, b) {
  return new Date(a.date) - new Date(b.date);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2600);
}

function switchPanel(panelId) {
  if (panelId === "adminPanel" && state.session?.role !== "admin") {
    showToast("Administrator login required for this view.");
    return;
  }

  if (panelId === "subscriberPanel" && !["subscriber", "admin"].includes(state.session?.role || "")) {
    showToast("Login or sign up as a subscriber to open this view.");
    return;
  }

  state.currentMode = panelId === "adminPanel"
    ? "admin"
    : panelId === "subscriberPanel"
      ? "subscriber"
      : "public";
  els.panelTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.panel === panelId));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
  updateModeLabel();
}

function updateModeLabel() {
  const labels = {
    public: "Public Visitor",
    subscriber: "Registered Subscriber",
    admin: "Administrator",
  };
  els.activeModeLabel.textContent = labels[state.currentMode] || "Public Visitor";
}

function applyCurrentMode() {
  const panelId = state.currentMode === "admin"
    ? "adminPanel"
    : state.currentMode === "subscriber"
      ? "subscriberPanel"
      : "publicPanel";

  els.panelTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.panel === panelId));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
  updateModeLabel();
}

function titleCase(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
