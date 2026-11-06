// CLI-only preload; never bundled into the app or deployed Function.
const {bufferedHostingFetch}=require('./upload-transport.cjs');
globalThis.fetch=bufferedHostingFetch(globalThis.fetch.bind(globalThis));
// One-time owner deployment: gcloud supplies a short-lived OAuth access token.
// Seed the CLI's memory cache rather than trying to refresh that access token
// before every file. GitHub's regular ADC/OIDC flow does not use this variable.
if(process.env.PLANVIEW_CLI_ACCESS_TOKEN) {
  if(process.env.PLANVIEW_CLI_ACCESS_TOKEN!==process.env.FIREBASE_TOKEN)throw Error('Deployment token mismatch');
  require('./node_modules/firebase-tools/lib/apiv2').setAccessToken(process.env.PLANVIEW_CLI_ACCESS_TOKEN);
}
