import { Command } from '@commander-js/extra-typings';
import { CliError } from '../lib/errors.js';
import { readConfigFile, resolveConfigValue, writeConfig } from '../lib/config.js';
import { resolveEnvironment } from '../lib/slug-resolver.js';
import { output, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  format?: OutputFormat;
  quiet?: boolean;
  verbose?: boolean;
  apiUrl?: string;
  project?: string;
  env?: string;
}

/**
 * Fixed environments available per tier.
 * Environments are no longer user-managed -- they are fixed strings.
 */
const FREE_ENVIRONMENTS = ['development', 'production'] as const;
const PAID_ENVIRONMENTS = ['development', 'staging', 'production'] as const;

export const envsCommand = new Command('envs')
  .description('Manage environments');

envsCommand
  .command('list')
  .description('List available environments for the current project')
  .action(async function () {
    const opts = this.optsWithGlobals() as GlobalOpts;

    const configFile = await readConfigFile();

    // Resolve project slug from flag or config (just for display context)
    const projectSlug =
      opts.project ?? resolveConfigValue('default_project', configFile).value;
    if (!projectSlug) {
      throw new CliError(
        'No project selected. Run: skystate projects select <slug>',
      );
    }

    // Show all three environments -- tier detection is not available locally
    // Free tier gets development + production; paid tiers get all three.
    // Since we cannot determine tier locally, show all with a note.
    const environments = PAID_ENVIRONMENTS.map((slug) => ({
      slug,
      available: 'all tiers' as string,
    }));

    // Mark free-only environments
    for (const env of environments) {
      if ((FREE_ENVIRONMENTS as readonly string[]).includes(env.slug)) {
        env.available = 'all tiers';
      } else {
        env.available = 'hobby, pro';
      }
    }

    const jsonData = environments.map((e) => ({
      slug: e.slug,
      available: e.available,
    }));

    output(jsonData, {
      headers: ['ENVIRONMENT', 'AVAILABLE'],
      rows: environments.map((e) => [e.slug, e.available]),
    }, { format: opts.format as OutputFormat | undefined, quiet: opts.quiet });
  });

envsCommand
  .command('select')
  .argument('<slug>', 'Environment slug')
  .description('Set the default environment')
  .action(async function (slug: string) {
    const opts = this.optsWithGlobals() as GlobalOpts;

    // Validate environment slug locally (no API call needed)
    resolveEnvironment(slug);

    // Save to config
    await writeConfig('default_env', slug);

    if (opts.quiet) return;
    const configFile = await readConfigFile();
    const projectSlug =
      opts.project ?? resolveConfigValue('default_project', configFile).value;
    process.stderr.write(
      `Default environment set to: ${slug}${projectSlug ? ` (project: ${projectSlug})` : ''}\n`,
    );
  });
