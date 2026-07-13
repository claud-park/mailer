import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { app, shell } from 'electron';
import { google, Auth } from 'googleapis';

type OAuth2Client = Auth.OAuth2Client;
type Credentials = Auth.Credentials;

const SERVICE = 'zenmail';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/calendar.events',
];

export function getClientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID ?? readLocalConfig().clientId;
}

function getClientSecret(): string | undefined {
  return process.env.GOOGLE_CLIENT_SECRET ?? readLocalConfig().clientSecret;
}

function readLocalConfig(): { clientId?: string; clientSecret?: string } {
  try {
    const file = path.join(app.getPath('userData'), 'config.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// keytar is a native module; fall back to a plain file if it failed to build
// so a broken rebuild never blocks app startup.
type TokenStore = {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  del(account: string): Promise<void>;
  list(): Promise<string[]>;
};

function fileStore(): TokenStore {
  const file = path.join(app.getPath('userData'), 'tokens.json');
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  };
  const write = (data: Record<string, string>) =>
    fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  return {
    async get(account) {
      return read()[account] ?? null;
    },
    async set(account, value) {
      const d = read();
      d[account] = value;
      write(d);
    },
    async del(account) {
      const d = read();
      delete d[account];
      write(d);
    },
    async list() {
      return Object.keys(read());
    },
  };
}

function keytarStore(): TokenStore | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const keytar = require('keytar') as typeof import('keytar');
    // A native Keychain call can fail at RUNTIME for reasons unrelated to keytar being
    // installed at all — ACL/signature mismatch after a rebuild, a locked keychain, a denied
    // access prompt. Every operation degrades to the file store rather than letting an
    // uncaught native rejection crash its caller (auth:get-account, sign-in's token save,
    // sign-out's token delete). The file store is created lazily and lives for the process
    // lifetime, so a set() that falls back is later found by a get() that also falls back.
    const fallback = fileStore();
    return {
      async get(account) {
        try {
          const v = await keytar.getPassword(SERVICE, account);
          if (v !== null) return v;
        } catch (err) {
          console.warn('[auth] keychain read failed, falling back to file store:', err);
        }
        return fallback.get(account);
      },
      async set(account, value) {
        try {
          await keytar.setPassword(SERVICE, account, value);
        } catch (err) {
          console.warn('[auth] keychain write failed, falling back to file store:', err);
          await fallback.set(account, value);
        }
      },
      async del(account) {
        try {
          await keytar.deletePassword(SERVICE, account);
        } catch (err) {
          console.warn('[auth] keychain delete failed, falling back to file store:', err);
        }
        await fallback.del(account);
      },
      async list() {
        try {
          const creds = await keytar.findCredentials(SERVICE);
          return creds.map((c) => c.account);
        } catch (err) {
          console.warn('[auth] keychain list failed, falling back to file store:', err);
          return fallback.list();
        }
      },
    };
  } catch (err) {
    console.warn('[auth] keytar unavailable, falling back to file store:', err);
    return null;
  }
}

const store: TokenStore = keytarStore() ?? fileStore();

const ACCOUNT_KEY_FILE = () => path.join(app.getPath('userData'), 'account.json');

export function getStoredEmail(): string | null {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNT_KEY_FILE(), 'utf8')).email ?? null;
  } catch {
    return null;
  }
}

function setStoredEmail(email: string | null): void {
  if (email === null) {
    fs.rmSync(ACCOUNT_KEY_FILE(), { force: true });
  } else {
    fs.writeFileSync(ACCOUNT_KEY_FILE(), JSON.stringify({ email }));
  }
}

function newOAuthClient(redirectUri?: string): OAuth2Client {
  return new google.auth.OAuth2({
    clientId: getClientId(),
    clientSecret: getClientSecret(),
    redirectUri,
  });
}

/** Returns an authorized client for the stored account, or null if signed out. */
export async function getAuthorizedClient(): Promise<{
  client: OAuth2Client;
  email: string;
  calendarReady: boolean;
} | null> {
  const email = getStoredEmail();
  if (!email) return null;
  const raw = await store.get(email);
  if (!raw) return null;
  const client = newOAuthClient();
  let current = JSON.parse(raw) as Credentials;
  // 저장 토큰의 scope 문자열에 calendar.events 포함 여부 → calendarReady (강제 무효화 없음).
  const calendarReady = typeof current.scope === 'string' && current.scope.includes('calendar.events');
  client.setCredentials(current);
  client.on('tokens', (tokens) => {
    // persist refreshed tokens, accumulating across consecutive refreshes
    // so a rotated refresh_token is never overwritten by a stale one
    current = { ...current, ...tokens };
    void store.set(email, JSON.stringify(current));
  });
  return { client, email, calendarReady };
}

/** Full interactive sign-in: PKCE + loopback redirect + Keychain storage. */
export async function signIn(): Promise<string> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error(
      'GOOGLE_CLIENT_ID is not configured. Set the env var or add clientId to config.json in userData.'
    );
  }

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  const { server, port, codePromise } = await startLoopbackServer();
  try {
    const redirectUri = `http://localhost:${port}`;
    const client = newOAuthClient(redirectUri);
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      code_challenge_method: 'S256' as never,
      code_challenge: challenge,
    } as never);
    await shell.openExternal(url);

    const code = await codePromise;
    const { tokens } = await client.getToken({ code, codeVerifier: verifier, redirect_uri: redirectUri });
    client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress ?? 'unknown';

    await store.set(email, JSON.stringify(tokens));
    setStoredEmail(email);
    return email;
  } finally {
    server.close();
  }
}

export async function signOut(): Promise<void> {
  const email = getStoredEmail();
  if (email) await store.del(email);
  setStoredEmail(null);
}

function startLoopbackServer(): Promise<{
  server: http.Server;
  port: number;
  codePromise: Promise<string>;
}> {
  return new Promise((resolveStart) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body style="background:#0f0f0f;color:#ececec;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><p>ZenMail sign-in complete. You can close this tab.</p></body></html>'
      );
      if (code) resolveCode(code);
      else if (error) rejectCode(new Error(`OAuth error: ${error}`));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolveStart({ server, port, codePromise });
    });
    // give up after 5 minutes
    setTimeout(() => rejectCode(new Error('Sign-in timed out')), 5 * 60 * 1000).unref();
  });
}
