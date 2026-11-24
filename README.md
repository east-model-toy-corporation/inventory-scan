# 條碼盤點

手機或電腦都可使用。支援手機相機連續刷讀、USB／藍牙掃描槍、手動批次輸入、Excel／CSV 商品主檔、離線暫存，以及透過 Google 試算表跨裝置彙總。

1. 在「設定開始」選擇門市、盤點人和場次。有商品主檔時可匯入檔案或從雲端載入。
2. 在「刷讀」開啟鏡頭，或將條碼輸入後按 Enter。點選明細數量可修改。
3. 在「彙總」重新整理全場資料，並匯出 Excel（彙總、明細、依人員）或 CSV。在「設定」可下載本機 JSON 備份。
4. 跨裝置使用時，在各裝置填入相同的 API 網址與金鑰，再以同一場次代碼加入。

離線時資料會先保存在本機。設定雲端連線後，待上傳資料會在連線恢復時自動重試。首次開啟需要連線，以便快取應用程式供離線重新載入使用。

## 開發與測試

- `node --test tests/` 或 `npm run test:gas` 執行 14 項 Node.js 測試。
- `node --test tests/gas.test.js` 單獨執行 9 項 Apps Script 測試。
- `npm run test:e2e` 執行 Playwright 測試，預期 14 項通過、1 項略過（相機介面測試只在 Chromium 執行）。
- `npm test` 依序執行 Node.js 和 Playwright 的完整測試。
- `npm run serve` 啟動前端和模擬 API，並印出兩個網址。測試 API 金鑰為 `test-key`。

螢幕截圖儲存在 [screens/](screens/)。執行 `npx playwright test tests/screens.spec.js --project=webkit` 可重拍六張 iPhone 14 介面截圖。執行 `npx playwright test tests/camera.spec.js --project=chromium-camera` 可重拍 ZXing 辨識條碼後的 `07-camera-scan.png`。

[部署說明](docs/DEPLOY.md)
