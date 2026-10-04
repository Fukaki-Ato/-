import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig.json 依赖编辑器生成的 temp/ 文件，CLI 下不保证存在；测试使用自包含的 core 配置。
  tsconfig: './tsconfig.core.json',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
