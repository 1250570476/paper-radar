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

function setMode(nextMode) {
  mode = nextMode;
  const signingUp = mode === "signup";
  signupTab.classList.toggle("active", signingUp);
  signinTab.classList.toggle("active", !signingUp);
  signupTab.setAttribute("aria-selected", String(signingUp));
  signinTab.setAttribute("aria-selected", String(!signingUp));
  document.querySelector("#account-title").textContent = signingUp ? "Create your PaperFlare account" : "Sign in to PaperFlare";
  document.querySelector("#account-intro").textContent = signingUp ? "Save your research setup and choose how often you want relevant new-paper alerts." : "Continue to your personalized research feed and alert settings.";
  document.querySelector("#auth-submit").textContent = signingUp ? "Create account" : "Sign in";
  document.querySelector("#alert-frequency-field").classList.toggle("hidden", !signingUp);
  document.querySelector("#auth-password").autocomplete = signingUp ? "new-password" : "current-password";
  setStatus("");
}

function saveSession(nextSession) {
  session = nextSession;
  if (nextSession) sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  else sessionStorage.removeItem(SESSION_KEY);
  updateAccountView();
}

function updateAccountView() {
  const user = session?.user;
  authForms.classList.toggle("hidden", Boolean(user));
  accountPanel.classList.toggle("hidden", !user);
  accountButton.textContent = user ? "My account" : "Create account";
  if (!user) return;
  document.querySelector("#account-email").textContent = user.email || "Signed in";
  const preference = user.user_metadata?.alert_frequency || "daily";
  document.querySelector("#account-frequency").textContent = ({ instant: "As soon as possible", daily: "Daily digest", weekly: "Weekly digest" })[preference] || "Daily digest";
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

async function submitAuth(event) {
  event.preventDefault();
  if (!isConfigured()) {
    setStatus("Account registration is ready in the website, but the Supabase project still needs to be connected before sign-up can go live.", "warning");
    return;
  }
  const email = document.querySelector("#auth-email").value.trim();
  const password = document.querySelector("#auth-password").value;
  const button = document.querySelector("#auth-submit");
  button.disabled = true;
  setStatus(mode === "signup" ? "Creating your account…" : "Signing you in…");
  try {
    const data = mode === "signup"
      ? await authRequest(`/signup?redirect_to=${encodeURIComponent(authRedirectUrl)}`, { email, password, data: { alert_frequency: document.querySelector("#alert-frequency").value } })
      : await authRequest("/token?grant_type=password", { email, password });
    if (data.access_token) {
      saveSession(data);
    } else {
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
  if (!accessToken || !isConfigured()) return;

  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`
      }
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
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    setMode("signin");
    setStatus("Email confirmed. You are now signed in.", "success");
    openAccount();
  } catch (error) {
    setMode("signin");
    setStatus(`${error.message} Please sign in with your email and password.`, "warning");
    openAccount();
  }
}

function openAccount() {
  updateAccountView();
  if (!dialog.open) dialog.showModal();
}

accountButton.addEventListener("click", openAccount);
document.querySelectorAll("[data-open-account]").forEach(button => button.addEventListener("click", openAccount));
document.querySelector("#close-account").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
signupTab.addEventListener("click", () => setMode("signup"));
signinTab.addEventListener("click", () => setMode("signin"));
form.addEventListener("submit", submitAuth);
document.querySelector("#signout-button").addEventListener("click", async () => {
  try { if (isConfigured() && session?.access_token) await authRequest("/logout", null, session.access_token); }
  catch (error) { console.warn("Remote sign-out failed; clearing the local session.", error); }
  saveSession(null);
  dialog.close();
});

setMode("signup");
updateAccountView();
restoreConfirmationSession();
