(function () {
  "use strict";

  function track(name, parameters = {}) {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", name, parameters);
  }

  window.paperFlareTrack = track;

  document.addEventListener("click", event => {
    const target = event.target.closest("button, a");
    if (!target) return;

    if (target.matches("#account-button, [data-open-account]")) {
      track("account_dialog_opened");
    } else if (target.matches("#refresh-button")) {
      track("paper_search_started");
    } else if (target.matches(".add-favorite")) {
      track("journal_followed");
    } else if (target.matches(".remove-journal")) {
      track("journal_unfollowed");
    } else if (target.matches(".paper-actions a[target='_blank']")) {
      track("paper_opened");
    } else if (target.matches(".save-paper")) {
      track("paper_save_toggled");
    }
  });

  document.addEventListener("submit", event => {
    if (event.target.matches("#profile-form")) track("research_profile_saved");
  });
})();
