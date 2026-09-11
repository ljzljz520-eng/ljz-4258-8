import { defineConfig } from 'vitest/config';

// 测试运行器使用独立配置，避免加载 Qwik 浏览器构建插件
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
