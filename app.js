const STORAGE_KEY = "paper-radar-profile-v2";
const LEGACY_KEY = "paper-radar-profile-v1";
const DAY = 864e5;

const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
const state = {
  profile: JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {
    cvText: legacy?.cvText || "",
    interests: legacy?.interests || "",
    excluded: legacy?.excluded || "",
    favoriteJournals: []
  },
  saved: new Set(JSON.parse(localStorage.getItem("paper-radar-saved") || "[]")),
  journals: [],
  papers: [],
  generatedAt: null,
  latestByJournal: {}
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
}[character]));
const clean = value => String(value || "").toLowerCase().replace(/[^a-z0-9+ -]/g, " ").replace(/\s+/g, " ").trim();
const normalizeTitle = value => clean(value).replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
const journalId = journal => journal?.id || normalizeTitle(journal?.title || journal?.display_name || "").replace(/\s+/g, "-");
const formatDate = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Not checked";

const stopWords = new Set(["the", "and", "for", "with", "from", "into", "using", "use", "based", "study", "studies", "effect", "effects", "development", "design", "analysis", "novel", "approach", "applications", "application", "research", "system", "systems", "method", "methods", "results", "their", "our", "this", "that", "are", "was", "were", "have", "has", "its", "can", "may", "university", "engineering", "mechanical", "present", "student", "grade", "author", "publications", "experience", "skills"]);
const conceptFamilies = [
  { label: "micro/millirobots", terms: ["microrobot", "microrobots", "microrobotic", "millirobot", "millirobots", "microswimmer", "microswimmers", "microbot", "micromachine", "micromachines", "untethered robot", "medical robot"] },
  { label: "soft robotics", terms: ["soft robot", "soft robots", "soft robotic", "hydrogel robot", "continuum robot", "shape morphing", "shape-morphing", "bioinspired robot"] },
  { label: "magnetic actuation", terms: ["magnetic actuation", "magnetically actuated", "magnetic robot", "magnetic microrobot", "microroller", "rotating magnetic field", "janus microrobot"] },
  { label: "ultrasound/acoustics", terms: ["ultrasound", "ultrasonic", "acoustic actuation", "acoustically actuated", "focused ultrasound", "acoustic streaming", "acoustofluidic", "acoustofluidics"] },
  { label: "neuromodulation", terms: ["neuromodulation", "neurostimulation", "neural stimulation", "nerve stimulation", "peripheral nerve", "bioelectronic medicine"] },
  { label: "hydrogels", terms: ["hydrogel", "hydrogels", "alginate", "soft biomaterial", "biodegradable particle", "injectable biomaterial"] },
  { label: "piezoelectric materials", terms: ["piezoelectric", "piezoelectricity", "barium titanate", "batio3", "piezoelectric nanoparticle"] },
  { label: "iontronics", terms: ["iontronic", "iontronics", "ionotronic", "ionotronics", "ionic device", "ionic transistor", "ionic sensor", "ionic actuator", "ion transport"] },
  { label: "microfluidics", terms: ["microfluidic", "microfluidics", "lab on a chip", "lab-on-a-chip", "droplet microfluidics", "flow focusing", "microchannel", "organ on a chip", "microphysiological system"] },
  { label: "particle/cell separation", terms: ["particle separation", "cell separation", "deterministic lateral displacement", "inertial microfluidics", "circulating tumor cell"] },
  { label: "biomaterials", terms: ["biomaterial", "biomaterials", "tissue engineering", "scaffold", "regenerative medicine"] },
  { label: "micro/nanofabrication", terms: ["microfabrication", "nanofabrication", "two photon polymerization", "soft lithography", "3d printing"] }
];

function hasExact(text, value) {
  return (` ${clean(text)} `).includes(` ${clean(value)} `);
}

function frequentTerms(text, limit = 25) {
  const words = (clean(text).match(/[a-z][a-z0-9-]{2,}/g) || []).filter(word => word.length > 3 && !stopWords.has(word));
  const counts = {};
  words.forEach(word => { counts[word] = (counts[word] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}

function profileModel() {
  const interests = clean(state.profile.interests);
  const cv = clean((state.profile.cvText || "").slice(0, 30000));
  const explicitTerms = frequentTerms(interests, 30);
  const activeFamilies = conceptFamilies.filter(family => family.terms.some(term => hasExact(`${interests} ${cv}`, term))).map(family => ({
    ...family,
    priority: family.terms.some(term => hasExact(interests, term)) ? 3 : 1
  }));
  return { interests, explicitTerms, activeFamilies };
}

function scorePaper(paper, model) {
  const title = clean(paper.title);
  const abstract = clean(paper.abstract || paper.summary);
  const text = `${title} ${abstract}`;
  const excluded = String(state.profile.excluded || "").split(/[,;\n]/).map(clean).filter(Boolean);
  if (excluded.some(term => hasExact(text, term))) return null;

  let raw = 0;
  let titleSignals = 0;
  let familyHits = 0;
  let explicitHits = 0;
  const evidence = [];

  model.activeFamilies.forEach(family => {
    const titleTerms = family.terms.filter(term => hasExact(title, term));
    const abstractTerms = family.terms.filter(term => hasExact(abstract, term));
    if (!titleTerms.length && !abstractTerms.length) return;
    const points = family.priority * (titleTerms.length ? 8 : 3) + Math.min(5, titleTerms.length + abstractTerms.length - 1);
    raw += points;
    familyHits += 1;
    if (titleTerms.length) titleSignals += 1;
    evidence.push({ value: family.label, points });
  });

  model.explicitTerms.forEach(term => {
    const inTitle = hasExact(title, term);
    const inAbstract = hasExact(abstract, term);
    if (!inTitle && !inAbstract) return;
    const points = inTitle ? 7 : 2;
    raw += points;
    explicitHits += 1;
    if (inTitle) titleSignals += 1;
    evidence.push({ value: term, points });
  });

  const strong = raw >= 25 && (titleSignals >= 1 || familyHits >= 2) && (familyHits >= 2 || explicitHits >= 2);
  const candidate = !strong && raw >= 13 && (titleSignals >= 1 || familyHits >= 2) && (familyHits >= 1 || explicitHits >= 2);
  if (!strong && !candidate) return null;
  const hits = evidence.sort((a, b) => b.points - a.points).filter((item, index, list) => list.findIndex(other => other.value === item.value) === index).slice(0, 5).map(item => item.value);
  return {
    tier: strong ? "strong" : "candidate",
    value: strong ? Math.min(98, 80 + Math.round((raw - 25) * 0.8)) : Math.min(79, 45 + Math.round((raw - 13) * 2)),
    hits,
    explanation: `${familyHits} research concept${familyHits === 1 ? "" : "s"} and ${explicitHits} explicit interest term${explicitHits === 1 ? "" : "s"}`
  };
}

function saveProfile() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
}

async function loadPublisherData(force = false) {
  const suffix = force ? `?t=${Date.now()}` : "";
  const [journalsResponse, papersResponse] = await Promise.all([
    fetch(`data/journals.json${suffix}`),
    fetch(`data/papers.json${suffix}`)
  ]);
  if (!journalsResponse.ok || !papersResponse.ok) throw new Error("Publisher data is unavailable");
  state.journals = await journalsResponse.json();
  const snapshot = await papersResponse.json();
  state.papers = snapshot.papers || [];
  state.generatedAt = snapshot.generated_at || null;
  state.latestByJournal = snapshot.latest_by_journal || {};
  migrateFavorites();
}

function migrateFavorites() {
  const names = new Set((state.profile.favoriteJournals || []).map(item => normalizeTitle(item.title || item.display_name)));
  state.profile.favoriteJournals = state.journals.filter(journal => names.has(normalizeTitle(journal.title)));
  saveProfile();
}

function showView(name) {
  $$(".view").forEach(view => view.classList.toggle("hidden", view.id !== `${name}-view`));
  $$(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  if (name === "journals") renderFavorites();
}

$$(".nav-button").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
$$("[data-go-profile]").forEach(button => button.addEventListener("click", () => showView("profile")));
$$("[data-go-journals]").forEach(button => button.addEventListener("click", () => showView("journals")));

function populateProfile() {
  $("#cv-text").value = state.profile.cvText;
  $("#interests").value = state.profile.interests;
  $("#excluded").value = state.profile.excluded;
  updateFavoriteSummaries();
}

function updateFavoriteSummaries() {
  const count = state.profile.favoriteJournals.length;
  $("#favorites-count").textContent = `${count} journal${count === 1 ? "" : "s"} selected`;
  $("#profile-journal-summary").textContent = count ? `${count} favorite journal${count === 1 ? "" : "s"} will restrict your feed.` : "No favorites yet; search will use every supported journal.";
  $("#journal-warning").classList.toggle("hidden", count > 0);
}

function journalCard(journal, { favorite = false } = {}) {
  const latest = state.latestByJournal[journal.id];
  return `<article class="journal-card"><div><div class="journal-type">${escapeHtml(journal.publisher || "Publisher website")}</div><h3>${escapeHtml(journal.title)}</h3><p>${escapeHtml(journal.frequency || "Checked daily")} · Direct publisher source</p><small>${latest ? `Latest publisher item: ${escapeHtml(formatDate(latest))}` : "Awaiting first publisher-page update"}</small></div><button class="${favorite ? "remove-journal secondary" : "add-favorite primary"}" data-id="${escapeHtml(journal.id)}">${favorite ? "Remove" : "Add to favorites"}</button></article>`;
}

function bindJournalButtons(container, journals) {
  container.querySelectorAll(".add-favorite").forEach(button => button.addEventListener("click", () => {
    const journal = journals.find(item => item.id === button.dataset.id);
    if (journal && !state.profile.favoriteJournals.some(item => item.id === journal.id)) {
      state.profile.favoriteJournals.push(journal);
      saveProfile();
      renderFavorites();
      searchJournals();
    }
  }));
  container.querySelectorAll(".remove-journal").forEach(button => button.addEventListener("click", () => {
    state.profile.favoriteJournals = state.profile.favoriteJournals.filter(item => item.id !== button.dataset.id);
    saveProfile();
    renderFavorites();
  }));
}

function renderFavorites() {
  const box = $("#favorite-journals");
  const favorites = state.profile.favoriteJournals;
  box.innerHTML = favorites.length ? favorites.map(journal => journalCard(journal, { favorite: true })).join("") : `<div class="empty compact"><h3>No favorite journals yet</h3><p>Search above and add journals to make your feed journal-specific.</p></div>`;
  bindJournalButtons(box, favorites);
  updateFavoriteSummaries();
  $("#last-checked").textContent = state.generatedAt ? `Publisher pages updated: ${formatDate(state.generatedAt)}` : "Publisher pages have not been indexed yet";
}

function searchJournals() {
  const query = clean($("#journal-search").value);
  const results = query ? state.journals.filter(journal => clean(`${journal.title} ${journal.publisher} ${journal.issn || ""}`).includes(query)) : state.journals;
  $("#journal-results").innerHTML = results.length ? results.map(journal => journalCard(journal, { favorite: state.profile.favoriteJournals.some(item => item.id === journal.id) })).join("") : `<div class="empty compact"><h3>No supported journal found</h3><p>Try a shorter journal title.</p></div>`;
  bindJournalButtons($("#journal-results"), results);
  $("#journal-search-status").textContent = `${results.length} direct publisher source${results.length === 1 ? "" : "s"}`;
}

$("#journal-search-button").addEventListener("click", searchJournals);
$("#journal-search").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); searchJournals(); }
});

async function extractPdf(file) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    text += `${content.items.map(item => item.str).join(" ")}\n`;
  }
  return text;
}

$("#cv-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  $("#file-label").textContent = `Reading ${file.name}…`;
  try {
    $("#cv-text").value = file.type === "application/pdf" || file.name.endsWith(".pdf") ? await extractPdf(file) : await file.text();
    $("#file-label").textContent = file.name;
  } catch (error) {
    $("#file-label").textContent = "Could not extract this file. Paste its text below.";
    console.error(error);
  }
});

$("#profile-form").addEventListener("submit", event => {
  event.preventDefault();
  state.profile.cvText = $("#cv-text").value.trim();
  state.profile.interests = $("#interests").value.trim();
  state.profile.excluded = $("#excluded").value.trim();
  saveProfile();
  $("#save-status").textContent = "Profile saved locally";
  setTimeout(() => { $("#save-status").textContent = ""; }, 1800);
  showView("feed");
  $("#feed-status").textContent = "Profile saved. Press Search papers when you are ready.";
});

function openScan() {
  $("#search-progress").classList.remove("hidden", "minimized");
  $(".scan-body").classList.remove("hidden");
  $("#expand-scan").classList.add("hidden");
  updateScan({ progress: 2, current: "Preparing selected journals", candidates: 0, matches: 0 });
}

function updateScan({ progress, current, candidates, matches }) {
  if (progress != null) {
    const value = Math.max(2, Math.min(100, Math.round(progress)));
    $("#scan-progress-bar").style.width = `${value}%`;
    $("#scan-percent").textContent = `${value}%`;
    $("#scan-mini-percent").textContent = `${value}%`;
  }
  if (current) {
    $("#scan-current-value").textContent = current;
    $("#scan-mini-text").textContent = current;
  }
  if (candidates != null) $("#scan-candidates").textContent = Number(candidates).toLocaleString();
  if (matches != null) $("#scan-matches").textContent = Number(matches).toLocaleString();
}

function closeScan() {
  updateScan({ progress: 100, current: "Search complete" });
  setTimeout(() => $("#search-progress").classList.add("hidden"), 900);
}

$("#minimize-scan").addEventListener("click", () => {
  $("#search-progress").classList.add("minimized");
  $(".scan-body").classList.add("hidden");
  $("#expand-scan").classList.remove("hidden");
});
$("#expand-scan").addEventListener("click", () => {
  $("#search-progress").classList.remove("minimized");
  $(".scan-body").classList.remove("hidden");
  $("#expand-scan").classList.add("hidden");
});

function renderPapers(ranked) {
  $("#paper-list").innerHTML = ranked.map(({ paper, score }) => {
    const summary = paper.abstract || paper.summary || "Open the publisher page to read the abstract.";
    return `<article class="paper-card"><div class="score" style="--score:${score.value}"><strong>${score.value}</strong><small>RELEVANCE</small></div><div><div class="paper-meta">${escapeHtml(paper.journal)} · ${escapeHtml(paper.published || "New")}</div><h3>${escapeHtml(paper.title)}</h3><p>${escapeHtml(summary.slice(0, 520))}</p><div class="why"><strong>Why it matches:</strong> ${escapeHtml(score.explanation)} · ${score.hits.map(escapeHtml).join(", ")}</div></div><div class="paper-actions"><button class="icon-button save-paper" data-id="${escapeHtml(paper.id)}" title="Save paper">${state.saved.has(paper.id) ? "★" : "☆"}</button><a class="icon-button" href="${escapeHtml(paper.url)}" target="_blank" rel="noreferrer" title="Open publisher page">↗</a></div></article>`;
  }).join("");

  $("#empty-state").classList.toggle("hidden", ranked.length > 0);
  $("#empty-state h3").textContent = "No relevant papers found";
  $("#empty-state p").textContent = "Try a longer time window, more journals, or broader research interests.";
  $("#empty-state button").textContent = "Adjust my profile";
  const strongCount = ranked.filter(item => item.score.tier === "strong").length;
  $("#feed-status").textContent = ranked.length ? `${ranked.length} relevant match${ranked.length === 1 ? "" : "es"} found (${strongCount} strong) from direct publisher data.` : "No papers passed the relevance threshold.";
  $$(".save-paper").forEach(button => button.addEventListener("click", () => {
    state.saved.has(button.dataset.id) ? state.saved.delete(button.dataset.id) : state.saved.add(button.dataset.id);
    localStorage.setItem("paper-radar-saved", JSON.stringify([...state.saved]));
    button.textContent = state.saved.has(button.dataset.id) ? "★" : "☆";
  }));
}

let searchInFlight = false;
async function searchPapers() {
  if (searchInFlight) return;
  if (!state.profile.interests) {
    $("#profile-warning").classList.remove("hidden");
    return;
  }
  searchInFlight = true;
  $("#profile-warning").classList.add("hidden");
  $("#refresh-button").disabled = true;
  openScan();
  try {
    const days = Number($("#days-select").value);
    const cutoff = Date.now() - days * DAY;
    const favorites = state.profile.favoriteJournals.length ? state.profile.favoriteJournals : state.journals;
    const favoriteIds = new Set(favorites.map(journal => journal.id));
    const model = profileModel();
    const candidates = [];
    let matches = 0;

    for (let index = 0; index < favorites.length; index += 1) {
      const journal = favorites[index];
      const journalPapers = state.papers.filter(paper => paper.journal_id === journal.id && new Date(paper.published).getTime() >= cutoff);
      candidates.push(...journalPapers);
      matches = candidates.filter(paper => scorePaper(paper, model)).length;
      updateScan({ progress: 5 + (index + 1) * 85 / favorites.length, current: journal.title, candidates: candidates.length, matches });
      await wait(70);
    }

    const unique = [...new Map(candidates.filter(paper => favoriteIds.has(paper.journal_id)).map(paper => [paper.doi || paper.url || paper.id, paper])).values()];
    const ranked = unique.map(paper => ({ paper, score: scorePaper(paper, model) })).filter(item => item.score).sort((a, b) => (a.score.tier === "strong" ? 0 : 1) - (b.score.tier === "strong" ? 0 : 1) || b.score.value - a.score.value || String(b.paper.published).localeCompare(String(a.paper.published))).slice(0, 40);
    updateScan({ progress: 96, current: "Ranking matches", candidates: unique.length, matches: ranked.length });
    renderPapers(ranked);
    closeScan();
  } catch (error) {
    $("#feed-status").textContent = "Publisher data could not be loaded. Try again shortly.";
    $("#search-progress").classList.add("hidden");
    console.error(error);
  } finally {
    searchInFlight = false;
    $("#refresh-button").disabled = false;
  }
}

$("#refresh-button").addEventListener("click", searchPapers);
$("#days-select").addEventListener("change", () => {
  $("#feed-status").textContent = "Time window changed. Press Search papers to update the feed.";
});
$("#check-journals-button").addEventListener("click", async () => {
  $("#check-journals-button").disabled = true;
  $("#last-checked").textContent = "Reloading the latest publisher snapshot…";
  try {
    await loadPublisherData(true);
    renderFavorites();
    $("#feed-status").textContent = "Publisher data reloaded. Press Search papers to update the feed.";
  } catch (error) {
    $("#last-checked").textContent = "Could not reload publisher data.";
  } finally {
    $("#check-journals-button").disabled = false;
  }
});

async function initialize() {
  populateProfile();
  try {
    await loadPublisherData();
    renderFavorites();
  } catch (error) {
    $("#feed-status").textContent = "Publisher index is being prepared. Try again shortly.";
    console.error(error);
  }
  if (!state.profile.interests) $("#profile-warning").classList.remove("hidden");
}

initialize();
