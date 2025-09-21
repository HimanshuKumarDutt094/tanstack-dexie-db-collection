# Examples

This file contains longer combination examples that demonstrate integration patterns with `dexieCollectionOptions`. Keep `README.md` concise — use this file for copy-paste-ready examples.

Note: Examples show optimistic UI patterns and persistence handler usage for clarity. This driver writes changes locally immediately and does not automatically roll back local writes on backend failure. Add retries, rollback or conflict-resolution logic inside your persistence handlers when needed. Also note the driver stores metadata fields `_updatedAt` and `_createdAt` in the Dexie table; codecs must account for these if you transform stored shapes.

---

## Complete React Todo App

```typescript
import React, { useState } from "react"
import { createCollection } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { dexieCollectionOptions } from "tanstack-dexie-db-collection"
import { z } from "zod"

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  createdAt: z.date(),
})

type Todo = z.infer<typeof todoSchema>

// Create collection with backend sync
const todosCollection = createCollection(
  dexieCollectionOptions({
    id: "todos",
    schema: todoSchema,
    getKey: (item) => item.id,

    // Optimistic updates with background sync
    awaitPersistence: false,
    swallowPersistenceErrors: true,

    onInsert: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        try {
          await todoAPI.create(mutation.modified)
        } catch (error) {
          console.error("Backend sync failed for insert:", error)
        }
      }
    },

    onUpdate: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        try {
          await todoAPI.update(
            mutation.key,
            mutation.changes || mutation.modified
          )
        } catch (error) {
          console.error("Backend sync failed for update:", error)
        }
      }
    },

    onDelete: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        try {
          await todoAPI.delete(mutation.key)
        } catch (error) {
          console.error("Backend sync failed for delete:", error)
        }
      }
    },
  })
)

function TodoApp() {
  const { data: todos = [] } = useLiveQuery(todosCollection)
  const [newTodoText, setNewTodoText] = useState("")

  const addTodo = async () => {
    if (!newTodoText.trim()) return

    const tx = todosCollection.insert({
      id: crypto.randomUUID(),
      text: newTodoText.trim(),
      completed: false,
      createdAt: new Date(),
    })

    await tx.isPersisted.promise
    setNewTodoText("")
  }

  const toggleTodo = async (id: string) => {
    const tx = todosCollection.update(id, (todo) => {
      todo.completed = !todo.completed
    })
    await tx.isPersisted.promise
  }

  const deleteTodo = async (id: string) => {
    const tx = todosCollection.delete(id)
    await tx.isPersisted.promise
  }

  return (
    <div className="todo-app">
      <h1>Todos ({todos.length})</h1>

      <div className="add-todo">
        <input
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          placeholder="Add a todo..."
          onKeyPress={(e) => e.key === "Enter" && addTodo()}
        />
        <button onClick={addTodo}>Add</button>
      </div>

      <ul className="todo-list">
        {todos
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((todo) => (
            <li key={todo.id} className={todo.completed ? "completed" : ""}>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
              />
              <span>{todo.text}</span>
              <button onClick={() => deleteTodo(todo.id)}>Delete</button>
            </li>
          ))}
      </ul>
    </div>
  )
}

export default TodoApp
```

---

## E-commerce Product Catalog

```typescript
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  category: z.string(),
  inStock: z.boolean(),
  lastUpdated: z.date(),
})

const productsCollection = createCollection(
  dexieCollectionOptions({
    id: "products",
    schema: productSchema,
    getKey: (product) => product.id,
    dbName: "ecommerce-app",
    syncBatchSize: 100,

    codec: {
      serialize: (product) => ({
        ...product,
        lastUpdated: product.lastUpdated.toISOString(),
      }),
      parse: (stored) => ({
        ...stored,
        lastUpdated: new Date(stored.lastUpdated),
      }),
    },

    onUpdate: async ({ transaction }) => {
      const updates = transaction.mutations.map((m) => ({
        id: m.key,
        changes: m.changes,
      }))

      await fetch("/api/products/bulk-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      })
    },
  })
)
```

---

## User Profile Management

```typescript
const userProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: z.string().optional(),
  preferences: z.object({
    theme: z.enum(["light", "dark"]),
    notifications: z.boolean(),
  }),
  lastSeen: z.date(),
})

const userProfileCollection = createCollection(
  dexieCollectionOptions({
    id: "user-profiles",
    schema: userProfileSchema,
    getKey: (user) => user.id,

    awaitPersistence: true,
    persistenceTimeoutMs: 8000,

    onUpdate: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        await fetch(`/api/users/${mutation.key}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mutation.changes || mutation.modified),
        })
      }
    },
  })
)

function UserSettings() {
  const { data: users = [] } = useLiveQuery(userProfileCollection)
  const currentUser = users[0]

  const updatePreferences = async (newPrefs: any) => {
    const tx = userProfileCollection.update(currentUser.id, (user) => {
      user.preferences = { ...user.preferences, ...newPrefs }
    })

    try {
      await tx.isPersisted.promise
      showNotification("Settings saved!", "success")
    } catch (error) {
      showNotification("Failed to save settings", "error")
    }
  }
}
```

---

## Chat Messages with Real-time Sync

```typescript
const messageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  content: z.string(),
  timestamp: z.date(),
  status: z.enum(["sending", "sent", "delivered", "read"]),
})

const messagesCollection = createCollection(
  dexieCollectionOptions({
    id: "messages",
    schema: messageSchema,
    getKey: (message) => message.id,

    awaitPersistence: false,

    onInsert: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        const message = mutation.modified
        await sendMessageToServer(message)
        messagesCollection.update(message.id, (msg) => {
          msg.status = "sent"
        })
      }
    },
  })
)

function ChatWindow({ chatId }: { chatId: string }) {
  const { data: allMessages = [] } = useLiveQuery(messagesCollection)
  const chatMessages = allMessages.filter((msg) => msg.chatId === chatId)

  const sendMessage = async (content: string) => {
    const newMessage = {
      id: crypto.randomUUID(),
      chatId,
      senderId: getCurrentUserId(),
      content,
      timestamp: new Date(),
      status: "sending" as const,
    }

    messagesCollection.insert(newMessage)
  }
}
```

---

## Notes

- These examples are intentionally compact — they demonstrate the shape and usage
  of `dexieCollectionOptions` and the recommended patterns (optimistic vs awaited
  persistence, codecs, update modes). For full app code, copy the snippet and adapt.

---
