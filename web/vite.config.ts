import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@lib': resolve(__dirname, '../src/lib'),
      '@shared': resolve(__dirname, '../src'),
    },
  },
  server: {
    // 与 .clawdao/project.json ports.web 对齐
    port: 5182,
    strictPort: true,
    proxy: {
      // /api → Bun 后端（与 src/index.ts --port 18795 对齐；与 .clawdao/project.json ports.dev 一致）
      '/api': 'http://localhost:18795',
      // /outputs → 生成图片静态托管
      '/outputs': {
        target: 'http://localhost:18795',
        changeOrigin: true,
      },
    },
  },
});
