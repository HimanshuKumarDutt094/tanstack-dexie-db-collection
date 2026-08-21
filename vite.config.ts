import { defineConfig } from "vitest/config"
import { preserveDirectives } from "rollup-plugin-preserve-directives"
import { externalizeDeps } from "vite-plugin-externalize-deps"
import dts from "vite-plugin-dts"
import packageJson from "./package.json"

export default defineConfig({
  plugins: [
    externalizeDeps(),
    preserveDirectives(),
    dts({
      outDirs: "dist/esm",
      entryRoot: "src",
      include: "src",
      tsconfigPath: "./tsconfig.json",
      compilerOptions: { module: 99, declarationMap: false, skipLibCheck: true, rootDir: "src" },
    }),
  ],
  build: {
    outDir: "dist",
    minify: false,
    sourcemap: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "esm/[name].js",
    },
    rollupOptions: {
      output: { preserveModules: true },
    },
  },
  test: {
    name: packageJson.name,
    dir: `./tests`,
    environment: `jsdom`,
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: { enabled: true },
  },
})
