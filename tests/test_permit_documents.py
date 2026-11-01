import copy
from email.message import Message
import io
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error

import local_permit_documents as docs


PDF = "https://open.rijkswaterstaat.nl/publish/pages/231845/besluit.pdf"
SECOND = "https://open.rijkswaterstaat.nl/publish/pages/231845/tekening.pdf"
PORTAL = "https://open.rijkswaterstaat.nl/@310789/kennisgeving-besluit-vergunning-2"


class Response(io.BytesIO):
    def __init__(self, body, url, content_type="application/pdf", length=None):
        super().__init__(body)
        self.url = url
        self.headers = Message()
        self.headers["Content-Type"] = content_type
        if length is not None:
            self.headers["Content-Length"] = str(length)

    def geturl(self):
        return self.url


def ranked(urls=None):
    source = {"id": "stcrt-2026-35213", "title": "RWS-2026/23770 Stuwweg",
              "text": "Kennisgeving besluit Stuwweg", "sourceAvailable": True,
              "association": {"kind": "area", "certain": False, "relation": "contains_point"},
              "documentUrls": urls or [PDF]}
    return {"sources": [source], "procedures": [], "coverage": {
        "complete": False, "warnings": ["attachments_not_retrieved"]},
        "searchIntent": {"dutchQuery": "Waarom vergunning Stuwweg", "terms": ["Stuwweg", "motivering"]}}


def pages(count=3, *, ocr=False):
    return {"pageCount": count, "pages": [
        {"page": n, "text": "Stuwweg motivering aanvraag werkzaamheden. " * 4,
         "ocr": ocr, "truncated": False}
        for n in range(1, min(count, 24) + 1)],
        "pagesLimited": count > 24, "deadlineReached": False, "textTruncated": False}


class DocumentTests(unittest.TestCase):
    def setUp(self):
        with docs._CACHE_LOCK:
            docs._CACHE.clear()

    def test_only_fixed_https_public_document_routes_are_accepted(self):
        self.assertEqual(docs.safe_document_url(PDF + "#page=3"), PDF)
        self.assertEqual(docs.safe_document_url("/publish/pages/1/test.pdf", PORTAL),
                         "https://open.rijkswaterstaat.nl/publish/pages/1/test.pdf")
        for url in [
            "http://open.rijkswaterstaat.nl/publish/pages/1/x.pdf",
            "https://127.0.0.1/x.pdf", "https://localhost/x.pdf",
            "https://open.rijkswaterstaat.nl.evil.test/publish/pages/1/x.pdf",
            "https://open.rijkswaterstaat.nl:443/publish/pages/1/x.pdf",
            "https://user:secret@open.rijkswaterstaat.nl/publish/pages/1/x.pdf",
            "https://open.rijkswaterstaat.nl/publish/../private/x.pdf",
            "https://open.rijkswaterstaat.nl/publish/pages/%2e%2e/x.pdf",
            "https://open.rijkswaterstaat.nl/publish/pages/1/x.pdf?url=http://localhost/",
            "https://open.rijkswaterstaat.nl/admin", "file:///etc/passwd",
            "https://repository.overheid.nl/admin.pdf",
            "https://open.rijkswaterstaat.nl/publish/pages/1/\nx.pdf",
            "https://open.rijkswaterstaat.nl\\@evil.test/publish/pages/1/x.pdf",
        ]:
            self.assertIsNone(docs.safe_document_url(url), url)

    def test_redirect_destinations_are_revalidated_before_any_next_request(self):
        requests = []
        def blocked(request, timeout):
            requests.append(request.full_url)
            headers = Message()
            headers["Location"] = "http://169.254.169.254/latest/meta-data/"
            raise urllib.error.HTTPError(request.full_url, 302, "Found", headers, None)
        with self.assertRaisesRegex(docs.DocumentError, "links_blocked"):
            docs._download(PORTAL, time.monotonic() + 2, blocked)
        self.assertEqual(requests, [PORTAL])
        def trusted(request, timeout):
            if request.full_url == PORTAL:
                headers = Message()
                headers["Location"] = PDF
                raise urllib.error.HTTPError(PORTAL, 302, "Found", headers, None)
            return Response(b"%PDF-test", PDF)
        self.assertEqual(docs._download(PORTAL, time.monotonic() + 2, trusted)[1], PDF)
        def hidden(request, timeout):
            return Response(b"%PDF-test", "https://evil.test/x.pdf")
        with self.assertRaisesRegex(docs.DocumentError, "links_blocked"):
            docs._download(PDF, time.monotonic() + 2, hidden)

    def test_redirect_chain_download_size_type_and_deadline_are_bounded(self):
        requests = []
        def loop(request, timeout):
            requests.append(request.full_url)
            headers = Message()
            headers["Location"] = PORTAL
            raise urllib.error.HTTPError(PORTAL, 302, "Found", headers, None)
        with self.assertRaisesRegex(docs.DocumentError, "links_blocked"):
            docs._download(PORTAL, time.monotonic() + 2, loop)
        self.assertEqual(len(requests), 4)
        for body, content_type, length, error in [
            (b"%PDF-", "application/pdf", docs.MAX_BYTES + 1, "limit"),
            (b"a", "application/json", None, "unavailable"),
        ]:
            with self.assertRaisesRegex(docs.DocumentError, error):
                docs._download(PDF, time.monotonic() + 2,
                               lambda request, timeout: Response(body, PDF, content_type, length))
        with patch.object(docs, "MAX_BYTES", 10):
            with self.assertRaisesRegex(docs.DocumentError, "limit"):
                docs._download(PDF, time.monotonic() + 2,
                               lambda request, timeout: Response(b"%PDF-" + b"x" * 20, PDF))
        with self.assertRaisesRegex(docs.DocumentError, "deadline"):
            docs._download(PDF, time.monotonic() - 1)

    def test_inspection_links_are_safe_pdf_only_and_decisions_precede_drawings(self):
        html = f'<a href="{SECOND}">Drawing</a><a href="{PDF}">Decision</a>' \
               '<a href="https://evil.test/private.pdf">bad</a>' \
               '<a href="javascript:alert(1)">bad</a><script>fetch("http://localhost")</script>'
        self.assertEqual(docs.inspection_pdf_links(html, PORTAL), [PDF, SECOND])
        requests = []
        def opener(request, timeout):
            requests.append(request.full_url)
            if request.full_url == PORTAL:
                return Response(html.encode(), PORTAL, "text/html")
            return Response(b"%PDF-test", request.full_url)
        value = docs.enrich_permit_documents(ranked([PORTAL]), {"query": "Warum Stuwweg"},
                                            _opener=opener, _extractor=lambda *_: pages())
        self.assertEqual(requests, [PORTAL, PDF, SECOND])
        self.assertEqual(value["coverage"]["documentsAvailable"], 2)
        self.assertTrue(value["sources"][0]["documentUrl"].endswith(".pdf"))

    def test_html_cannot_be_crawled_beyond_one_inspection_level(self):
        requests = []
        def opener(request, timeout):
            requests.append(request.full_url)
            if request.full_url == PORTAL:
                return Response(f'<a href="{PDF}">PDF</a>'.encode(), PORTAL, "text/html")
            return Response(f'<a href="{SECOND}">PDF</a>'.encode(), PDF, "text/html")
        result = docs.enrich_permit_documents(ranked([PORTAL]), {"query": "Stuwweg"},
                                             _opener=opener, _extractor=lambda *_: self.fail("not a PDF"))
        self.assertEqual(requests, [PORTAL, PDF])
        self.assertIn("permit_document_links_blocked", result["coverage"]["warnings"])
        self.assertFalse(result["coverage"]["attachmentsIncluded"])

    def test_two_pdf_limit_includes_failed_downloads_and_retains_notices(self):
        requests = []
        def opener(request, timeout):
            requests.append(request.full_url)
            raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", Message(), None)
        original = ranked([PDF, SECOND, PDF.replace("besluit.pdf", "third.pdf")])
        result = docs.enrich_permit_documents(copy.deepcopy(original), {"query": "Stuwweg"},
                                             _opener=opener, _extractor=lambda *_: pages())
        self.assertEqual(len(requests), 2)
        self.assertEqual(result["coverage"]["documentsAttempted"], 2)
        self.assertEqual(result["sources"], original["sources"])
        self.assertIn("permit_document_unavailable", result["coverage"]["warnings"])

    def test_page_evidence_has_stable_ids_uncertainty_and_utf16_highlights(self):
        called = []
        def extract(*args):
            called.append(True)
            result = pages(22, ocr=True)
            result["pages"][2]["text"] = "😀 Stuwweg motivering besluit."
            return result
        opener = lambda request, timeout: Response(b"%PDF-test", request.full_url)
        result = docs.enrich_permit_documents(ranked(), {"query": "Stuwweg"}, _opener=opener, _extractor=extract)
        sources = result["sources"]
        self.assertLessEqual(len(sources), 8)
        self.assertEqual(len([s for s in sources if s.get("kind") == "document_page"]), 6)
        self.assertTrue(all(s["association"]["certain"] is False for s in sources))
        self.assertTrue(all(s["pageCount"] == 22 and s["ocr"] for s in sources[:6]))
        self.assertEqual(result["coverage"]["documentOCRPages"], 22)
        self.assertNotIn("attachments_not_retrieved", result["coverage"]["warnings"])
        again = docs.enrich_permit_documents(ranked(), {"query": "Stuwweg"}, _opener=lambda *_: self.fail("cached"),
                                            _extractor=lambda *_: self.fail("cached"))
        self.assertEqual([s["id"] for s in again["sources"]], [s["id"] for s in sources])
        self.assertEqual(len(called), 1)
        self.assertEqual(docs._highlights("😀 Stuwweg", ["stuwweg"])[0], {"start": 3, "end": 10, "term": "stuwweg"})

    def test_partial_extraction_keeps_available_pages_and_precise_coverage(self):
        parsed = pages(30)
        parsed["pages"] = parsed["pages"][:4]
        parsed["deadlineReached"] = True
        result = docs.enrich_permit_documents(ranked(), {"query": "Stuwweg"},
            _opener=lambda request, timeout: Response(b"%PDF-test", request.full_url),
            _extractor=lambda *_: parsed)
        self.assertEqual(result["coverage"]["documentPagesRead"], 4)
        self.assertEqual(result["coverage"]["documentsAvailable"], 1)
        self.assertIn("permit_document_pages_limited", result["coverage"]["warnings"])
        self.assertIn("permit_document_deadline", result["coverage"]["warnings"])
        self.assertTrue(result["coverage"]["partial"])

    def test_generic_notices_still_search_server_derived_attachment_candidates(self):
        value = ranked()
        candidate = value["sources"].pop()
        candidate["date"] = "2026-10-05"
        candidate["title"] = "Kennisgeving besluit RWS"
        value["documentCandidates"] = [candidate]
        result = docs.enrich_permit_documents(value, {"query": "motivering Stuwweg"},
            _opener=lambda request, timeout: Response(b"%PDF-test", request.full_url),
            _extractor=lambda *_: pages(1))
        self.assertEqual(result["coverage"]["documentsAvailable"], 1)
        self.assertEqual(result["sources"][0]["documentType"], "pdf")
        self.assertEqual(result["sources"][0]["publicationDate"], "2026-10-05")
        self.assertEqual(result["sources"][0]["noticeId"], "stcrt-2026-35213")

    def test_header_only_pages_are_not_counted_as_fully_read(self):
        parsed = pages(2, ocr=True)
        parsed["pages"][1]["incomplete"] = True
        result = docs.enrich_permit_documents(ranked(), {"query": "Stuwweg"},
            _opener=lambda request, timeout: Response(b"%PDF-test", request.full_url),
            _extractor=lambda *_: parsed)
        self.assertEqual(result["coverage"]["documentPagesRead"], 2)
        self.assertEqual(result["coverage"]["documentPagesFullyRead"], 1)
        self.assertEqual(result["coverage"]["documentPagesAvailable"], 2)
        self.assertTrue(result["coverage"]["partial"])
        self.assertIn("permit_document_pages_limited", result["coverage"]["warnings"])

    def test_candidate_priority_preserves_explicit_case_matches_before_unrelated_nearby_notices(self):
        value = ranked()
        first = value["sources"][0]
        later = {**first, "id": "stcrt-2026-19609", "documentUrls": [SECOND]}
        value["documentCandidates"] = [later]
        candidates = docs._candidates(value, ["stuwweg"])
        self.assertEqual(candidates[0][0]["id"], "stcrt-2026-35213")

    def test_pdf_pages_do_not_displace_later_grant_or_latest_procedural_notice(self):
        value = ranked()
        refusal = {**value["sources"][0], "procedureId": "case-1", "status": "refused",
                   "publicationDate": "2024-01-01"}
        older = {**refusal, "id": "stcrt-2024-2", "publicationDate": "2024-02-01",
                 "documentUrls": []}
        grant = {**refusal, "id": "stcrt-2025-3", "status": "granted",
                 "publicationDate": "2025-01-01", "documentUrls": []}
        newest = {**refusal, "id": "stcrt-2026-4", "status": "amended",
                  "publicationDate": "2026-01-01", "documentUrls": []}
        value["sources"] = [refusal, older, grant, newest]
        value["procedures"] = [{"id": "case-1", "statusEventId": grant["id"],
                                "events": [{"id": n["id"], "date": n["publicationDate"]}
                                           for n in (refusal, older, grant, newest)]}]
        result = docs.enrich_permit_documents(value, {"query": "refusal Stuwweg"},
            _opener=lambda request, timeout: Response(b"%PDF-test", request.full_url),
            _extractor=lambda *_: pages(10))
        identifiers = [s["id"] for s in result["sources"]]
        self.assertLessEqual(len(identifiers), 8)
        for notice in (refusal, grant, newest):
            self.assertIn(notice["id"], identifiers)
        self.assertEqual(len([s for s in result["sources"] if s.get("documentType") == "pdf"]), 5)

    def test_three_procedure_decisions_and_latest_notices_leave_at_least_one_pdf_page(self):
        notices, procedures = [], []
        for n in range(3):
            seed = {"id": f"gmb-2023-{n+1}", "procedureId": f"case-{n}", "status": "refused"}
            grant = {"id": f"gmb-2024-{n+1}", "procedureId": f"case-{n}", "status": "granted"}
            latest = {"id": f"gmb-2025-{n+1}", "procedureId": f"case-{n}", "status": "extended"}
            notices.extend([seed, grant, latest])
            procedures.append({"id": f"case-{n}", "statusEventId": grant["id"],
                               "events": [{"id": x["id"], "date": str(y)}
                                          for x, y in ((seed, 2023), (grant, 2024), (latest, 2025))]})
        # The three strongest matches precede the engine-reserved chronology rows.
        notices.sort(key=lambda s: (s["status"] != "refused", s["id"]))
        selected = docs._evidence_budget([{"id": f"pdf-{n}", "documentType": "pdf"} for n in range(8)],
                                        notices, procedures)
        self.assertEqual(len(selected), 8)
        self.assertEqual(sum(s.get("documentType") == "pdf" for s in selected), 1)
        selected_ids = {s["id"] for s in selected}
        for procedure in procedures:
            self.assertIn(procedure["statusEventId"], selected_ids)
            self.assertIn(procedure["events"][-1]["id"], selected_ids)

    def test_cache_is_memory_only_bounded_to_ten_urls_and_expires(self):
        for n in range(15):
            docs._cache_put(str(n), {"kind": "pages", "data": pages(1)})
        self.assertEqual(len(docs._CACHE), 10)
        self.assertIsNone(docs._cache_get("0"))
        with patch.object(docs.time, "monotonic", return_value=time.monotonic() + 301):
            self.assertIsNone(docs._cache_get("14"))
        self.assertEqual(len(docs._CACHE), 0)

    def test_warmed_native_helper_does_not_require_compiler_in_server_path(self):
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "helper.swift"
            source.write_text("// known source")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
            binary = Path(folder) / ("permit-pdf-text-" + digest)
            binary.write_bytes(b"compiled")
            with patch.object(docs, "SWIFT_SOURCE", source), \
                 patch.object(docs, "STAGING", Path(folder)), \
                 patch.object(docs.shutil, "which", return_value=None):
                self.assertEqual(docs._ensure_helper(time.monotonic() + 1), binary)

    def test_no_explicit_question_means_no_download_and_client_url_is_never_used(self):
        original = ranked()
        self.assertIs(docs.enrich_permit_documents(original, {"url": PDF}, _opener=lambda *_: self.fail("no query")), original)
        result = docs.enrich_permit_documents(ranked(), {"query": "Stuwweg", "url": "http://localhost/private"},
            _opener=lambda request, timeout: Response(b"%PDF-test", request.full_url), _extractor=lambda *_: pages(1))
        self.assertTrue(result["coverage"]["attachmentsIncluded"])

    def test_swift_output_rejects_overlarge_text_pages_and_bad_page_numbers(self):
        for result in [
            {"pageCount": 24, "pages": [{"page": 25, "text": "x", "ocr": False}]},
            {"pageCount": 1, "pages": [{"page": 1, "text": "x" * 12001, "ocr": False}]},
            {"pageCount": 1, "pages": [{"page": True, "text": "x", "ocr": False}]},
            {"pageCount": 30, "pages": [{"page": n + 1, "text": "x", "ocr": False} for n in range(25)]},
        ]:
            fake = subprocess.CompletedProcess([], 0, stdout=json.dumps(result).encode(), stderr=b"")
            with patch.object(docs, "_ensure_helper", return_value=Path("/trusted/helper")), \
                 patch.object(docs.subprocess, "run", return_value=fake):
                with self.assertRaisesRegex(docs.DocumentError, "extraction_unavailable"):
                    docs._extract_pdf(b"%PDF-test", time.monotonic() + 3)
        with patch.object(docs, "_ensure_helper", return_value=Path("/trusted/helper")), \
             patch.object(docs.subprocess, "run", side_effect=subprocess.TimeoutExpired("helper", 1)):
            with self.assertRaisesRegex(docs.DocumentError, "deadline"):
                docs._extract_pdf(b"%PDF-test", time.monotonic() + 3)

    def test_native_timeout_preserves_completed_pages_from_progressive_output(self):
        header = json.dumps({"type": "header", "pageCount": 22})
        page = {"page": 1, "text": "Stuwweg besluit vergunning en voorwaarden.", "ocr": True,
                "truncated": False, "incomplete": False}
        progress = (header + "\n" + json.dumps(page) + '\n{"page":2,"text":"unfinished').encode()
        timeout = subprocess.TimeoutExpired("helper", 1, output=progress)
        with patch.object(docs, "_ensure_helper", return_value=Path("/trusted/helper")), \
             patch.object(docs.subprocess, "run", side_effect=timeout):
            result = docs._extract_pdf(b"%PDF-test", time.monotonic() + 3)
        self.assertEqual(result["pageCount"], 22)
        self.assertEqual(result["pages"], [page])
        self.assertTrue(result["pagesLimited"])
        self.assertTrue(result["deadlineReached"])
        enriched = docs.enrich_permit_documents(ranked(), {"query": "Stuwweg"},
            _opener=lambda request, timeout: Response(b"%PDF-test", request.full_url),
            _extractor=lambda *_: result)
        self.assertEqual(enriched["coverage"]["documentsAvailable"], 1)
        self.assertEqual(enriched["coverage"]["documentPagesFullyRead"], 1)
        self.assertEqual(enriched["sources"][0]["documentType"], "pdf")
        self.assertIn("permit_document_deadline", enriched["coverage"]["warnings"])

    def test_complete_progressive_output_stays_complete_and_malformed_middle_is_rejected(self):
        page = {"page": 1, "text": "Stuwweg besluit vergunning.", "ocr": True}
        output = "\n".join(json.dumps(row) for row in [
            {"type": "header", "pageCount": 1}, page,
            {"type": "complete", "pageCount": 1, "pagesLimited": False,
             "deadlineReached": False, "textTruncated": False}]) + "\n"
        result = docs._parse_helper_output(output)
        self.assertFalse(result["pagesLimited"])
        self.assertFalse(result["deadlineReached"])
        with self.assertRaisesRegex(docs.DocumentError, "extraction_unavailable"):
            docs._parse_helper_output(output.replace(json.dumps(page), "garbage"), interrupted=True)


if __name__ == "__main__":
    unittest.main()
