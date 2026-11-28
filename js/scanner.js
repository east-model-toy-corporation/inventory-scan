(function () {
  const formats = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39'];
  const DECODE_INTERVALS = Object.freeze({barcodeDetector:120,zxing:190});

  function cropDrawSize(width,height) {
    const scale = Math.min(1,720/Math.max(width,height));
    return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
  }

  function fitPreview(video,preview) {
    if ((!video.srcObject && !video.currentSrc) || video.parentElement !== preview) return true;
    const {width,height} = preview.getBoundingClientRect();
    if (!width || !height) return false;

    // Drop WebKit's cached video box before restoring the cover layout.
    video.style.display = 'none';
    void video.offsetHeight;
    video.style.display = 'block';
    video.removeAttribute('width');
    video.removeAttribute('height');
    Object.assign(video.style,{
      position:'absolute',inset:'0',width:'100%',height:'100%',
      minWidth:'100%',minHeight:'100%',maxWidth:'none',maxHeight:'none',
      objectFit:'cover',objectPosition:'center'
    });
    return true;
  }

  function decoder() {
    const z = window.ZXing;
    const reader = new z.MultiFormatReader();
    const hints = new Map([[z.DecodeHintType.POSSIBLE_FORMATS,formats.map(format => z.BarcodeFormat[format.toUpperCase()])],
      [z.DecodeHintType.TRY_HARDER,true]]);
    reader.setHints(hints);
    return canvas => {
      try {
        const source = new z.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new z.BinaryBitmap(new z.HybridBinarizer(source));
        return [reader.decodeWithState(bitmap).getText()];
      } catch (error) {
        if (!(error instanceof z.NotFoundException || error instanceof z.ChecksumException || error instanceof z.FormatException)) throw error;
        return [];
      }
    };
  }
  function create(video, onScan, onState) {
    const preview = video.parentElement;
    let previewRetry;
    function relayout() {
      cancelAnimationFrame(previewRetry);
      function fit(retries) {
        if (!fitPreview(video,preview) && retries > 0) {
          previewRetry = requestAnimationFrame(() => fit(retries-1));
        }
      }
      fit(4);
    }
    for (const event of ['loadedmetadata','loadeddata','resize']) {
      video.addEventListener(event,relayout);
    }
    const guide = preview.querySelector('.guide');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d',{willReadFrequently:true});
    const idleOverlay = preview.querySelector('#scan-idle');
    const params = new URLSearchParams(location.search);
    const idleOverride = Number(params.get('idlePause'));
    const idleDelay = Number.isFinite(idleOverride) && params.get('idlePause')?.trim() ?
      Math.max(500,idleOverride) : 60000;
    let stream, track, facing = 'environment', generation = 0, torch = false;
    let paused = false, pauseVersion = 0, idle = false, busy = false;
    let decodeTimer, idleTimer, decodeFrame, interval;

    function relayoutAfterShow() {
      const token = generation;
      const refresh = () => {
        if (token === generation) relayout();
      };
      requestAnimationFrame(() => requestAnimationFrame(refresh));
      setTimeout(refresh,75);
    }

    function clearDecodeTimer() {
      clearTimeout(decodeTimer);
      decodeTimer = null;
    }
    function resetIdleTimer() {
      clearTimeout(idleTimer);
      if (!decodeFrame || paused || idle) return;
      idleTimer = setTimeout(() => {
        idle = true;
        pauseVersion++;
        clearDecodeTimer();
        idleOverlay.hidden = false;
      },idleDelay);
    }
    function scheduleDecode() {
      if (decodeFrame && !paused && !idle && !busy && decodeTimer == null) {
        decodeTimer = setTimeout(tick,interval);
      }
    }
    async function tick() {
      decodeTimer = null;
      if (!decodeFrame || paused || idle || busy) return;
      if (video.readyState < 2) {
        scheduleDecode();
        return;
      }
      const token = generation;
      const version = pauseVersion;
      busy = true;
      try {
        const codes = await decodeFrame();
        for (const code of codes) {
          if (token !== generation || version !== pauseVersion) break;
          if (!code) continue;
          resetIdleTimer();
          onScan(code,'camera');
        }
      } catch (_) {
        if (token === generation) {
          stop();
          onState(false,false,'無法辨識鏡頭畫面，請重新開啟鏡頭');
        }
      } finally {
        busy = false;
        scheduleDecode();
      }
    }
    preview.addEventListener('click',() => {
      if (!idle || paused) return;
      relayout();
      idle = false;
      idleOverlay.hidden = true;
      resetIdleTimer();
      scheduleDecode();
    });
    function stop() {
      generation++;
      cancelAnimationFrame(previewRetry);
      decodeFrame = null;
      clearDecodeTimer();
      clearTimeout(idleTimer);
      idle = false;
      idleOverlay.hidden = true;
      if (stream) stream.getTracks().forEach(item => item.stop());
      stream = track = null;
      video.srcObject = null;
      torch = false;
      onState(false,false,'');
    }
    async function start() {
      stop();
      const token = generation;
      try {
        if (!window.isSecureContext) throw new Error('需 HTTPS 才能開鏡頭');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('此瀏覽器無法使用相機');
        const facingMode = {ideal:facing};
        let media;
        try {
          media = await navigator.mediaDevices.getUserMedia({video:{facingMode,
            width:{ideal:1280,max:1920},height:{ideal:720,max:1080},aspectRatio:{ideal:16/9}},audio:false});
        } catch (error) {
          if (error.name !== 'OverconstrainedError' || token !== generation) throw error;
          media = await navigator.mediaDevices.getUserMedia({video:{facingMode}});
        }
        if (token !== generation) { media.getTracks().forEach(item => item.stop()); return; }
        stream = media;
        track = stream.getVideoTracks()[0];
        track.addEventListener('ended',() => {
          if (token === generation) { stop(); onState(false,false,'鏡頭已停止'); }
        });
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        onState(true,!!capabilities.torch,'');
        video.srcObject = stream;
        await video.play();
        if (token !== generation) return;
        relayout();
        relayoutAfterShow();
        let decode;
        if ('BarcodeDetector' in window && params.get('engine') !== 'zxing') {
          try {
            const supported = await window.BarcodeDetector.getSupportedFormats();
            if (formats.every(format => supported.includes(format))) {
              const detector = new window.BarcodeDetector({formats});
              decode = async crop => {
                try { return (await detector.detect(crop)).map(result => result.rawValue); }
                catch (_) {
                  decode = decoder();
                  if (token === generation) interval = DECODE_INTERVALS.zxing;
                  return [];
                }
              };
            }
          } catch (_) { /* 改用 ZXing */ }
        }
        if (token !== generation) return;
        interval = decode ? DECODE_INTERVALS.barcodeDetector : DECODE_INTERVALS.zxing;
        decode = decode || decoder();
        decodeFrame = function decodeGuide() {
          const box = preview.getBoundingClientRect();
          const frame = guide.getBoundingClientRect();
          if (!box.width || !box.height || !video.videoWidth || !video.videoHeight) return [];
          // Include 5% of the guide size on each side for barcodes near the edge.
          const {x,y,width,height} = window.InvCore.guideToVideoRect({
            videoW:video.videoWidth,videoH:video.videoHeight,boxW:box.width,boxH:box.height,
            guide:{left:frame.left-box.left-frame.width*.05,top:frame.top-box.top-frame.height*.05,
              width:frame.width*1.1,height:frame.height*1.1}
          });
          if (!width || !height) return [];
          const draw = cropDrawSize(width,height);
          if (canvas.width !== draw.width) canvas.width = draw.width;
          if (canvas.height !== draw.height) canvas.height = draw.height;
          context.drawImage(video,x,y,width,height,0,0,draw.width,draw.height);
          return decode(canvas);
        };
        resetIdleTimer();
        scheduleDecode();
      } catch (error) {
        if (token !== generation) return;
        stop();
        const message = error.name === 'NotAllowedError' ? '請在瀏覽器設定允許相機' :
          error.name === 'NotFoundError' ? '找不到相機' :
          ['需 HTTPS 才能開鏡頭','此瀏覽器無法使用相機'].includes(error.message) ? error.message : '無法開啟相機，請確認相機未被占用';
        onState(false,false,message);
      }
    }
    return {start,stop,relayout,relayoutAfterShow,pause:() => {
      if (paused) return;
      paused = true;
      pauseVersion++;
      clearDecodeTimer();
      resetIdleTimer();
      idleOverlay.hidden = true;
    },resume:() => {
      if (!paused) return;
      paused = false;
      idleOverlay.hidden = !idle;
      resetIdleTimer();
      scheduleDecode();
    },toggle:() => stream ? stop() : start(),switchCamera:() => {
      facing = facing === 'environment' ? 'user' : 'environment';
      return start();
    },toggleTorch:async () => {
      if (!track) return false;
      await track.applyConstraints({advanced:[{torch:!torch}]});
      torch = !torch;
      return torch;
    }};
  }
  const scanner = {create,DECODE_INTERVALS,cropDrawSize};
  if (typeof module === 'object' && module.exports) module.exports = scanner;
  else window.InvScanner = scanner;
})();
