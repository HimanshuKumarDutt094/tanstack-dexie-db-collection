# AGENTS.md

> Contributor guide for AI coding agents (and humans). Tool-agnostic.

## Project Overview

**tanstack-dexie-db-collection** is a TypeScript library that provides seamless integration between TanStack DB and Dexie.js, enabling local-first persistence with efficient change monitoring and IndexedDB storage.

The core philosophy of this project is **minimal dependencies, strict type safety, and zero-config sync**. Always respect this philosophy when proposing architectural changes.

## Commands

Run these commands to validate your changes before proposing them.

```bash
# Setup and installation
pnpm install

# Build the library
pnpm build

# Run local development (watch mode)
pnpm dev

# Run test suite
pnpm test

# Linting and formatting
pnpm lint
pnpm format
```

## Architecture & Repo Map

```text
src/
  dexie.ts          # Core implementation: dexieCollectionOptions, sync logic
  helper.ts         # Utilities: metadata fields, Dexie field stripping
  index.ts          # Public exports
tests/
  basic-operations.test.ts  # Core test suite
  test-helpers.ts           # Test utilities and fixtures
```

**Key Patterns:**
- **Sync Strategy**: Initial batch sync with `liveQuery` for reactive updates. Never poll; always use Dexie's reactive APIs.
- **Metadata Fields**: All stored records include `_createdAt` and `_updatedAt` timestamps for efficient change detection. The `__dexie_counter__` ID is reserved for sequential ID generation.
- **Optimistic Updates**: Mutations are written locally first, then synced to backend via optional handlers. Use `ackedIds` and `pendingAcks` for tracking.
- **Type Safety**: Schemas (Zod, Standard Schema) are used for both type inference and optional runtime validation. Never use `any` in public APIs.

## Coding Conventions

- **Types/Interfaces**: Strict TypeScript typing is mandatory. Never use `any`. Always define explicit interfaces for public APIs. Use generics with clear priority order (explicit type > schema inference).
- **Secrets/Env Vars**: Not applicable for this library (client-side only).
- **Naming**: `camelCase` for functions/variables, `PascalCase` for types/interfaces/classes, `CONSTANT_CASE` for constants.
- **Styling**: Follow existing code style: backtick quotes, explicit return types on public functions, JSDoc only when necessary for clarity.

## Do

- Keep diffs small, atomic, and strictly focused on the requested task.
- Read existing code to understand the context before proposing a completely new approach.
- Emulate the surrounding code style and architecture. Match indentation, naming, and patterns.
- Write unit tests for every new feature, edge case, or bug fix. Use the existing test helpers.
- Fail fast and handle errors gracefully with clear, user-friendly messages.
- Use `debug` module for logging (already configured with `ts/db:dexie` namespace).

## Don't

- **Don't add new dependencies** without explicit permission. Use the standard library or existing dependencies (`@tanstack/db`, `dexie`, `debug`) whenever possible.
- **Don't refactor code unrelated to your specific task.** Avoid spurious formatting changes (run `pnpm format` only when necessary).
- **Don't hallucinate APIs.** If you are unsure about Dexie.js or TanStack DB methods, read the source code or documentation first.
- **Don't leave debugging artifacts.** Remove all `console.log` statements. Use the `debug` module if logging is needed.
- **Don't break backward compatibility.** Public API changes require explicit permission and should follow semver.
- **Don't modify test helpers** unless absolutely necessary for the task at hand.

## PR / Commit Checklist

Before finalizing any changes, ensure:
- [ ] Tests pass locally (`pnpm test`)
- [ ] Linter reports zero warnings (`pnpm lint`)
- [ ] Build succeeds without errors (`pnpm build`)
- [ ] Changes are minimal and strictly address the prompt
- [ ] No unrelated files were modified
- [ ] New code includes appropriate tests
- [ ] TypeScript types are explicit and strict (no `any`)
# tanstack-dexie-db-collection

## Visão Geral do Projeto

**tanstack-dexie-db-collection** é uma biblioteca TypeScript que fornece integração entre **TanStack DB** e **Dexie.js**, permitindo uma camada de persistência local-first com monitoramento eficiente de mudanças e armazenamento IndexedDB.

### Propósito

- Criar coleções TanStack DB que sincronizam automaticamente com tabelas Dexie no IndexedDB
- Suportar atualizações otimistas com rastreamento de confirmação (acknowledgment tracking)
- Fornecer atualizações reativas em tempo real usando `liveQuery` do Dexie
- Habilitar padrões offline-first com sincronização de backend opcional

### Tecnologias Principais

- **TanStack DB** - Gerenciamento de estado reativo em memória
- **Dexie.js 4.x** - Wrapper IndexedDB
- **TypeScript** - Tipagem estática com schemas (Zod, Standard Schema)
- **Vite** - Build e desenvolvimento
- **Vitest** - Framework de testes
- **pnpm** - Gerenciador de pacotes

### Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                    TanStack DB Collection                │
│  (In-memory, reactive state with optimistic updates)    │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ sync() - bidirectional
                     │
┌────────────────────▼────────────────────────────────────┐
│              Dexie Collection Options Driver             │
│  - Initial batch sync (configurable batch size)         │
│  - liveQuery subscription for reactive updates          │
│  - Metadata fields (_updatedAt, _createdAt)             │
│  - Ack tracking for optimistic mutations                │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Dexie API
                     │
┌────────────────────▼────────────────────────────────────┐
│                    IndexedDB (Browser)                   │
│                    Database: app-db                      │
│                    Tables: dynamic per collection        │
└─────────────────────────────────────────────────────────┘
```

## Estrutura do Projeto

```
tanstack-dexie-db-collection/
├── src/
│   ├── index.ts          # Export principal
│   ├── dexie.ts          # Implementação principal (dexieCollectionOptions)
│   └── helper.ts         # Utilitários (metadata, dexie fields)
├── tests/
│   ├── basic-operations.test.ts  # Testes principais
│   └── test-helpers.ts           # Helpers de teste
├── package.json
├── tsconfig.json
├── vite.config.ts
└── eslint.config.mjs
```

## Build e Execução

### Pré-requisitos

- Node.js (versão compatível com ES2020+)
- pnpm 10.6.3+

### Comandos

```bash
# Instalar dependências
pnpm install

# Build do projeto
pnpm build

# Build em modo watch (desenvolvimento)
pnpm dev

# Rodar testes
pnpm test

# Lint
pnpm lint

# Formatar código
pnpm format

# Release (bumpp + publish)
pnpm release
```

## Configuração de Tipo

O projeto usa **TypeScript estrito** com as seguintes configurações principais:

- `target`: ES2020
- `module`: ESNext
- `moduleResolution`: Bundler
- `strict`: true
- `declaration`: true (gera .d.ts)

## Padrões de Desenvolvimento

### Style Guide

- **Aspas**: Backtick (`` ` ``) para strings
- **Formatação**: Prettier com configuração padrão
- **Convenção de nomes**: PascalCase para tipos/parâmetros de tipo
- **Unused vars**: Prefixo `_` permitido para parâmetros não utilizados

### Práticas de Teste

- **Framework**: Vitest com ambiente jsdom
- **Cobertura**: Istanbul (habilitada em vite.config.ts)
- **Typecheck**: Habilitado nos testes
- **Padrão**: `describe` / `it` / `expect`
- **Cleanup**: Usar `afterEach` para limpar recursos (coleções, DBs)

### Estrutura de Código

O arquivo principal `src/dexie.ts` contém:

1. **Config interface** - `DexieCollectionConfig` com opções configuráveis
2. **Utils interface** - `DexieUtils` com métodos utilitários
3. **Função principal** - `dexieCollectionOptions()` que retorna configuração de coleção

### Recursos Chave Implementados

#### Sincronização

- **Initial sync**: Batch loading com paginação por `_updatedAt`
- **Live updates**: `liveQuery` para mudanças em tempo real
- **Change detection**: Comparação shallow + metadata timestamps

#### Otimistic Updates

- **Ack tracking**: `ackedIds`, `pendingAcks` para mutations
- **awaitIds**: Utility para aguardar IDs serem observados
- **Timeouts**: Configuráveis (`ackTimeoutMs`, `awaitTimeoutMs`)

#### Utilitários

```typescript
collection.utils = {
  getTable(),           // Acesso direto à tabela Dexie
  refresh(),            // Força reavaliação do liveQuery
  refetch(),            // Refresh + await processamento
  awaitIds(ids),        // Aguarda IDs serem vistos
  getNextId(),          // Gera IDs sequenciais numéricos
  insertLocally(),      // Insert sem trigger de handlers
  updateLocally(),      // Update sem trigger de handlers
  deleteLocally(),      // Delete sem trigger de handlers
  bulkInsertLocally(),  // Bulk insert local
  bulkUpdateLocally(),  // Bulk update local
  bulkDeleteLocally(),  // Bulk delete local
}
```

#### Metadata Fields

Campos internos adicionados automaticamente:

- `_createdAt`: Timestamp de criação
- `_updatedAt`: Timestamp de última atualização
- `__dexie_counter__`: ID especial para contador de IDs sequenciais

### Handlers de Persistência

A biblioteca suporta handlers opcionais para sincronização com backend:

```typescript
dexieCollectionOptions({
  onInsert: async ({ transaction }) => { /* sync to server */ },
  onUpdate: async ({ transaction }) => { /* sync to server */ },
  onDelete: async ({ transaction }) => { /* sync to server */ },
  
  awaitPersistence: false,        // Fire-and-forget (default)
  persistenceTimeoutMs: 5000,     // Timeout para await
  swallowPersistenceErrors: true, // Log errors, não propaga (default)
})
```

### Codecs (Transformação de Dados)

Suporte para transformação entre formato armazenado e em memória:

```typescript
codec: {
  parse: (stored) => ({ ...stored, date: new Date(stored.date) }),
  serialize: (item) => ({ ...item, date: item.date.toISOString() }),
}
```

## Dependências Principais

```json
{
  "dependencies": {
    "@standard-schema/spec": "^1.0.0",
    "@tanstack/db": "latest",
    "debug": "^4.4.1",
    "dexie": "4.2.0"
  },
  "devDependencies": {
    "@tanstack/config": "^0.20.1",
    "@types/debug": "^4.1.12",
    "fake-indexeddb": "^6.2.2",
    "jsdom": "^27.0.0",
    "vitest": "^3.2.4",
    "zod": "^4"
  }
}
```

## Recursos Adicionais

- **README.md**: Documentação completa de API e exemplos de uso
- **EXAMPLES.md**: Exemplos copy-paste prontos (React apps, bootstrap, SSE, WebSocket)
- **GEMINI.md**: Contexto adicional para agentes de IA

## Autor e Licença

- **Autor**: Himanshu Kumar Dutt
- **Licença**: MIT
- **Repositório**: https://github.com/HimanshuKumarDutt094/tanstack-dexie-db-collection
