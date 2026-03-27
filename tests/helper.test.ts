import { describe, expect, it } from "vitest"
import { addDexieMetadata, stripDexieFields } from "../src/helper"

/**
 * Unit tests for helper.ts utility functions
 * Tests for stripDexieFields and addDexieMetadata
 */

describe(`Helper Utilities`, () => {
  describe(`stripDexieFields`, () => {
    it(`should remove Dexie metadata fields from object`, () => {
      const input = {
        id: `1`,
        name: `Test`,
        _updatedAt: 123456,
        _createdAt: 123456,
      }

      const result = stripDexieFields(input)

      expect(result).toEqual({
        id: `1`,
        name: `Test`,
      })
      expect(result).not.toHaveProperty(`_updatedAt`)
      expect(result).not.toHaveProperty(`_createdAt`)
    })

    it(`should remove _dexieMeta field`, () => {
      const input = {
        id: `1`,
        name: `Test`,
        _dexieMeta: { some: `data` },
      }

      const result = stripDexieFields(input)

      expect(result).toEqual({
        id: `1`,
        name: `Test`,
      })
      expect(result).not.toHaveProperty(`_dexieMeta`)
    })

    it(`should keep all other fields`, () => {
      const input = {
        id: `1`,
        name: `Test`,
        age: 25,
        active: true,
        tags: [`a`, `b`],
        nested: { foo: `bar` },
      }

      const result = stripDexieFields(input)

      expect(result).toEqual({
        id: `1`,
        name: `Test`,
        age: 25,
        active: true,
        tags: [`a`, `b`],
        nested: { foo: `bar` },
      })
    })

    it(`should handle empty object`, () => {
      const input = {}

      const result = stripDexieFields(input)

      expect(result).toEqual({})
    })

    it(`should handle null/undefined`, () => {
      expect(stripDexieFields(null)).toBe(null)
      expect(stripDexieFields(undefined)).toBe(undefined)
    })

    it(`should handle arrays`, () => {
      const input = [
        { id: `1`, _updatedAt: 123 },
        { id: `2`, _createdAt: 456 },
      ]

      const result = stripDexieFields(input)

      // Note: stripDexieFields doesn't recursively process array items
      // It treats arrays as objects and returns them as-is
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
    })

    it(`should not mutate the original object`, () => {
      const input = {
        id: `1`,
        _updatedAt: 123,
      }

      const result = stripDexieFields(input)

      expect(input).toHaveProperty(`_updatedAt`)
      expect(result).not.toHaveProperty(`_updatedAt`)
    })
  })

  describe(`addDexieMetadata`, () => {
    it(`should add _updatedAt and _createdAt to new object`, () => {
      const input = {
        id: `1`,
        name: `Test`,
      }

      const result = addDexieMetadata(input)

      expect(result._updatedAt).toBeDefined()
      expect(result._createdAt).toBeDefined()
      expect(typeof result._updatedAt).toBe(`number`)
      expect(typeof result._createdAt).toBe(`number`)
      expect(result._updatedAt).toBeGreaterThanOrEqual(Date.now() - 1000)
      expect(result._createdAt).toBeGreaterThanOrEqual(Date.now() - 1000)
    })

    it(`should only add _updatedAt for updates (isUpdate=true)`, () => {
      const input = {
        id: `1`,
        name: `Test`,
        _createdAt: 100000,
      }

      const result = addDexieMetadata(input, true)

      expect(result._updatedAt).toBeDefined()
      expect(result._createdAt).toBe(100000) // Preserved from input
      expect(result._updatedAt).not.toBe(100000)
    })

    it(`should preserve all original fields`, () => {
      const input = {
        id: `1`,
        name: `Test`,
        age: 25,
        active: true,
      }

      const result = addDexieMetadata(input)

      expect(result.id).toBe(`1`)
      expect(result.name).toBe(`Test`)
      expect(result.age).toBe(25)
      expect(result.active).toBe(true)
    })

    it(`should not mutate the original object`, () => {
      const input = {
        id: `1`,
        name: `Test`,
      }

      const result = addDexieMetadata(input)

      expect(input).not.toHaveProperty(`_updatedAt`)
      expect(result).toHaveProperty(`_updatedAt`)
    })

    it(`should handle objects with nested properties`, () => {
      const input = {
        id: `1`,
        profile: {
          name: `Test`,
          settings: { theme: `dark` },
        },
      }

      const result = addDexieMetadata(input)

      expect(result.profile).toEqual({
        name: `Test`,
        settings: { theme: `dark` },
      })
      expect(result._updatedAt).toBeDefined()
    })

    it(`should handle empty object`, () => {
      const input = {}

      const result = addDexieMetadata(input)

      expect(result._updatedAt).toBeDefined()
      expect(result._createdAt).toBeDefined()
    })

    it(`should create metadata with increasing timestamps`, () => {
      const input1 = { id: `1` }
      const result1 = addDexieMetadata(input1)
      const createdAt1 = result1._createdAt

      // Small delay to ensure different timestamp
      const start = Date.now()
      while (Date.now() === start) {
        // Wait for next millisecond
      }

      const input2 = { id: `2` }
      const result2 = addDexieMetadata(input2)

      expect(result2._createdAt).toBeGreaterThanOrEqual(createdAt1)
    })
  })

  describe(`Integration: stripDexieFields + addDexieMetadata`, () => {
    it(`should round-trip data through both functions`, () => {
      const original = {
        id: `1`,
        name: `Test`,
        value: 42,
      }

      // Add metadata (simulate insert)
      const withMeta = addDexieMetadata(original, false)
      expect(withMeta._createdAt).toBeDefined()
      expect(withMeta._updatedAt).toBeDefined()

      // Strip metadata (simulate reading from storage)
      const stripped = stripDexieFields(withMeta)

      expect(stripped).toEqual(original)
    })

    it(`should handle update scenario`, async () => {
      const original = { id: `1`, name: `Original` }

      // Initial insert
      const inserted = addDexieMetadata(original, false)
      const createdAt = inserted._createdAt

      // Wait for next millisecond to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 2))

      // Update - pass the inserted object (with _createdAt) to preserve it
      const updated = addDexieMetadata(
        { ...inserted, name: `Updated` },
        true
      )

      expect(updated._createdAt).toBe(createdAt) // Preserved
      expect(updated._updatedAt).toBeGreaterThanOrEqual(createdAt) // Same or newer timestamp
    })

    it(`should strip all Dexie reserved fields in one pass`, () => {
      const input = {
        id: `1`,
        name: `Test`,
        _dexieMeta: { sync: true },
        _updatedAt: 123,
        _createdAt: 456,
      }

      const result = stripDexieFields(input)

      expect(result).toEqual({ id: `1`, name: `Test` })
      expect(result).not.toHaveProperty(`_dexieMeta`)
      expect(result).not.toHaveProperty(`_updatedAt`)
      expect(result).not.toHaveProperty(`_createdAt`)
    })

    it(`should handle objects with symbols as keys`, () => {
      const sym = Symbol(`test`)
      const input: any = { id: `1`, [sym]: `symbol-value` }

      const result = stripDexieFields(input)

      // Symbols are not returned by Object.keys(), so they won't be copied
      expect(result.id).toBe(`1`)
      expect(result[sym]).toBeUndefined()
    })
  })
})
