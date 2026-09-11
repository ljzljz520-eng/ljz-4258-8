/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { qwikVite } from '@builder.io/qwik/optimizer';

export default defineConfig({
  plugins: [qwikVite({ csr: true })],
  server: { host: true, port: 5173 },
  build: { target: 'es2022', outDir: 'dist' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as never);
