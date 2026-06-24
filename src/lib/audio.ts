// G.711 μ-law decode: 8-bit unsigned → signed 16-bit PCM
function mulawDecode(u8: number): number {
  u8 = ~u8 & 0xff;
  const sign = u8 & 0x80 ? -1 : 1;
  const exp  = (u8 >> 4) & 0x07;
  const mant = u8 & 0x0f;
  return sign * (((mant | 0x10) << (exp + 3)) - 0x84);
}

// G.711 μ-law encode: signed 16-bit PCM → 8-bit unsigned
function mulawEncode(s: number): number {
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  s = Math.min(s + 0x84, 0x7fff);
  let exp = 7;
  for (let m = 0x4000; exp > 0 && !(s & m); exp--, m >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  return (~(sign | (exp << 4) | mant)) & 0xff;
}

export function mulawToLinear(buf: Buffer): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = mulawDecode(buf[i]);
  return out;
}

export function linearToMulaw(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = mulawEncode(pcm[i]);
  return out;
}

// Parse WAV → mono Int16Array resampled to targetRate Hz
export function wavToLinearMono(wavBuf: Buffer, targetRate = 8000): Int16Array {
  const numChannels  = wavBuf.readUInt16LE(22);
  const sampleRate   = wavBuf.readUInt32LE(24);
  const bitsPerSample = wavBuf.readUInt16LE(34);

  // Walk chunks to find "data"
  let offset = 12;
  while (offset < wavBuf.length - 8) {
    const id   = wavBuf.toString("ascii", offset, offset + 4);
    const size = wavBuf.readUInt32LE(offset + 4);
    if (id === "data") { offset += 8; break; }
    offset += 8 + size;
  }

  const bps      = bitsPerSample >> 3;
  const nSamples = Math.floor((wavBuf.length - offset) / (numChannels * bps));
  const mono     = new Int16Array(nSamples);

  for (let i = 0; i < nSamples; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const pos = offset + (i * numChannels + ch) * bps;
      sum += bps === 2 ? wavBuf.readInt16LE(pos) : (wavBuf[pos] - 128) << 8;
    }
    mono[i] = Math.round(sum / numChannels);
  }

  if (sampleRate === targetRate) return mono;

  const ratio  = sampleRate / targetRate;
  const outLen = Math.floor(nSamples / ratio);
  const out    = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo  = Math.floor(src);
    const hi  = Math.min(lo + 1, nSamples - 1);
    out[i]    = Math.round(mono[lo] * (1 - (src - lo)) + mono[hi] * (src - lo));
  }
  return out;
}

export function linearMonoToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataLen = pcm.length * 2;
  const buf = Buffer.allocUnsafe(44 + dataLen);
  buf.write("RIFF", 0);       buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);       buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);  buf.writeUInt16LE(1, 20);   // PCM
  buf.writeUInt16LE(1, 22);   buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

// Accumulated inbound μ-law 8 kHz → WAV for Groq Whisper
export function twilioMulawToWhisperWav(mulawBuf: Buffer): Buffer {
  return linearMonoToWav(mulawToLinear(mulawBuf), 8000);
}

// RMS of a μ-law buffer — used for voice-activity detection
export function mulawRms(buf: Buffer): number {
  if (!buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const s = mulawDecode(buf[i]);
    sum += s * s;
  }
  return Math.sqrt(sum / buf.length);
}
