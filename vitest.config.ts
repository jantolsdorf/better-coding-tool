import { defineConfig } from 'vitest/config';

// Unit tests of the model and controllers (tests/*.test.ts). happy-dom provides the browser
// APIs they use: localStorage, DOMParser, and the DOM for messages.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
