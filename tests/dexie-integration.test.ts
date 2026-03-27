// Import fake-indexeddb BEFORE Dexie
import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import Dexie, { liveQuery } from "dexie"

/**
 * Tests for Dexie.js integration patterns used in dexie.ts
 * Based on patterns extracted from Dexie source code tests
 */

describe(`Dexie Integration Patterns`, () => {
  describe(`Dexie Database & Version`, () => {
    it(`should create database and verify version`, async () => {
      const db = new Dexie(`test-version-db`)
      db.version(1).stores({ test: `&id` })
      await db.open()

      expect(db.verno).toBe(1)
      expect(db.name).toBe(`test-version-db`)

      await db.close()
      await Dexie.delete(`test-version-db`)
    })

    it(`should upgrade database version`, async () => {
      const db = new Dexie(`test-upgrade-db`)
      db.version(1).stores({ store1: `++id` })
      await db.open()
      expect(db.verno).toBe(1)
      db.close()

      // Upgrade to version 2
      const db2 = new Dexie(`test-upgrade-db`)
      db2.version(2).stores({ store1: `++id,name` })
      await db2.open()
      expect(db2.verno).toBe(2)

      await db2.close()
      await Dexie.delete(`test-upgrade-db`)
    })
  })

  describe(`Dexie Table Operations`, () => {
    it(`should access table and perform CRUD operations`, async () => {
      const db = new Dexie(`test-table-db`)
      db.version(1).stores({ items: `&id,name` })
      await db.open()

      const table = db.table(`items`)

      // Add
      const id = await table.add({ id: `1`, name: `Item 1` })
      expect(id).toBe(`1`)

      // Get
      const item = await table.get(`1`)
      expect(item?.name).toBe(`Item 1`)

      // Update
      await table.update(`1`, { name: `Updated Item` })
      const updated = await table.get(`1`)
      expect(updated?.name).toBe(`Updated Item`)

      // Delete
      await table.delete(`1`)
      const deleted = await table.get(`1`)
      expect(deleted).toBeUndefined()

      await db.close()
      await Dexie.delete(`test-table-db`)
    })

    it(`should use table.where() for queries`, async () => {
      const db = new Dexie(`test-query-db`)
      db.version(1).stores({ users: `&id,name,age` })
      await db.open()

      const table = db.table(`users`)
      await table.bulkAdd([
        { id: `1`, name: `Alice`, age: 25 },
        { id: `2`, name: `Bob`, age: 30 },
        { id: `3`, name: `Charlie`, age: 35 },
      ])

      // Query by index
      const result = await table.where(`age`).above(28).toArray()
      expect(result.length).toBe(2)

      await db.close()
      await Dexie.delete(`test-query-db`)
    })
  })

  describe(`Dexie Transactions`, () => {
    it(`should execute transaction with read-write mode`, async () => {
      const db = new Dexie(`test-transaction-db`)
      db.version(1).stores({ items: `&id` })
      await db.open()

      const result = await db.transaction(`rw`, db.items, async () => {
        await db.items.add({ id: `1`, name: `Transaction Item` })
        const item = await db.items.get(`1`)
        return item
      })

      expect(result?.name).toBe(`Transaction Item`)

      await db.close()
      await Dexie.delete(`test-transaction-db`)
    })

    it(`should rollback transaction on error`, async () => {
      const db = new Dexie(`test-rollback-db`)
      db.version(1).stores({ items: `&id` })
      await db.open()

      try {
        await db.transaction(`rw`, db.items, async () => {
          await db.items.add({ id: `1`, name: `Should Rollback` })
          throw new Error(`Force rollback`)
        })
      } catch (err) {
        // Expected error
      }

      const item = await db.items.get(`1`)
      expect(item).toBeUndefined()

      await db.close()
      await Dexie.delete(`test-rollback-db`)
    })
  })

  describe(`Dexie liveQuery`, () => {
    it(`should observe table changes with liveQuery`, async () => {
      const db = new Dexie(`test-livequery-db`)
      db.version(1).stores({ items: `&id` })
      await db.open()

      let callCount = 0
      let lastResult: any[] = []

      const subscription = liveQuery(async () => {
        callCount++
        lastResult = await db.items.toArray()
      }).subscribe({
        next: () => {
          // Called on each change
        },
        error: (err) => {
          throw err
        },
      })

      // Wait for initial emission
      await new Promise((r) => setTimeout(r, 50))
      expect(callCount).toBeGreaterThanOrEqual(1)

      // Add item
      await db.items.add({ id: `1`, name: `Live Item` })
      await new Promise((r) => setTimeout(r, 50))
      expect(lastResult.length).toBe(1)
      expect(lastResult[0]?.name).toBe(`Live Item`)

      subscription.unsubscribe()

      await db.close()
      await Dexie.delete(`test-livequery-db`)
    })

    it(`should handle multiple updates in liveQuery`, async () => {
      const db = new Dexie(`test-livequery-multi-db`)
      db.version(1).stores({ items: `&id` })
      await db.open()

      const results: Array<any[]> = []

      const subscription = liveQuery(async () => {
        const items = await db.items.toArray()
        results.push(items)
      }).subscribe({
        next: () => {},
        error: (err) => {
          throw err
        },
      })

      // Initial state
      await new Promise((r) => setTimeout(r, 50))

      // Add multiple items
      await db.items.bulkAdd([
        { id: `1`, name: `Item 1` },
        { id: `2`, name: `Item 2` },
      ])

      await new Promise((r) => setTimeout(r, 100))
      expect(results[results.length - 1]?.length).toBe(2)

      subscription.unsubscribe()

      await db.close()
      await Dexie.delete(`test-livequery-multi-db`)
    })
  })

  describe(`Dexie bulk operations`, () => {
    it(`should use bulkPut for upsert operations`, async () => {
      const db = new Dexie(`test-bulk-db`)
      db.version(1).stores({ items: `&id` })
      await db.open()

      const table = db.table(`items`)

      // Bulk insert
      await table.bulkPut([
        { id: `1`, name: `Item 1` },
        { id: `2`, name: `Item 2` },
        { id: `3`, name: `Item 3` },
      ])

      const count = await table.count()
      expect(count).toBe(3)

      // Bulk update
      await table.bulkPut([
        { id: `2`, name: `Updated Item 2` },
        { id: `4`, name: `Item 4` },
      ])

      const updated = await table.get(`2`)
      expect(updated?.name).toBe(`Updated Item 2`)

      const newCount = await table.count()
      expect(newCount).toBe(4)

      await db.close()
      await Dexie.delete(`test-bulk-db`)
    })

    it(`should use bulkGet for multiple retrievals`, async () => {
      const db = new Dexie(`test-bulkget-db`)
      db.version(1).stores({ items: `&id` })
      await db.open()

      const table = db.table(`items`)
      await table.bulkAdd([
        { id: `1`, name: `Item 1` },
        { id: `2`, name: `Item 2` },
        { id: `3`, name: `Item 3` },
      ])

      // Bulk get
      const results = await table.bulkGet([`1`, `2`, `3`])
      expect(results.length).toBe(3)
      expect(results[0]?.name).toBe(`Item 1`)
      expect(results[1]?.name).toBe(`Item 2`)

      await db.close()
      await Dexie.delete(`test-bulkget-db`)
    })
  })

  describe(`Dexie Subscription`, () => {
    it(`should handle subscription errors`, async () => {
      const db = new Dexie(`test-subscription-error-db`)
      db.version(1).stores({ items: `&id` })
      await db.open()

      let errorCaught = false

      const subscription = liveQuery(async () => {
        throw new Error(`Test error`)
      }).subscribe({
        next: () => {},
        error: () => {
          errorCaught = true
        },
      })

      await new Promise((r) => setTimeout(r, 50))
      expect(errorCaught).toBe(true)

      subscription.unsubscribe()

      await db.close()
      await Dexie.delete(`test-subscription-error-db`)
    })
  })

  describe(`Database Upgrade with Upgrader Functions`, () => {
    it(`should run upgrader function when upgrading version`, async () => {
      const DBNAME = `test-upgrade-with-function`
      
      // Create initial version
      let db = new Dexie(DBNAME)
      db.version(1).stores({ users: `++id` })
      await db.open()
      
      // Add initial data
      await db.users.bulkAdd([{ name: `User1` }, { name: `User2` }])
      db.close()

      // Upgrade with upgrader function
      db = new Dexie(DBNAME)
      db.version(1).stores({ users: `++id` })
      db.version(2).stores({ users: `++id,email` }).upgrade((trans) => {
        let counter = 0
        return trans
          .table(`users`)
          .toCollection()
          .modify((obj) => {
            obj.email = `user${++counter}@example.com`
          })
      })
      await db.open()

      // Verify upgrader ran
      const users = await db.users.toArray()
      expect(users.length).toBe(2)
      expect(users[0].email).toMatch(/user\d@example\.com/)
      expect(users[1].email).toMatch(/user\d@example\.com/)

      await db.close()
      await Dexie.delete(DBNAME)
    })

    it(`should handle multiple upgrader functions in sequence`, async () => {
      const DBNAME = `test-multi-upgrade`
      
      // Version 1
      let db = new Dexie(DBNAME)
      db.version(1).stores({ items: `++id` })
      await db.open()
      await db.items.add({ name: `Item1` })
      db.close()

      // Version 2 with upgrader
      db = new Dexie(DBNAME)
      db.version(1).stores({ items: `++id` })
      db.version(2).stores({ items: `++id,category` }).upgrade((trans) => {
        return trans.table(`items`).toCollection().modify((obj) => {
          obj.category = `default`
        })
      })
      await db.open()
      db.close()

      // Version 3 with another upgrader
      db = new Dexie(DBNAME)
      db.version(1).stores({ items: `++id` })
      db.version(2).stores({ items: `++id,category` })
      db.version(3).stores({ items: `++id,category,priority` }).upgrade((trans) => {
        return trans.table(`items`).toCollection().modify((obj) => {
          obj.priority = 1
        })
      })
      await db.open()

      const items = await db.items.toArray()
      expect(items.length).toBe(1)
      expect(items[0].category).toBe(`default`)
      expect(items[0].priority).toBe(1)

      await db.close()
      await Dexie.delete(DBNAME)
    })

    it(`should handle version upgrade in reverse order specification`, async () => {
      const DBNAME = `test-reverse-version`
      
      // Specify versions in reverse order (should still work)
      const db = new Dexie(DBNAME)
      db.version(3).stores({ items: `++id,name` })
      db.version(2).stores({ items: `++id` })
      db.version(1).stores({})
      
      await db.open()
      expect(db.verno).toBe(3)
      
      await db.items.add({ name: `Test Item` })
      const count = await db.items.count()
      expect(count).toBe(1)

      await db.close()
      await Dexie.delete(DBNAME)
    })
  })

  describe(`Compound Indexes`, () => {
    it(`should create and query compound primary keys`, async () => {
      const db = new Dexie(`test-compound-pk`)
      db.version(1).stores({ events: `[date+time]` })
      await db.open()

      // Add data with compound key
      await db.events.bulkAdd([
        { date: `2024-01-01`, time: `10:00`, title: `Meeting` },
        { date: `2024-01-01`, time: `14:00`, title: `Lunch` },
        { date: `2024-01-02`, time: `09:00`, title: `Workshop` },
      ])

      // Query by compound key
      const meeting = await db.events.get([`2024-01-01`, `10:00`])
      expect(meeting?.title).toBe(`Meeting`)

      const workshop = await db.events.get([`2024-01-02`, `09:00`])
      expect(workshop?.title).toBe(`Workshop`)

      await db.close()
      await Dexie.delete(`test-compound-pk`)
    })

    it(`should create and query compound indexes`, async () => {
      const db = new Dexie(`test-compound-index`)
      db.version(1).stores({ products: `++id,[category+price]` })
      await db.open()

      await db.products.bulkAdd([
        { id: `1`, category: `electronics`, price: 100, name: `Radio` },
        { id: `2`, category: `electronics`, price: 200, name: `TV` },
        { id: `3`, category: `books`, price: 50, name: `Novel` },
      ])

      // Query by compound index
      const electronics = await db.products
        .where(`[category+price]`)
        .between([`electronics`, 0], [`electronics`, 150])
        .toArray()
      
      expect(electronics.length).toBe(1)
      expect(electronics[0].name).toBe(`Radio`)

      await db.close()
      await Dexie.delete(`test-compound-index`)
    })

    it(`should handle compound keys with multiEntry`, async () => {
      const db = new Dexie(`test-compound-multientry`)
      db.version(1).stores({ articles: `++id,*tags` })
      await db.open()

      await db.articles.bulkAdd([
        { id: `1`, title: `TypeScript Guide`, tags: [`typescript`, `javascript`] },
        { id: `2`, title: `React Tips`, tags: [`react`, `javascript`] },
        { id: `3`, title: `Vue Basics`, tags: [`vue`] },
      ])

      // Query by multiEntry index
      const jsArticles = await db.articles.where(`tags`).equals(`javascript`).toArray()
      expect(jsArticles.length).toBe(2)

      const tsArticles = await db.articles.where(`tags`).equals(`typescript`).toArray()
      expect(tsArticles.length).toBe(1)

      await db.close()
      await Dexie.delete(`test-compound-multientry`)
    })
  })

  describe(`Database Migration from Raw IndexedDB`, () => {
    it(`should open existing IndexedDB database and migrate to Dexie`, async () => {
      const DBNAME = `test-migration-raw`
      
      // Clean up first
      await Dexie.delete(DBNAME)

      // Create raw IndexedDB database
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(DBNAME, 1)
        request.onupgradeneeded = () => {
          const rawDb = request.result
          const store = rawDb.createObjectStore(`people`, { keyPath: `id` })
          store.createIndex(`name`, `name`, { unique: false })
          store.add({ id: `1`, name: `Alice`, age: 30 })
        }
        request.onsuccess = () => {
          request.result.close()
          resolve()
        }
        request.onerror = () => reject(request.error)
      })

      // Now open with Dexie
      const db = new Dexie(DBNAME)
      db.version(1).stores({ people: `id,name` })
      await db.open()

      // Verify data migrated correctly
      const people = await db.people.toArray()
      expect(people.length).toBe(1)
      expect(people[0].name).toBe(`Alice`)
      expect(people[0].age).toBe(30)

      // Test index works
      const alice = await db.people.where(`name`).equals(`Alice`).first()
      expect(alice?.id).toBe(`1`)

      await db.close()
      await Dexie.delete(DBNAME)
    })
  })
})
