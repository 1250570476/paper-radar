#!/usr/bin/env python3
"""Match indexed papers to CatchPapers profiles and send deduplicated digests."""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAPERS_PATH = ROOT / "data" / "papers.json"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
RESEND_KEY = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL = os.environ.get("CATCHPAPERS_FROM_EMAIL") or "CatchPapers <papers@updates.catchpapers.app>"
SITE_URL = os.environ.get("CATCHPAPERS_SITE_URL") or "https://catchpapers.app/"
DRY_RUN = os.environ.get("PAPERFLARE_DRY_RUN") == "1"

STOP_WORDS = {
    "the", "and", "for", "with", "from", "into", "using", "use", "based", "study",
    "studies", "effect", "effects", "development", "design", "analysis", "novel",
    "approach", "applications", "application", "research", "system", "systems", "method",
    "methods", "results", "their", "our", "this", "that", "are", "was", "were", "have",
    "has", "its", "can", "may", "engineering", "university",
}


def request_json(url: str, *, method: str = "GET", headers: dict | None = None, data=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"{method} {url} failed ({error.code}): {detail[:500]}") from error


def supabase(path: str, *, method: str = "GET", data=None, extra_headers=None):
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    headers.update(extra_headers or {})
    return request_json(f"{SUPABASE_URL}{path}", method=method, headers=headers, data=data)


def terms(value: str) -> set[str]:
    words = re.findall(r"[a-z][a-z0-9+-]{2,}", (value or "").lower())
    return {word for word in words if len(word) > 3 and word not in STOP_WORDS}


def phrases(value: str) -> list[str]:
    return [part.strip().lower() for part in re.split(r"[,;\n]", value or "") if len(part.strip()) >= 4]


def score(paper: dict, profile: dict) -> tuple[int, list[str]] | None:
    title = (paper.get("title") or "").lower()
    abstract = (paper.get("abstract") or paper.get("summary") or "").lower()
    combined = f" {title} {abstract} "
    exclusions = phrases(profile.get("excluded", ""))
    if any(value in combined for value in exclusions):
        return None

    interest_phrases = phrases(profile.get("interests", ""))
    interest_terms = terms(profile.get("interests", ""))
    evidence: list[tuple[str, int]] = []
    points = 0
    for phrase in interest_phrases:
        if phrase in title:
            evidence.append((phrase, 18))
            points += 18
        elif phrase in abstract:
            evidence.append((phrase, 7))
            points += 7
    for word in interest_terms:
        if re.search(rf"\b{re.escape(word)}\b", title):
            evidence.append((word, 7))
            points += 7
        elif re.search(rf"\b{re.escape(word)}\b", abstract):
            evidence.append((word, 2))
            points += 2
    unique = sorted(set(evidence), key=lambda item: item[1], reverse=True)
    title_hits = sum(1 for value, _ in unique if value in title)
    if points < 14 or (title_hits == 0 and len(unique) < 3):
        return None
    return min(98, 50 + points), [item[0] for item in unique[:4]]


def paper_key(paper: dict) -> str:
    stable = paper.get("doi") or paper.get("url") or paper.get("id") or paper.get("title", "")
    return hashlib.sha256(str(stable).encode()).hexdigest()


def safe_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value or "")
    return value if parsed.scheme == "https" and parsed.netloc else SITE_URL


def due(profile: dict, now: datetime) -> bool:
    last = profile.get("last_alert_at")
    if not last:
        return True
    last_at = datetime.fromisoformat(last.replace("Z", "+00:00"))
    delay = timedelta(days=7 if profile.get("alert_frequency") == "weekly" else 1)
    return now - last_at >= delay


def get_user_email(user_id: str) -> str | None:
    user = supabase(f"/auth/v1/admin/users/{urllib.parse.quote(user_id)}")
    return user.get("email") if user else None


def email_html(matches: list[tuple[dict, int, list[str]]], unsubscribe_url: str) -> str:
    cards = []
    for paper, relevance, hits in matches:
        url = html.escape(safe_url(paper.get("url") or ""), quote=True)
        cards.append(
            f'<div style="border:1px solid #dce5df;border-radius:12px;padding:18px;margin:14px 0">'
            f'<div style="color:#1f684f;font-size:12px;font-weight:700">{html.escape(paper.get("journal", ""))} · {relevance}% match</div>'
            f'<h2 style="font-size:18px;line-height:1.35;margin:8px 0">{html.escape(paper.get("title", "Untitled paper"))}</h2>'
            f'<p style="color:#53635d;font-size:14px">Matched: {html.escape(", ".join(hits))}</p>'
            f'<a href="{url}" style="color:#1f684f;font-weight:700">Open publisher page →</a></div>'
        )
    return (
        '<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#17241f">'
        '<p style="color:#e46e44;font-weight:700;letter-spacing:.08em">CATCHPAPERS</p>'
        '<h1>New papers that match your work</h1>' + "".join(cards) +
        f'<p style="font-size:12px;color:#718078;margin-top:28px">Manage alerts or delete your account in <a href="{html.escape(SITE_URL, quote=True)}">CatchPapers</a>, or <a href="{html.escape(unsubscribe_url, quote=True)}">unsubscribe from alerts</a>.</p></div>'
    )


def send_email(email: str, matches: list[tuple[dict, int, list[str]]], unsubscribe_token: str):
    subject = f"{len(matches)} new CatchPapers match{'es' if len(matches) != 1 else ''}"
    unsubscribe_url = f"{SITE_URL}?unsubscribe={urllib.parse.quote(unsubscribe_token)}"
    if DRY_RUN:
        print(f"DRY RUN: would send {len(matches)} match(es) to {email}")
        return
    request_json(
        "https://api.resend.com/emails",
        method="POST",
        headers={"Authorization": f"Bearer {RESEND_KEY}", "Content-Type": "application/json"},
        data={
            "from": FROM_EMAIL,
            "to": [email],
            "subject": subject,
            "html": email_html(matches, unsubscribe_url),
            "headers": {"List-Unsubscribe": f"<{unsubscribe_url}>"},
        },
    )


def main() -> int:
    if not SUPABASE_URL or not SERVICE_KEY or (not RESEND_KEY and not DRY_RUN):
        print("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or RESEND_API_KEY", file=sys.stderr)
        return 2
    snapshot = json.loads(PAPERS_PATH.read_text(encoding="utf-8"))
    papers = snapshot.get("papers", [])
    profiles = supabase("/rest/v1/profiles?alerts_enabled=eq.true&interests=neq.&select=*") or []
    now = datetime.now(timezone.utc)
    for profile in profiles:
        if not due(profile, now):
            continue
        journal_ids = set(profile.get("favorite_journal_ids") or [])
        delivered_rows = supabase(
            f"/rest/v1/alert_deliveries?user_id=eq.{profile['user_id']}&select=paper_key"
        ) or []
        delivered = {row["paper_key"] for row in delivered_rows}
        matches = []
        for paper in papers:
            key = paper_key(paper)
            if key in delivered or (journal_ids and paper.get("journal_id") not in journal_ids):
                continue
            result = score(paper, profile)
            if result:
                matches.append((paper, result[0], result[1]))
        matches.sort(key=lambda item: (item[1], item[0].get("published", "")), reverse=True)
        matches = matches[:10]
        if not matches:
            continue
        email = get_user_email(profile["user_id"])
        if not email:
            continue
        send_email(email, matches, str(profile["unsubscribe_token"]))
        if DRY_RUN:
            continue
        rows = [{"user_id": profile["user_id"], "paper_key": paper_key(paper), "paper_title": paper.get("title", "")[:500]} for paper, _, _ in matches]
        supabase("/rest/v1/alert_deliveries", method="POST", data=rows)
        supabase(
            f"/rest/v1/profiles?user_id=eq.{profile['user_id']}", method="PATCH",
            data={"last_alert_at": now.isoformat()},
        )
        print(f"Sent {len(matches)} match(es) to user {profile['user_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
