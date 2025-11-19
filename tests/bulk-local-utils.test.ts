import "./fake-db"

import { afterEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import { dexieCollectionOptions } from "../src"
import {
  cleanupTestResources,
  createNumericTestState,
  createTestState,
  getTestData,
  waitForCollectionSize,
  waitForKey,
  waitForNoKey,
} from "./test-helpers"
import type { TestItem } from "./test-helpers"

describe(`Dexie Local Write Utilities`, () => {
  afterEach(cleanupTestResources)

  describe(`insertLocally`, () => {
    it(`inserts a single item without triggering onInsert handler`, async () => {
      const onInsertSpy = vi.fn()
      const { db } = await createTestState()

      // Override collection with handler
      const opts = dexieCollectionOptions({
        id: `test-with-handler`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onInsert: onInsertSpy,
      })
      const collectionWithHandler = createCollection(opts)
      await collectionWithHandler.stateWhenReady()

      const utils = collectionWithHandler.utils
      const item: TestItem = { id: `local-1`, name: `Local Insert` }

      await utils.insertLocally(item)
      await waitForKey(collectionWithHandler, `local-1`)

      // Verify item is in collection
      expect(collectionWithHandler.has(`local-1`)).toBe(true)
      expect(collectionWithHandler.get(`local-1`)?.name).toBe(`Local Insert`)

      // Verify item is in database
      const dbItem = await db.table(`test`).get(`local-1`)
      expect(dbItem).toBeDefined()
      expect(dbItem.name).toBe(`Local Insert`)

      // Verify handler was NOT called
      expect(onInsertSpy).not.toHaveBeenCalled()
    })

    it(`updates existing item (upsert behavior)`, async () => {
      const { collection, db } = await createTestState([
        { id: `1`, name: `Original` },
      ])

      const utils = collection.utils
      const updatedItem: TestItem = {
        id: `1`,
        name: `Updated via insertLocally`,
      }

      await utils.insertLocally(updatedItem)
      await new Promise((r) => setTimeout(r, 100))

      // Verify item was updated
      expect(collection.get(`1`)?.name).toBe(`Updated via insertLocally`)

      const dbItem = await db.table(`test`).get(`1`)
      expect(dbItem.name).toBe(`Updated via insertLocally`)
    })

    it(`marks ID as seen and acked`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      const item: TestItem = { id: `seen-test`, name: `Test` }
      await utils.insertLocally(item)

      // awaitIds should resolve immediately since item is acked
      await expect(utils.awaitIds([`seen-test`])).resolves.toBeUndefined()
    })

    it(`throws error on invalid data`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      // Try to insert invalid data (missing required field)
      const invalidItem = { id: `invalid` } as any

      await expect(utils.insertLocally(invalidItem)).rejects.toThrow()
    })
  })

  describe(`bulkInsertLocally`, () => {
    it(`inserts multiple items without triggering onInsert handler`, async () => {
      const onInsertSpy = vi.fn()
      const { db } = await createTestState()

      const opts = dexieCollectionOptions({
        id: `test-bulk-handler`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onInsert: onInsertSpy,
      })
      const collectionWithHandler = createCollection(opts)
      await collectionWithHandler.stateWhenReady()

      const utils = collectionWithHandler.utils
      const items = getTestData(10)

      await utils.bulkInsertLocally(items)
      await waitForCollectionSize(collectionWithHandler, 10)

      // Verify all items are in collection
      expect(collectionWithHandler.size).toBe(10)
      for (let i = 1; i <= 10; i++) {
        expect(collectionWithHandler.has(String(i))).toBe(true)
      }

      // Verify items are in database
      const dbCount = await db.table(`test`).count()
      expect(dbCount).toBe(10)

      // Verify handler was NOT called
      expect(onInsertSpy).not.toHaveBeenCalled()
    })

    it(`handles empty array gracefully`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      await expect(utils.bulkInsertLocally([])).resolves.toBeUndefined()
    })

    it(`handles large batch efficiently`, async () => {
      const { collection, db } = await createTestState()
      const utils = collection.utils

      const largeDataset = Array.from({ length: 500 }, (_, i) => ({
        id: String(i),
        name: `Bulk item ${i}`,
      }))

      const start = Date.now()
      await utils.bulkInsertLocally(largeDataset)
      const duration = Date.now() - start

      console.log(`Bulk inserted 500 items in ${duration}ms`)

      await waitForCollectionSize(collection, 500, 5000)

      expect(collection.size).toBe(500)
      const dbCount = await db.table(`test`).count()
      expect(dbCount).toBe(500)

      // Should be reasonably fast (< 2 seconds)
      expect(duration).toBeLessThan(2000)
    })

    it(`handles duplicates gracefully (upsert behavior)`, async () => {
      const { collection, db } = await createTestState([
        { id: `1`, name: `Original 1` },
        { id: `2`, name: `Original 2` },
      ])

      const utils = collection.utils

      // Insert items with some duplicates
      const items: Array<TestItem> = [
        { id: `1`, name: `Updated 1` }, // Duplicate
        { id: `2`, name: `Updated 2` }, // Duplicate
        { id: `3`, name: `New 3` },
        { id: `4`, name: `New 4` },
      ]

      await utils.bulkInsertLocally(items)
      await waitForCollectionSize(collection, 4)

      // Verify duplicates were updated
      expect(collection.get(`1`)?.name).toBe(`Updated 1`)
      expect(collection.get(`2`)?.name).toBe(`Updated 2`)

      // Verify new items were added
      expect(collection.get(`3`)?.name).toBe(`New 3`)
      expect(collection.get(`4`)?.name).toBe(`New 4`)

      const dbCount = await db.table(`test`).count()
      expect(dbCount).toBe(4)
    })

    it(`marks all IDs as seen and acked`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      const items = getTestData(5)
      await utils.bulkInsertLocally(items)

      // All IDs should be immediately available
      const ids = items.map((item) => item.id)
      await expect(utils.awaitIds(ids)).resolves.toBeUndefined()
    })
  })

  describe(`updateLocally`, () => {
    it(`updates a single item without triggering onUpdate handler`, async () => {
      const onUpdateSpy = vi.fn()
      const { db } = await createTestState([{ id: `1`, name: `Original` }])

      const opts = dexieCollectionOptions({
        id: `test-update-handler`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onUpdate: onUpdateSpy,
      })
      const collectionWithHandler = createCollection(opts)
      await collectionWithHandler.stateWhenReady()

      const utils = collectionWithHandler.utils
      const updatedItem: TestItem = { id: `1`, name: `Updated Locally` }

      await utils.updateLocally(`1`, updatedItem)
      await new Promise((r) => setTimeout(r, 100))

      // Verify item was updated
      expect(collectionWithHandler.get(`1`)?.name).toBe(`Updated Locally`)

      const dbItem = await db.table(`test`).get(`1`)
      expect(dbItem.name).toBe(`Updated Locally`)

      // Verify handler was NOT called
      expect(onUpdateSpy).not.toHaveBeenCalled()
    })

    it(`respects rowUpdateMode setting`, async () => {
      const { db } = await createTestState([{ id: `1`, name: `Original` }])

      // Test with partial mode (default)
      const optsPartial = dexieCollectionOptions({
        id: `test-partial`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        rowUpdateMode: `partial`,
      })
      const collectionPartial = createCollection(optsPartial)
      await collectionPartial.stateWhenReady()

      const utilsPartial = collectionPartial.utils
      await utilsPartial.updateLocally(`1`, { id: `1`, name: `Partial Update` })
      await new Promise((r) => setTimeout(r, 100))

      expect(collectionPartial.get(`1`)?.name).toBe(`Partial Update`)

      // Test with full mode
      const optsFull = dexieCollectionOptions({
        id: `test-full`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        rowUpdateMode: `full`,
      })
      const collectionFull = createCollection(optsFull)
      await collectionFull.stateWhenReady()

      const utilsFull = collectionFull.utils
      await utilsFull.updateLocally(`1`, { id: `1`, name: `Full Update` })
      await new Promise((r) => setTimeout(r, 100))

      expect(collectionFull.get(`1`)?.name).toBe(`Full Update`)
    })

    it(`throws error when updating non-existent item in partial mode`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      // Partial mode should fail on non-existent item
      await expect(
        utils.updateLocally(`non-existent`, {
          id: `non-existent`,
          name: `Test`,
        })
      ).rejects.toThrow()
    })
  })

  describe(`bulkUpdateLocally`, () => {
    it(`updates multiple items without triggering onUpdate handler`, async () => {
      const onUpdateSpy = vi.fn()
      const initialData = getTestData(5)
      const { db } = await createTestState(initialData)

      const opts = dexieCollectionOptions({
        id: `test-bulk-update-handler`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onUpdate: onUpdateSpy,
      })
      const collectionWithHandler = createCollection(opts)
      await collectionWithHandler.stateWhenReady()

      const utils = collectionWithHandler.utils

      const updatedItems: Array<TestItem> = initialData.map((item) => ({
        ...item,
        name: `Updated ${item.name}`,
      }))

      await utils.bulkUpdateLocally(updatedItems)
      await new Promise((r) => setTimeout(r, 100))

      // Verify all items were updated
      for (const item of updatedItems) {
        expect(collectionWithHandler.get(item.id)?.name).toBe(item.name)
      }

      // Verify database consistency
      const dbItems = await db.table(`test`).toArray()
      expect(dbItems).toHaveLength(5)
      dbItems.forEach((dbItem) => {
        expect(dbItem.name).toMatch(/^Updated Item \d+$/)
      })

      // Verify handler was NOT called
      expect(onUpdateSpy).not.toHaveBeenCalled()
    })

    it(`handles empty array gracefully`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      await expect(utils.bulkUpdateLocally([])).resolves.toBeUndefined()
    })

    it(`handles large batch updates efficiently`, async () => {
      const initialData = Array.from({ length: 200 }, (_, i) => ({
        id: String(i),
        name: `Original ${i}`,
      }))
      const { collection, db } = await createTestState(initialData)
      const utils = collection.utils

      const updatedData = initialData.map((item) => ({
        ...item,
        name: `Updated ${item.id}`,
      }))

      const start = Date.now()
      await utils.bulkUpdateLocally(updatedData)
      const duration = Date.now() - start

      console.log(`Bulk updated 200 items in ${duration}ms`)

      await new Promise((r) => setTimeout(r, 200))

      // Spot check some items
      expect(collection.get(`0`)?.name).toBe(`Updated 0`)
      expect(collection.get(`199`)?.name).toBe(`Updated 199`)

      const dbCount = await db.table(`test`).count()
      expect(dbCount).toBe(200)

      // Should be reasonably fast
      expect(duration).toBeLessThan(2000)
    })
  })

  describe(`deleteLocally`, () => {
    it(`deletes a single item without triggering onDelete handler`, async () => {
      const onDeleteSpy = vi.fn()
      const { db } = await createTestState([{ id: `1`, name: `To Delete` }])

      const opts = dexieCollectionOptions({
        id: `test-delete-handler`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onDelete: onDeleteSpy,
      })
      const collectionWithHandler = createCollection(opts)
      await collectionWithHandler.stateWhenReady()

      const utils = collectionWithHandler.utils

      await utils.deleteLocally(`1`)
      await waitForNoKey(collectionWithHandler, `1`)

      // Verify item is gone from collection
      expect(collectionWithHandler.has(`1`)).toBe(false)

      // Verify item is gone from database
      const dbItem = await db.table(`test`).get(`1`)
      expect(dbItem).toBeUndefined()

      // Verify handler was NOT called
      expect(onDeleteSpy).not.toHaveBeenCalled()
    })

    it(`removes item from tracking`, async () => {
      const { collection } = await createTestState([
        { id: `tracked`, name: `Test` },
      ])
      const utils = collection.utils

      // Verify item is tracked
      await utils.awaitIds([`tracked`])

      // Delete locally
      await utils.deleteLocally(`tracked`)
      await waitForNoKey(collection, `tracked`)

      // Item should no longer be tracked
      expect(collection.has(`tracked`)).toBe(false)
    })

    it(`succeeds silently when deleting non-existent item`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      // Should not throw
      await expect(utils.deleteLocally(`non-existent`)).resolves.toBeUndefined()
    })
  })

  describe(`bulkDeleteLocally`, () => {
    it(`deletes multiple items without triggering onDelete handler`, async () => {
      const onDeleteSpy = vi.fn()
      const initialData = getTestData(10)
      const { db } = await createTestState(initialData)

      const opts = dexieCollectionOptions({
        id: `test-bulk-delete-handler`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onDelete: onDeleteSpy,
      })
      const collectionWithHandler = createCollection(opts)
      await collectionWithHandler.stateWhenReady()

      const utils = collectionWithHandler.utils

      const idsToDelete = [`1`, `3`, `5`, `7`, `9`]
      await utils.bulkDeleteLocally(idsToDelete)
      await waitForCollectionSize(collectionWithHandler, 5)

      // Verify items are gone
      for (const id of idsToDelete) {
        expect(collectionWithHandler.has(id)).toBe(false)
      }

      // Verify remaining items
      expect(collectionWithHandler.size).toBe(5)
      expect(collectionWithHandler.has(`2`)).toBe(true)
      expect(collectionWithHandler.has(`4`)).toBe(true)

      // Verify database consistency
      const dbCount = await db.table(`test`).count()
      expect(dbCount).toBe(5)

      // Verify handler was NOT called
      expect(onDeleteSpy).not.toHaveBeenCalled()
    })

    it(`handles empty array gracefully`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      await expect(utils.bulkDeleteLocally([])).resolves.toBeUndefined()
    })

    it(`handles large batch deletes efficiently`, async () => {
      const initialData = Array.from({ length: 300 }, (_, i) => ({
        id: String(i),
        name: `Item ${i}`,
      }))
      const { collection, db } = await createTestState(initialData)
      const utils = collection.utils

      const idsToDelete = Array.from({ length: 150 }, (_, i) => String(i * 2))

      const start = Date.now()
      await utils.bulkDeleteLocally(idsToDelete)
      const duration = Date.now() - start

      console.log(`Bulk deleted 150 items in ${duration}ms`)

      await waitForCollectionSize(collection, 150, 3000)

      expect(collection.size).toBe(150)

      const dbCount = await db.table(`test`).count()
      expect(dbCount).toBe(150)

      // Should be reasonably fast
      expect(duration).toBeLessThan(2000)
    })

    it(`removes all items from tracking`, async () => {
      const initialData = getTestData(5)
      const { collection } = await createTestState(initialData)
      const utils = collection.utils

      const ids = initialData.map((item) => item.id)

      // Verify items are tracked
      await utils.awaitIds(ids)

      // Delete all
      await utils.bulkDeleteLocally(ids)
      await waitForCollectionSize(collection, 0)

      // All items should be gone
      expect(collection.size).toBe(0)
      for (const id of ids) {
        expect(collection.has(id)).toBe(false)
      }
    })
  })

  describe(`Real-world scenarios`, () => {
    it(`bootstrap from server without triggering handlers`, async () => {
      const onInsertSpy = vi.fn()
      const { db } = await createTestState()

      const opts = dexieCollectionOptions({
        id: `test-bootstrap-handler`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onInsert: onInsertSpy,
      })
      const collectionWithHandler = createCollection(opts)
      await collectionWithHandler.stateWhenReady()

      const utils = collectionWithHandler.utils

      // Simulate fetching data from server
      const serverData = Array.from({ length: 50 }, (_, i) => ({
        id: `server-${i}`,
        name: `Server Item ${i}`,
      }))

      // Bootstrap using bulkInsertLocally
      await utils.bulkInsertLocally(serverData)
      await waitForCollectionSize(collectionWithHandler, 50)

      expect(collectionWithHandler.size).toBe(50)
      expect(onInsertSpy).not.toHaveBeenCalled()

      const dbCount = await db.table(`test`).count()
      expect(dbCount).toBe(50)
    })

    it(`handle WebSocket updates without triggering handlers`, async () => {
      const onInsertSpy = vi.fn()
      const onUpdateSpy = vi.fn()
      const onDeleteSpy = vi.fn()

      const initialData = getTestData(5)
      const { db } = await createTestState(initialData)

      const opts = dexieCollectionOptions({
        id: `test-websocket-handlers`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onInsert: onInsertSpy,
        onUpdate: onUpdateSpy,
        onDelete: onDeleteSpy,
      })
      const collectionWithHandlers = createCollection(opts)
      await collectionWithHandlers.stateWhenReady()

      const utils = collectionWithHandlers.utils

      // Simulate WebSocket events
      // 1. New item created
      await utils.insertLocally({ id: `ws-new`, name: `WebSocket New` })

      // 2. Existing item updated
      await utils.updateLocally(`1`, { id: `1`, name: `WebSocket Updated` })

      // 3. Item deleted
      await utils.deleteLocally(`2`)

      await new Promise((r) => setTimeout(r, 200))

      // Verify changes
      expect(collectionWithHandlers.has(`ws-new`)).toBe(true)
      expect(collectionWithHandlers.get(`1`)?.name).toBe(`WebSocket Updated`)
      expect(collectionWithHandlers.has(`2`)).toBe(false)

      // Verify no handlers were called
      expect(onInsertSpy).not.toHaveBeenCalled()
      expect(onUpdateSpy).not.toHaveBeenCalled()
      expect(onDeleteSpy).not.toHaveBeenCalled()

      // Verify database consistency
      const dbCount = await db.table(`test`).count()
      expect(dbCount).toBe(5) // 5 initial - 1 deleted + 1 new = 5
    })

    it(`incremental sync with mixed operations`, async () => {
      const initialData = getTestData(10)
      const { collection, db } = await createTestState(initialData)
      const utils = collection.utils

      // Simulate incremental sync response
      const syncChanges = {
        created: [
          { id: `new-1`, name: `New 1` },
          { id: `new-2`, name: `New 2` },
        ],
        updated: [
          { id: `1`, name: `Updated 1` },
          { id: `2`, name: `Updated 2` },
        ],
        deleted: [`3`, `4`],
      }

      // Apply changes
      await utils.bulkInsertLocally(syncChanges.created)
      await utils.bulkUpdateLocally(syncChanges.updated)
      await utils.bulkDeleteLocally(syncChanges.deleted)

      await waitForCollectionSize(collection, 10, 2000)

      // Verify final state: 10 initial - 2 deleted + 2 new = 10
      expect(collection.size).toBe(10)

      // Verify specific changes
      expect(collection.has(`new-1`)).toBe(true)
      expect(collection.has(`new-2`)).toBe(true)
      expect(collection.get(`1`)?.name).toBe(`Updated 1`)
      expect(collection.get(`2`)?.name).toBe(`Updated 2`)
      expect(collection.has(`3`)).toBe(false)
      expect(collection.has(`4`)).toBe(false)

      const dbCount = await db.table(`test`).count()
      expect(dbCount).toBe(10)
    })
  })

  describe(`Error handling and edge cases`, () => {
    it(`handles quota exceeded error gracefully`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      // This is hard to test in fake-indexeddb, but we can verify error handling structure
      // In real scenarios, this would throw QuotaExceededError
      const largeItem = {
        id: `large`,
        name: `x`.repeat(1000000), // 1MB string
      }

      // Should not crash, either succeeds or throws descriptive error
      try {
        await utils.insertLocally(largeItem)
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain(`Failed to insert`)
      }
    })

    it(`handles concurrent operations correctly`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      // Perform many concurrent operations
      const operations = [
        ...Array.from({ length: 10 }, (_, i) =>
          utils.insertLocally({ id: `concurrent-${i}`, name: `Item ${i}` })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          utils.updateLocally(`concurrent-${i}`, {
            id: `concurrent-${i}`,
            name: `Updated ${i}`,
          })
        ),
      ]

      await Promise.all(operations)
      await waitForCollectionSize(collection, 10, 2000)

      expect(collection.size).toBe(10)
    })

    it(`handles transaction conflicts gracefully`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      // Try to update and delete the same item concurrently
      const item = { id: `conflict`, name: `Test` }
      await utils.insertLocally(item)
      await waitForKey(collection, `conflict`)

      // These operations might conflict
      const operations = [
        utils.updateLocally(`conflict`, { id: `conflict`, name: `Updated` }),
        utils.deleteLocally(`conflict`),
      ]

      // One should succeed, one might fail, but shouldn't crash
      const results = await Promise.allSettled(operations)

      // At least one should succeed
      const succeeded = results.filter((r) => r.status === `fulfilled`)
      expect(succeeded.length).toBeGreaterThan(0)
    })

    it(`validates data before writing`, async () => {
      const { collection } = await createTestState()
      const utils = collection.utils

      // Try to insert completely invalid data
      const invalidData = null as any

      await expect(utils.insertLocally(invalidData)).rejects.toThrow()
    })
  })

  describe(`Performance benchmarks`, () => {
    it(`compares bulk vs individual operations`, async () => {
      const { collection: collection1, db: db1 } = await createTestState()
      const { collection: collection2, db: db2 } = await createTestState()

      const utils1 = collection1.utils
      const utils2 = collection2.utils

      const testData = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        name: `Item ${i}`,
      }))

      // Individual inserts
      const start1 = Date.now()
      for (const item of testData) {
        await utils1.insertLocally(item)
      }
      const duration1 = Date.now() - start1

      // Bulk insert
      const start2 = Date.now()
      await utils2.bulkInsertLocally(testData)
      const duration2 = Date.now() - start2

      console.log(`Individual inserts: ${duration1}ms`)
      console.log(`Bulk insert: ${duration2}ms`)
      console.log(`Speedup: ${(duration1 / duration2).toFixed(2)}x`)

      // Bulk should be significantly faster
      expect(duration2).toBeLessThan(duration1)

      // Verify both have same result
      await waitForCollectionSize(collection1, 100, 2000)
      await waitForCollectionSize(collection2, 100, 2000)

      expect(collection1.size).toBe(100)
      expect(collection2.size).toBe(100)

      await db1.close()
      await db2.close()
    })
  })

  describe(`getNextId with bulk operations`, () => {
    it(`generates IDs for bulk insert`, async () => {
      const { collection, db } = await createNumericTestState()
      const utils = collection.utils

      const items = []
      for (let i = 0; i < 10; i++) {
        const id = await utils.getNextId()
        items.push({ id, name: `Item ${id}` })
      }

      await utils.bulkInsertLocally(items)
      await waitForCollectionSize(collection, 10)

      expect(collection.size).toBe(10)
      for (let i = 1; i <= 10; i++) {
        expect(collection.has(i)).toBe(true)
      }

      await db.close()
    })

    it(`handles mixed bulk operations with sequential IDs`, async () => {
      const { collection, db } = await createNumericTestState()
      const utils = collection.utils

      const initialItems = []
      for (let i = 0; i < 5; i++) {
        const id = await utils.getNextId()
        initialItems.push({ id, name: `Initial ${id}` })
      }

      await utils.bulkInsertLocally(initialItems)
      await waitForCollectionSize(collection, 5)

      await utils.bulkDeleteLocally([2, 3])
      await waitForCollectionSize(collection, 3)

      const newItems = []
      for (let i = 0; i < 3; i++) {
        const id = await utils.getNextId()
        newItems.push({ id, name: `New ${id}` })
      }
      await utils.bulkInsertLocally(newItems)
      await waitForCollectionSize(collection, 6)

      expect(collection.has(6)).toBe(true)
      expect(collection.has(7)).toBe(true)
      expect(collection.has(8)).toBe(true)

      await db.close()
    })

    it(`stress test with 200 sequential IDs`, async () => {
      const { collection, db } = await createNumericTestState()
      const utils = collection.utils

      const count = 200
      const items = []

      for (let i = 0; i < count; i++) {
        const id = await utils.getNextId()
        items.push({ id, name: `Stress ${id}` })
      }

      await utils.bulkInsertLocally(items)
      await waitForCollectionSize(collection, count, 3000)

      expect(collection.size).toBe(count)
      for (let i = 1; i <= count; i++) {
        expect(collection.has(i)).toBe(true)
      }

      await db.close()
    })

    it(`works with bootstrap then new inserts`, async () => {
      const { collection, db } = await createNumericTestState()
      const utils = collection.utils

      const serverData = [
        { id: 1, name: `Server 1` },
        { id: 2, name: `Server 2` },
      ]
      await utils.bulkInsertLocally(serverData)
      await waitForCollectionSize(collection, 2)

      const nextId = await utils.getNextId()
      expect(nextId).toBe(3)

      await utils.insertLocally({ id: nextId, name: `User 3` })
      await waitForCollectionSize(collection, 3)

      await db.close()
    })
  })
})
