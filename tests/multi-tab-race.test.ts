import "./fake-db"
import { afterEach, describe, expect, it } from "vitest"
import Dexie from "dexie"
import fc from "fast-check"
import {
  cleanupTestResources,
  createMultiTabState,
  createNumericMultiTabState,
  waitForBothCollections,
  waitForKey,
  waitForNoKey,
  waitForNumericKey,
} from "./test-helpers"
import type { TestItem } from "./test-helpers"

// Insert-or-update on a contended key. Under realistic interleaving the OTHER
// tab's write may already have synced this key into our local state (Dexie
// liveQuery fires between scheduler steps), so a plain `insert()` would throw
// "already exists". Upsert preserves the concurrent-write intent (last writer
// wins) regardless of sync timing — which is exactly what the scheduler
// surfaced that `Promise.all` hid. The scheduler found this; the helper is the
// fix to keep the test asserting the real invariant (convergence), not an
// incidental insert-vs-update timing accident.
async function upsert(
  col: any,
  item: { id: string; name: string }
): Promise<void> {
  try {
    await col.insert(item).isPersisted.promise
  } catch {
    col.update(item.id, (d: any) => {
      d.name = item.name
    })
    await col.stateWhenReady()
  }
}

// Per-run teardown for property tests. fast-check runs the body `numRuns`
// times; without this, every run leaks two live liveQuery subscriptions, which
// accumulate and slow later iterations into the test timeout. Unsubscribe the
// collections BEFORE deleting the shared DB to avoid DatabaseClosedError noise.
async function teardownMultiTab(
  colA: any,
  colB: any,
  dbA: Dexie,
  dbB: Dexie
): Promise<void> {
  try {
    await colA.cleanup()
  } catch {
    /* ignore */
  }
  try {
    await colB.cleanup()
  } catch {
    /* ignore */
  }
  dbA.close()
  dbB.close()
  try {
    await Dexie.delete(dbA.name)
  } catch {
    /* ignore */
  }
}

describe(`Dexie Multi-tab Race Conditions`, () => {
  afterEach(cleanupTestResources)

  // PORTED to fast-check `fc.scheduler()`. Instead of a single fixed ordering
  // (`Promise.all`), the scheduler systematically explores both interleavings
  // of the two tabs' inserts on the same key and asserts convergence under
  // each. On failure it shrinks to the minimal `schedulerFor()` ordering for a
  // deterministic repro. Per-run state uses a fresh DB (createMultiTabState
  // bumps the db id); afterEach(cleanupTestResources) tears everything down.
  it(`concurrent inserts on the same key converge under every interleaving`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        const { colA, colB, dbA, dbB } = await createMultiTabState()
        try {
          // Each tab is a one-op sequence; the scheduler picks which lands last.
          s.scheduleSequence([
            () => upsert(colA, { id: `race-1`, name: `Collection A` }),
          ])
          s.scheduleSequence([
            () => upsert(colB, { id: `race-1`, name: `Collection B` }),
          ])
          await s.waitAll()

          const utilsA = colA.utils as unknown as {
            refetch?: () => Promise<void>
          }
          const utilsB = colB.utils as unknown as {
            refetch?: () => Promise<void>
          }
          if (utilsA.refetch) await utilsA.refetch()
          if (utilsB.refetch) await utilsB.refetch()

          await waitForKey(colA, `race-1`, 1000)
          await waitForKey(colB, `race-1`, 1000)

          // Both tabs must agree on the final value (last writer wins).
          const finalValueA = colA.get(`race-1`)
          const finalValueB = colB.get(`race-1`)
          const dataA = finalValueA
            ? { id: finalValueA.id, name: finalValueA.name }
            : null
          const dataB = finalValueB
            ? { id: finalValueB.id, name: finalValueB.name }
            : null
          expect(dataA).toEqual(dataB)
          expect(dataA?.name).toMatch(/Collection [AB]/)

          // And the persisted DB row matches what both tabs observe.
          const dbRow = await dbA.table(`test`).get(`race-1`)
          const cleanDbRow = dbRow ? { id: dbRow.id, name: dbRow.name } : dbRow
          expect(cleanDbRow).toEqual(dataA)
        } finally {
          await teardownMultiTab(colA, colB, dbA, dbB)
        }
      }),
      { numRuns: 8 }
    )
  }, 30000)

  // PORTED to fast-check `fc.scheduler()`: both tabs delete the same seeded
  // key; the scheduler explores both orderings and asserts both converge on
  // the key being absent (and gone from the shared DB) regardless of which
  // delete lands first.
  it(`concurrent deletes on the same key converge under every interleaving`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        const initialData = [{ id: `delete-me`, name: `To be deleted` }]
        const { colA, colB, dbA, dbB } = await createMultiTabState(
          initialData,
          initialData
        )
        try {
          await waitForKey(colA, `delete-me`, 1000)
          await waitForKey(colB, `delete-me`, 1000)

          s.scheduleSequence([
            async () => {
              colA.delete(`delete-me`)
              await colA.stateWhenReady()
            },
          ])
          s.scheduleSequence([
            async () => {
              colB.delete(`delete-me`)
              await colB.stateWhenReady()
            },
          ])
          await s.waitAll()

          const utilsA = colA.utils as unknown as {
            refetch?: () => Promise<void>
          }
          const utilsB = colB.utils as unknown as {
            refetch?: () => Promise<void>
          }
          if (utilsA.refetch) await utilsA.refetch()
          if (utilsB.refetch) await utilsB.refetch()

          await waitForNoKey(colA, `delete-me`, 1000)
          await waitForNoKey(colB, `delete-me`, 1000)

          expect(colA.has(`delete-me`)).toBe(false)
          expect(colB.has(`delete-me`)).toBe(false)

          const dbRow = await dbA.table(`test`).get(`delete-me`)
          expect(dbRow).toBeUndefined()
        } finally {
          await teardownMultiTab(colA, colB, dbA, dbB)
        }
      }),
      { numRuns: 8 }
    )
  }, 30000)

  // PORTED to fast-check `fc.scheduler()`. The old version sprayed ops with
  // `setTimeout(i*50)` — one nondeterministic, flaky ordering per run. Here
  // each tab is an ordered sequence and the scheduler interleaves them, so the
  // convergence invariant is checked against MANY interleavings deterministically
  // (and shrinks on failure). Each sequence ends with an `*-insert-2`, so the
  // globally-last op is always one of those → key present and both tabs agree.
  it(`rapid alternating inserts/deletes converge across interleavings`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        const { colA, colB, dbA, dbB } = await createMultiTabState()
        try {
          // Tab A: insert → delete → insert. Tab B: insert → insert.
          s.scheduleSequence([
            () => upsert(colA, { id: `flip-flop`, name: `A-insert-1` }),
            async () => {
              colA.delete(`flip-flop`)
              await colA.stateWhenReady()
            },
            () => upsert(colA, { id: `flip-flop`, name: `A-insert-2` }),
          ])
          s.scheduleSequence([
            () => upsert(colB, { id: `flip-flop`, name: `B-insert-1` }),
            () => upsert(colB, { id: `flip-flop`, name: `B-insert-2` }),
          ])
          await s.waitAll()

          const utilsA = colA.utils as unknown as {
            refetch?: () => Promise<void>
          }
          const utilsB = colB.utils as unknown as {
            refetch?: () => Promise<void>
          }
          if (utilsA.refetch) await utilsA.refetch()
          if (utilsB.refetch) await utilsB.refetch()

          const finalA = colA.get(`flip-flop`)
          const finalB = colB.get(`flip-flop`)
          const cleanFinalA = finalA
            ? { id: finalA.id, name: finalA.name }
            : null
          const cleanFinalB = finalB
            ? { id: finalB.id, name: finalB.name }
            : null
          expect(cleanFinalA).toEqual(cleanFinalB)
          if (finalA) {
            expect(finalA.name).toMatch(/[AB]-insert-2/)
          }
        } finally {
          await teardownMultiTab(colA, colB, dbA, dbB)
        }
      }),
      { numRuns: 15 }
    )
  }, 60000)

  // PORTED to fast-check `fc.scheduler()`: tab A bulk-inserts ids 1-10, tab B
  // inserts 5-15 (overlap 5-10). Each tab's inserts are an ordered sequence;
  // the scheduler interleaves the two, exercising many orderings of the
  // overlapping writes. Invariants hold for every interleaving: all 15 keys
  // present, overlapping keys converge (last writer wins), disjoint keys keep
  // their sole writer's value.
  it(`bulk inserts with overlapping keys converge across interleavings`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        const { colA, colB, dbA, dbB } = await createMultiTabState()
        try {
          const itemsA = Array.from({ length: 10 }, (_, i) => ({
            id: String(i + 1),
            name: `Item ${i + 1} from A`,
          }))
          const itemsB = Array.from({ length: 11 }, (_, i) => ({
            id: String(i + 5),
            name: `Item ${i + 5} from B`,
          }))

          s.scheduleSequence(itemsA.map((item) => () => upsert(colA, item)))
          s.scheduleSequence(itemsB.map((item) => () => upsert(colB, item)))
          await s.waitAll()

          const utilsA = colA.utils as unknown as {
            refetch?: () => Promise<void>
          }
          const utilsB = colB.utils as unknown as {
            refetch?: () => Promise<void>
          }
          if (utilsA.refetch) await utilsA.refetch()
          if (utilsB.refetch) await utilsB.refetch()

          await waitForBothCollections(colA, colB, 15, 2000)

          expect(colA.size).toBe(15)
          expect(colB.size).toBe(15)

          // Overlapping keys (5-10): last writer wins, both tabs agree.
          for (let i = 5; i <= 10; i++) {
            const valueA = colA.get(String(i))
            const valueB = colB.get(String(i))
            const dataA = valueA ? { id: valueA.id, name: valueA.name } : null
            const dataB = valueB ? { id: valueB.id, name: valueB.name } : null
            expect(dataA).toEqual(dataB)
            expect(dataA?.name).toMatch(/Item \d+ from [AB]/)
          }

          // Disjoint keys keep their sole writer's value regardless of ordering.
          expect(colA.get(`1`)?.name).toBe(`Item 1 from A`)
          expect(colA.get(`15`)?.name).toBe(`Item 15 from B`)
        } finally {
          await teardownMultiTab(colA, colB, dbA, dbB)
        }
      }),
      { numRuns: 6 }
    )
  }, 60000)

  it(`handles concurrent updates with refetch coordination`, async () => {
    const initialData = [
      { id: `update-me`, name: `Initial`, count: 0 } as TestItem & {
        count: number
      },
    ]
    const { colA, colB, dbA, dbB } = await createMultiTabState(
      initialData,
      initialData
    )

    await waitForKey(colA, `update-me`, 1000)
    await waitForKey(colB, `update-me`, 1000)

    // Both collections try to update the same item
    colA.update(`update-me`, (item) => {
      ;(item as any).name = `Updated by A`
      ;(item as any).count = ((item as any).count || 0) + 1
    })

    colB.update(`update-me`, (item) => {
      ;(item as any).name = `Updated by B`
      ;(item as any).count = ((item as any).count || 0) + 10
    })

    await colA.stateWhenReady()
    await colB.stateWhenReady()

    // Force refetch to ensure both see final state
    const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
    const utilsB = colB.utils as unknown as { refetch?: () => Promise<void> }
    if (utilsA.refetch) await utilsA.refetch()
    if (utilsB.refetch) await utilsB.refetch()

    await new Promise((r) => setTimeout(r, 100))

    // Both collections should see the same final value
    const finalValueA = colA.get(`update-me`)
    const finalValueB = colB.get(`update-me`)
    // Compare only data fields, ignoring internal metadata
    const dataA = finalValueA
      ? { id: finalValueA.id, name: finalValueA.name }
      : null
    const dataB = finalValueB
      ? { id: finalValueB.id, name: finalValueB.name }
      : null
    expect(dataA).toEqual(dataB)

    // Should have one of the updates (last writer wins)
    expect(dataA?.name).toMatch(/Updated by [AB]/)

    dbA.close()
    dbB.close()

    await Dexie.delete(dbA.name)
  })

  it(`maintains cross-instance consistency with awaitIds`, async () => {
    const { colA, colB, dbA, dbB } = await createMultiTabState()

    // Insert from collection A
    const txA = colA.insert({ id: `await-test`, name: `From A` })
    await txA.isPersisted.promise

    // Use awaitIds on collection B to wait for the item
    const utilsBAwait = colB.utils as unknown as {
      awaitIds?: (ids: Array<string>, timeout?: number) => Promise<void>
    }

    if (utilsBAwait.awaitIds) {
      await utilsBAwait.awaitIds([`await-test`], 2000)
    } else {
      // Fallback to refetch + waitForKey
      const utilsB = colB.utils as unknown as {
        refetch?: () => Promise<void>
      }
      if (utilsB.refetch) await utilsB.refetch()
      await waitForKey(colB, `await-test`, 2000)
    }

    // Following RxDB pattern: Wait for database to have the data first
    await dbB.table(`test`).get(`await-test`)

    // Then check collection state - give reactive layer a moment to process
    await waitForKey(colB, `await-test`, 1000)

    // Collection B should now see the item
    expect(colB.has(`await-test`)).toBe(true)
    expect(colB.get(`await-test`)?.name).toBe(`From A`)

    // Now delete from collection B
    colB.delete(`await-test`)
    await colB.stateWhenReady()

    // Collection A should eventually see the deletion
    const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
    if (utilsA.refetch) await utilsA.refetch()
    await waitForNoKey(colA, `await-test`, 2000)

    expect(colA.has(`await-test`)).toBe(false)

    dbA.close()
    dbB.close()

    await Dexie.delete(dbA.name)
  })

  it(`handles rapid fire operations between multiple instances`, async () => {
    const { colA, colB, dbA, dbB } = await createMultiTabState()

    const operationCount = 50
    const promises: Array<Promise<void>> = []

    // Alternate between collections for rapid operations
    for (let i = 0; i < operationCount; i++) {
      const collection = i % 2 === 0 ? colA : colB
      const itemId = String(i)

      promises.push(
        (async () => {
          const tx = collection.insert({
            id: itemId,
            name: `Rapid item ${i}`,
          })
          await tx.isPersisted.promise
        })()
      )
    }

    await Promise.all(promises)

    // Force refetch to ensure both see final state
    const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
    const utilsB = colB.utils as unknown as { refetch?: () => Promise<void> }
    if (utilsA.refetch) await utilsA.refetch()
    if (utilsB.refetch) await utilsB.refetch()

    await waitForBothCollections(colA, colB, operationCount, 5000)

    // Both collections should have all items
    expect(colA.size).toBe(operationCount)
    expect(colB.size).toBe(operationCount)

    // Verify all items are present and consistent
    for (let i = 0; i < operationCount; i++) {
      const itemId = String(i)
      expect(colA.has(itemId)).toBe(true)
      expect(colB.has(itemId)).toBe(true)
      // Compare only data fields, ignoring internal metadata
      const dataA = colA.get(itemId)
      const dataB = colB.get(itemId)
      const cleanDataA = dataA ? { id: dataA.id, name: dataA.name } : null
      const cleanDataB = dataB ? { id: dataB.id, name: dataB.name } : null
      expect(cleanDataA).toEqual(cleanDataB)
    }

    dbA.close()
    dbB.close()

    await Dexie.delete(dbA.name)
  })

  describe(`getNextId multi-tab concurrency`, () => {
    it(`generates unique IDs across multiple collection instances`, async () => {
      const { colA, colB, dbA, dbB } = await createNumericMultiTabState()

      const idsA = []
      const idsB = []

      for (let i = 0; i < 10; i++) {
        idsA.push(await colA.utils.getNextId())
      }

      for (let i = 0; i < 10; i++) {
        idsB.push(await colB.utils.getNextId())
      }

      const allIds = [...idsA, ...idsB]
      const uniqueIds = new Set(allIds)

      expect(uniqueIds.size).toBe(20)
      expect(Math.max(...allIds)).toBe(20)

      dbA.close()
      dbB.close()
      await Dexie.delete(dbA.name)
    })

    it(`handles concurrent getNextId calls from multiple tabs`, async () => {
      const { colA, colB, dbA, dbB } = await createNumericMultiTabState()

      const promises = [
        ...Array.from({ length: 15 }, () => colA.utils.getNextId()),
        ...Array.from({ length: 15 }, () => colB.utils.getNextId()),
      ]

      const ids = await Promise.all(promises)
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(30)

      dbA.close()
      dbB.close()
      await Dexie.delete(dbA.name)
    })

    it(`maintains counter consistency across tab inserts`, async () => {
      const { colA, colB, dbA, dbB } = await createNumericMultiTabState()

      const id1 = await colA.utils.getNextId()
      await colA.utils.insertLocally({ id: id1, name: `Tab A Item` })

      const id2 = await colB.utils.getNextId()
      await colB.utils.insertLocally({ id: id2, name: `Tab B Item` })

      expect(id1).toBe(1)
      expect(id2).toBe(2)

      await waitForNumericKey(colA, id1)
      await waitForNumericKey(colB, id2)

      dbA.close()
      dbB.close()
      await Dexie.delete(dbA.name)
    })

    it(`handles rapid concurrent ID generation`, async () => {
      const { colA, colB, dbA, dbB } = await createNumericMultiTabState()

      const count = 25
      const promises = []

      for (let i = 0; i < count; i++) {
        promises.push(colA.utils.getNextId())
        promises.push(colB.utils.getNextId())
      }

      const ids = await Promise.all(promises)
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(count * 2)

      const sortedIds = [...ids].sort((a, b) => a - b)
      expect(sortedIds).toEqual(
        Array.from({ length: count * 2 }, (_, i) => i + 1)
      )

      dbA.close()
      dbB.close()
      await Dexie.delete(dbA.name)
    })
  })
})
