/** Turn Firebase Auth / Firestore errors into plain sentences a school office can act on. */
export function friendlyAuthError(e: any): string {
  const c = (e?.code as string | undefined) ?? '';
  const m = (e?.message as string | undefined) ?? '';
  switch (c) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials': return 'Incorrect email or password.';
    case 'auth/invalid-email': return 'That email address doesn’t look right.';
    case 'auth/missing-password': return 'Enter your password.';
    case 'auth/email-already-in-use': return 'An account with this email already exists. Sign in instead — or, if sign-up didn’t finish last time, use the same password here to finish it.';
    case 'auth/weak-password': return 'Use a password of at least 6 characters.';
    case 'auth/too-many-requests': return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed': return 'No connection. Check your internet and try again.';
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation': return 'That sign-in method is switched off. In the Firebase console, open Authentication → Sign-in method and turn on Email/Password, Anonymous (for the demo) and Google (for owners).';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return 'The Google window was closed before signing in. Try again.';
    case 'auth/popup-blocked': return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/credential-already-in-use': return 'That email already has a Musa OS account. Sign in with it instead.';
    case 'auth/configuration-not-found': return 'Firebase Authentication isn’t set up yet. In the Firebase console, open Authentication and click Get started, then enable Email/Password.';
    case 'auth/unauthorized-domain': return `This web address isn’t allowed to sign in yet. In the Firebase console, open Authentication → Settings → Authorized domains and add ${location.hostname}.`;
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.': return 'The Firebase API key is wrong. Check VITE_FIREBASE_API_KEY in your environment variables and redeploy.';
    case 'permission-denied': return 'The database refused the request. Publish the Firestore security rules (Firestore Database → Rules) and try again.';
    case 'unavailable':
    case 'failed-precondition':
    case 'not-found': return 'Can’t reach the database. Make sure Cloud Firestore has been created in the Firebase console (Firestore Database → Create database).';
  }
  if (/insufficient permissions/i.test(m)) return 'The database refused the request. Publish the Firestore security rules (Firestore Database → Rules) and try again.';
  if (/client is offline|database .* does not exist|NOT_FOUND/i.test(m)) return 'Can’t reach the database. Make sure Cloud Firestore has been created in the Firebase console (Firestore Database → Create database).';
  if (/api-key-not-valid|invalid-api-key/i.test(m + c)) return 'The Firebase API key is wrong. Check VITE_FIREBASE_API_KEY in your environment variables and redeploy.';
  return m || 'Something went wrong. Please try again.';
}
