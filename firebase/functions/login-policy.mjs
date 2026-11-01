// Public login identifiers, never passwords. Only the pinned Firebase UID gets access.
export const TEST_USER_NAME='TestUser02';
export const TEST_USER_EMAIL='testuser02@planview-ecf9b.invalid';
export function accessAllowed(token,emails,testUserUid='') {
  if(!token?.uid)return false;
  if(testUserUid&&token.uid===testUserUid&&token.email===TEST_USER_EMAIL&&token.firebase?.sign_in_provider==='password')return true;
  return token.email_verified===true&&new Set(emails.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)).has(String(token.email||'').toLowerCase());
}
