import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The build produces a single self-contained dist/index.html that can be
// opened directly from disk (file://) without a server.
export default defineConfig({
  plugins: [viteSingleFile()],
});
