#!/usr/bin/env bash
# Run manually as project owner after the first successful CLI deployment.
# Creates scoped deployment access; never creates/downloads a service-account JSON key.
set -euo pipefail
if [[ "${1:-}" != "--apply" ]]; then
  printf '%s\n' 'Review this file, then run: bash firebase/setup-github-oidc.sh --apply' >&2
  exit 2
fi
PROJECT_ID='planview-ecf9b'
REPOSITORY='bbyw2hrnf6-boop/PlanView-Plankaart'
DEPLOY_ACCOUNT="planview-github@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_ACCOUNT="planview-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project="$PROJECT_ID"
if ! gcloud iam service-accounts describe "$DEPLOY_ACCOUNT" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create planview-github --display-name='Planview GitHub deployment' --project="$PROJECT_ID"
fi
for role in roles/firebasehosting.admin roles/cloudfunctions.admin roles/run.admin roles/firebase.viewer roles/firebaserules.admin roles/datastore.indexAdmin roles/secretmanager.viewer roles/serviceusage.serviceUsageConsumer roles/serviceusage.apiKeysViewer roles/artifactregistry.reader; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${DEPLOY_ACCOUNT}" --role="$role" --condition=None --quiet >/dev/null
done
# CI may deploy as the existing runtime account; it cannot download its private key.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_ACCOUNT" --member="serviceAccount:${DEPLOY_ACCOUNT}" --role=roles/iam.serviceAccountUser --project="$PROJECT_ID" --quiet >/dev/null
if ! gcloud iam workload-identity-pools describe github --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create github --location=global --display-name='Planview GitHub' --project="$PROJECT_ID"
fi
if ! gcloud iam workload-identity-pools providers describe planview-main --workload-identity-pool=github --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc planview-main --workload-identity-pool=github --location=global --issuer-uri='https://token.actions.githubusercontent.com' --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' --attribute-condition="assertion.repository == '${REPOSITORY}' && assertion.ref == 'refs/heads/main'" --project="$PROJECT_ID"
fi
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_ACCOUNT" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPOSITORY}" --project="$PROJECT_ID" --quiet >/dev/null
printf '\nGitHub repository variables:\nFIREBASE_PROJECT_ID=%s\nGCP_DEPLOY_SERVICE_ACCOUNT=%s\nGCP_WORKLOAD_IDENTITY_PROVIDER=projects/%s/locations/global/workloadIdentityPools/github/providers/planview-main\n' "$PROJECT_ID" "$DEPLOY_ACCOUNT" "$PROJECT_NUMBER"
