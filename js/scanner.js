(function () {
  const formats = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39'];
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
    const guide = preview.querySelector('.guide');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d',{willReadFrequently:true});
    let stream, track, frame, facing = 'environment', generation = 0, torch = false;
    let paused = false, pauseVersion = 0;
    function stop() {
      generation++;
      if (frame != null) cancelAnimationFrame(frame);
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
            width:{ideal:1280},height:{ideal:720},aspectRatio:{ideal:16/9}},audio:false});
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
        let decode;
        if ('BarcodeDetector' in window && new URLSearchParams(location.search).get('engine') !== 'zxing') {
          try {
            const supported = await window.BarcodeDetector.getSupportedFormats();
            if (formats.every(format => supported.includes(format))) {
              const detector = new window.BarcodeDetector({formats});
              decode = async crop => {
                try { return (await detector.detect(crop)).map(result => result.rawValue); }
                catch (_) { decode = decoder(); return decode(crop); }
              };
            }
          } catch (_) { /* 改用 ZXing */ }
        }
        if (token !== generation) return;
        decode = decode || decoder();
        async function decodeGuide() {
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
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          context.drawImage(video,x,y,width,height,0,0,width,height);
          return decode(canvas);
        }
        let previous = -Infinity;
        async function tick(time) {
          if (token !== generation) return;
          if (!paused && video.readyState >= 2 && time-previous >= 120) {
            previous = time;
            try {
              const version = pauseVersion;
              const codes = await decodeGuide();
              for (const code of codes) {
                if (token !== generation || paused || version !== pauseVersion) break;
                onScan(code,'camera');
              }
            } catch (_) {
              if (token === generation) { stop(); onState(false,false,'無法辨識鏡頭畫面，請重新開啟鏡頭'); }
              return;
            }
          }
          if (token === generation) frame = requestAnimationFrame(tick);
        }
        frame = requestAnimationFrame(tick);
      } catch (error) {
        if (token !== generation) return;
        stop();
        const message = error.name === 'NotAllowedError' ? '請在瀏覽器設定允許相機' :
          error.name === 'NotFoundError' ? '找不到相機' :
          ['需 HTTPS 才能開鏡頭','此瀏覽器無法使用相機'].includes(error.message) ? error.message : '無法開啟相機，請確認相機未被占用';
        onState(false,false,message);
      }
    }
    return {start,stop,pause:() => { paused = true; pauseVersion++; },
      resume:() => { paused = false; },toggle:() => stream ? stop() : start(),switchCamera:() => {
      facing = facing === 'environment' ? 'user' : 'environment';
      return start();
    },toggleTorch:async () => {
      if (!track) return false;
      await track.applyConstraints({advanced:[{torch:!torch}]});
      torch = !torch;
      return torch;
    }};
  }
  window.InvScanner = {create};
})();
