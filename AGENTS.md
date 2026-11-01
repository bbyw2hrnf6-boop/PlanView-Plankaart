# PlanView development and publication

This folder is the canonical app. Preserve the existing map/data logic and local user credentials. The user requested that localhost and the private cloud app stay synchronized.

Since 18 October 2026 this folder is `InteractiveMap/app/`; the former separate `Documents/PlanView Plankaart` was moved here whole. The generated checkout is the sibling `InteractiveMap/deploy/site/`. Read `../README.md` for the unified layout. Preserve localhost:4174 and use the root/Desktop launcher. Archived copies under `../archive/work/` are historical, not active sources. A path/documentation-only move leaves browser assets unchanged; verify release status instead of redeploying unchanged content.

After a user-authorized app change is implemented and validated, follow CLOUD_SYNC.md immediately in the same task to push and publish the matching browser assets and cloud server source to the existing PlanView Site before reporting the change complete. Use the installed Sites skill and native Sites tools, preserve the existing owner-only audience, and retain all credentials only in session memory. Do not create another Site, use the deprecated prototype source as authoritative, or commit credentials/browser data. Do not force-reset source conflicts. Report failed publication rather than claiming both copies match.

The cloud Worker supports GPT-6 Luna High with a user-supplied API key entered through the web settings. Keys are encrypted per signed-in account; keep the native PLANVIEW_CREDENTIAL_KEY secret unchanged. The cloud Rules tab supports actual DSO text using a separately entered, encrypted per-account DSO key. Codex CLI sessions and DSO geometry/RP proxies remain local. Never copy local sign-in tokens or API keys into hosting source.

Synchronization is part of the app-change workflow, not a scheduled task. The user explicitly removed the recurring cloud-sync automation. Do not recreate a heartbeat, periodic check, background watcher, or recurring sync job. Run release status, validation, source push, deployment and receipt recording as part of each authorized PlanView change. Do not claim arbitrary external local edits or Git pushes are automatically detected.


## Desktop integration · 18 October 2026

For desktop UI changes, preserve every executable search criterion and source/unknown-state distinction. Use shared `feedback.css` loading treatments; percentages require a known denominator. Test search CTA hit targets, focused criteria editing, cancelled/partial results, stale-response handling, comparison state and reduced motion. Keep the self-contained `briefing.html` and current README/source docs aligned with the implemented behavior. Historical dated audits must be marked superseded rather than rewritten as current evidence.
