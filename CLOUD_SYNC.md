# PlanView local/cloud synchronization

Canonical app: `/Users/uhorizon/Documents/PlanView Plankaart`.
Private Site: `appgprj_6ab985de2e6481918b9e1e3ccccdfcd8`.
Web URL: https://planview-maastricht-spatial.dannhir.chatgpt.site
Generated Site source checkout: `/Users/uhorizon/Documents/ChatGPT/InteractiveMap/work/planview-cloud`.

The desktop keeps serving the canonical app at localhost:4174. The Site serves a sanitized static mirror, independent of the Mac being awake. Maintain the current owner-only audience. Do not expose local credentials or copy Codex sign-in material into the Site. Browser cases and preferences are device-specific and are not synchronized. The current cloud release includes public maps, 3D, address search, simple phrase interpretation and map screening; it has no Codex CLI AI or DSO/RP server.

## Publishing procedure

1. Run `python3 tools/cloud_release.py status` from the canonical app. If unchanged, finish quietly. A scheduled run should defer while `settled` is false.
2. Read the installed Sites skill. Get the existing Site and verify its audience is still owner-only. Obtain a fresh source repository write credential with the native Sites tool; keep it in session memory, pass it to the source helper through hidden stdin, never save or print it.
3. Open/refresh the generated checkout using the Sites source helper. Use its exact opening result throughout. If cloud and local edits diverged, stop and report the conflict; never reset either history.
4. Run `python3 tools/cloud_release.py stage --checkout "/Users/uhorizon/Documents/ChatGPT/InteractiveMap/work/planview-cloud"` from the canonical app. Only the first migration uses `--force-initial`. The script validates JS/JSON/assets, mirrors allowlisted runtime files, writes matching release.json to both copies, and rejects independently advanced cloud source.
5. Package and push with the native Sites source helper using the prior opening result, no remaining commands, and an absolute tar.gz archive path. The helper owns the cloud source commit and push.
6. Publish that exact commit/archive with `save_version_and_deploy_private`. Poll only nonterminal deployments. On failure keep the returned saved version ID and follow the Sites repair workflow. Do not record a failed deployment as published.
7. After confirmed success, run `python3 tools/cloud_release.py record --fingerprint FINGERPRINT --commit SITE_COMMIT --deployment DEPLOYMENT_ID` with the exact staged fingerprint and returned identifiers. This saves a local receipt used to skip unchanged runs.

A heartbeat checks every ten minutes while the local Codex executor is available; it cannot publish new local edits while the Mac or Codex app is offline. Already published files remain hosted. Existing open pages need reloading to use new files. Direct Codex app edits should use this same procedure immediately after validation, so they do not wait for the heartbeat.
