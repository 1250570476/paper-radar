#!/usr/bin/env python3
"""Collect recent papers from publisher journal pages without scholarly aggregators."""

from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
JOURNALS_PATH = ROOT / "data" / "journals.json"
OUTPUT_PATH = ROOT / "data" / "papers.json"
CUTOFF = datetime.now(timezone.utc) - timedelta(days=190)
HEADERS = {
    "User-Agent": "PaperRadar/1.0 (+https://github.com/1250570476/paper-radar; publisher-metadata index)",
    "Accept": "text/html,application/xhtml+xml",
}


def fetch(url: str, attempts: int = 3) -> str:
    for attempt in range(attempts):
        try:
            request = Request(url, headers=HEADERS)
            with urlopen(request, timeout=35) as response:
                return response.read().decode("utf-8", errors="replace")
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)
    return ""


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    for candidate in (value, value.replace("Z", "+00:00")):
        try:
            parsed = datetime.fromisoformat(candidate)
            return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)
        except ValueError:
            pass
    for pattern in ("%d %B %Y", "%d %b %Y", "%B %d, %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, pattern).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def text_of(node) -> str:
    return " ".join(node.get_text(" ", strip=True).split()) if node else ""


def meta_content(soup: BeautifulSoup, names: tuple[str, ...]) -> str:
    for name in names:
        node = soup.find("meta", attrs={"name": name}) or soup.find("meta", attrs={"property": name})
        if node and node.get("content"):
            return " ".join(node["content"].split())
    return ""


def article_details(url: str) -> tuple[str, str]:
    try:
        soup = BeautifulSoup(fetch(url), "html.parser")
    except Exception:
        return "", ""
    abstract = meta_content(soup, ("description", "dc.description", "citation_abstract", "og:description"))
    doi = meta_content(soup, ("citation_doi", "dc.identifier"))
    if doi.lower().startswith("doi:"):
        doi = doi[4:].strip()
    return abstract, doi


def scrape_journal(journal: dict) -> list[dict]:
    papers: list[dict] = []
    seen_urls: set[str] = set()
    reached_cutoff = False

    for page in range(1, int(journal.get("max_pages", 6)) + 1):
        query = urlencode({"searchType": "journalSearch", "sort": "PubDate", "page": page})
        url = f'{journal["listing_url"]}?{query}'
        soup = BeautifulSoup(fetch(url), "html.parser")
        cards = soup.select("article")
        page_items = 0

        for card in cards:
            link = card.select_one('h3 a[href*="/articles/"]') or card.select_one('a[href*="/articles/"]')
            if not link or not link.get("href"):
                continue
            article_url = urljoin("https://www.nature.com", link["href"].split("?")[0])
            if article_url in seen_urls:
                continue
            seen_urls.add(article_url)
            title = text_of(link)
            if not title:
                continue
            time_node = card.find("time")
            published = parse_date((time_node.get("datetime") if time_node else "") or text_of(time_node))
            if published and published < CUTOFF:
                reached_cutoff = True
                continue
            summary_node = card.select_one(".c-card__summary") or card.select_one("[data-test='article-description']")
            summary = text_of(summary_node)
            doi_match = re.search(r"/articles/(10\.\d{4,9}/[^/?#]+)", article_url)
            doi = doi_match.group(1) if doi_match else ""
            if not summary or not doi:
                detail_summary, detail_doi = article_details(article_url)
                summary = summary or detail_summary
                doi = doi or detail_doi
            paper_id = doi or hashlib.sha1(article_url.encode()).hexdigest()[:16]
            papers.append({
                "id": paper_id,
                "doi": doi,
                "title": title,
                "abstract": summary,
                "url": article_url,
                "published": published.date().isoformat() if published else "",
                "journal_id": journal["id"],
                "journal": journal["title"],
                "publisher": journal["publisher"],
                "source": url,
            })
            page_items += 1

        if page_items == 0 or reached_cutoff:
            break
        time.sleep(0.35)

    return papers


def main() -> None:
    journals = json.loads(JOURNALS_PATH.read_text(encoding="utf-8"))
    all_papers: list[dict] = []
    latest: dict[str, str] = {}
    errors: dict[str, str] = {}

    for journal in journals:
        print(f'Checking {journal["title"]}…', flush=True)
        try:
            papers = scrape_journal(journal)
            all_papers.extend(papers)
            dates = [paper["published"] for paper in papers if paper["published"]]
            if dates:
                latest[journal["id"]] = max(dates)
            print(f'  {len(papers)} papers collected', flush=True)
        except Exception as error:
            errors[journal["id"]] = f"{type(error).__name__}: {error}"
            print(f"  failed: {errors[journal['id']]}", flush=True)

    deduplicated = {paper["doi"] or paper["url"]: paper for paper in all_papers}
    papers = sorted(deduplicated.values(), key=lambda paper: paper["published"], reverse=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Direct publisher journal and article pages",
        "latest_by_journal": latest,
        "errors": errors,
        "papers": papers,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(papers)} unique papers", flush=True)


if __name__ == "__main__":
    main()
