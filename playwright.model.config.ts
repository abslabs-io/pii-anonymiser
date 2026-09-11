import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './tests/model',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  use: {
    ...base.use,
    headless: process.env.MODEL_HEADLESS === '1',
    launchOptions: {
      ...base.use?.launchOptions,
      args:
        process.env.MODEL_SOFTWARE_GPU === '1'
          ? [
              '--enable-unsafe-webgpu',
              '--use-angle=swiftshader',
              '--enable-features=Vulkan',
            ]
          : [],
    },
  },
});
