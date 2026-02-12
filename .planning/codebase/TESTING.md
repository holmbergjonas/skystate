# Testing Patterns

**Analysis Date:** 2026-03-04

## Test Frameworks

### TypeScript (CLI and Dashboard)

**Runner:** Vitest 4.x
- CLI config: `cli/vitest.config.ts` (unit), `cli/vitest.config.e2e.ts` (E2E)
- Dashboard config: `dashboard/vite.config.ts` (unit, via `test` key), `dashboard/playwright.config.ts` (E2E)

**Assertion Library:** Vitest built-in (`expect`) + `@testing-library/jest-dom` for DOM matchers in dashboard

**Dashboard setup file:** `dashboard/src/test-setup.ts` imports `@testing-library/jest-dom/vitest`

**Run Commands:**
```bash
# CLI unit tests
cd cli && npm test                              # vitest run (unit only)
cd cli && npm run test:watch                    # vitest watch
cd cli && npm run test:e2e                      # vitest run --config vitest.config.e2e.ts

# Dashboard unit tests
cd dashboard && npm test                        # vitest run (unit only)
cd dashboard && npm run test:e2e                # playwright test

# API (C#)
cd api && dotnet test SkyState.Api.UnitTests/
cd api && dotnet test SkyState.Api.IntegrationTests/
cd api && dotnet test SkyState.Api.EndToEndTests/   # requires running PostgreSQL
```

### C# API

**Runner:** xUnit
**Mocking:** NSubstitute (`Substitute.For<IInterface>()`)
**Integration test host:** `WebApplicationFactory<Program>` (Microsoft.AspNetCore.Mvc.Testing)

## Test File Organization

**CLI:**
- Separate `test/` directory (not co-located with source)
- Structure: `cli/test/unit/lib/*.test.ts` and `cli/test/unit/commands/*.test.ts`
- E2E tests: `cli/test/e2e/*.test.ts`
- Helpers shared across E2E: `cli/test/e2e/helpers.ts`

**Dashboard:**
- Separate `test/` directory
- Unit tests: `dashboard/test/unit/lib/*.test.ts`, `dashboard/test/unit/features/<feature>/*.test.tsx`, `dashboard/test/unit/layout/*.test.tsx`
- E2E tests: `dashboard/test/e2e/*.spec.ts` (Playwright uses `.spec.ts`)
- E2E helpers: `dashboard/test/e2e/helpers.ts`, `dashboard/test/e2e/global-setup.ts`

**C# API:**
- Separate projects per test type: `SkyState.Api.UnitTests/`, `SkyState.Api.IntegrationTests/`, `SkyState.Api.EndToEndTests/`
- Integration test infrastructure: `SkyState.Api.IntegrationTests/Infrastructure/` (factory, in-memory repos, stubs)
- End-to-end test infrastructure: `SkyState.Api.EndToEndTests/Infrastructure/` (factory connecting to real PostgreSQL)

**Naming:**
- TypeScript: `<module-name>.test.ts` / `<ComponentName>.test.tsx`
- C#: `<ServiceName>Tests.cs` / `<EndpointGroup>Tests.cs`

## Test Structure

### TypeScript (Vitest)

**Suite organization — consistent across CLI and dashboard:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (always declared at top, before module import)
// ---------------------------------------------------------------------------
vi.mock('../../../src/lib/http-client.js', () => ({
  createHttpClient: vi.fn(() => mockClient),
}));

import { projectsCommand } from '../../../src/commands/projects.js';

// ---------------------------------------------------------------------------
// Helpers (test factories, seedStore, etc.)
// ---------------------------------------------------------------------------
function seedStore() { ... }
function createProgram(): Command { ... }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('feature or component', () => {
  beforeEach(() => {
    seedStore();
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('describes expected behavior', async () => {
    // arrange
    // act
    // assert
  });
});
```

**Section dividers:** `// ---------------------------------------------------------------------------` lines with labels (`Mocks`, `Helpers`, `Tests`) are used consistently to separate test file sections.

### C# (xUnit)

**Class fixture pattern — integration tests:**
```csharp
public class ProjectEndpointTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private readonly IUserRepository _userRepo = factory.Services.GetRequiredService<IUserRepository>();

    private static CancellationToken CT => TestContext.Current.CancellationToken;
    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    [Fact]
    public async Task ListProjects_AsAlice_ReturnsOnlyAliceProjects()
    {
        // arrange
        // act
        // assert
    }
}
```

**Unit test class with private fields:**
```csharp
public class BillingServiceTests
{
    private readonly IUserRepository _userRepo = Substitute.For<IUserRepository>();
    private readonly BillingService _sut;

    public BillingServiceTests()
    {
        _sut = new BillingService(_userRepo, ...);
    }

    [Fact]
    public async Task MethodName_Scenario_ExpectedResult()
    {
        // Given
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));

        // When
        var result = await _sut.GetStatusAsync(userId);

        // Then
        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.Equal("free", status.Tier);
    }
}
```

**C# test naming convention:** `MethodName_Scenario_ExpectedResult` (e.g., `GetStatusAsync_FreeTier_ReturnsCorrectPerResourceUsageAndLimits`)

## Mocking

### TypeScript (Vitest)

**Module mocking:**
```typescript
// Mock entire module with factory
vi.mock('../../../src/lib/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/config.js')>();
  return {
    ...actual,  // preserve actual exports
    readConfigFile: vi.fn(async () => ({ api_url: 'http://test.dev', ... })),
    resolveToken: vi.fn(async () => 'test-token'),
  };
});

// Mock with simple stub
vi.mock('../../../src/lib/spinner.js', () => ({
  withSpinner: vi.fn(async (_msg: string, fn: () => Promise<unknown>) => fn()),
}));
```

**Global stub pattern (for `fetch`):**
```typescript
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => responseBody,
  text: async () => JSON.stringify(responseBody),
})));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
```

**Mock HTTP client for CLI command tests:**
```typescript
const mockClient = {
  get: vi.fn() as unknown as HttpClient['get'] & ReturnType<typeof vi.fn>,
  post: vi.fn() as unknown as HttpClient['post'] & ReturnType<typeof vi.fn>,
  put: vi.fn() as unknown as HttpClient['put'] & ReturnType<typeof vi.fn>,
  del: vi.fn() as unknown as HttpClient['del'] & ReturnType<typeof vi.fn>,
};
vi.mock('../../../src/lib/http-client.js', () => ({
  createHttpClient: vi.fn(() => mockClient),
}));
```

**Spy on stdout/stderr (CLI tests):**
```typescript
beforeEach(() => {
  stdoutData = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      stdoutData += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  );
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
```

**Zustand store mocking (dashboard component tests):**
```typescript
type TestState = Record<string, unknown>;
let testStore: UseBoundStore<StoreApi<TestState>>;

vi.mock('@/store', () => ({
  useStore: (selector: (s: TestState) => unknown) => testStore(selector),
}));

// In beforeEach, create a real Zustand store with test data:
function seedStore(overrides?: Partial<TestState>) {
  testStore = create<TestState>()(() => ({
    projects: [...],
    selectedProjectId: 'p1',
    ...overrides,
  }));
}
```

**What to mock:**
- HTTP clients and `fetch` global
- Config file reads (`readConfigFile`, `resolveToken`)
- Spinners (`withSpinner` passes through to `fn()` directly)
- External API calls (`@/lib/api`)
- The Zustand store (`@/store` → replaced with real test Zustand store)
- Complex UI dependencies that have no test relevance (e.g., `CodeMirrorEditor` → simple textarea)

**What NOT to mock:**
- The module under test itself
- Pure utility functions that can run without side effects (e.g., `slugify`, `deriveSlug`)
- Error classes (tested directly in `errors.test.ts`)
- `tabReducer` state machine (tested directly via real Zustand store in component tests)

### C# (NSubstitute)

**Interface mocking:**
```csharp
private readonly IUserRepository _userRepo = Substitute.For<IUserRepository>();

// Setup return values
_userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));

// Verify not called
await _projectRepo.DidNotReceive().GetCountByUserIdAsync(Arg.Any<Guid>());
```

**Integration tests — in-memory repositories (no mocks):**
- `SkyStateApiFactory` replaces all real Postgres repositories with `InMemoryDatabase`-backed implementations
- Defined in `api/SkyState.Api.IntegrationTests/Infrastructure/InMemoryRepositories.cs`
- External services (Stripe, GitHub OAuth) replaced with `StubStripeService`, `StubGitHubOAuthService`
- Auth: `TestAuthHandler` activated via `EnableTestAuth=true` setting

## Fixtures and Factories

### TypeScript Test Data

**CLI tests — inline sample objects:**
```typescript
const sampleProjects = [
  { projectId: 'uuid-1', name: 'Project Alpha', slug: 'project-alpha', ... },
];
```

**Dashboard tests — factory functions:**
```typescript
function makeVersion(major: number, minor: number, patch: number, state = '{}') {
  return {
    projectStateId: `ps-${major}.${minor}.${patch}`,
    environmentId: 'env-1',
    major, minor, patch, state,
    comment: null,
    createdAt: '2024-01-01T00:00:00Z',
    stateSizeBytes: state.length,
    version: { major, minor, patch },
  };
}

function makeBilling(overrides?: Partial<Record<string, unknown>>) {
  return { tier: 'free', boostMultiplier: 1, ..., ...overrides };
}
```

**`seedStore()` pattern** — creates real Zustand store with test data; accepts `overrides` for test-specific variations:
```typescript
function seedStore(overrides?: Partial<TestState>) {
  testStore = create<TestState>()(() => ({
    projects: [...defaultProjects],
    selectedProjectId: 'p1',
    ...overrides,  // caller can override any slice
  }));
}
```

### C# Test Data

**Static factory methods:**
```csharp
private static User MakeUser(Guid userId, string tier = "free", int boost = 1, DateTime? paymentFailedAt = null) =>
    new()
    {
        UserId = userId,
        SubscriptionTier = tier,
        BoostMultiplier = boost,
        PaymentFailedAt = paymentFailedAt,
        ...
    };
```

**Uid helpers for unique resource naming:**
```csharp
private static string Uid() => Guid.NewGuid().ToString("N")[..8];
// Usage: var slug = $"alice-proj-{Uid()}";
```

TypeScript E2E equivalent: `export function uid(): string { return crypto.randomUUID().replace(/-/g, '').slice(0, 8); }`

## Coverage

**Requirements:** No coverage thresholds configured in any `vitest.config.ts` or xUnit project

**View coverage:**
```bash
cd cli && npx vitest run --coverage
cd dashboard && npx vitest run --coverage
```

## Test Types

### Unit Tests

**CLI (`cli/test/unit/`):**
- Scope: individual lib modules and command actions in isolation
- All dependencies mocked via `vi.mock()`
- stdout captured via `vi.spyOn(process.stdout, 'write')` to assert output
- Commander program created fresh in each test via `createProgram()` helper

**Dashboard (`dashboard/test/unit/`):**
- Scope: React components, lib utilities, store slices
- Components rendered with `@testing-library/react`'s `render()`
- Router-dependent components wrapped in `MemoryRouter` with `initialEntries`
- Store mocked with real Zustand instances seeded with test data
- User interaction via `userEvent` from `@testing-library/user-event`

**C# API (`SkyState.Api.UnitTests/`):**
- Scope: service classes in isolation (all repository dependencies mocked with NSubstitute)
- One test class per service (e.g., `BillingServiceTests`, `MeteringServiceTests`)
- Exercises all `ServiceResult` variants and edge cases

### Integration Tests

**C# API (`SkyState.Api.IntegrationTests/`):**
- Scope: full HTTP round-trip through real middleware, services, and in-memory repositories
- Uses `WebApplicationFactory<Program>` with real DI container
- Repositories replaced with thread-safe in-memory implementations (no database)
- External services (Stripe, GitHub) replaced with stubs
- Auth via `TestAuthHandler` using `X-Test-GitHub-Id` header
- Each test creates its own isolated user via `_userRepo.CreateAsync(...)` + `Uid()` suffix

**Pattern:**
```csharp
public class ProjectEndpointTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    [Fact]
    public async Task ListProjects_AsAlice_ReturnsOnlyAliceProjects()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", ...));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", ...);
        var response = await client.GetAsync("/projects", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
```

### E2E Tests

**C# API (`SkyState.Api.EndToEndTests/`):**
- Scope: full lifecycle against real PostgreSQL database
- Uses `[Collection(EndToEndCollection.Name)]` to serialize tests
- `SkyStateEndToEndFactory` connects to real DB (requires `POSTGRES_CONNECTION_STRING` env var)
- `CrudLifecycleTests` covers full project → environment → state → rollback → public read → cleanup
- Implements `IDisposable` for factory cleanup

**CLI (`cli/test/e2e/`):**
- Scope: CLI http-client against real API + PostgreSQL (same docker-compose stack)
- Default API URL: `http://skystate_proxy:80/api`
- Test auth via `SKYSTATE_TEST_AUTH_GITHUB_ID` env var (set by `createTestClient()`)
- Tests skip gracefully when API is not available (network errors not rethrown in some paths)

**Dashboard (`dashboard/test/e2e/`):**
- Framework: Playwright 1.x
- Tests run against live dashboard at `E2E_BASE_URL` (default `http://skystate_proxy:80`)
- Auth: VITE_TEST_MODE enabled; test sends `X-Test-GitHub-Id` headers
- `global-setup.ts` runs before all tests
- `helpers.ts` provides `deleteAllProjects()` (cleanup) and `createProject()` (UI helper that handles both the NewProjectPage and modal flows)
- `playwright.config.ts`: 1 worker, no parallelism, 30s timeout, Chromium only

## Common Patterns

**Async Testing (TypeScript):**
```typescript
it('description', async () => {
  // Use await directly; Vitest handles async
  await expect(client.get('/test')).rejects.toThrow(AuthError);
  const result = await client.get('/data');
  expect(result.data).toEqual(expected);
});
```

**Waiting for React state/DOM updates:**
```typescript
await waitFor(() => {
  expect(screen.getByText(/Comparing with/)).toBeInTheDocument();
});
// Or for element appearance:
const envOption = await screen.findByRole('menuitem', { name: /Production/ });
```

**Error Testing (TypeScript):**
```typescript
// Preferred: rejects.toThrow for expected throws
await expect(client.get('/test')).rejects.toThrow(AuthError);

// When you need to inspect error properties:
try {
  await api.projects.list();
  expect.unreachable('Should have thrown');
} catch (e) {
  expect(e).toBeInstanceOf(ApiError);
  const err = e as ApiError;
  expect(err.status).toBe(404);
}
```

**Error Testing (C#):**
```csharp
// Use Assert.IsType to pattern-match ServiceResult variants
var overLimit = Assert.IsType<ServiceResult<bool>.OverLimit>(result);
Assert.Equal("projects", overLimit.Limit.Resource);

// Use Assert.IsType<ServiceResult<T>.NotFound>(result) to verify not-found cases
Assert.IsType<ServiceResult<BillingStatusResponse>.NotFound>(result);
```

**Verifying NOT called (C# NSubstitute):**
```csharp
await _projectRepo.DidNotReceive().GetCountByUserIdAsync(Arg.Any<Guid>());
```

**Verifying output format (CLI tests):**
```typescript
const parsed = JSON.parse(stdoutData);
expect(parsed).toHaveLength(2);
expect(parsed[0].name).toBe('Project Alpha');
expect(parsed[0].apiKeyHash).toBeUndefined(); // sensitive field excluded
```

---

*Testing analysis: 2026-03-04*
