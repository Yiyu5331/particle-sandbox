import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/e2e',
  use:{baseURL:'http://127.0.0.1:18841',channel:process.env.PLAYWRIGHT_CHROMIUM_CHANNEL, viewport:{width:1200,height:800}},
  webServer:{command:'python3 -m http.server 18841 --bind 127.0.0.1 --directory dist',url:'http://127.0.0.1:18841/particle-sandbox.html'},
});
