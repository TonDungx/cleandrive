'use strict';

/**
 * Making a smaller copy of a video (E3), from the window's side.
 *
 * ## Why the pixels are here and not in the main process
 *
 * `VideoDecoder` and `VideoEncoder` are web APIs; the main process does not
 * have them. Measured while deciding this: they are also absent from a `data:`
 * URL and present from `file://`, which is the origin `main.js` already loads
 * this window from -- so there is no hidden window and no second origin, just
 * the window that was already open.
 *
 * That is the opposite of `thumbs.js`, which is main-process-only because
 * `nativeImage` is. Between the two of them the app can see inside a video from
 * both sides, and neither one could do the other's job.
 *
 * ## The shape of a run
 *
 * The main process owns the file: it finds the samples and writes the result.
 * This file owns the pixels. Samples come over in batches, go through a
 * decoder, optionally through a canvas to be made smaller, then through an
 * encoder, and the encoded chunks go back. Nothing ever hands a `VideoFrame`
 * across the boundary -- a frame is a handle to memory the window owns, and it
 * does not survive a structured clone.
 *
 * ## What was measured before any of this was written
 *
 * On this machine, at 1080p: decode **660 frames a second** on a real file from
 * the library, encode **109** with hardware H.264 and **84** with hardware
 * HEVC. So a run is encoder-bound at roughly three and a half times real time,
 * and the roadmap's "encode the first ten seconds to estimate" costs about
 * three seconds rather than ten.
 *
 * `MediaRecorder` was measured too and rejected: it does emit `video/mp4`, but
 * it samples a track at the rate a camera would fill it, and three hundred
 * frames pushed into one in 74 ms produced **zero bytes**. That is why
 * `lib/media/mp4/mux.js` exists.
 */

(() => {
  const dialog = $('shrink');
  if (!dialog) return;

  const list = $('shrink-list');
  const levels = $('shrink-levels');
  const estimate = $('shrink-estimate');
  const progress = $('shrink-progress');
  const progressBar = $('shrink-progress-bar');
  const refusals = $('shrink-refusals');
  const go = $('shrink-go');
  const close = $('shrink-close');
  const compare = $('shrink-compare');

  /** Two seconds between key frames, so the copy can still be scrubbed. */
  const KEYFRAME_SECONDS = 2;

  /** How many samples cross the boundary at once. See `encode.js` in main. */
  const BATCH = 48;

  const state = {
    /** What the dialog is working on: one row per picked video. */
    rows: [],
    /** Videos that cannot be done, and why. */
    refused: [],
    level: 'balanced',
    phase: 'idle',
    token: null,
    /**
     * What the progress line says, as a function rather than a sentence.
     *
     * `translateDom` rewrites only what is in the markup, so a sentence written
     * here would be handed to a Vietnamese reader in English. Keeping the
     * *function* lets a language change re-say it with the numbers formatted to
     * match — the pattern `media.js` settled on for its status line. A
     * screenshot caught the other half of this: the line was also never cleared
     * when the run ended, so a finished dialog sat there claiming to still be
     * encoding frame 180 of 180.
     */
    progressLine: null,
    /** What was made, for the Compare button and the language change. */
    made: [],
    returnFocus: null,
  };

  /* --------------------------------------------------------------- codecs -- */

  /**
   * Which encoder to ask for, in order of preference.
   *
   * H.264 only, and that is a measured decision rather than a conservative
   * one. HEVC encodes here -- hardware only, 84 fps at 1080p -- and it would
   * save perhaps a further fifth. But the copy has to be openable, and the
   * lesson this project already paid for is in E5: Zalo's re-encoded JPEG XL
   * copies are *smaller* and nothing on this machine will draw them, so the
   * smaller copy was the useless one. A copy of a video that Explorer will not
   * thumbnail and the viewer will not play is the same mistake in a new format.
   *
   * `avc1.42E01E` is checked first and is deliberately not assumed: measured
   * on this machine, baseline is **not supported** by this encoder while main
   * and high both are, in hardware and in software.
   */
  const ENCODER_CANDIDATES = [
    'avc1.640028',
    'avc1.4D401F',
    'avc1.42E01E',
  ];

  async function pickEncoder(width, height, bitrate, framerate) {
    for (const codec of ENCODER_CANDIDATES) {
      for (const accel of ['prefer-hardware', 'no-preference']) {
        const config = {
          codec,
          width,
          height,
          bitrate,
          framerate,
          hardwareAcceleration: accel,
          avc: { format: 'avc' },
          latencyMode: 'quality',
        };
        try {
          const supported = await VideoEncoder.isConfigSupported(config);
          if (supported && supported.supported) return config;
        } catch {
          // An implementation that throws on a configuration it dislikes is
          // saying no in a louder voice. Try the next one.
        }
      }
    }
    return null;
  }

  /* ------------------------------------------------------------- pipeline -- */

  /**
   * Decode a run of samples and encode them again.
   *
   * @param {object} job     what `video:open` handed back
   * @param {object} options {limit, collect, onProgress, token}
   * @returns {Promise<object>} bytes written, frames seen, and the encoder's
   *                            own configuration record for the muxer
   */
  async function transcode(job, options) {
    const { settings, source } = job;
    const limit = options.limit || source.sampleCount;
    const token = options.token || {};

    const encoderConfig = await pickEncoder(
      settings.width,
      settings.height,
      settings.bitrate,
      Math.round(settings.framerate) || 30
    );
    if (!encoderConfig) throw new Error(t('shrink.noEncoder', 'This computer has no video encoder this app can use'));

    let codecConfig = null;
    let bytes = 0;
    let frames = 0;
    let failure = null;
    const pending = [];

    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (metadata && metadata.decoderConfig && metadata.decoderConfig.description && !codecConfig) {
          // The encoder's own `avcC`, which the muxer cannot write without and
          // which arrives attached to the first chunk rather than at configure
          // time. Missing it produces a file whose frames are all present and
          // which no decoder can start.
          codecConfig = new Uint8Array(metadata.decoderConfig.description);
        }
        bytes += chunk.byteLength;
        if (options.collect) {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          pending.push({
            data,
            timestamp: chunk.timestamp,
            duration: chunk.duration || 0,
            key: chunk.type === 'key',
          });
        }
      },
      error: (err) => { failure = failure || err; },
    });
    encoder.configure(encoderConfig);

    const keyEvery = Math.max(1, Math.round((Number(settings.framerate) || 30) * KEYFRAME_SECONDS));
    const scaling = settings.scaled;
    const canvas = scaling ? new OffscreenCanvas(settings.width, settings.height) : null;
    const ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;

    let seen = 0;
    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (failure) return;
          let send = frame;
          if (scaling) {
            ctx.drawImage(frame, 0, 0, settings.width, settings.height);
            send = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration || 0 });
          }
          encoder.encode(send, { keyFrame: seen % keyEvery === 0 });
          if (send !== frame) send.close();
          seen += 1;
          frames += 1;
        } catch (err) {
          failure = failure || err;
        } finally {
          frame.close();
        }
      },
      error: (err) => { failure = failure || err; },
    });
    decoder.configure({
      codec: source.codec,
      description: source.description ? new Uint8Array(source.description) : undefined,
      codedWidth: source.width,
      codedHeight: source.height,
      // Hardware where there is some, but never *only* hardware: a decoder that
      // refuses is a file that cannot be copied, and the software path on this
      // machine is fast enough that the difference is not worth a refusal.
      hardwareAcceleration: 'no-preference',
    });

    const flushPending = async () => {
      if (!options.collect || !pending.length) return;
      const batch = pending.splice(0, pending.length);
      unwrap(await api.videoWrite(job.jobId, batch), t('shrink.label', 'Make a smaller copy'));
    };

    try {
      for (let from = 0; from < limit; from += BATCH) {
        if (token.cancelled || failure) break;
        const count = Math.min(BATCH, limit - from);
        const samples = unwrap(
          await api.videoRead(job.jobId, from, count),
          t('shrink.label', 'Make a smaller copy')
        );
        if (!samples || !samples.length) break;

        for (const sample of samples) {
          if (token.cancelled || failure) break;
          decoder.decode(new EncodedVideoChunk({
            type: sample.key ? 'key' : 'delta',
            timestamp: sample.timestamp,
            duration: sample.duration,
            data: new Uint8Array(sample.data),
          }));
          // Both queues, because either one can be the slow half: the decoder
          // runs at 660 frames a second here and the encoder at 109, so the
          // encoder is normally what this waits for.
          while (!token.cancelled && !failure
                 && (decoder.decodeQueueSize > 24 || encoder.encodeQueueSize > 12)) {
            await new Promise((resolve) => setTimeout(resolve, 2));
          }
        }
        await flushPending();
        if (options.onProgress) options.onProgress(Math.min(limit, from + count), limit);
      }

      if (!token.cancelled && !failure) {
        await decoder.flush();
        await encoder.flush();
        await flushPending();
      }
    } finally {
      try { decoder.close(); } catch { /* already closed by its own error */ }
      try { encoder.close(); } catch { /* same */ }
    }

    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
    return { bytes, frames, codecConfig, fourcc: 'avc1', width: settings.width, height: settings.height };
  }

  /* ------------------------------------------------------------ the rows -- */

  function levelLabel(name) {
    return name === 'smallest'
      ? t('shrink.level.smallest', 'Smallest')
      : t('shrink.level.balanced', 'Smaller, keeping the quality');
  }

  function refusalText(row) {
    switch (row.reason) {
      case 'dehydrated':
        return t('shrink.refused.dehydrated', 'is only in the cloud — reading it would download it');
      case 'codec':
        return t('shrink.refused.codec', 'is {codec}, which this app cannot open', { codec: row.detail || '?' });
      case 'notBmff':
        return t('shrink.refused.notBmff', 'is not an MP4 or MOV');
      case 'noVideoTrack':
        return t('shrink.refused.noVideo', 'has no video in it');
      case 'fragmented':
        return t('shrink.refused.fragmented', 'is split into fragments, which this app cannot take apart yet');
      case 'noCodecConfig':
        return t('shrink.refused.noConfig', 'does not carry the settings a decoder needs');
      case 'noSamples':
        return t('shrink.refused.noSamples', 'has no frames');
      default:
        return t('shrink.refused.unreadable', 'could not be read');
    }
  }

  function drawList() {
    list.replaceChildren();
    for (const row of state.rows) {
      const line = document.createElement('div');
      line.className = 'shrink-row';

      const name = document.createElement('span');
      name.className = 'shrink-name';
      name.textContent = row.name;
      name.title = row.path;

      const facts = document.createElement('span');
      facts.className = 'shrink-facts';
      const parts = [formatBytes(row.size)];
      if (row.settings) {
        parts.push(`${formatCount(row.settings.width)}×${formatCount(row.settings.height)}`);
        if (row.settings.sourceBitrate) {
          parts.push(t('shrink.kbps', '{n} kbps', { n: formatCount(Math.round(row.settings.sourceBitrate / 1000)) }));
        }
      }
      facts.textContent = parts.join(' · ');

      const verdict = document.createElement('span');
      verdict.className = 'shrink-verdict';
      if (row.done) {
        verdict.textContent = t('shrink.rowDone', 'copy is {size}', { size: formatBytes(row.done.size) });
        verdict.classList.add('is-done');
      } else if (row.estimate) {
        verdict.textContent = t('shrink.rowLikely', 'likely about {size}', { size: formatBytes(row.estimate) });
      } else if (row.failed) {
        verdict.textContent = row.failed;
        verdict.classList.add('is-failed');
      }

      line.append(name, facts, verdict);
      list.appendChild(line);
    }

    refusals.hidden = state.refused.length === 0;
    if (state.refused.length) {
      refusals.replaceChildren();
      const lead = document.createElement('span');
      lead.textContent = t('shrink.refusedLead', '{n} left out:', { n: formatCount(state.refused.length) });
      refusals.appendChild(lead);
      for (const row of state.refused.slice(0, 6)) {
        const line = document.createElement('div');
        line.textContent = `${row.name} — ${refusalText(row)}`;
        refusals.appendChild(line);
      }
      if (state.refused.length > 6) {
        const more = document.createElement('div');
        more.textContent = t('shrink.refusedMore', '…and {n} more', {
          n: formatCount(state.refused.length - 6),
        });
        refusals.appendChild(more);
      }
    }
  }

  function drawLevels() {
    levels.replaceChildren();
    for (const name of ['balanced', 'smallest']) {
      const id = `shrink-level-${name}`;
      const label = document.createElement('label');
      label.className = 'shrink-level';
      label.htmlFor = id;

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'shrink-level';
      radio.id = id;
      radio.value = name;
      radio.checked = state.level === name;
      radio.disabled = state.phase === 'working';
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        state.level = name;
        void estimateAll();
      });

      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = levelLabel(name);
      const note = document.createElement('small');
      note.textContent = name === 'smallest'
        ? t('shrink.level.smallestNote', 'Also shrinks anything wider than 1280 pixels.')
        : t('shrink.level.balancedNote', 'Keeps the picture the same size.');
      text.append(title, document.createElement('br'), note);

      label.append(radio, text);
      levels.appendChild(label);
    }
  }

  /**
   * The estimate, and the word attached to it.
   *
   * The roadmap asks for a confidence of `likely`, and that word is doing real
   * work: the number comes from encoding the opening of the file and
   * multiplying, so it is an honest measurement of a sample rather than a
   * prediction of the whole. A recording whose second half is busier than its
   * first will beat it. Saying "likely" is the difference between a number
   * that was measured and a number that was promised.
   */
  function drawEstimate() {
    const done = state.rows.filter((r) => r.estimate || r.done);
    if (!done.length) {
      estimate.textContent = state.phase === 'estimating'
        ? t('shrink.estimating', 'Encoding the first {n} seconds of each to see how far it goes…', { n: 10 })
        : '';
      return;
    }
    const before = state.rows.reduce((n, r) => n + r.size, 0);
    const after = state.rows.reduce((n, r) => n + (r.done ? r.done.size : (r.estimate || r.size)), 0);
    const saved = before - after;

    estimate.replaceChildren();
    const line = document.createElement('strong');
    line.textContent = state.phase === 'done'
      ? t('shrink.madeTotal', '{n} copies · {before} became {after}', {
          n: formatCount(state.made.length), before: formatBytes(before), after: formatBytes(after),
        })
      : t('shrink.likelyTotal', 'Likely about {after} in total, down from {before}', {
          before: formatBytes(before), after: formatBytes(after),
        });
    estimate.appendChild(line);

    const note = document.createElement('div');
    note.className = 'card-note';
    if (saved <= 0) {
      note.textContent = t(
        'shrink.noGain',
        'These are already small for what they hold. A copy would not be worth the space it takes.'
      );
    } else if (state.phase === 'done') {
      note.textContent = t(
        'shrink.doneNote',
        'The copies are beside the originals. Nothing has been deleted — the originals are exactly where they were, and you can put them in the Recycle Bin yourself once you have looked.'
      );
    } else {
      note.textContent = t(
        'shrink.likelyNote',
        'Measured by encoding the opening of each file, not predicted. A busier second half will come out larger. Nothing is deleted: the copy goes beside the original.'
      );
    }
    estimate.appendChild(note);
  }

  function drawButtons() {
    const workable = state.rows.length > 0;
    go.hidden = state.phase === 'done';
    go.disabled = !workable || state.phase === 'estimating' || state.phase === 'working';
    go.textContent = state.phase === 'working'
      ? t('app.stop', 'Stop')
      : t('shrink.go', 'Make the copies');
    if (state.phase === 'working') go.disabled = false;
    compare.hidden = state.made.length === 0;
    close.textContent = state.phase === 'done' ? t('app.done', 'Done') : t('app.cancel', 'Cancel');
  }

  function drawProgress() {
    setText($('shrink-progress-text'), state.progressLine ? state.progressLine() : '');
  }

  function draw() {
    drawList();
    drawLevels();
    drawEstimate();
    drawProgress();
    drawButtons();
  }

  /* ----------------------------------------------------------- estimating -- */

  async function estimateAll() {
    if (state.phase === 'working') return;
    state.phase = 'estimating';
    for (const row of state.rows) {
      row.estimate = null;
      row.failed = null;
    }
    draw();

    const token = { cancelled: false };
    state.token = token;

    for (const row of state.rows) {
      if (token.cancelled) break;
      try {
        const job = unwrap(
          await api.videoOpen(row.path, state.level),
          t('shrink.label', 'Make a smaller copy')
        );
        row.settings = job.settings;
        row.jobId = job.jobId;

        const trial = await transcode(job, { limit: job.trial.sampleCount, token });
        // The trial covered a known slice of the file; the rest is assumed to
        // cost the same per second. Audio is added back at its real size,
        // because it is copied rather than re-encoded and so is known exactly.
        const share = job.trial.seconds > 0 ? job.source.durationSec / job.trial.seconds : 1;
        row.estimate = Math.round(trial.bytes * share) + (job.source.audioBytes || 0);
        await api.videoClose(job.jobId);
      } catch (err) {
        row.failed = err && err.message ? err.message : t('shrink.failed', 'could not be encoded');
        if (row.jobId) await api.videoClose(row.jobId).catch(() => {});
      }
      if (!token.cancelled) draw();
    }

    if (state.token === token) state.token = null;
    if (!token.cancelled) {
      state.phase = 'ready';
      draw();
    }
  }

  /* -------------------------------------------------------------- running -- */

  async function run() {
    if (state.phase === 'working') {
      if (state.token) state.token.cancelled = true;
      return;
    }
    state.phase = 'working';
    state.made = [];
    state.progressLine = null;
    progress.hidden = false;
    draw();

    const token = { cancelled: false };
    state.token = token;

    let index = 0;
    for (const row of state.rows) {
      index += 1;
      if (token.cancelled) break;
      row.failed = null;
      try {
        const job = unwrap(
          await api.videoOpen(row.path, state.level),
          t('shrink.label', 'Make a smaller copy')
        );
        row.settings = job.settings;
        row.jobId = job.jobId;

        const made = await transcode(job, {
          limit: job.source.sampleCount,
          collect: true,
          token,
          onProgress: (done, total) => {
            const whole = ((index - 1) + done / Math.max(1, total)) / state.rows.length;
            progressBar.style.width = `${Math.round(whole * 100)}%`;
            progressBar.parentElement.setAttribute('aria-valuenow', String(Math.round(whole * 100)));
            state.progressLine = () => t('shrink.working', 'Encoding {name} — {done} of {total} frames', {
              name: row.name, done: formatCount(done), total: formatCount(total),
            });
            drawProgress();
          },
        });

        if (token.cancelled) {
          await api.videoClose(job.jobId).catch(() => {});
          break;
        }

        const saved = unwrap(
          await api.videoSave(job.jobId, {
            codecConfig: made.codecConfig ? Array.from(made.codecConfig) : null,
            fourcc: made.fourcc,
            width: made.width,
            height: made.height,
            framerate: job.settings.framerate,
          }),
          t('shrink.label', 'Make a smaller copy')
        );
        row.done = saved;
        state.made.push({ source: row.path, copy: saved.path });
      } catch (err) {
        row.failed = err && err.message ? err.message : t('shrink.failed', 'could not be encoded');
        if (row.jobId) await api.videoClose(row.jobId).catch(() => {});
      }
      draw();
    }

    if (state.token === token) state.token = null;
    progress.hidden = true;
    // The run is over, so the line that described it must go. Leaving it is how
    // a finished dialog ends up insisting it is still on frame 180 of 180.
    state.progressLine = null;
    state.phase = 'done';
    draw();

    if (state.made.length) {
      // Said, not shown. A toast raised here lands *behind* the modal backdrop
      // — a screenshot caught it half-hidden under the dialog's own edge — and
      // it would only repeat the line the dialog is already showing in full.
      // What a toast would still have been good for is telling somebody who
      // cannot see the dialog, and `announce` does that part properly.
      announce(t('shrink.toast', '{n} smaller copies made. The originals are untouched.', {
        n: formatCount(state.made.length),
      }));
      // The new files are real files in folders the library covers, so the
      // screen that listed the originals should list these too.
      if (typeof media !== 'undefined' && typeof media.refreshAfterEncode === 'function') {
        media.refreshAfterEncode(state.made.map((m) => m.copy));
      }
    }
  }

  /* ----------------------------------------------------------------- open -- */

  async function openFor(paths) {
    state.rows = [];
    state.refused = [];
    state.made = [];
    state.phase = 'estimating';
    state.returnFocus = document.activeElement;
    progress.hidden = true;
    state.progressLine = null;

    const plan = unwrap(await api.videoPlan(paths), t('shrink.label', 'Make a smaller copy'));
    for (const row of plan || []) {
      if (row.ok) state.rows.push({ ...row, estimate: null, done: null, failed: null });
      else state.refused.push(row);
    }

    draw();
    if (!dialog.open) dialog.showModal();
    close.focus();

    if (state.rows.length) await estimateAll();
    else {
      state.phase = 'ready';
      draw();
    }
  }

  function shut() {
    if (state.token) state.token.cancelled = true;
    for (const row of state.rows) {
      if (row.jobId) api.videoClose(row.jobId).catch(() => {});
    }
    if (dialog.open) dialog.close();
    if (state.returnFocus && typeof state.returnFocus.focus === 'function') state.returnFocus.focus();
    state.returnFocus = null;
  }

  go.addEventListener('click', () => { void run(); });
  close.addEventListener('click', shut);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); shut(); });

  /**
   * Look at the original and the copy side by side, which is step three of the
   * roadmap's behaviour and the whole point of not deleting anything: the
   * person decides after seeing both, not before.
   */
  compare.addEventListener('click', () => {
    if (!state.made.length) return;
    const pair = state.made[0];
    const files = [
      { path: pair.source, name: baseName(pair.source), kind: 'video' },
      { path: pair.copy, name: baseName(pair.copy), kind: 'video' },
    ];
    shut();
    if (window.PhotoCompare) window.PhotoCompare.open(files, { groups: [], index: -1 });
  });

  const baseName = (p) => String(p).split(/[\\/]/).pop();

  // Everything above is built by script, so none of it is reachable by
  // `translateDom` and all of it has to be redrawn by hand. Three features in
  // this project have now been caught by the other half of that rule, so no
  // element this file writes into carries `data-i18n`.
  onLanguageChange(() => {
    if (dialog.open) draw();
  });

  window.VideoShrink = { open: openFor };
})();
