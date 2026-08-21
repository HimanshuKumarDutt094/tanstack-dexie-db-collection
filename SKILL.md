---
name: ctest-review
description: Generates automated Jest tests for a source file using ctest-generated .md as reference. Use when the user wants to generate, write, or create tests based on ctest analysis output.
argument-hint: [source-file-path]
allowed-tools: Read, Glob, Grep, Edit, Write, Bash
---

# Ctest — Generate Automated Tests

Your job is to **write automated Jest tests** for a source file, using the ctest-generated `.md` as a reference for how the external libraries are actually used and tested.

## 1. Determine the target file

If `$ARGUMENTS` was provided, use it as the source file path.

Otherwise, open `CTEST_CHECKLIST.md` and pick the **first unchecked item** (`- [ ]`). The checklist entry is the path to the `.md` file — remove the `.md` suffix to get the source file path.

## 2. Read both files in parallel

- **Source file**: the file itself (e.g. `src/lib/utils.js`)
- **Ctest markdown**: the same path with `.md` appended (e.g. `src/lib/utils.js.md`)

Read both before doing anything else.

## 3. Understand the source file

From the source file, identify:
- What functions/classes this module **exports**
- Which **external libraries** it imports and which methods/functions it calls on them
- What the module is responsible for (single-sentence summary)

## 4. Mine the ctest markdown for patterns

The `.md` file contains real test blocks extracted from the dependency source code. For each external library section:
- Read the test block examples carefully
- Extract the **patterns** they demonstrate: how to set up the library, what inputs to pass, what to assert, how errors are handled
- These are your raw material — adapt them to test **your module's behavior**, not the library itself

## 5. Check for an existing test file

Look for `tests/<module-name>.test.js` (e.g. `src/lib/utils.js` → `tests/utils.test.js`).

- If it **exists**: read it, then **add new `describe`/`it` blocks** for any functions not yet covered. Do not duplicate existing tests.
- If it **does not exist**: create it from scratch following the conventions below.

## 6. Write the tests

Follow the project's Jest conventions:

```js
// CommonJS imports
const someModule = require('../src/lib/example');

// Mock external dependencies (fs, os, child_process, http, etc.)
jest.mock('fs');
jest.mock('os');

describe('Module Name', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('functionName', () => {
    it('should <expected behavior> when <condition>', () => {
      // Arrange
      // Act
      // Assert
    });

    it('should throw / return null / handle error when <bad input>', () => {
      // ...
    });
  });
});
```

**Rules:**
- Test **this module's exported functions**, not the external libraries directly
- Use the ctest `.md` test examples as inspiration for edge cases, error conditions, and setup patterns — adapt them to the module under test
- Mock all I/O: `fs`, `os`, `child_process`, `https`, `path` (when side-effectful)
- Cover: happy path, edge cases, and error/exception paths for every exported function
- Use `jest.spyOn` for partial mocks when full mock is too broad
- Use descriptive names: `should return X when Y`
- Follow 2-space indentation, semicolons, `const`/`let`

## 7. Save the test file

Write or update `tests/<module-name>.test.js` with the generated tests.

## 8. Cleanup

After the test file is written:

### 8.1 Mark the checklist item as done

Edit `CTEST_CHECKLIST.md` and change the item from unchecked to checked:

```
- [ ] src/lib/example.js.md   →   - [x] src/lib/example.js.md
```

### 8.2 Delete the ctest-generated `.md` file

Remove the `.md` file that was used as reference (e.g. `src/lib/example.js.md`):

```bash
rm src/lib/example.js.md
```

Both steps are required. Do not skip either one.
