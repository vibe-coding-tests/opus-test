// src/net/interp.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleBuffer } from './interp.js';

const buf = [
  { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
  { t: 1, x: 10, y: 0, z: 0, yaw: 1, pitch: 0 },
];

test('samples midway between two states', () => {
  const s = sampleBuffer(buf, 0.5);
  assert.ok(Math.abs(s.x - 5) < 1e-6);
  assert.ok(Math.abs(s.yaw - 0.5) < 1e-6);
});

test('clamps before the first sample', () => {
  const s = sampleBuffer(buf, -3);
  assert.equal(s.x, 0);
});

test('clamps after the last sample', () => {
  const s = sampleBuffer(buf, 9);
  assert.equal(s.x, 10);
});

test('interpolates yaw the short way around the wrap', () => {
  const wrap = [
    { t: 0, x: 0, y: 0, z: 0, yaw: 3.0, pitch: 0 },
    { t: 1, x: 0, y: 0, z: 0, yaw: -3.0, pitch: 0 },
  ];
  const s = sampleBuffer(wrap, 0.5);
  assert.ok(Math.abs(Math.abs(s.yaw) - Math.PI) < 0.2);
});

test('empty buffer returns null', () => {
  assert.equal(sampleBuffer([], 0.5), null);
});
