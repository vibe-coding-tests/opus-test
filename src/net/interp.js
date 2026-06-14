// src/net/interp.js
// Linear interpolation over a time-ordered buffer of transform samples.
// `renderT` is in the same time units as each sample's `t`.

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function sampleBuffer(buf, renderT) {
  if (!buf || buf.length === 0) return null;
  if (renderT <= buf[0].t) return { ...buf[0] };
  const last = buf[buf.length - 1];
  if (renderT >= last.t) return { ...last };
  let i = 0;
  while (i < buf.length - 1 && buf[i + 1].t < renderT) i++;
  const a = buf[i], b = buf[i + 1];
  const k = (renderT - a.t) / (b.t - a.t || 1);
  return {
    t: renderT,
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    yaw: lerpAngle(a.yaw, b.yaw, k),
    pitch: a.pitch + (b.pitch - a.pitch) * k,
  };
}
