'use strict';

/**
 * A queue that callbacks push into and a `for await` reads out of.
 *
 * The engines under the analyzers -- the directory walk, the duplicate finder,
 * the photo scan -- report through callbacks, because that is what a walk with
 * sixteen directories in flight naturally does. An analyzer is an async
 * iterable. This is the join: `onProgress` pushes, the analyzer's generator
 * reads, and nothing is buffered beyond what the reader has not got to yet.
 */
function channel() {
  const queue = [];
  let waiting = null;
  let closed = false;
  let failure = null;

  const wake = () => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve();
    }
  };

  return {
    push(item) {
      if (closed) return;
      queue.push(item);
      wake();
    },
    end() {
      closed = true;
      wake();
    },
    fail(err) {
      failure = err;
      closed = true;
      wake();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queue.length > 0) yield queue.shift();
        if (failure) throw failure;
        if (closed) return;
        await new Promise((resolve) => {
          waiting = resolve;
        });
      }
    },
  };
}

/**
 * Run a callback-style engine and stream what it reports while it works.
 *
 * `start(push)` begins the work and returns its promise; everything it pushes
 * is yielded as it arrives, and the promise's value is returned at the end.
 */
async function* streamWhile(start) {
  const ch = channel();
  const work = Promise.resolve()
    .then(() => start((item) => ch.push(item)))
    .then(
      (value) => {
        ch.end();
        return value;
      },
      (err) => {
        ch.fail(err);
        return undefined;
      }
    );

  for await (const item of ch) yield item;
  return work;
}

module.exports = { channel, streamWhile };
