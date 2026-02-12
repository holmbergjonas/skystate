/**
 * Read the CLI version from package.json at runtime.
 *
 * Falls back to '0.1.0' if package.json cannot be read (e.g., during tests).
 */
export async function getVersion(): Promise<string> {
  try {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../package.json'), 'utf8'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}
