import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { SilenceDetector } from '../public/js/silence.js';

describe('SilenceDetector (auto-save on silence)', () => {
  let clock;
  let fired;
  let ticks;
  let d;

  const advance = (ms) => {
    // Simulate the 100 ms interval the browser would run.
    for (let t = 0; t < ms; t += 100) {
      clock += 100;
      d.tick();
    }
  };

  beforeEach(() => {
    clock = 0;
    fired = 0;
    ticks = [];
    d = new SilenceDetector({
      threshold: 0.02,
      graceMs: 700,
      now: () => clock,
      onSilence: () => fired++,
      onTick: (remaining) => ticks.push(remaining),
    });
    d.start(3000, { autoTick: false });
  });

  it('does not fire before the user has spoken at all', () => {
    advance(10_000);
    assert.equal(fired, 0);
  });

  it('fires once after the configured silence following speech', () => {
    d.level(0.1); // speech
    advance(2900);
    assert.equal(fired, 0);
    advance(200);
    assert.equal(fired, 1);
    advance(5000);
    assert.equal(fired, 1, 'must fire only once per session');
  });

  it('ignores background noise below the threshold', () => {
    d.level(0.1);
    advance(1000);
    d.level(0.005); // quiet-room noise
    advance(2100);
    assert.equal(fired, 1);
  });

  it('resets the countdown when the user speaks again', () => {
    d.level(0.1);
    advance(2500);
    d.level(0.08);
    advance(2500);
    assert.equal(fired, 0);
    advance(600);
    assert.equal(fired, 1);
  });

  it('treats transcript events as activity (STT still emitting text)', () => {
    d.activity();
    advance(2000);
    d.activity();
    advance(2000);
    assert.equal(fired, 0);
  });

  it('shows no countdown during a short natural pause, then counts down 1 -> 0', () => {
    d.level(0.1);
    advance(600);
    assert.ok(ticks.every((t) => t === null), 'no countdown within grace period');
    ticks.length = 0;
    advance(2300);
    const shown = ticks.filter((t) => t !== null);
    assert.ok(shown.length > 0);
    assert.ok(shown.every((v, i) => i === 0 || v <= shown[i - 1]), 'countdown must be monotonic');
    assert.ok(shown.at(-1) < 0.1);
  });

  it('does nothing after stop()', () => {
    d.level(0.1);
    d.stop();
    advance(10_000);
    assert.equal(fired, 0);
  });
});
