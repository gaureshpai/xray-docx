const {defineConfig, devices} = require('@playwright/test');

module.exports = defineConfig({
  testDir:'tests/browser',
  timeout:30000,
  expect:{timeout:10000},
  fullyParallel:true,
  workers:2,
  retries:0,
  reporter:'list',
  use:{baseURL:'http://127.0.0.1:8123', acceptDownloads:true, trace:'retain-on-failure'},
  webServer:{command:'node tests/python.cjs -m tests.browser_server', url:'http://127.0.0.1:8123', reuseExistingServer:false},
  projects:[
    {name:'chromium', use:{...devices['Desktop Chrome']}},
    {name:'firefox', use:{...devices['Desktop Firefox']}},
    {name:'webkit', use:{...devices['Desktop Safari']}},
    {name:'mobile-chromium', use:{...devices['Pixel 7']}},
  ],
});
