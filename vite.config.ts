import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { thirdPartyLicenses } from './build/licenses';

// The build produces a single self-contained dist/index.html that can be
// opened directly from disk (file://) without a server. The licenses of the
// bundled packages go with it (see build/licenses.ts).
export default defineConfig({
  plugins: [thirdPartyLicenses(), viteSingleFile()],
});
