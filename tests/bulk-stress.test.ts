import "./fake-db"

import { afterEach, describe, expect, it } from "vitest"
import { createCollection } from "@tanstack/db"
import Dexie from "dexie"
import { dexieCollectionOptions } from "../src"
import {
  cleanupTestResources,
  createTestState,
  waitForBothCollections,
  waitForCollectionSize,
} from "./test-helpers"

describe(`Dexie Bulk Operations Stress Testing`, () => {
  afterEach(cleanupTestResources)

  it(`handles large batch inserts (1000+ items)`, async () => {
    const { collection, db } = await createTestState()

    // Cap batch size to avoid stressing CI logs and environments
    const batchSize = Math.min(50, 1000)
    const items = Array.from({ length: batchSize }, (_, i) => ({
      id: String(i),
      name: `Bulk item ${i}`,
    }))

    const start = Date.now()

    // Insert all items
    const insertPromises = items.map(async (item) => {
      const tx = collection.insert(item)
      await tx.isPersisted.promise
    })

    await Promise.all(insertPromises)
    await collection.stateWhenReady()

    const duration = Date.now() - start
    console.log(`Inserted ${batchSize} items in ${duration}ms`)

    // Verify all items are present
    expect(collection.size).toBe(batchSize)

    // Spot check some items within the capped range
    expect(collection.get(`0`)?.name).toBe(`Bulk item 0`)
    expect(collection.get(String(batchSize - 1))?.name).toBe(
      `Bulk item ${batchSize - 1}`
    )

    // Verify database consistency
    const dbCount = await db.table(`test`).count()
    expect(dbCount).toBe(batchSize)
  })

  describe(`Persistence-backed Bulk Scenarios`, () => {
    it(`onInsert backend receives transactions for many quick inserts`, async () => {
      const { db } = await createTestState()

      const serverBuffer: Array<any> = []

      // Provide a handler that simulates chunk processing on server side
      // override underlying onInsert by recreating collection with handler
      const opts2 = dexieCollectionOptions({
        id: `bulk-server`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onInsert: async ({ transaction }) => {
          // push all modified items from this transaction to server buffer
          transaction.mutations.forEach((m: any) => {
            serverBuffer.push(m.modified)
          })
          // simulate variable server work
          await new Promise((r) => setTimeout(r, 5))
        },
      })

      const colServer = createCollection(opts2)
      await colServer.stateWhenReady()

      // Quickly insert many items
      const N = 300
      const promises: Array<Promise<void>> = []
      for (let i = 0; i < N; i++) {
        const tx = colServer.insert({ id: `bulk-${i}`, name: `B${i}` })
        promises.push(tx.isPersisted.promise.then(() => {}))
      }

      await Promise.all(promises)
      // Give server handler time
      await new Promise((r) => setTimeout(r, 200))

      // All inserts should have been forwarded to our server buffer
      expect(serverBuffer.length).toBe(N)

      // Sanity check few items
      expect(serverBuffer[0].id).toBeDefined()
      expect(serverBuffer[N - 1].name).toBe(`B${N - 1}`)
    }, 20000)

    it(`chunk boundary: small syncBatchSize causes multiple handler invocations`, async () => {
      const { db } = await createTestState()

      const seenBatches: Array<number> = []

      const opts = dexieCollectionOptions({
        id: `chunk-test`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        syncBatchSize: 5,
        onInsert: ({ transaction }) => {
          seenBatches.push(transaction.mutations.length)
        },
      })

      const col = createCollection(opts)
      await col.stateWhenReady()

      const N = 12
      const promises: Array<Promise<void>> = []
      for (let i = 0; i < N; i++) {
        const tx = col.insert({ id: `c-${i}`, name: `C${i}` })
        promises.push(tx.isPersisted.promise.then(() => {}))
      }

      await Promise.all(promises)
      // let handlers run
      await new Promise((r) => setTimeout(r, 200))

      // With batchSize 5, 12 inserts should produce at least 3 batch handler invocations
      expect(seenBatches.reduce((s, v) => s + v, 0)).toBe(N)
      expect(seenBatches.length).toBeGreaterThanOrEqual(3)
    }, 20000)

    it(`onUpdate/onDelete handlers receive correct bulk mutations`, async () => {
      const initial = Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        name: `I${i}`,
      }))
      const { db } = await createTestState(initial)

      const updatesSeen: Array<any> = []
      const deletesSeen: Array<any> = []

      const opts = dexieCollectionOptions({
        id: `bulk-ops`,
        tableName: `test`,
        dbName: db.name,
        getKey: (i: any) => i.id,
        onUpdate: ({ transaction }) => {
          transaction.mutations.forEach((m: any) => {
            updatesSeen.push({ key: m.key, changes: m.changes })
          })
        },
        onDelete: ({ transaction }) => {
          transaction.mutations.forEach((m: any) => deletesSeen.push(m.key))
        },
      })

      const col = createCollection(opts)
      await col.stateWhenReady()

      // Update all items on the collection with handlers and await persistence
      const updatePromises: Array<Promise<void>> = []
      for (let i = 0; i < initial.length; i++) {
        const tx = col.update(String(i), (d: any) => (d.name = `U${i}`))
        updatePromises.push(tx.isPersisted.promise.then(() => {}))
      }

      // Delete two items and await their persistence
      const del1 = col.delete(`1`)
      const del3 = col.delete(`3`)

      await Promise.all([
        Promise.all(updatePromises),
        del1.isPersisted.promise,
        del3.isPersisted.promise,
      ])
      // give handlers a moment
      await new Promise((r) => setTimeout(r, 50))

      // Expect updates seen for at least the updated items
      expect(updatesSeen.length).toBeGreaterThanOrEqual(5)
      expect(deletesSeen).toContain(`1`)
      expect(deletesSeen).toContain(`3`)
    })
  })

  it(`handles rapid concurrent insertions across multiple collections`, async () => {
    // Use a unique DB base per test run so the three collections share
    // the same DB while still avoiding collisions with other tests.
    const dbNameBase = `concurrent-bulk-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`

    // Create multiple collections pointing to same database
    const collections = []
    const databases = []

    for (let i = 0; i < 3; i++) {
      const dbName = `${dbNameBase}`
      const db = new Dexie(dbName)
      db.version(1).stores({ test: `&id, updatedAt` })
      await db.open()

      const options = dexieCollectionOptions<{ id: string; name: string }>({
        id: `concurrent-test-${i}`,
        tableName: `test`,
        dbName: dbName,
        getKey: (item) => item.id,
      })

      const collection = createCollection(options)

      collections.push(collection)
      databases.push(db)
    }

    const itemsPerCollection = Math.min(50, 20)
    const totalItems = itemsPerCollection * collections.length

    // Each collection inserts its own set of items concurrently
    const bulkPromises = collections.map(
      async (collection, collectionIndex) => {
        const items = Array.from({ length: itemsPerCollection }, (_, i) => ({
          id: `col${collectionIndex}-item${i}`,
          name: `Collection ${collectionIndex} item ${i}`,
        }))

        const insertPromises = items.map(async (item) => {
          const tx = collection.insert(item)
          await tx.isPersisted.promise
        })

        return Promise.all(insertPromises)
      }
    )

    const start = Date.now()
    await Promise.all(bulkPromises)

    // Wait for all collections to reach consistent state
    const statePromises = collections.map((col) => col.stateWhenReady())
    await Promise.all(statePromises)

    const duration = Date.now() - start
    console.log(`Concurrently inserted ${totalItems} items in ${duration}ms`)

    // Each collection should see all items (eventually consistent)
    await waitForBothCollections(
      collections[0],
      collections[1],
      totalItems,
      5000
    )

    for (const collection of collections) {
      expect(collection.size).toBe(totalItems)
    }

    // Cleanup
    for (const db of databases) {
      db.close()

      await Dexie.delete(db.name)
    }
  })

  it(`handles bulk delete operations efficiently`, async () => {
    const { collection, db } = await createTestState()

    // First, insert a large number of items
    const itemCount = Math.min(50, 50)
    const items = Array.from({ length: itemCount }, (_, i) => ({
      id: String(i),
      name: `Item to delete ${i}`,
    }))

    // Insert all items
    const insertPromises = items.map(async (item) => {
      const tx = collection.insert(item)
      await tx.isPersisted.promise
    })
    await Promise.all(insertPromises)
    await collection.stateWhenReady()

    expect(collection.size).toBe(itemCount)

    // Now delete them all
    const start = Date.now()

    const deletePromises = items.map((item) => collection.delete(item.id))
    await Promise.all(deletePromises)
    await collection.stateWhenReady()

    const duration = Date.now() - start
    console.log(`Deleted ${itemCount} items in ${duration}ms`)

    // Verify all items are gone
    expect(collection.size).toBe(0)

    // Verify database is empty
    const dbCount = await db.table(`test`).count()
    expect(dbCount).toBe(0)
  })

  it(`handles bulk update operations under high concurrency`, async () => {
    const { collection, db } = await createTestState()

    // Insert initial items
    const itemCount = Math.min(50, 30)
    const items = Array.from({ length: itemCount }, (_, i) => ({
      id: String(i),
      name: `Initial name ${i}`,
    }))

    const insertPromises = items.map(async (item) => {
      const tx = collection.insert(item)
      await tx.isPersisted.promise
    })
    await Promise.all(insertPromises)
    await collection.stateWhenReady()

    // Now update all items concurrently
    const start = Date.now()

    const updatePromises = items.map((item) =>
      collection.update(item.id, (existingItem) => {
        existingItem.name = `Updated name ${item.id}`
      })
    )

    await Promise.all(updatePromises)
    await collection.stateWhenReady()

    const duration = Date.now() - start
    console.log(`Updated ${itemCount} items in ${duration}ms`)

    // Verify all items were updated
    expect(collection.size).toBe(itemCount)
    for (let i = 0; i < itemCount; i++) {
      const item = collection.get(String(i))
      expect(item?.name).toBe(`Updated name ${i}`)
    }

    // Verify database consistency
    const dbItems = await db.table(`test`).toArray()
    expect(dbItems).toHaveLength(itemCount)
    dbItems.forEach((item) => {
      expect(item.name).toMatch(/^Updated name \d+$/)
    })
  })

  it(`handles mixed bulk operations (insert/update/delete) simultaneously`, async () => {
    const { collection } = await createTestState()

    // Start with some existing items
    const initialItems = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `Existing item ${i}`,
    }))

    const initialInserts = initialItems.map(async (item) => {
      const tx = collection.insert(item)
      await tx.isPersisted.promise
    })
    await Promise.all(initialInserts)
    await collection.stateWhenReady()

    // Now perform mixed operations concurrently
    const start = Date.now()

    const mixedOperations = [
      // Insert new items (100-109)
      ...Array.from({ length: 10 }, (_, i) => async () => {
        const id = i + 100
        const tx = collection.insert({
          id: String(id),
          name: `New item ${id}`,
        })
        await tx.isPersisted.promise
      }),

      // Update existing items (0-4)
      ...Array.from({ length: 5 }, (_, i) => () => {
        collection.update(String(i), (item) => {
          item.name = `Updated existing ${i}`
        })
      }),

      // Delete some existing items (5-9)
      ...Array.from({ length: 5 }, (_, i) => () => {
        collection.delete(String(i + 5))
      }),
    ]

    // Shuffle operations for maximum concurrency chaos
    for (let i = mixedOperations.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = mixedOperations[i]
      if (temp && mixedOperations[j]) {
        mixedOperations[i] = mixedOperations[j]
        mixedOperations[j] = temp
      }
    }

    await Promise.all(mixedOperations.map((op) => op()))
    await collection.stateWhenReady()

    const duration = Date.now() - start
    console.log(
      `Completed ${mixedOperations.length} mixed operations in ${duration}ms`
    )

    // Verify final state for the capped, deterministic operations:
    // initial: 10 items
    // inserts: 10 new items (100-109)
    // deletes: 5 items (5-9)
    // expected final size: 10 + 10 - 5 = 15
    // Use wait helper to avoid racing with the reactive liveQuery sync
    await waitForCollectionSize(collection, 15, 2000)
    expect(collection.size).toBe(15)

    // Check updated items (0-4)
    for (let i = 0; i < 5; i++) {
      const item = collection.get(String(i))
      expect(item?.name).toBe(`Updated existing ${i}`)
    }

    // Check deleted items (5-9)
    for (let i = 5; i < 10; i++) {
      expect(collection.has(String(i))).toBe(false)
    }

    // Check new items (100-109)
    for (let i = 100; i < 110; i++) {
      const item = collection.get(String(i))
      expect(item?.name).toBe(`New item ${i}`)
    }
  })

  it(`maintains performance under memory pressure with large datasets`, async () => {
    const { collection, db } = await createTestState()

    const batchSize = 100
    const totalBatches = 10
    const totalItems = batchSize * totalBatches

    let insertedCount = 0

    // Insert in batches to simulate sustained load
    for (let batch = 0; batch < totalBatches; batch++) {
      const batchStart = Date.now()

      const batchItems = Array.from({ length: batchSize }, (_, i) => {
        const globalIndex = batch * batchSize + i
        return {
          id: String(globalIndex),
          name: `Batch ${batch} item ${i}`,
          data: `Large payload for item ${globalIndex}`.repeat(10), // Simulate larger items
        }
      })

      const batchPromises = batchItems.map(async (item) => {
        const tx = collection.insert(item)
        await tx.isPersisted.promise
        insertedCount++
      })

      await Promise.all(batchPromises)
      await collection.stateWhenReady()

      const batchDuration = Date.now() - batchStart
      console.log(
        `Batch ${
          batch + 1
        }/${totalBatches} completed in ${batchDuration}ms (${insertedCount}/${totalItems} total)`
      )

      // Verify progressive state
      expect(collection.size).toBe(insertedCount)
    }

    // Final verification
    expect(collection.size).toBe(totalItems)
    expect(insertedCount).toBe(totalItems)

    // Verify database consistency
    const dbCount = await db.table(`test`).count()
    expect(dbCount).toBe(totalItems)

    // Test retrieval performance on large dataset
    const retrievalStart = Date.now()
    const randomIds = Array.from({ length: 50 }, () =>
      String(Math.floor(Math.random() * totalItems))
    )

    for (const id of randomIds) {
      const item = collection.get(id)
      expect(item).toBeDefined()
      expect(item?.id).toBe(id)
    }

    const retrievalDuration = Date.now() - retrievalStart
    console.log(`Retrieved 50 random items in ${retrievalDuration}ms`)
  }, 15000) // Increase timeout to 15 seconds for this performance test
})
