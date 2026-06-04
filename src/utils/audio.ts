/**
 * Convert a Float32Array of audio samples in range [-1.0, 1.0] to an ArrayBuffer
 * containing 16-bit Signed Integers (PCM Int16).
 */
export function float32ToInt16(floatArr: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(floatArr.length * 2);
  const int16View = new Int16Array(buffer);
  for (let i = 0; i < floatArr.length; i++) {
    const s = Math.max(-1, Math.min(1, floatArr[i]));
    int16View[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return buffer;
}

/**
 * Encodes an ArrayBuffer (or typed array) to a Base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, sub as any);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 encoded 16-bit Signed Int PCM string back into a Float32Array
 * for playout in standard Web Audio API.
 */
export function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Convert byte stream to Int16
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  return float32Array;
}

export function startAmbientNoise(
  audioCtx: AudioContext,
  type: "none" | "office" | "cafe" | "airport"
): { stop: () => void } {
  if (type === "none") {
    return { stop: () => {} };
  }

  const sampleRate = audioCtx.sampleRate;
  const bufferSize = 2 * sampleRate; // 2 seconds loop
  const buffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  // Generate noise type
  if (type === "office") {
    // Brownian noise (muffled AC / server room hum)
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5;
    }
  } else {
    // Pink noise for cafe (crowd murmur) and airport (terminal wash)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      data[i] *= 0.11;
      b6 = white * 0.115926;
    }
  }

  // Create Source Node
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  // Create filters and routing
  const mainGain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  source.connect(filter);

  const activeIntervals: any[] = [];
  const activeNodes: (AudioScheduledSourceNode | GainNode | DelayNode)[] = [];

  if (type === "office") {
    // Office AC hum: Low-pass filter around 120Hz
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(120, audioCtx.currentTime);
    mainGain.gain.setValueAtTime(0.08, audioCtx.currentTime); // Subtle hum
    filter.connect(mainGain);
  } else if (type === "cafe") {
    // Cafe crowd murmur: Low-pass filter around 400Hz
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(350, audioCtx.currentTime);
    mainGain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    filter.connect(mainGain);

    // Dynamic scheduling of plate/cup clinks
    const playClink = () => {
      if (audioCtx.state === "suspended") return;
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      // Random high frequency clink
      const freq = 1800 + Math.random() * 1200;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      
      // Fast exponential decay
      gainNode.gain.setValueAtTime(0.0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.005 + Math.random() * 0.008, audioCtx.currentTime + 0.002);
      gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.08 + Math.random() * 0.05);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
      
      activeNodes.push(osc, gainNode);
    };

    const interval = setInterval(() => {
      // Play 1-3 clinks randomly
      const clinksCount = Math.floor(Math.random() * 3) + 1;
      for (let c = 0; c < clinksCount; c++) {
        setTimeout(playClink, Math.random() * 2000);
      }
    }, 4000 + Math.random() * 4000);
    
    activeIntervals.push(interval);
  } else if (type === "airport") {
    // Airport terminal: Pink noise bandpass filtered around 250Hz with wide Q
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(250, audioCtx.currentTime);
    filter.Q.setValueAtTime(0.7, audioCtx.currentTime);
    mainGain.gain.setValueAtTime(0.03, audioCtx.currentTime);

    // Terminal Echo Reverb
    const delay = audioCtx.createDelay();
    delay.delayTime.setValueAtTime(0.35, audioCtx.currentTime);
    
    const feedback = audioCtx.createGain();
    feedback.gain.setValueAtTime(0.45, audioCtx.currentTime);

    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay); // Feedback loop

    // Mix raw + echo
    filter.connect(mainGain);
    delay.connect(mainGain);

    activeNodes.push(delay, feedback);

    // Play a standard airport boarding chime (Ding Dong - G5, C6) every 18 seconds
    const playChime = () => {
      if (audioCtx.state === "suspended") return;
      const now = audioCtx.currentTime;

      // Note 1 (Ding)
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.frequency.setValueAtTime(783.99, now); // G5
      gain1.gain.setValueAtTime(0.0, now);
      gain1.gain.linearRampToValueAtTime(0.008, now + 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.00001, now + 1.2);
      osc1.connect(gain1);
      gain1.connect(delay); // Send to delay for echo effect!
      gain1.connect(audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 1.5);

      // Note 2 (Dong)
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.frequency.setValueAtTime(523.25, now + 0.4); // C5
      gain2.gain.setValueAtTime(0.0, now + 0.4);
      gain2.gain.linearRampToValueAtTime(0.008, now + 0.45);
      gain2.gain.exponentialRampToValueAtTime(0.00001, now + 1.8);
      osc2.connect(gain2);
      gain2.connect(delay); // Send to delay for echo effect!
      gain2.connect(audioCtx.destination);
      osc2.start(now + 0.4);
      osc2.stop(now + 2.0);

      activeNodes.push(osc1, gain1, osc2, gain2);
    };

    // Schedule chime initially, then every 18 seconds
    setTimeout(playChime, 2000);
    const interval = setInterval(playChime, 18000);
    activeIntervals.push(interval);
  }

  mainGain.connect(audioCtx.destination);
  source.start();

  return {
    stop: () => {
      try {
        source.stop();
      } catch (e) {}
      try {
        source.disconnect();
      } catch (e) {}
      try {
        filter.disconnect();
      } catch (e) {}
      try {
        mainGain.disconnect();
      } catch (e) {}

      activeIntervals.forEach(clearInterval);
      activeNodes.forEach((node) => {
        try {
          if (node instanceof AudioScheduledSourceNode) {
            node.stop();
          }
          node.disconnect();
        } catch (e) {}
      });
    }
  };
}
