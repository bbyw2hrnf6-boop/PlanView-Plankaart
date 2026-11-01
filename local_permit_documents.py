"""Bounded attachment evidence for explicit local Permit-tab questions.

Candidates originate only in the server-retrieved notice corpus. This module is
never an HTTP endpoint and accepts no client URL. Documents remain inert data.
"""
from collections import OrderedDict
from copy import deepcopy
import hashlib
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
STAGING = ROOT / "maintenance" / "permit-documents-20261018"
SWIFT_SOURCE = ROOT / "tools" / "permit_pdf_text.swift"
MAX_BYTES = 12 * 1024 * 1024
MAX_HTML_BYTES = 512 * 1024
MAX_DOCUMENTS = 2
MAX_PAGES = 24
MAX_PAGE_TEXT = 12000
MAX_SOURCE_TEXT = 6000
MAX_REDIRECTS = 3
CACHE_TTL = 300
_CACHE = OrderedDict()
_CACHE_LOCK = threading.Lock()
_BUILD_LOCK = threading.Lock()
_HOSTS = {"repository.overheid.nl", "zoek.officielebekendmakingen.nl",
          "open.rijkswaterstaat.nl"}


class DocumentError(Exception):
    pass


def safe_document_url(value, base=None):
    """Fixed HTTPS hosts and public document routes; never credentials or ports."""
    if not isinstance(value, str) or not value or len(value) > 2400:
        return None
    if re.search(r"[\x00-\x20\x7f\\]", value):
        return None
    try:
        url = urllib.parse.urljoin(base, value) if base else value
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "https" or parsed.hostname not in _HOSTS or
                parsed.username or parsed.password or parsed.port is not None or
                parsed.query):
            return None
        path = urllib.parse.unquote(parsed.path)
        if (not path.startswith("/") or path.startswith("//") or
                any(part in (".", "..") for part in path.split("/")) or
                re.search(r"[\x00-\x1f\x7f\\]", path)):
            return None
        if parsed.hostname == "repository.overheid.nl":
            allowed = path.startswith("/frbr/officielepublicaties/")
        elif parsed.hostname == "zoek.officielebekendmakingen.nl":
            allowed = bool(re.fullmatch(
                r"/(?:gmb|stcrt|prb|wsb|bgr|exb)-\d{4}-\d{1,9}(?:\.(?:pdf|html)|/[^?#]*)", path))
        else:
            allowed = (bool(re.match(r"^/@\d+(?:/|$)", path)) or
                       path.startswith("/ter-inzage/") or
                       path.startswith("/publish/pages/"))
        if not allowed:
            return None
        return urllib.parse.urlunsplit(("https", parsed.hostname, parsed.path, "", ""))
    except (ValueError, TypeError):
        return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _remaining(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise DocumentError("permit_document_deadline")
    return remaining


def _download(url, deadline, opener=None):
    current = safe_document_url(url)
    if not current:
        raise DocumentError("permit_document_links_blocked")
    open_request = opener or urllib.request.build_opener(_NoRedirect()).open
    for redirect in range(MAX_REDIRECTS + 1):
        request = urllib.request.Request(current, method="GET", headers={
            "Accept": "application/pdf,text/html;q=0.8",
            "Accept-Encoding": "identity",
            "User-Agent": "PlanView-permit-research/1.0",
        })
        try:
            response = open_request(request, timeout=min(12, _remaining(deadline)))
        except urllib.error.HTTPError as error:
            if error.code in (301, 302, 303, 307, 308):
                target = safe_document_url(error.headers.get("Location", ""), current)
                error.close()
                if not target or redirect >= MAX_REDIRECTS:
                    raise DocumentError("permit_document_links_blocked") from None
                current = target
                continue
            error.close()
            raise DocumentError("permit_document_unavailable") from None
        except (OSError, urllib.error.URLError):
            raise DocumentError("permit_document_unavailable") from None
        with response:
            # A supplied opener must also expose the actual destination.
            resolved = safe_document_url(response.geturl())
            if not resolved or resolved != current:
                raise DocumentError("permit_document_links_blocked")
            kind = response.headers.get_content_type()
            limit = MAX_BYTES if kind == "application/pdf" or current.lower().endswith(".pdf") else MAX_HTML_BYTES
            length = response.headers.get("Content-Length")
            if length:
                try:
                    if int(length) < 0 or int(length) > limit:
                        raise DocumentError("permit_document_limit")
                except ValueError:
                    raise DocumentError("permit_document_unavailable") from None
            chunks, size = [], 0
            while True:
                _remaining(deadline)
                chunk = response.read(min(65536, limit + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise DocumentError("permit_document_limit")
                chunks.append(chunk)
            data = b"".join(chunks)
            if data.startswith(b"%PDF-"):
                return data, current, "pdf"
            if kind in ("text/html", "application/xhtml+xml") and len(data) <= MAX_HTML_BYTES:
                return data, current, "html"
            raise DocumentError("permit_document_unavailable")
    raise DocumentError("permit_document_links_blocked")


class _PDFLinks(HTMLParser):
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.links = base, []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        safe = safe_document_url(href, self.base)
        if safe and urllib.parse.urlsplit(safe).path.lower().endswith(".pdf") and safe not in self.links:
            self.links.append(safe)


def inspection_pdf_links(html, base):
    parser = _PDFLinks(base)
    parser.feed(html[:MAX_HTML_BYTES].decode("utf-8", errors="replace") if isinstance(html, bytes) else html[:MAX_HTML_BYTES])
    # Decisions precede drawings if a portal offers both. No nested HTML crawl.
    return sorted(parser.links[:30], key=lambda u: (
        -int(bool(re.search(r"besluit|beschikking|vergunning|decision", u, re.I))),
        int(bool(re.search(r"tekening|drawing|bijlage", u, re.I))), u))[:12]


def _cache_get(url):
    now = time.monotonic()
    with _CACHE_LOCK:
        for key in list(_CACHE):
            if _CACHE[key][0] <= now:
                del _CACHE[key]
        entry = _CACHE.get(url)
        if entry:
            _CACHE.move_to_end(url)
            return deepcopy(entry[1])
    return None


def _cache_put(url, value):
    # Cache text/links only, never original binary documents.
    if len(json.dumps(value, ensure_ascii=False)) > 600000:
        return
    with _CACHE_LOCK:
        _CACHE[url] = (time.monotonic() + CACHE_TTL, deepcopy(value))
        _CACHE.move_to_end(url)
        while len(_CACHE) > 10:
            _CACHE.popitem(last=False)


def _ensure_helper(deadline):
    if not SWIFT_SOURCE.is_file():
        raise DocumentError("permit_document_extraction_unavailable")
    digest = hashlib.sha256(SWIFT_SOURCE.read_bytes()).hexdigest()[:16]
    binary = STAGING / ("permit-pdf-text-" + digest)
    if binary.is_file():
        return binary
    # Finder/launched localhost servers can have a minimal PATH. A warmed helper
    # requires no compiler; first builds also recognize the system compiler directly.
    compiler = "/usr/bin/swiftc" if Path("/usr/bin/swiftc").is_file() else shutil.which("swiftc")
    if not compiler:
        raise DocumentError("permit_document_extraction_unavailable")
    with _BUILD_LOCK:
        if binary.is_file():
            return binary
        STAGING.mkdir(parents=True, exist_ok=True)
        temporary = binary.with_suffix(".building")
        try:
            sdk_options = _compatible_sdk_options(compiler, deadline)
            result = subprocess.run([
                compiler, "-O", *sdk_options, "-module-cache-path",
                str(STAGING / "module-cache"), str(SWIFT_SOURCE), "-o", str(temporary),
            ], capture_output=True, timeout=min(25, _remaining(deadline)))
            if result.returncode or not temporary.is_file():
                raise DocumentError("permit_document_extraction_unavailable")
            temporary.replace(binary)
        except (OSError, subprocess.TimeoutExpired):
            raise DocumentError("permit_document_extraction_unavailable") from None
        finally:
            temporary.unlink(missing_ok=True)
    return binary


def _compatible_sdk_options(compiler, deadline):
    """Use an installed compatible SDK when CLT's newest default is newer than Swift."""
    try:
        version = subprocess.run([compiler, "--version"], capture_output=True, text=True,
                                 timeout=min(3, _remaining(deadline)))
        match = re.search(r"Apple Swift version (\d+)\.(\d+)", version.stdout)
        if not match:
            return []
        compiler_version = tuple(map(int, match.groups()))
        available = []
        seen = set()
        for candidate in Path("/Library/Developer/CommandLineTools/SDKs").glob("MacOSX*.sdk"):
            candidate = candidate.resolve()
            if candidate in seen:
                continue
            seen.add(candidate)
            interfaces = candidate / "usr/lib/swift/Swift.swiftmodule"
            interface = next(interfaces.glob("*-apple-macos.swiftinterface"), None)
            if not interface:
                continue
            with interface.open() as stream:
                header = stream.read(600)
            sdk_version = re.search(r"Apple Swift version (\d+)\.(\d+)", header)
            numbers = re.search(r"MacOSX(\d+)(?:\.(\d+))?", candidate.name)
            if sdk_version and numbers and tuple(map(int, sdk_version.groups())) <= compiler_version:
                available.append(((int(numbers[1]), int(numbers[2] or 0)), candidate))
        if available:
            sdk = max(available, key=lambda row: row[0])[1]
            architecture = "arm64" if platform.machine() == "arm64" else "x86_64"
            return ["-sdk", str(sdk), "-target", architecture + "-apple-macosx13.0"]
    except (OSError, subprocess.TimeoutExpired):
        pass
    return []


def _extract_pdf(data, deadline):
    if not data.startswith(b"%PDF-") or len(data) > MAX_BYTES:
        raise DocumentError("permit_document_limit")
    helper = _ensure_helper(deadline)
    seconds = _remaining(deadline) - 1
    if seconds < 1:
        raise DocumentError("permit_document_deadline")
    STAGING.mkdir(parents=True, exist_ok=True)
    timed_out, return_code = False, 0
    with tempfile.TemporaryDirectory(prefix="read-", dir=STAGING) as folder:
        path = Path(folder) / "document.pdf"
        path.write_bytes(data)
        try:
            result = subprocess.run([str(helper), str(path), str(min(89, seconds))],
                                    capture_output=True, timeout=seconds + 0.8)
            raw, return_code = result.stdout, result.returncode
        except subprocess.TimeoutExpired as error:
            raw = error.stdout or error.output or b""
            timed_out = True
        except OSError:
            raise DocumentError("permit_document_extraction_unavailable") from None
    if not raw and timed_out:
        raise DocumentError("permit_document_deadline")
    return _parse_helper_output(raw, interrupted=timed_out or bool(return_code))


def _parse_helper_output(raw, *, interrupted=False):
    """Read only completed inert JSON lines; native timeout retains finished pages."""
    if not isinstance(raw, (str, bytes)) or len(raw) > 1500000:
        raise DocumentError("permit_document_extraction_unavailable")
    try:
        try:
            parsed = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            lines = raw.split(b"\n" if isinstance(raw, bytes) else "\n")
            if lines and not lines[-1]:
                lines.pop()
            header, completed, pages = None, None, []
            for index, line in enumerate(lines):
                try:
                    item = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    # A killed process may stop halfway through its next JSON line.
                    if interrupted and index == len(lines) - 1:
                        break
                    raise ValueError()
                if not isinstance(item, dict):
                    raise ValueError()
                if item.get("type") == "header" and header is None and not pages:
                    header = item
                elif item.get("type") == "complete" and header and completed is None:
                    completed = item
                elif "page" in item and "text" in item and header and completed is None:
                    pages.append(item)
                else:
                    raise ValueError()
            if not header or not pages:
                if interrupted:
                    raise DocumentError("permit_document_deadline")
                raise ValueError()
            if completed and completed.get("pageCount") != header.get("pageCount"):
                raise ValueError()
            parsed = {"pageCount": header.get("pageCount"), "pages": pages,
                      "pagesLimited": interrupted or not completed or bool(completed.get("pagesLimited")),
                      "deadlineReached": interrupted or not completed or bool(completed.get("deadlineReached")),
                      "textTruncated": bool((completed or {}).get("textTruncated"))}
        if interrupted:
            parsed["pagesLimited"] = True
            parsed["deadlineReached"] = True
        count, pages = parsed["pageCount"], parsed["pages"]
        if (isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 2000 or
                not isinstance(pages, list) or not pages or len(pages) > MAX_PAGES):
            raise ValueError()
        seen, chars = set(), 0
        for page in pages:
            if (not isinstance(page, dict) or not isinstance(page.get("text"), str) or
                    not isinstance(page.get("page"), int) or isinstance(page["page"], bool) or
                    not 1 <= page["page"] <= min(count, MAX_PAGES) or page["page"] in seen or
                    len(page["text"]) > MAX_PAGE_TEXT):
                raise ValueError()
            seen.add(page["page"])
            chars += len(page["text"])
            page["ocr"] = bool(page.get("ocr"))
        if chars > 240000:
            raise ValueError()
        if len(pages) < count or any(page.get("incomplete") for page in pages):
            parsed["pagesLimited"] = True
        return parsed
    except (ValueError, KeyError, TypeError):
        raise DocumentError("permit_document_extraction_unavailable") from None


def _fold(value):
    return "".join(c for c in unicodedata.normalize("NFKD", str(value or "")).lower()
                   if not unicodedata.combining(c))


def _terms(ranked, value):
    intent = ranked.get("searchIntent") or {}
    explicit = intent.get("terms") if isinstance(intent.get("terms"), list) else []
    words = re.findall(r"[^\W_]{3,}", _fold(str(intent.get("dutchQuery", "")) + " " + str(value.get("query", ""))))
    stop = {"der", "die", "das", "und", "was", "wie", "ist", "den", "dem", "ein", "eine",
            "the", "and", "for", "what", "this", "that", "het", "een", "van", "voor", "met",
            "zijn", "welke", "hier", "daar", "werden", "wurde", "bitte", "please", "kann"}
    return list(dict.fromkeys(_fold(t).strip() for t in [*explicit, *words]
                             if isinstance(t, str) and 2 <= len(t.strip()) <= 100 and _fold(t).strip() not in stop))[:50]


def _association(value):
    result = deepcopy(value) if isinstance(value, dict) else {"kind": "nearby", "certain": False}
    result["certain"] = bool(result.get("certain")) and result.get("kind") in ("parcel", "address")
    return result


def _candidates(ranked, terms):
    notices = [s for s in [*(ranked.get("sources") or []),
                           *(ranked.get("documentCandidates") or [])] if isinstance(s, dict)]
    selected, priorities = {}, {}
    for index, source in enumerate(notices):
        selected.setdefault(source.get("id"), source)
        priorities.setdefault(source.get("id"), 1000 - min(index, 50) * 10)
    rows = []
    for procedure in ranked.get("procedures", []):
        if not isinstance(procedure, dict):
            continue
        for event in procedure.get("events", []):
            if not isinstance(event, dict):
                continue
            source = selected.get(event.get("id"), {})
            title = str(event.get("title") or procedure.get("title") or "")
            folded = _fold(title + " " + str(event.get("sourceText", ""))[:12000])
            score = priorities.get(event.get("id"), 0) + sum(4 for t in terms if t in folded)
            if score == 0:
                continue
            parent = {**source, "id": event.get("id"), "title": title,
                      "procedureId": procedure.get("id"),
                      "association": _association(event.get("association") or procedure.get("association")),
                      "publicationDate": event.get("date"), "status": event.get("status", "unknown"),
                      "caseNumber": event.get("caseNumber") or procedure.get("caseNumber"),
                      "authority": procedure.get("authority")}
            for url in event.get("documentUrls", []):
                if isinstance(url, str):
                    rows.append((score, parent, url))
    # The ranked source projection may carry attachments even if procedures were trimmed.
    for source in notices:
        for url in source.get("documentUrls", []):
            if isinstance(url, str):
                rows.append((priorities.get(source.get("id"), 100), source, url))
    rows.sort(key=lambda row: (-row[0],
                               -int(bool(re.search(r"besluit|beschikking|omgevingsvergunning", row[2], re.I))),
                               int(bool(re.search(r"tekening|drawing", row[2], re.I))),
                               -int(row[2].lower().endswith(".pdf")),
                               str(row[1].get("id", "")), row[2]))
    seen, result = set(), []
    for _, source, url in rows:
        safe = safe_document_url(url)
        if safe and safe not in seen and re.fullmatch(r"(?:gmb|stcrt|prb|wsb|bgr)-\d{4}-\d{1,9}", str(source.get("id", ""))):
            seen.add(safe)
            result.append((source, safe))
    return result[:12]


def _excerpt(text, terms):
    if len(text) <= MAX_SOURCE_TEXT:
        return text
    folded = _fold(text)
    positions = [folded.find(t) for t in terms if folded.find(t) >= 0]
    start = max(0, min(positions) - 900) if positions else 0
    boundary = text.rfind("\n", max(0, start - 250), start + 1)
    if boundary >= 0:
        start = boundary + 1
    return text[start:start + MAX_SOURCE_TEXT].strip()


def _highlights(text, terms):
    # Browser offsets are UTF-16 code units, including any astral characters.
    matches = []
    for term in terms:
        for match in re.finditer(re.escape(term), text, re.I):
            matches.append({"start": len(text[:match.start()].encode("utf-16-le")) // 2,
                            "end": len(text[:match.end()].encode("utf-16-le")) // 2,
                            "term": term})
            if len(matches) >= 40:
                return sorted(matches, key=lambda m: (m["start"], m["end"]))
    return sorted(matches, key=lambda m: (m["start"], m["end"]))


def _evidence_budget(document_pages, original_sources, procedures):
    """Keep later decisions/last notices when PDF pages share the eight-source budget."""
    notices = [source for source in original_sources if source.get("kind") != "document_page"]
    by_id = {source.get("id"): source for source in notices}
    procedure_map = {procedure.get("id"): procedure for procedure in procedures if isinstance(procedure, dict)}
    required = []

    def reserve(identifier):
        if identifier in by_id and identifier not in required and len(required) < 7:
            required.append(identifier)

    if notices:
        reserve(notices[0].get("id"))  # Strongest textual/case match.
    matched = []
    for notice in notices:
        identifier = notice.get("procedureId")
        if not identifier:
            identifier = next((p.get("id") for p in procedures
                               if isinstance(p, dict) and any(
                                   e.get("id") == notice.get("id") for e in p.get("events", [])
                                   if isinstance(e, dict))), None)
        if identifier and identifier not in matched:
            matched.append(identifier)
    decisive = {"granted", "refused", "withdrawn", "revoked", "mixed"}
    for identifier in matched[:3]:
        procedure = procedure_map.get(identifier, {})
        reserve(procedure.get("statusEventId"))
        events = [e for e in procedure.get("events", []) if isinstance(e, dict)]
        if events:
            reserve(max(events, key=lambda e: (e.get("date") or "", e.get("id") or "")).get("id"))
        else:
            available = [n for n in notices if n.get("procedureId") == identifier]
            if available:
                decisions = [n for n in available if n.get("status") in decisive]
                if decisions:
                    reserve(max(decisions, key=lambda n: (
                        n.get("decisionDate") or n.get("publicationDate") or "",
                        n.get("publicationDate") or "", n.get("id") or "")).get("id"))
                reserve(max(available, key=lambda n: (
                    n.get("publicationDate") or "", n.get("id") or "")).get("id"))
    documents = document_pages[:min(6, 8 - len(required))]
    notice_budget = 8 - len(documents)
    retained = [by_id[identifier] for identifier in required]
    retained += [source for source in notices if source.get("id") not in required][
        :max(0, notice_budget - len(retained))]
    return documents + retained


def enrich_permit_documents(ranked, value, deadline_seconds=45, *, _opener=None, _extractor=None):
    """Enrich trusted retrieval output only when its explicit question is present."""
    if not isinstance(ranked, dict) or not isinstance(value, dict) or not isinstance(value.get("query"), str) or not value["query"].strip():
        return ranked
    # value is used only for intent terms; candidates always originate in ranked.
    if not isinstance(deadline_seconds, (int, float)) or not math.isfinite(deadline_seconds):
        deadline_seconds = 45
    deadline = time.monotonic() + max(0, min(90, deadline_seconds))
    terms = _terms(ranked, value)
    coverage = ranked.setdefault("coverage", {})
    warnings = coverage.setdefault("warnings", [])
    original_sources = list(ranked.get("sources") or [])
    stats = {"documentsChecked": 0, "documentsAvailable": 0, "documentPagesRead": 0,
             "documentPagesFullyRead": 0, "documentPagesAvailable": 0,
             "documentOCRPages": 0, "documentsAttempted": 0}
    found, seen = [], set()
    pending = [(source, url, 0) for source, url in _candidates(ranked, terms)]
    extractor = _extractor or _extract_pdf

    def warning(code):
        if code not in warnings:
            warnings.append(code)

    while pending and stats["documentsAttempted"] < MAX_DOCUMENTS and stats["documentsChecked"] < 6:
        source, candidate, depth = pending.pop(0)
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            _remaining(deadline)
            cached = _cache_get(candidate)
            if cached and cached.get("kind") == "links":
                if depth:
                    warning("permit_document_links_blocked")
                    continue
                pending[:0] = [(source, url, 1) for url in cached["urls"] if url not in seen]
                continue
            stats["documentsChecked"] += 1
            if cached and cached.get("kind") == "pages":
                parsed, document_url = cached["data"], cached["url"]
                stats["documentsAttempted"] += 1
            else:
                attempted_pdf = candidate.lower().endswith(".pdf")
                if attempted_pdf:
                    stats["documentsAttempted"] += 1
                data, document_url, kind = _download(candidate, deadline, _opener)
                if kind == "html":
                    if depth:
                        warning("permit_document_links_blocked")
                        continue
                    urls = inspection_pdf_links(data, document_url)
                    _cache_put(candidate, {"kind": "links", "urls": urls})
                    if not urls:
                        warning("permit_document_unavailable")
                    pending[:0] = [(source, url, 1) for url in urls if url not in seen]
                    continue
                if not attempted_pdf:
                    stats["documentsAttempted"] += 1
                parsed = extractor(data, deadline)
                _cache_put(candidate, {"kind": "pages", "url": document_url, "data": parsed})
            stats["documentsAvailable"] += 1
            stats["documentPagesAvailable"] += parsed["pageCount"]
            if parsed.get("pagesLimited"):
                warning("permit_document_pages_limited")
            if parsed.get("deadlineReached"):
                warning("permit_document_deadline")
            if parsed.get("textTruncated"):
                warning("permit_document_text_truncated")
            for page in parsed.get("pages", [])[:MAX_PAGES]:
                stats["documentPagesRead"] += 1
                if not page.get("incomplete"):
                    stats["documentPagesFullyRead"] += 1
                else:
                    warning("permit_document_pages_limited")
                if page.get("ocr"):
                    stats["documentOCRPages"] += 1
                    warning("permit_document_ocr")
                    warning("permit_document_ocr_uncertain")
                text = page.get("text", "")[:MAX_PAGE_TEXT].strip()
                if len(text) < 12:
                    continue
                excerpt = _excerpt(text, terms)
                page_number = page["page"]
                identifier = str(source["id"]) + "-doc-" + hashlib.sha256(document_url.encode()).hexdigest()[:14] + "-p" + str(page_number)
                folded = _fold(excerpt)
                score = sum(5 + min(10, folded.count(t)) for t in terms if t in folded)
                found.append((score, {
                    **{key: source.get(key) for key in ("procedureId", "publicationDate", "decisionDate",
                        "status", "caseNumber", "authority")},
                    "id": identifier, "noticeId": source["id"], "kind": "document_page", "documentType": "pdf",
                    "title": str(source.get("title", "Permit document"))[:700],
                    "url": document_url + "#page=" + str(page_number), "documentUrl": document_url,
                    "page": page_number, "pageCount": parsed["pageCount"], "ocr": bool(page.get("ocr")),
                    "incomplete": bool(page.get("incomplete")),
                    "sourceAvailable": True, "association": _association(source.get("association")),
                    "attachmentsIncluded": True, "excerpt": True, "text": excerpt,
                    "highlightTerms": terms[:30], "highlightRanges": _highlights(excerpt, terms),
                }))
                if not found[-1][1].get("publicationDate"):
                    found[-1][1]["publicationDate"] = source.get("date")
        except DocumentError as error:
            warning(str(error))
            if str(error) == "permit_document_deadline":
                break
        except (OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired):
            warning("permit_document_unavailable")
    if pending and (stats["documentsAttempted"] >= MAX_DOCUMENTS or stats["documentsChecked"] >= 6):
        warning("permit_document_limit")
    if found:
        found.sort(key=lambda row: (-row[0], row[1]["documentUrl"], row[1]["page"]))
        # Keep original notices in the same evidence budget for source chronology.
        ranked["sources"] = _evidence_budget([row[1] for row in found], original_sources,
                                             ranked.get("procedures") or [])
        coverage["attachmentsIncluded"] = True
        coverage["retrieval"] = "ranked-permit-notices-and-document-pages"
    else:
        ranked["sources"] = original_sources
        coverage["attachmentsIncluded"] = False
    coverage.update(stats)
    coverage["sourcesReturned"] = len(ranked["sources"])
    coverage["documentsComplete"] = False
    if any(code in warnings for code in ("permit_document_unavailable", "permit_document_deadline",
                                        "permit_document_pages_limited", "permit_document_extraction_unavailable")):
        coverage["partial"] = True
    # The old notice-only warning becomes a precise statement after successful extraction.
    if found and "attachments_not_retrieved" in warnings:
        warnings.remove("attachments_not_retrieved")
    return ranked
