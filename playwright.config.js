const {defineConfig,devices} = require('@playwright/test');

module.exports = defineConfig({
  testDir:'./tests',
  testMatch:'*.spec.js',
  timeout:40000,
  use:{acceptDownloads:true,trace:'retain-on-failure'},
  projects:[
    {name:'chromium',testIgnore:['camera.spec.js','camera-portrait.spec.js','camera-idle.spec.js','compact.spec.js','screens.spec.js'],use:{...devices['Pixel 7'],launchOptions:{args:[
      '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'
    ]}}},
    {name:'webkit',testIgnore:['camera.spec.js','camera-portrait.spec.js','camera-idle.spec.js','compact.spec.js'],use:{...devices['iPhone 14']}},
    {name:'chromium-camera',testMatch:['camera.spec.js','compact.spec.js'],use:{...devices['Pixel 7'],launchOptions:{args:[
      '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${__dirname}/tests/fixtures/ean13.y4m`
    ]}}},
    {name:'chromium-camera-portrait',testMatch:'camera-portrait.spec.js',use:{...devices['Pixel 7'],launchOptions:{args:[
      '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${__dirname}/tests/fixtures/ean13-portrait.y4m`
    ]}}},
    {name:'chromium-camera-idle',testMatch:'camera-idle.spec.js',use:{...devices['Pixel 7'],launchOptions:{args:[
      '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${__dirname}/tests/fixtures/blank.y4m`
    ]}}}
  ]
});
