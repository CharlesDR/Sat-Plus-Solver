import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works under a GitHub Pages project path.
  base: './',
  plugins: [react()],
});
