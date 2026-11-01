# Desktop UX and demo readiness · 18 October 2026

## Audit before implementation

The 17 October desktop audit was rechecked against the current canonical source before editing. Its live evidence is retained in the workspace `output/planview-ux-review-20261017/`.

Priority defects: overlapping sticky Search/Reset targets at 1280×720; full manual catalogue opened for one criterion; hidden partial-search coverage; async comparison redraw discarded expanded details and routing drafts; saved/comparison notes could diverge; address debounce allowed stale responses; Google/imagery context disappeared in desktop layout. Loading treatments were inconsistent and some JavaScript motion ignored reduced-motion settings.

## Authorized implementation scope

Desktop only, retaining all current data adapters and search semantics. Consolidate search actions; focused searchable criteria editor; persistent search coverage; optional user-triggered travel times for at most three results; stable comparison, dossier and notes; compact attributed imagery with Google Street View access; consistent progress and unknown/error states. Existing public maps need no new account. Do not turn route-time enrichment into an unsupported scan filter, equate model data with legal permission, or invent absent imagery.

## Validation and release

Implementation and live validation results are recorded below. The canonical local app and existing owner-private Site must publish the same source using CLOUD_SYNC.md. Existing secrets and device-local cases are preserved. Documentation reflects current UI; historical audits remain dated and their superseded statements are marked.

## Briefing

Only after the implementation has passed checks, create `briefing.html` and its assets from the actual interface. Explain all supported search criteria, operators, units, sources and spatial scope; distinguish post-search checks, contextual overlays and unsupported requirements. Provide simple and complex search examples, demo path, fallback path and questions/answers. Any trailer uses actual screenshots and readable captions, with playback controls and no fabricated search results.


## Implementation completed in staging

- Search: 30 searchable criterion entries, focused editors, retained manual semantics, one action footer, persistent actual count and partial/cancelled status. Explicit routing of up to three candidates, destination + transport mode shown with each time, source attribution, no ranking/filter side effect.
- Inspector: compact Esri aerial, Google links, retained preview map instance, location guard, proposal question/examples and preserved answers during loading. Saved-state CTA and note conflict preservation.
- Comparison: aligned decision toolbar/matrix, profile guidance, empty-export guard, retained maps/expanded details/focus/drafts, real progress counts, stale route reset, shared notes.
- Global: feedback.css, reduced motion including map/scroll paths, consistent focus and controls, updated current/historical documentation.

## Live findings resolved

At 1280×720, the main Search button center now hits `advanced-run` (x28,y597,w404,h48), with Reset in the same footer. Mouse click starts the real manual search. Criteria picker selection applies Wohnnutzung correctly. Comparison checks used a public Maastricht location and station target; actual driving result was returned, changing the destination cleared old output, and switching tabs preserved the draft. No user cases or credentials from localhost:4174 were modified; separate staging origin is used.


## Final application verification

- Application checks pass with `node --test tests/*.test.cjs tests/*.test.mjs` and `python3 -m unittest discover -s tests -p 'test_*.py'`. The suite grows with later regression fixes; use the final run output for current counts. Root JavaScript syntax, JSON parsing and referenced index assets are validated before publication.
- Live desktop journeys at 1280×720: manual criteria picker, adding/removing OR alternatives, actual Maastricht scan (39 sampled points; 9 candidates in this run), persistent coverage, result/inspector navigation and comparison. Counts are observed examples, not guaranteed results.
- Optional search-result driving route: public candidate A to Stationsplein, Maastricht returned 8 minutes / 4.4 km; provider OSRM/FOSSGIS. Comparison route also returned a real result. Both are modeled network times, without live traffic.
- One real local rule query completed for the selected Maastricht point: 10 of 12 documents checked; incomplete coverage and 16 source diagnostics. The answer chiefly cited provincial recreation-related restrictions and expressly lacked complete municipal applicability. This demonstrates source-backed research, not a valid permission decision. Generic warnings are translated and coverage precedes the answer.
- Final visual QA caught Leaflet preview panes painting above sticky inspector tabs; stacking isolation resolves it. An address journey also exposed interrupted map navigation during pane resizing; committed target positioning plus center-preserving resize now land at the requested point and zoom. Regression tests cover late resize and subsequent user panning. The actual Reyckenborg 55 address journey was repeated successfully after the fix.
- Captured real search, criterion picker, results, optional routing, inspector, rule form and comparison screens. No synthetic results or credentials are embedded. Browser error logs were empty in checked flows.

## Remaining operational boundaries

External map/model/routing/DSO services can be slow or unavailable; retain visible unknown and partial results. Environmental models, current legal-effect completeness, unsupported natural-language conditions and cross-field OR remain bounded as documented. The private cloud requires each signed-in user's own configured service keys where applicable; local credentials and browser cases are not mirrored. Live source availability cannot be guaranteed for a presentation, so the self-contained briefing provides an offline visual path.

## Interactive trilingual briefing validation

The initial silent German demo package has been superseded by the interactive English/German/Dutch briefing in the same stable `briefing.html` and MP4 paths. English is the default; a visible language switch and `?lang=en|de|nl` select the briefing language independently of the application. The English video has spoken narration and on-screen titles; the exact new walkthrough transcript stays English; guide controls and gallery explanations are translated into all three briefing languages. The current media manifest is authoritative for duration, encoding, voice build and file sizes. Narration-only replacements require media inspection and playback verification again before the package is final.

A short overview leads to a four-step walkthrough covering eight real English app captures. Six example searches allow editing the area and numeric thresholds, display the resulting checklist, validate inconsistent ranges and copy the checklist for manual review. This is explicitly a practice area: no live result generation, API requests or browser-case mutation. All 30 picker entries, 17 zoning groups, 14 soil classes, an observed Maastricht starter, capabilities/limits, FAQ, source descriptions and the five-minute presentation path remain available. Detailed material is progressively disclosed rather than front-loaded.

Recorded browser checks after the trilingual integration:

- English, German and Dutch navigation, catalogue text, examples and captions change together. Language-specific URLs and the separate briefing preference are supported.
- Environment category returns 4/30 criteria, whole-parcel/boundary scope returns 8/30, and German `Boden` returns 1/30. Filter behavior uses stable category and scope IDs, not translated text matching.
- Example thresholds update the checklist and chips. A parcel minimum above its maximum disables Copy; a valid 900 m² minimum restores it. The copied text was checked through the clipboard.
- All four steps and eight recorded views are accessible. Gallery enlargement, Escape to close, and Home keyboard navigation were exercised.
- The desktop layout has no horizontal overflow at 1280×720. Checked browser error logs are empty.
- Historical Aaron trailer, superseded by the detailed walkthrough below: 49 seconds, H.264 1280×720 at 24 fps, one AAC track at 48 kHz; 9,521,772-byte MP4 embedded in the 14,939,264-byte HTML. Voice `com.apple.siri.natural.Aaron`, enhanced quality 2, normal rate 0.5. Decoded audio RMS 0.10020, peak 0.82556; no clipping, and all seven speech segments finish before their next scene. Local browser playback advanced beyond 43 seconds with sound unmuted. No autoplay. This is technical audio verification, not a claim of human audition.

In the offline edition, images and video are embedded with their actual detected MIME types. The app/hosted edition uses the same video as a separate same-origin MP4. CSP allows those local media sources and blocks API calls; app/source links require deliberate navigation. The briefing can be opened as a standalone offline file, while live application maps, scans and optional source checks still depend on their services. Existing output paths remain intact.

### Reproduction

The authoring source is `../output/planview-demo-20261018/build-briefing-v2.py`. Its translated content blocks generate `briefing-content-v2.json` for review and `briefing-template-v2.html`; the JSON file is a generated snapshot, not a separate source to edit. Promote the reviewed V2 template to `briefing-template.html`, refresh the referenced screenshot/video/poster assets from the checked English media build, then build the offline and hosted editions with the validated timeline/video/QA and `embed-briefing.py`. See [the output guide](../../output/README.md) for exact commands.

`demo-walkthrough-en/` retains the current consecutive screen captures, narration segments, transcript/subtitles, renderer, timeline and media QA. `media-en/` retains the superseded 49-second trailer source. The previous root `make-trailer.swift` describes the historical silent German build, not the current English narration workflow. Do not substitute fabricated UI or remove sources, supported criteria or unknown-state distinctions to shorten the presentation. Localhost:4174 remains the priority working instance and does not need restarting for an HTML-only briefing refresh.

## Lossless hosting package repair

The first source push succeeded but archive validation rejected the expanded package above 256 MiB; no deployment was recorded for that attempt. Camping and development-project GeoJSON now use byte-identical gzip twins through the existing data loader. Both source generators retain readable originals and refresh their compressed twins. Publication validation refuses mismatches and excludes only those duplicate plaintext maintenance copies. No source features, coordinates, attributes, imagery, trailer quality or supported criteria were removed. Targeted integration tests cover compressed and already-expanded HTTP responses. The application checks listed above also cover this packaging contract; later briefing/media changes must still pass release-size validation without dropping data precision or features.

## Final local regression check

The Fit selected region button now retains the chosen municipality, stops an earlier map animation and commits the selected bounds before sidebar resizing. The live English Maastricht journey retained municipality 0935 and loaded municipality-scale zoom-12 tiles; checked browser error logs were empty. The full final suite passes 209 Node and 19 Python tests. Localhost:4174 returned HTTP 200 for the app and final briefing; served briefing bytes matched the local artifact, and the local application API remained available. Existing local credentials and browser cases were not changed.


## Detailed English walkthrough · 18 October 2026

The 49-second trailer is superseded by an approximately six-minute product demonstration, assembled from 51 actual interaction clips. It includes area selection, the full criterion picker, two real search runs, parcel identity and resizable inspector, environmental model coverage, proposal research and citations, official layers and 3D, a shared comparison profile and priorities, rainfall/flooding scenarios, optional driving times, notes, saved sites, exports and history. All movement comes from consecutive browser captures; readable narration holds and cursor/highlight overlays are editorial additions. The source manifest retains actual timing and all captured frames.

Observed demo data: the first sampled search checked 80 points and returned 14 candidates; the refined 1 km search returned 15 candidates from a newly selected sample. These counts are examples, not inventory guarantees. The selected parcel is MTT00 F 3496. Noise is 45 dB Lden at the point; slope is only a lower bound with 39.5% raster coverage, and soil/GHG remain open. Rule research reports 10/12 documents with partial coverage. Climate examples show 75.8 cm in the low-probability river/sea scenario at one selected point and 4.9 cm in the 70 mm/hour rainfall scenario at another; NoData never becomes zero or an all-clear. Driving examples to Stationsplein Maastricht are 2, 2 and 9 minutes without live traffic.

The recording exposed untranslated cached climate explanations and a raw zoning-group label. Render-time EN/NL/DE localization now fixes both, preserving source identifiers, numeric values, query URLs and unknown states. Five added regression checks cover language changes, cached records, immutable provenance and unknown wording; the complete Node suite now passes 214 tests.

Final media statistics and browser playback checks are recorded with the validated media build and release receipt. The old trailer/briefing remain recoverable in the demo folder's `archive-49s-trailer/`. The live user instance at localhost:4174 and its cases were preserved; recording used a separate temporary local origin.


### Initial detailed-demo verification — audio conclusion superseded

The audio conclusion below was invalidated by the subsequent missing-speech report. Aggregate RMS and an unmuted browser did not establish complete narration; see the audio repair entry below. Historical media sizes/hashes describe the first long build.

Final English video: 376.834 seconds (6:17 rounded), 1280×720 at 24 fps, H.264 with one 48 kHz AAC track; 13,754,447 bytes. Enhanced Apple Siri Aaron, quality 2, rate 0.5; 30 narration beats and ten chapters. Decoded audio RMS 0.08560, peak 0.86040, no clipping; technical verification, not a human audition claim. Full-resolution final encoded scenes and all narration-to-capture mappings were reviewed.

Offline HTML: 20,768,831 bytes with exact matching embedded MP4 hash. App/hosted HTML: 2,429,564 bytes plus the same MP4. English/German/Dutch chapter controls show all ten chapters; environment catalogue filter returns 4/30; invalid example area ranges disable copying and valid values restore it. Browser error logs remained empty.

Playback QA found that the Python server did not support MP4 seeking. Single-byte-range support now returns exact 206/Content-Range responses, bounded reads, 416 for unsatisfiable requests, correct HEAD and conditional semantics. Eight tests cover these behaviors and existing static-path protections; the full suite passes 214 Node and 28 Python tests. The verified main listener was restarted once on the unchanged port 4174. Live browser seeking reached 242.12 seconds and 328.52 seconds with sound unmuted, and the complete 376.834-second range was seekable. The temporary recording server was stopped.

The browser policy forbids direct file: navigation for automated verification. The self-contained offline bytes and asset hashes were checked without bypassing that restriction; browser interaction checks used the distinct application-served briefing on localhost:4174.


The first long-demo publication was rejected because TAR headers/padding put the full expanded stream at 268,693,504 bytes, despite regular-file sizes totaling less than 256 MiB. No deployment was recorded. The geographic inventory now also uses an exact gzip twin: all 2,904,246 original bytes, coordinates and attributes remain identical after decompression. The readable local inventory is retained and its updater regenerates both formats. Video pixels, audio and source features are unchanged. Publication validation checks the full uncompressed archive stream, not only member payload sizes.


After the boundary-packaging fix, all 216 Node and 28 Python tests pass. A fresh localhost:4174 browser boot loaded all 12 provinces and 342 municipalities from the losslessly compressed inventory; no browser errors were logged. Existing main-origin cases and language preferences remained present.


### Missing narration repair · 18 October 2026

The initial long MP4 contained 42.7 seconds of opening silence and several later gaps. Nine source CAF files had been truncated to 512 silent samples by late speech callbacks after initial validation. The synthesis writer now locks completion, closes before publishing a unique temporary file atomically, and ignores late callbacks. Healthy segments and the original encoded video are retained.

`verify-audio.py` independently decodes actual source files and the final MP4, checks source duration against the unchanged timeline, then compares every spoken interval and each audible 100 ms chunk. The broken build fails exactly nine intervals. Briefing packaging now requires a successful report bound to the exact final video hash. Hosted media URLs include a hash query to invalidate cached earlier video. Final repair metrics belong in the generated `audio-verification.json`, `walkthrough-qa.json` and release receipt. No human audition is claimed by these technical checks.

Repair verified: all 30 speech intervals and 2,949 audible 100 ms chunks pass; first speech at 0.58 s. The repaired 15,219,331-byte MP4 has SHA-256 `de7bd50cacefaf49943d881ac7318debc64315557f63b89f61f00f063324753e`; its encoded video packets are identical to the original. Stable standalone MP4, offline HTML and localhost media all match. Browser playback and chapter seeking use the new hash URL with sound unmuted. Private web publication is pending the concurrent permit-history implementation; this repair did not push or publish its unfinished feature files. See `audio-repair-receipt.json`.
