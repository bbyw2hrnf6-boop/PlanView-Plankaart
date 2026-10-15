# PlanView development and publication

This folder is the canonical app. Preserve the existing map/data logic and local user credentials. The user requested that localhost and the private cloud app stay synchronized.

After a user-authorized app change is implemented and validated, follow CLOUD_SYNC.md to publish the same browser assets to the existing PlanView Site. Use the installed Sites skill and native Sites tools, preserve the existing owner-only audience, and retain all credentials only in session memory. Do not create another Site, use the deprecated prototype source as authoritative, or commit credentials/browser data. Do not force-reset source conflicts. Report failed publication rather than claiming both copies match.

Local Codex CLI AI and DSO/RP proxies are currently unavailable in the static cloud version. Do not imply otherwise or copy local sign-in tokens into hosting.
