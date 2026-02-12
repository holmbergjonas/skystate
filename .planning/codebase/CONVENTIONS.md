# Coding Conventions

**Analysis Date:** 2026-03-04

## Naming Patterns

**Files:**
- TypeScript source: `camelCase.ts` / `camelCase.tsx` (e.g., `http-client.ts`, `slug-resolver.ts`, `AppShell.tsx`)
- React components: `PascalCase.tsx` (e.g., `StateTab.tsx`, `SettingsTab.tsx`, `LoginPage.tsx`)
- Test files: same name as source with `.test.ts` / `.test.tsx` suffix
- C# files: `PascalCase.cs` matching the primary class name (e.g., `BillingService.cs`, `ProjectRepository.cs`)

**Functions (TypeScript):**
- Exported functions: `camelCase` (e.g., `createHttpClient`, `readConfigFile`, `resolveProject`)
- React components: `PascalCase` as named exports (e.g., `export function SettingsTab()`)
- Factory functions: `create` prefix (e.g., `createHttpClient`, `createHttpClient`)
- Event handlers in components: `handle` prefix is NOT used; plain descriptive names (e.g., `setSaving`, `setEnvName`)

**Variables:**
- `camelCase` throughout TypeScript
- Boolean state variables follow `is`/`has` or plain state noun (e.g., `saving`, `authChecked`, `authed`, `envSaving`)
- Test IDs / unique identifiers: `id` prefix or `uid()` helper

**Types and Interfaces (TypeScript):**
- `PascalCase` for all interfaces and type aliases
- `I` prefix is NOT used; interfaces are named by concept (e.g., `HttpClient`, `RequestOptions`, `GlobalOpts`)
- Response types named with `Response` suffix (e.g., `HttpResponse<T>`, `ProjectResponse`, `BillingStatusResponse`)

**C# naming:**
- Classes, interfaces, methods, properties: `PascalCase`
- Private fields: `_camelCase` with underscore prefix (e.g., `_userRepo`, `_sut`)
- Interface prefix: `I` is used (e.g., `IBillingService`, `IUserRepository`, `IProjectService`)
- Test subjects: `_sut` (System Under Test) convention
- Static helpers in tests: `PascalCase` (e.g., `MakeUser`, `CreateTierSettings`)

## Code Style

**Formatting:**
- No Prettier config found. TypeScript code relies on ESLint and TypeScript compiler enforcement.
- 2-space indentation used throughout TypeScript files
- Single quotes for strings in TypeScript; double quotes in C#
- Trailing commas on multi-line objects/arrays in TypeScript
- Arrow functions preferred over `function` keyword for callbacks and inline handlers

**Linting (TypeScript):**
- ESLint 9+ flat config in `cli/eslint.config.js` and `dashboard/eslint.config.js`
- CLI: `@eslint/js` recommended + `typescript-eslint` recommended
- Dashboard: adds `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`
- Zero-tolerance: `--max-warnings 0` enforced in both `build` and `lint` scripts
- `@typescript-eslint/no-unused-vars` enforced (compiler also enforces `noUnusedLocals`, `noUnusedParameters`)
- Occasional `// eslint-disable-next-line @typescript-eslint/no-unused-vars` used for intentional exceptions in tests

**TypeScript Strictness:**
- `strict: true` in all tsconfig files
- `noUnusedLocals: true`, `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- Dashboard additionally: `erasableSyntaxOnly: true`, `noUncheckedSideEffectImports: true`, `verbatimModuleSyntax: true`

## Import Organization

**TypeScript imports — order observed:**
1. External framework/library imports (e.g., `react`, `vitest`, `@testing-library/react`)
2. Internal absolute imports using `@/` alias (dashboard only, e.g., `@/store`, `@/lib/api`, `@/features/state/StateTab`)
3. Relative imports using `.js` extension (CLI, e.g., `'../lib/errors.js'`, `'../../src/lib/http-client.js'`)

**CLI import extension requirement:**
- All imports from local modules use `.js` extension even in TypeScript source (required for ESM: `import { CliError } from './errors.js'`)

**Path Aliases:**
- Dashboard: `@/*` maps to `./src/*` (configured in `dashboard/tsconfig.app.json` and `dashboard/vite.config.ts`)
- CLI: No path aliases; uses relative imports with `.js` extension

**Mock imports in tests:**
- `vi.mock(...)` calls appear before the `import` of the module under test (hoisted by Vitest)
- The import of the actual module always comes after all mock declarations

## Error Handling

**CLI (TypeScript):**
- All user-facing errors extend `CliError` with typed exit codes (defined in `cli/src/lib/errors.ts`)
- Error hierarchy: `CliError` → `AuthError` (exit 2), `LimitError` (exit 78), `RateLimitError` (exit 79), `NetworkError` (exit 1), `ApiError` (exit 1)
- HTTP errors are classified in `handleHttpError()` in `cli/src/lib/http-client.ts` and thrown as typed errors
- `catch (err: unknown)` pattern used; errors narrowed with `instanceof` before accessing properties
- Empty `catch {}` blocks used only for JSON parse fallbacks (with comment explaining intent)

**Dashboard (TypeScript):**
- `ApiError` class in `dashboard/src/lib/api-error.ts` wraps HTTP errors with `status`, `statusText`, `errorBody`
- 401 responses trigger `clearToken()` + redirect to `/login` (in `dashboard/src/lib/api.ts`)
- Network failures (TypeError) call `setApiAvailable(false)` for the service banner
- AbortError from cancelled requests is re-thrown without affecting API status

**C# API:**
- `ServiceResult<T>` discriminated union pattern (in `api/SkyState.Api/Models/ServiceResult.cs`):
  ```csharp
  public abstract record ServiceResult<T>
  {
      public sealed record ValidationError(string Message) : ServiceResult<T>;
      public sealed record NotFound() : ServiceResult<T>;
      public sealed record OverLimit(LimitResponse Limit) : ServiceResult<T>;
      public sealed record Success(T Value) : ServiceResult<T>;
  }
  ```
- Endpoints use switch expressions to map `ServiceResult` variants to HTTP status codes
- Services never throw for expected error cases; they return `ServiceResult` discriminated unions
- `ILogger<T>` injected into every service; structured logging with `LogWarning`/`LogInformation`

## Logging

**C# API:**
- Framework: Serilog (configured in `api/SkyState.Api/Program.cs` via `builder.Host.UseSerilog(...)`)
- Request logging: `app.UseSerilogRequestLogging()` for automatic HTTP request logs
- Structured logging with named parameters: `logger.LogWarning("Billing status: user {UserId} not found", userId)`
- Log levels: `LogInformation` for normal operations, `LogWarning` for not-found/unexpected state

**TypeScript (CLI):**
- No logging framework; debug output goes to `process.stderr`
- Verbose mode: `--verbose` flag enables curl-like HTTP logging to stderr via `logRequest`/`logResponse`
- Debug helper: `debug(config, msg)` writes `[debug:http] msg` to stderr only when `config.verbose` is true
- User-facing output goes to `process.stdout` via `output()` helper in `cli/src/lib/output.ts`

## Comments

**When to Comment:**
- File-level JSDoc block explaining purpose and context (e.g., top of `http-client.ts`, `errors.ts`)
- Section dividers using `// ---------------------------------------------------------------------------` lines with labels
- Inline comments for non-obvious intent (e.g., why auth is skipped, why a field is excluded)
- No mandatory JSDoc on every function; only on complex or exported APIs

**C# XML docs:**
- `<summary>` on class-level test fixtures explaining what they test
- `<summary>` on interface methods for non-obvious contracts
- Test classes have summary XML doc; individual test methods do not

## Function Design

**Size:**
- Functions are kept small and focused; complex logic extracted into private helpers
- CLI command actions delegate to helper functions (`withSpinner`, `output`, `resolveProject`)

**Parameters:**
- Prefer options objects for 3+ parameters
- C#: Primary constructors used for DI injection (e.g., `public class BillingService(IUserRepository userRepo, ...)`)
- TypeScript: Destructured objects for React component props

**Return Values:**
- TypeScript async functions return typed `Promise<T>`
- C# services return `ServiceResult<T>` (never throw for expected cases)
- C# repositories return `Task<T?>` (nullable) for single-item queries, `Task<IEnumerable<T>>` for collections

## Module Design

**TypeScript Exports:**
- Named exports used throughout (no default exports except React components in some files)
- `App.tsx` uses `export default function App()` (Vite convention)
- CLI commands exported as named instances: `export const projectsCommand = new Command(...)`
- Library modules export factory functions and types: `export function createHttpClient(...)`, `export interface HttpClient`

**Barrel Files:**
- Dashboard store: `dashboard/src/store/index.ts` re-exports the composed store
- CLI commands: `cli/src/commands/index.ts` composes all sub-commands
- No other barrel files; features import directly from their module paths

**C# Static Extension Methods:**
- Service/repository registrations grouped into extension methods:
  - `api/SkyState.Api/Services/ServiceCollectionExtensions.cs` → `AddSkyStateServices()`
  - `api/SkyState.Api/Repositories/RepositoryCollectionExtensions.cs` → `AddSkyStateRepositories()`
  - `api/SkyState.Api/Endpoints/EndpointExtensions.cs` → `MapSkyStateEndpoints()`

**React Feature Organization:**
- Each feature is a directory under `dashboard/src/features/<feature-name>/`
- Feature components are named exports from their own `.tsx` file
- Zustand store is split into slices: `auth-slice.ts`, `projects-slice.ts`, `billing-slice.ts`, etc., composed in `dashboard/src/store/index.ts`

---

*Convention analysis: 2026-03-04*
