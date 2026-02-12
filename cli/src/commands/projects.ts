import { Command } from '@commander-js/extra-typings';
import { CliError, ApiError } from '../lib/errors.js';
import { readConfigFile, resolveConfigValue, writeConfig } from '../lib/config.js';
import { createHttpClient } from '../lib/http-client.js';
import { resolveProject } from '../lib/slug-resolver.js';
import { output, outputDetail, detectFormat, type OutputFormat } from '../lib/output.js';
import { withSpinner } from '../lib/spinner.js';
import { requireInteractive, confirmSlug } from '../lib/prompt.js';
import { slugify } from '../lib/slug.js';
import { getVersion } from '../lib/version.js';

// Types matching API responses
interface ProjectResponse {
  projectId: string;
  name: string;
  slug: string;
  apiKeyHash: string;
  createdAt: string;
  updatedAt: string;
}

interface GlobalOpts {
  format?: OutputFormat;
  quiet?: boolean;
  verbose?: boolean;
  apiUrl?: string;
  project?: string;
  env?: string;
}

export const projectsCommand = new Command('projects')
  .description('Manage projects');

projectsCommand
  .command('list')
  .description('List all projects')
  .action(async function () {
    const opts = this.optsWithGlobals() as GlobalOpts;

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const { data } = await withSpinner('Fetching projects...', () =>
      client.get<ProjectResponse[]>('/projects'),
    );

    // Clean data for JSON output (exclude apiKeyHash)
    const cleanData = data.map((p) => ({
      projectId: p.projectId,
      name: p.name,
      slug: p.slug,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    output(cleanData, {
      headers: ['NAME', 'SLUG', 'CREATED'],
      rows: data.map((p) => [
        p.name,
        p.slug,
        p.createdAt.split('T')[0],
      ]),
    }, { format: opts.format as OutputFormat | undefined, quiet: opts.quiet });
  });

projectsCommand
  .command('create')
  .argument('<name>', 'Project name')
  .option('--slug <slug>', 'Custom slug (auto-derived from name if omitted)')
  .option('--no-default-envs', 'Skip creating default environments')
  .description('Create a new project')
  .action(async function (name: string) {
    const localOpts = this.opts() as { slug?: string; defaultEnvs: boolean };
    const opts = this.optsWithGlobals() as GlobalOpts;

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const slug = localOpts.slug ?? slugify(name);
    const apiKeyHash = crypto.randomUUID();

    let result: { projectId: string };
    try {
      const res = await withSpinner('Creating project...', () =>
        client.post<{ projectId: string }>('/projects', {
          name,
          slug,
          apiKeyHash,
        }),
      );
      result = res.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        throw new CliError(`Slug "${slug}" is invalid or already taken`);
      }
      throw err;
    }

    const format = detectFormat(opts.format as OutputFormat | undefined);
    const envSlugs: string[] = [];

    // Create default environments unless --no-default-envs
    if (localOpts.defaultEnvs !== false) {
      let tier = 'free';
      try {
        const { data: billing } = await client.get<{ tier: string }>('/billing/status');
        tier = billing.tier;
      } catch {
        // Best-effort -- default to free tier env list
      }

      const hasStagingEnv = tier === 'hobby' || tier === 'pro';
      const DEFAULT_ENVS = hasStagingEnv
        ? [
            { name: 'Development', slug: 'development', color: '#22c55e' },
            { name: 'Staging', slug: 'staging', color: '#f59e0b' },
            { name: 'Production', slug: 'production', color: '#ef4444' },
          ]
        : [
            { name: 'Development', slug: 'development', color: '#22c55e' },
            { name: 'Production', slug: 'production', color: '#ef4444' },
          ];
      for (const env of DEFAULT_ENVS) {
        try {
          await client.post(
            `/projects/${result.projectId}/environments`,
            env,
          );
          envSlugs.push(env.slug);
          if (!opts.quiet && format !== 'json') {
            process.stderr.write(`  ${env.name} environment created\n`);
          }
        } catch {
          // Best-effort -- don't fail project create if env creation fails
          if (!opts.quiet && format !== 'json') {
            process.stderr.write(
              `  Warning: failed to create ${env.name} environment\n`,
            );
          }
        }
      }
    }

    if (opts.quiet) return;

    if (format === 'json') {
      const jsonOut: Record<string, unknown> = {
        projectId: result.projectId,
        slug,
      };
      if (envSlugs.length > 0) {
        jsonOut.environments = envSlugs;
      }
      process.stdout.write(JSON.stringify(jsonOut, null, 2) + '\n');
    } else {
      process.stderr.write(`Created project ${slug}\n`);
    }
  });

projectsCommand
  .command('get')
  .argument('<slug>', 'Project slug')
  .description('Show project details')
  .action(async function (slug: string) {
    const opts = this.optsWithGlobals() as GlobalOpts;

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    let project: ProjectResponse;
    try {
      const { data } = await withSpinner('Fetching project...', () =>
        client.get<ProjectResponse>(
          `/projects/by-slug/${encodeURIComponent(slug)}`,
        ),
      );
      project = data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new CliError(
          `Project "${slug}" not found. Run: skystate projects list`,
        );
      }
      throw err;
    }

    // Clean data for JSON output (exclude apiKeyHash)
    const detailData: Record<string, unknown> = {
      name: project.name,
      slug: project.slug,
      created: project.createdAt.split('T')[0],
      updated: project.updatedAt.split('T')[0],
    };

    outputDetail(detailData, {
      format: opts.format as OutputFormat | undefined,
      quiet: opts.quiet,
    });
  });

projectsCommand
  .command('update')
  .argument('<slug>', 'Project slug')
  .requiredOption('--name <name>', 'New project name')
  .description('Update a project')
  .action(async function (slug: string) {
    const localOpts = this.opts() as { name: string };
    const opts = this.optsWithGlobals() as GlobalOpts;

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const projectId = await resolveProject(client, slug);

    // Fetch current project to preserve apiKeyHash
    const { data: current } = await client.get<ProjectResponse>(
      `/projects/${projectId}`,
    );

    try {
      await withSpinner('Updating project...', () =>
        client.put(`/projects/${projectId}`, {
          name: localOpts.name,
          apiKeyHash: current.apiKeyHash,
        }),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new CliError(
          `Project "${slug}" not found. Run: skystate projects list`,
        );
      }
      throw err;
    }

    if (opts.quiet) return;

    const format = detectFormat(opts.format as OutputFormat | undefined);
    if (format === 'json') {
      process.stdout.write(
        JSON.stringify({ slug, name: localOpts.name }, null, 2) + '\n',
      );
    } else {
      process.stderr.write(`Updated project ${slug}\n`);
    }
  });

projectsCommand
  .command('delete')
  .argument('<slug>', 'Project slug')
  .option('--force', 'Skip confirmation prompt')
  .description('Delete a project')
  .action(async function (slug: string) {
    const localOpts = this.opts() as { force?: boolean };
    const opts = this.optsWithGlobals() as GlobalOpts;

    // Confirmation
    if (!localOpts.force) {
      requireInteractive(false);
      const confirmed = await confirmSlug(
        `This will permanently delete project "${slug}" and all its data.`,
        slug,
      );
      if (!confirmed) {
        process.stderr.write('Aborted\n');
        process.exitCode = 1;
        return;
      }
    }

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const projectId = await resolveProject(client, slug);

    try {
      await withSpinner('Deleting project...', () =>
        client.del(`/projects/${projectId}`),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new CliError(
          `Project "${slug}" not found. Run: skystate projects list`,
        );
      }
      throw err;
    }

    if (opts.quiet) return;

    const format = detectFormat(opts.format as OutputFormat | undefined);
    if (format === 'json') {
      process.stdout.write(
        JSON.stringify({ deleted: slug }, null, 2) + '\n',
      );
    } else {
      process.stderr.write(`Deleted project ${slug}\n`);
    }
  });

projectsCommand
  .command('select')
  .argument('<slug>', 'Project slug')
  .description('Set the default project')
  .action(async function (slug: string) {
    const opts = this.optsWithGlobals() as GlobalOpts;

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    // Validate slug exists
    await resolveProject(client, slug);

    // Save to config
    await writeConfig('default_project', slug);

    if (opts.quiet) return;
    process.stderr.write(`Default project set to: ${slug}\n`);
  });
