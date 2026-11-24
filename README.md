# 條碼盤點

手機或電腦都可使用。支援手機相機連續刷讀、USB／藍牙掃描槍、手動批次輸入、Excel／CSV 商品主檔、離線暫存，以及透過 Google 試算表跨裝置彙總。

1. 在「設定開始」選擇門市並填寫盤點人。有進行中的場次時會自動加入，並沿用該場次的模式。建立新場次時可選擇模式並匯入 Excel／CSV。有主檔模式的場次若尚無主檔，加入者也可匯入。雲端主檔會在同門市、同場次的裝置間共享。
2. 在「刷讀」開啟鏡頭，或將條碼輸入後按 Enter。點選明細數量可修改。
3. 在「彙總」重新整理全場資料，並匯出 Excel（彙總、明細、依人員）或 CSV。在「設定」可下載本機 JSON 備份。
4. 跨裝置盤點時，各裝置填入相同的 API 網址與金鑰，再選擇同一門市。場次以門市及台北開始日期命名，跨日會沿用原場次。按「結束盤點」後，再選該門市就會開新場次。上一場仍可從「彙總」查看和匯出。
5. 設定雲端後，離線時可繼續本機已快取的進行中場次。離線確認結束後，結束指令會在恢復連線時同步。若場次已被結束而明細未能上傳，可按「匯出本機備份」保留明細。未設定雲端時，各門市的場次由此裝置管理。

離線時資料會先保存在本機。設定雲端連線後，待上傳資料會在連線恢復時自動重試。首次開啟需要連線，以便快取應用程式供離線重新載入使用。

## 開發與測試

- `node --test tests/` 或 `npm run test:gas` 執行 Node.js 測試。
- `node --test tests/gas.test.js` 單獨執行 Apps Script 測試。
- `npm run test:e2e` 執行 Playwright 測試（相機介面測試只在 Chromium 執行）。
- `npm test` 依序執行 Node.js 和 Playwright 的完整測試。
- `npm run serve` 啟動前端和模擬 API，並印出兩個網址。測試 API 金鑰為 `test-key`。

螢幕截圖儲存在 [screens/](screens/)。執行 `npx playwright test tests/screens.spec.js --project=webkit` 可重拍七張 iPhone 14 介面截圖，包含「結束盤點」按鈕。執行 `npx playwright test tests/camera.spec.js --project=chromium-camera` 可重拍 ZXing 辨識條碼後的 `07-camera-scan.png`。

[部署說明](docs/DEPLOY.md)
