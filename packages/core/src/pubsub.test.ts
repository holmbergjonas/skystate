import { describe, it, expect, vi } from 'vitest';
import { PubSubEmitter } from './pubsub.js';

describe('PubSubEmitter', () => {
  it('subscribe + emit matching path calls callback', () => {
    const emitter = new PubSubEmitter();
    const cb = vi.fn();

    emitter.subscribe('features.darkMode', cb);
    emitter.emit(new Set(['features.darkMode']));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('subscribe + emit non-matching path does not call callback', () => {
    const emitter = new PubSubEmitter();
    const cb = vi.fn();

    emitter.subscribe('features.darkMode', cb);
    emitter.emit(new Set(['limits.maxUsers']));

    expect(cb).not.toHaveBeenCalled();
  });

  it('root subscriber ("") fires on any emit that includes root', () => {
    const emitter = new PubSubEmitter();
    const cb = vi.fn();

    emitter.subscribe('', cb);
    emitter.emit(new Set(['', 'features.darkMode']));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes callback, subsequent emit does not call it', () => {
    const emitter = new PubSubEmitter();
    const cb = vi.fn();

    const unsub = emitter.subscribe('features.darkMode', cb);
    unsub();

    emitter.emit(new Set(['features.darkMode']));

    expect(cb).not.toHaveBeenCalled();
  });

  it('double unsubscribe does not throw', () => {
    const emitter = new PubSubEmitter();
    const cb = vi.fn();

    const unsub = emitter.subscribe('features.darkMode', cb);
    unsub();

    expect(() => unsub()).not.toThrow();
  });

  it('multiple subscribers on same path all fire', () => {
    const emitter = new PubSubEmitter();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    emitter.subscribe('features.darkMode', cb1);
    emitter.subscribe('features.darkMode', cb2);
    emitter.subscribe('features.darkMode', cb3);

    emitter.emit(new Set(['features.darkMode']));

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb3).toHaveBeenCalledTimes(1);
  });

  it('clear() removes all subscriptions, subsequent emit calls nothing', () => {
    const emitter = new PubSubEmitter();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    emitter.subscribe('features.darkMode', cb1);
    emitter.subscribe('limits.maxUsers', cb2);

    emitter.clear();
    emitter.emit(new Set(['features.darkMode', 'limits.maxUsers']));

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    expect(emitter.size).toBe(0);
  });

  it('size reflects current subscription count', () => {
    const emitter = new PubSubEmitter();

    expect(emitter.size).toBe(0);

    const unsub1 = emitter.subscribe('a', vi.fn());
    expect(emitter.size).toBe(1);

    const unsub2 = emitter.subscribe('a', vi.fn());
    expect(emitter.size).toBe(2);

    emitter.subscribe('b', vi.fn());
    expect(emitter.size).toBe(3);

    unsub1();
    expect(emitter.size).toBe(2);

    unsub2();
    expect(emitter.size).toBe(1);
  });

  it('emit with empty set calls no callbacks', () => {
    const emitter = new PubSubEmitter();
    const cb = vi.fn();

    emitter.subscribe('features.darkMode', cb);
    emitter.emit(new Set());

    expect(cb).not.toHaveBeenCalled();
  });

  it('emit with multiple changed paths calls all matching subscribers', () => {
    const emitter = new PubSubEmitter();
    const cbA = vi.fn();
    const cbB = vi.fn();
    const cbC = vi.fn();

    emitter.subscribe('a', cbA);
    emitter.subscribe('b', cbB);
    emitter.subscribe('c', cbC);

    emitter.emit(new Set(['a', 'b']));

    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbC).not.toHaveBeenCalled();
  });
});
