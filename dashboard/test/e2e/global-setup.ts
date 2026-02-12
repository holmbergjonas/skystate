import { deleteAllProjects } from './helpers';

async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? 'http://skystate_proxy:80';

  try {
    const response = await fetch(`${baseURL}/api/users/me`, {
      headers: {
        'X-Test-GitHub-Id': 'e2e-health-check',
        'X-Test-Email': 'health@test.com',
        'X-Test-Name': 'Health Check',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(
        `Stack health check failed (status ${response.status}).\n` +
        `Ensure docker-compose is running: ./up.sh`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Stack health check failed')) {
      throw err;
    }
    throw new Error(
      `Cannot reach ${baseURL} — stack appears to be down.\n` +
      `Start it with: ./up.sh`
    );
  }

  // Clean up leftover projects from previous test runs
  await deleteAllProjects();
}

export default globalSetup;
