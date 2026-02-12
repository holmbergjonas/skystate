import { describe, it, expect } from 'vitest';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, '../schemas');
const fixturesDir = resolve(__dirname, 'fixtures');

// Map from schema filename to its $id URI
const schemaIdMap = new Map<string, string>();

// Load all schema files and register them with AJV
function createValidator(): Ajv {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  const schemaFiles = readdirSync(schemasDir).filter(f => f.endsWith('.schema.json'));
  for (const file of schemaFiles) {
    const schema = JSON.parse(readFileSync(resolve(schemasDir, file), 'utf-8'));
    ajv.addSchema(schema);
    if (schema.$id) {
      schemaIdMap.set(file, schema.$id);
    }
  }

  return ajv;
}

// Get a compiled validator for a schema by filename
function getValidator(ajv: Ajv, schemaFilename: string) {
  const id = schemaIdMap.get(schemaFilename);
  if (!id) {
    throw new Error(`No $id found for schema file: ${schemaFilename}`);
  }
  const validate = ajv.getSchema(id);
  if (!validate) {
    throw new Error(`Schema not found in AJV for $id: ${id}`);
  }
  return validate;
}

// Discover all fixture files from both directories
function discoverFixtures(): { name: string; path: string }[] {
  const fixtures: { name: string; path: string }[] = [];

  // Fixtures in tests/fixtures/
  const fixtureFiles = readdirSync(fixturesDir).filter(f => f.endsWith('.json'));
  for (const file of fixtureFiles) {
    fixtures.push({ name: file, path: resolve(fixturesDir, file) });
  }

  // Fixtures directly in tests/ (e.g., get-public-state-*.json)
  const testRootFiles = readdirSync(__dirname).filter(
    f => f.endsWith('.json') && !f.includes('tsconfig'),
  );
  for (const file of testRootFiles) {
    fixtures.push({ name: file, path: resolve(__dirname, file) });
  }

  return fixtures;
}

const ajv = createValidator();
const fixtures = discoverFixtures();

// --- Schema compilation tests ---
describe('Schema compilation', () => {
  const schemaFiles = readdirSync(schemasDir).filter(f => f.endsWith('.schema.json'));

  for (const file of schemaFiles) {
    it(`compiles ${file} without errors`, () => {
      const validate = getValidator(ajv, file);
      expect(validate).toBeDefined();
      expect(typeof validate).toBe('function');
    });
  }
});

// --- Fixture validation tests ---
describe('Fixture validation', () => {
  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      const content = JSON.parse(readFileSync(fixture.path, 'utf-8'));

      it('is valid JSON', () => {
        expect(content).toBeDefined();
      });

      const responseSchema = content.response?.schema;
      const responseBody = content.response?.body;

      if (responseSchema && responseBody !== undefined) {
        if (typeof responseSchema === 'string') {
          // Direct schema reference (e.g., "billing-status.schema.json")
          it(`body validates against ${responseSchema}`, () => {
            const validate = getValidator(ajv, responseSchema);
            const valid = validate(responseBody);
            if (!valid) {
              expect.fail(
                `Validation errors: ${JSON.stringify(validate.errors, null, 2)}`,
              );
            }
          });
        } else if (
          typeof responseSchema === 'object' &&
          responseSchema.type === 'array' &&
          responseSchema.items
        ) {
          // Array schema reference (e.g., { type: "array", items: "invoice.schema.json" })
          it(`body is an array validating each item against ${responseSchema.items}`, () => {
            expect(Array.isArray(responseBody)).toBe(true);

            const validate = getValidator(ajv, responseSchema.items);

            for (let i = 0; i < responseBody.length; i++) {
              const valid = validate(responseBody[i]);
              if (!valid) {
                expect.fail(
                  `Item [${i}] validation errors: ${JSON.stringify(validate.errors, null, 2)}`,
                );
              }
            }
          });
        }
      }
    });
  }
});
