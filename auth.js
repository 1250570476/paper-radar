const config = window.PAPERFLARE_CONFIG || {};
const SESSION_KEY = "paperflare-auth-session";
const dialog = document.querySelector("#account-dialog");
const authForms = document.querySelector("#auth-forms");
const accountPanel = document.querySelector("#account-panel");
const form = document.querySelector("#auth-form");
const status = document.querySelector("#auth-status");
const signupTab = document.querySelector("#signup-tab");
const signinTab = document.querySelector("#signin-tab");
const accountButton = document.querySelector("#account-button");
const authRedirectUrl = new URL("./", window.location.href).href;
let mode = "signup";
let session = readSession();
let profileExists = null;
const normalizeFrequency = value => value === "weekly" ? "weekly" : "daily";

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
  catch { sessionStorage.removeItem(SESSION_KEY); return null; }
}

function isConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || "") && Boolean(config.supabaseAnonKey);
}

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `auth-status ${kind}`.trim();
}

function setAccountStatus(message, kind = "") {
  const accountStatus = document.querySelector("#account-settings-status");
  accountStatus.textContent = message;
  accountStatus.className = `auth-status ${kind}`.trim();
}

function setMode(nextMode) {
  mode = nextMode;
  const signingUp = mode === "signup";
  signupTab.classList.toggle("active", signingUp);
  signinTab.classList.toggle("active", !signingUp);
  signupTab.setAttribute("aria-selected", String(signingUp));
  signinTab.setAttribute("aria-selected", String(!signingUp));
  document.querySelector("#account-title").textContent = signingUp ? "Create your CatchPapers account" : "Sign in to CatchPapers";
  document.querySelector("#account-intro").textContent = signingUp ? "Save your research setup and receive relevant new-paper alerts." : "Continue to your personalized research feed and alert settings.";
  document.querySelector("#auth-submit").textContent = signingUp ? "Create account" : "Sign in";
  document.querySelector("#alert-frequency-field").classList.toggle("hidden", !signingUp);
  document.querySelector("#auth-password").autocomplete = signingUp ? "new-password" : "current-password";
  setStatus("");
}

function saveSession(nextSession) {
  const previousUserId = session?.user?.id;
  session = nextSession;
  if (!nextSession || previousUserId !== nextSession.user?.id) profileExists = null;
  if (nextSession) sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  else sessionStorage.removeItem(SESSION_KEY);
  updateAccountView();
  window.dispatchEvent(new CustomEvent("paperflare:session", { detail: { session } }));
}

async function authRequest(path, body, accessToken = "") {
  const response = await fetch(`${config.supabaseUrl}/auth/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${accessToken || config.supabaseAnonKey}`
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || "Account request failed.");
  return data;
}

async function validSession() {
  if (!session?.access_token) return null;
  const expiresAt = Number(session.expires_at || 0) * 1000;
  if (!expiresAt || expiresAt > Date.now() + 60_000) return session;
  if (!session.refresh_token) {
    saveSession(null);
    return null;
  }
  try {
    const refreshed = await authRequest("/token?grant_type=refresh_token", { refresh_token: session.refresh_token });
    saveSession(refreshed);
    return refreshed;
  } catch {
    saveSession(null);
    return null;
  }
}

async function restRequest(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const active = await validSession();
  if (!active) throw new Error("Please sign in to sync your CatchPapers profile.");
  const response = await fetch(`${config.supabaseUrl}/rest/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${active.access_token}`,
      Prefer: prefer
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || "CatchPapers could not sync your account data.");
  return data;
}

async function loadCloudProfile() {
  const active = await validSession();
  if (!active?.user?.id) return null;
  const rows = await restRequest(`/profiles?user_id=eq.${encodeURIComponent(active.user.id)}&select=*`);
  profileExists = Boolean(rows?.[0]);
  return rows?.[0] || null;
}

async function saveCloudProfile(profile) {
  const active = await validSession();
  if (!active?.user?.id) return null;
  const payload = {
    user_id: active.user.id,
    interests: String(profile.interests || "").slice(0, 12000),
    excluded: String(profile.excluded || "").slice(0, 3000),
    favorite_journal_ids: [...new Set(profile.favorite_journal_ids || [])].slice(0, 500),
    saved_paper_ids: [...new Set(profile.saved_paper_ids || [])].slice(0, 1000)
  };
  if (profileExists === null) await loadCloudProfile();
  if (!profileExists) payload.alert_frequency = normalizeFrequency(active.user.user_metadata?.alert_frequency);
  const rows = await restRequest("/profiles?on_conflict=user_id", {
    method: "POST", body: payload, prefer: "resolution=merge-duplicates,return=representation"
  });
  profileExists = true;
  return rows?.[0] || null;
}

async function loadAccountSettings() {
  try {
    const profile = await loadCloudProfile();
    const fallback = normalizeFrequency(session?.user?.user_metadata?.alert_frequency);
    const frequency = normalizeFrequency(profile?.alert_frequency || fallback);
    document.querySelector("#account-alert-frequency").value = frequency;
    document.querySelector("#account-alerts-enabled").checked = profile?.alerts_enabled ?? true;
    updateFrequencyLabel(frequency, profile?.alerts_enabled ?? true);
  } catch (error) {
    setAccountStatus(error.message, "warning");
  }
}

function updateFrequencyLabel(frequency, enabled = true) {
  document.querySelector("#account-frequency").textContent = enabled
    ? ({ daily: "Daily digest", weekly: "Weekly digest" })[frequency] || "Daily digest"
    : "Paused";
}

function updateAccountView() {
  const user = session?.user;
  authForms.classList.toggle("hidden", Boolean(user));
  accountPanel.classList.toggle("hidden", !user);
  accountButton.textContent = user ? "My account" : "Create account";
  if (!user) return;
  document.querySelector("#account-email").textContent = user.email || "Signed in";
  updateFrequencyLabel(normalizeFrequency(user.user_metadata?.alert_frequency));
}

async function submitAuth(event) {
  event.preventDefault();
  if (!isConfigured()) {
    setStatus("Account registration is not connected yet.", "warning");
    return;
  }
  const email = document.querySelector("#auth-email").value.trim();
  const password = document.querySelector("#auth-password").value;
  const button = document.querySelector("#auth-submit");
  button.disabled = true;
  setStatus(mode === "signup" ? "Creating your account…" : "Signing you in…");
  try {
    const frequency = document.querySelector("#alert-frequency").value;
    const data = mode === "signup"
      ? await authRequest(`/signup?redirect_to=${encodeURIComponent(authRedirectUrl)}`, { email, password, data: { alert_frequency: frequency } })
      : await authRequest("/token?grant_type=password", { email, password });
    if (data.access_token) {
      const completedMode = mode;
      saveSession(data);
      await loadAccountSettings();
      window.paperFlareTrack?.(completedMode === "signup" ? "sign_up" : "login", { method: "email" });
    } else {
      window.paperFlareTrack?.("sign_up_submitted", { method: "email" });
      setMode("signin");
      setStatus("Account created. Check your inbox and confirm your email before signing in.", "success");
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function restoreConfirmationSession() {
  const callback = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = callback.get("access_token");
  if (!accessToken || !isConfigured()) return false;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${accessToken}` }
    });
    const user = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(user.msg || user.message || "The confirmation session could not be restored.");
    saveSession({
      access_token: accessToken,
      refresh_token: callback.get("refresh_token") || "",
      expires_at: Number(callback.get("expires_at")) || null,
      expires_in: Number(callback.get("expires_in")) || null,
      token_type: callback.get("token_type") || "bearer",
      user
    });
    window.paperFlareTrack?.("sign_up", { method: "email_confirmation" });
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    setMode("signin");
    setStatus("Email confirmed. Your profile can now sync across devices.", "success");
    openAccount();
    await loadAccountSettings();
    return true;
  } catch (error) {
    setMode("signin");
    setStatus(`${error.message} Please sign in with your email and password.`, "warning");
    openAccount();
    return false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const button = document.querySelector("#save-account-settings");
  button.disabled = true;
  setAccountStatus("Saving…");
  try {
    const active = await validSession();
    const frequency = document.querySelector("#account-alert-frequency").value;
    const enabled = document.querySelector("#account-alerts-enabled").checked;
    const existing = await loadCloudProfile();
    if (existing) {
      await restRequest(`/profiles?user_id=eq.${encodeURIComponent(active.user.id)}`, {
        method: "PATCH", body: { alert_frequency: frequency, alerts_enabled: enabled }
      });
    } else {
      await restRequest("/profiles?on_conflict=user_id", {
        method: "POST", body: { user_id: active.user.id, alert_frequency: frequency, alerts_enabled: enabled },
        prefer: "resolution=merge-duplicates,return=representation"
      });
      profileExists = true;
    }
    updateFrequencyLabel(frequency, enabled);
    setAccountStatus("Alert settings saved.", "success");
    window.paperFlareTrack?.("alert_settings_saved");
  } catch (error) {
    setAccountStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function deleteAccount() {
  if (!window.confirm("Permanently delete your CatchPapers account, profile, saved papers, and alert history? This cannot be undone.")) return;
  const button = document.querySelector("#delete-account-button");
  button.disabled = true;
  setAccountStatus("Deleting your account…");
  try {
    await restRequest("/rpc/delete_own_account", { method: "POST", body: {} });
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("paper-radar-profile-v2");
    localStorage.removeItem("paper-radar-profile-v1");
    localStorage.removeItem("paper-radar-saved");
    session = null;
    window.location.reload();
  } catch (error) {
    setAccountStatus(error.message, "error");
    button.disabled = false;
  }
}

function openAccount() {
  updateAccountView();
  if (session?.user) loadAccountSettings();
  if (!dialog.open) dialog.showModal();
}

async function handleUnsubscribeLink() {
  const token = new URL(window.location.href).searchParams.get("unsubscribe");
  if (!token || !isConfigured()) return;
  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/unsubscribe_alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` },
      body: JSON.stringify({ token })
    });
    if (!response.ok) throw new Error("This unsubscribe link could not be applied.");
    window.history.replaceState({}, document.title, window.location.pathname);
    setMode("signin");
    setStatus("Email alerts have been paused. You can sign in any time to enable them again.", "success");
    openAccount();
  } catch (error) {
    setMode("signin");
    setStatus(error.message, "error");
    openAccount();
  }
}

accountButton.addEventListener("click", openAccount);
document.querySelectorAll("[data-open-account]").forEach(button => button.addEventListener("click", openAccount));
document.querySelector("#close-account").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
signupTab.addEventListener("click", () => setMode("signup"));
signinTab.addEventListener("click", () => setMode("signin"));
form.addEventListener("submit", submitAuth);
document.querySelector("#account-settings-form").addEventListener("submit", saveSettings);
document.querySelector("#delete-account-button").addEventListener("click", deleteAccount);
document.querySelector("#signout-button").addEventListener("click", async () => {
  try { if (isConfigured() && session?.access_token) await authRequest("/logout", null, session.access_token); }
  catch (error) { console.warn("Remote sign-out failed; clearing the local session.", error); }
  saveSession(null);
  dialog.close();
});

window.paperFlareAuth = {
  getSession: () => session,
  loadProfile: loadCloudProfile,
  saveProfile: saveCloudProfile,
  isSignedIn: () => Boolean(session?.user)
};

setMode("signup");
updateAccountView();
await handleUnsubscribeLink();
const restored = await restoreConfirmationSession();
if (!restored && session) {
  const active = await validSession();
  if (active) window.dispatchEvent(new CustomEvent("paperflare:session", { detail: { session: active } }));
}
