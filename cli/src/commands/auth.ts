import { Command } from '@commander-js/extra-typings';
import { CliError } from '../lib/errors.js';
import {
  resolveTokenWithSource,
  resolveConfigValue,
  readConfigFile,
  writeCredentials,
  getCredentialsPath,
} from '../lib/config.js';
import { createHttpClient } from '../lib/http-client.js';
import { outputDetail, type OutputFormat } from '../lib/output.js';
import { withSpinner } from '../lib/spinner.js';

// Types matching API responses
interface UserResponse {
  userId: string;
  email: string | null;
  displayName: string | null;
  ssoProvider: string;
  subscriptionTier: string;
  boostMultiplier: number;
}

interface BillingStatusResponse {
  tier: string;
  boostMultiplier: number;
  projects: { count: number; limit: number | null };
  environments: { count: number; limit: number | null };
  storage: { bytes: number; limit: number | null };
  apiRequests: { count: number; limit: number | null; resetDate: string };
}

/** Debug log to stderr when --verbose is set. */
function debugAuth(verbose: boolean | undefined, msg: string): void {
  if (verbose) {
    process.stderr.write(`[debug:auth] ${msg}\n`);
  }
}

/**
 * Open a URL in the default browser.
 * Falls back to printing the URL if browser cannot be opened.
 */
async function openBrowser(url: string): Promise<boolean> {
  const { exec } = await import('node:child_process');
  const { platform } = await import('node:os');

  const commands: Record<string, string> = {
    darwin: 'open',
    win32: 'start',
    linux: 'xdg-open',
  };

  const cmd = commands[platform()];
  if (!cmd) return false;

  return new Promise((resolve) => {
    exec(`${cmd} ${JSON.stringify(url)}`, (err) => {
      resolve(!err);
    });
  });
}

// ---------------------------------------------------------------------------
// Shared action handlers
// ---------------------------------------------------------------------------

interface LoginOpts {
  format?: OutputFormat;
  quiet?: boolean;
  verbose?: boolean;
  apiUrl?: string;
  browser?: boolean;
}

async function loginAction(opts: LoginOpts): Promise<void> {
  debugAuth(opts.verbose, 'login command started');

  const configFile = await readConfigFile();
  const apiUrl =
    opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
  debugAuth(opts.verbose, `resolved apiUrl=${apiUrl}`);

  const { createInterface } = await import('node:readline');

  const base = apiUrl.replace(/\/+$/, '');
  const loginUrl = `${base}/auth/github?flow=cli`;

  if (opts.browser !== false) {
    const opened = await openBrowser(loginUrl);
    if (opened) {
      process.stderr.write('Opening browser for login...\n');
    } else {
      process.stderr.write(`Open this URL to log in:\n  ${loginUrl}\n\n`);
    }
  } else {
    process.stderr.write(`Open this URL to log in:\n  ${loginUrl}\n\n`);
  }

  process.stderr.write('Paste token: ');

  const LOGIN_TIMEOUT_MS = 120_000;

  const token = await new Promise<string>((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, terminal: false });

    const timeout = setTimeout(() => {
      rl.close();
      reject(new CliError('Login timed out'));
    }, LOGIN_TIMEOUT_MS);

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      clearTimeout(timeout);
      rl.close();
      resolve(trimmed);
    });
  });

  debugAuth(opts.verbose, 'token received, writing credentials');
  // Write token to credentials file
  await writeCredentials(token);

  // Fetch user info to display success message
  let version = '0.1.0';
  try {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../package.json'), 'utf8'),
    ) as { version: string };
    version = pkg.version;
  } catch {
    // use default version
  }

  const client = createHttpClient({
    apiUrl,
    verbose: opts.verbose ?? false,
    version,
  });

  debugAuth(opts.verbose, 'fetching /users/me to confirm identity');
  try {
    const { data: user } = await client.get<UserResponse>('/users/me');
    debugAuth(opts.verbose, `user confirmed: userId=${user.userId} email=${user.email}`);
    process.stderr.write(
      `Logged in as ${user.email ?? 'unknown'} (${user.displayName ?? 'unknown'})\n`,
    );
  } catch (err) {
    debugAuth(opts.verbose, `failed to fetch /users/me: ${err instanceof Error ? err.message : String(err)}`);
    // Token stored but user info fetch failed -- still report success
    process.stderr.write('Logged in successfully.\n');
  }

  process.stderr.write(
    `Token written to ${getCredentialsPath()}\n`,
  );
}

async function logoutAction(opts: { verbose?: boolean }): Promise<void> {
  debugAuth(opts.verbose, 'logout command started');

  const { unlink } = await import('node:fs/promises');
  const credPath = getCredentialsPath();
  debugAuth(opts.verbose, `removing credentials at ${credPath}`);

  try {
    await unlink(credPath);
    debugAuth(opts.verbose, 'credentials file deleted');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    debugAuth(opts.verbose, 'credentials file did not exist (already logged out)');
    // File doesn't exist -- that's fine, idempotent
  }

  process.stderr.write(
    `Logged out. Token removed from ${credPath}\n`,
  );
}

// ---------------------------------------------------------------------------
// Top-level commands: skystate login / skystate logout
// ---------------------------------------------------------------------------

export const loginCommand = new Command('login')
  .description('Log in via GitHub OAuth')
  .option('--no-browser', 'Print URL instead of opening browser')
  .action(async function () {
    await loginAction(this.optsWithGlobals() as LoginOpts);
  });

export const logoutCommand = new Command('logout')
  .description('Clear stored credentials')
  .action(async function () {
    await logoutAction(this.optsWithGlobals() as { verbose?: boolean });
  });

// ---------------------------------------------------------------------------
// auth subcommand group (auth login, auth logout, auth status)
// ---------------------------------------------------------------------------

export const statusCommand = new Command('status')
  .description('Show account, billing, and usage overview')
  .action(async function () {
    const opts = this.optsWithGlobals() as {
      format?: OutputFormat;
      quiet?: boolean;
      verbose?: boolean;
      apiUrl?: string;
    };

    debugAuth(opts.verbose, 'status command started');

    // Step 1: Check token exists and determine source
    const tokenInfo = await resolveTokenWithSource();
    if (!tokenInfo) {
      debugAuth(opts.verbose, 'no token found from any source');
      process.stderr.write('Not authenticated. Run: skystate login\n');
      process.exitCode = 2;
      return;
    }

    const tokenSource =
      tokenInfo.source === 'env'
        ? 'SKYSTATE_TOKEN (env var)'
        : 'credentials file';
    debugAuth(opts.verbose, `token found via ${tokenSource}`);

    // Step 2: Create HTTP client
    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;

    let version = '0.1.0';
    try {
      const { readFileSync } = await import('node:fs');
      const { dirname, join } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const pkg = JSON.parse(
        readFileSync(join(__dirname, '../package.json'), 'utf8'),
      ) as { version: string };
      version = pkg.version;
    } catch {
      // use default version
    }

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    // Step 3: Fetch user info and billing status in parallel
    debugAuth(opts.verbose, 'fetching /users/me and /billing/status in parallel');
    const [userRes, billingRes] = await withSpinner(
      'Fetching account info...',
      () =>
        Promise.all([
          client.get<UserResponse>('/users/me'),
          client.get<BillingStatusResponse>('/billing/status'),
        ]),
    );

    const user = userRes.data;
    const billing = billingRes.data;
    debugAuth(opts.verbose, `user: id=${user.userId} tier=${user.subscriptionTier} provider=${user.ssoProvider}`);

    // Step 4: Format usage strings
    const formatUsage = (count: number, limit: number | null): string =>
      limit !== null ? `${count}/${limit}` : `${count}/unlimited`;

    const formatBytes = (bytes: number, limit: number | null): string => {
      const fmt = (b: number) => {
        if (b < 1024) return `${b} B`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
        return `${(b / (1024 * 1024)).toFixed(1)} MB`;
      };
      return limit !== null ? `${fmt(bytes)}/${fmt(limit)}` : `${fmt(bytes)}/unlimited`;
    };

    // Step 5: Display with outputDetail (key-value detail view)
    const detailData: Record<string, unknown> = {
      email: user.email ?? '(not set)',
      name: user.displayName ?? '(not set)',
      provider: user.ssoProvider,
      'token source': tokenSource,
      tier: user.subscriptionTier,
      projects: formatUsage(billing.projects.count, billing.projects.limit),
      environments: formatUsage(billing.environments.count, billing.environments.limit),
      storage: formatBytes(billing.storage.bytes, billing.storage.limit),
      'api requests': formatUsage(billing.apiRequests.count, billing.apiRequests.limit),
    };

    outputDetail(detailData, {
      format: opts.format as OutputFormat | undefined,
      quiet: opts.quiet,
    });
  });
