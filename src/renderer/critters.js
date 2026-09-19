'use strict';

/**
 * The company you keep while a scan runs.
 *
 * A scan of a large folder is a wait with nothing to watch, and a 3px line
 * that sweeps says only "something is happening". So a few small animals walk
 * the line instead: they patrol it, stop and sit, and now and then one takes
 * off after another.
 *
 * ## Why none of it runs in JavaScript
 *
 * A scan is the busiest the app ever is -- a worker walking a filesystem,
 * thousands of DOM rows arriving, and a main process hashing files. An
 * animation loop on a timer would be competing with exactly that, and the
 * thing it would slow down is the work the user is waiting for.
 *
 * So every frame here is drawn by the compositor from CSS keyframes. This file
 * only ever *decides*: which animal, where it starts, where it is going, how
 * fast, and what it does next. Those land as custom properties on the element
 * and the browser takes it from there. A re-roll is one timer per animal every
 * eight seconds or so, and it sets six strings.
 *
 * ## Why the drawings are here rather than in a file
 *
 * The content-security policy allows no remote image and no remote script, and
 * the repo deliberately holds no binary assets -- the tray icon and the section
 * icons are both drawn in code for the same reason. These are paths, they
 * inherit the theme's colours, and they cost nothing to load.
 */
(() => {
  const STORAGE_KEY = 'cleandrive.critters';

  /** Every choice the setting offers, in the order it offers them. */
  const SPECIES = ['cat', 'dog', 'bird', 'mouse'];
  const CHOICES = [...SPECIES, 'mixed', 'off'];
  const DEFAULT_CHOICE = 'cat';

  /* ---------------------------------------------------------------- drawing */

  /*
   * One box for every animal: 34 wide, 22 tall, standing on y = 20.
   *
   * Sharing the box is what lets a mouse and a dog walk the same line without
   * either of them floating above it or sinking into it, and it is why the
   * legs can be animated by the same rule for all four.
   */
  const PARTS = {
    cat: `
      <path class="critter-tail" d="M6.5 11.5c-3.6.4-4.6-3.2-1.8-4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/>
      <g class="critter-legs critter-legs-back">
        <rect x="8.4" y="14.6" width="2.2" height="5.4" rx="1.1"/>
        <rect x="12.4" y="14.6" width="2.2" height="5.4" rx="1.1"/>
      </g>
      <g class="critter-legs critter-legs-front">
        <rect x="18.4" y="14.6" width="2.2" height="5.4" rx="1.1"/>
        <rect x="22" y="14.6" width="2.2" height="5.4" rx="1.1"/>
      </g>
      <g class="critter-body">
        <rect x="6" y="8.4" width="19" height="8" rx="4"/>
        <circle cx="25.6" cy="9.4" r="4.6"/>
        <path d="M21.7 5.6l.2-3.4 2.9 2.1z"/>
        <path d="M27.2 4.3l2.4-2.5.9 3.3z"/>
        <circle class="critter-eye" cx="27.4" cy="9" r=".9"/>
      </g>`,

    dog: `
      <path class="critter-tail" d="M6.4 10.6c-2.8-1.4-2.4-4.2.4-4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      <g class="critter-legs critter-legs-back">
        <rect x="8.2" y="14.4" width="2.6" height="5.6" rx="1.3"/>
        <rect x="12.4" y="14.4" width="2.6" height="5.6" rx="1.3"/>
      </g>
      <g class="critter-legs critter-legs-front">
        <rect x="18.6" y="14.4" width="2.6" height="5.6" rx="1.3"/>
        <rect x="22.4" y="14.4" width="2.6" height="5.6" rx="1.3"/>
      </g>
      <g class="critter-body">
        <rect x="6" y="8" width="20" height="8.6" rx="4.2"/>
        <circle cx="26.4" cy="9.6" r="4.4"/>
        <rect x="28.4" y="9.8" width="5" height="3.6" rx="1.6"/>
        <path class="critter-ear" d="M24.4 5.6c2.6-.6 3.4 1.4 2.8 3.4-.6 1.8-2.6 1.6-3.2 0z"/>
        <circle class="critter-eye" cx="27.6" cy="8.6" r=".9"/>
      </g>`,

    bird: `
      <g class="critter-legs critter-legs-back">
        <rect x="14.6" y="15.6" width="1.6" height="4.4" rx=".8"/>
      </g>
      <g class="critter-legs critter-legs-front">
        <rect x="18.6" y="15.6" width="1.6" height="4.4" rx=".8"/>
      </g>
      <g class="critter-body">
        <path class="critter-tail" d="M9.4 10.2l-5.4-2.4 1 5z"/>
        <ellipse cx="18" cy="11.4" rx="7.4" ry="5"/>
        <circle cx="25" cy="7.2" r="4"/>
        <path d="M28.6 6.6l4.6 1.4-4.6 1.6z"/>
        <path class="critter-wing" d="M13.4 10.4c3.8-2 7.4-1.4 8.6 1.6-2.8 2.4-6.6 2-8.6-1.6z" opacity=".55"/>
        <circle class="critter-eye" cx="26.4" cy="6.6" r=".9"/>
      </g>`,

    mouse: `
      <path class="critter-tail" d="M7.4 14.6c-4.4.6-5.4-3.6-1.6-5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>
      <g class="critter-legs critter-legs-back">
        <rect x="11" y="17" width="1.8" height="3" rx=".9"/>
      </g>
      <g class="critter-legs critter-legs-front">
        <rect x="19.4" y="17" width="1.8" height="3" rx=".9"/>
      </g>
      <g class="critter-body">
        <circle class="critter-ear" cx="21.6" cy="10.6" r="3.2"/>
        <circle cx="25.4" cy="11" r="2.8"/>
        <ellipse cx="16" cy="15" rx="8.2" ry="5"/>
        <circle cx="24" cy="14.6" r="4.2"/>
        <path d="M27.8 14.2l3.4 1-3.4 1z"/>
        <circle class="critter-eye" cx="25.6" cy="13.6" r=".8"/>
      </g>`,
  };

  function draw(species) {
    return (
      '<span class="critter-flip">' +
      `<svg class="critter-art" viewBox="0 0 34 22" fill="currentColor" aria-hidden="true">${PARTS[species]}</svg>` +
      '</span>'
    );
  }

  /* ------------------------------------------------------------ the setting */

  function chosen() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (CHOICES.includes(saved)) return saved;
    } catch {
      /* No storage, or nothing in it. */
    }
    return DEFAULT_CHOICE;
  }

  function remember(choice) {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* The lane still works for this window. */
    }
  }

  /* ----------------------------------------------------------- the decisions */

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /**
   * What one animal does next.
   *
   * Everything below is expressed as custom properties, because the browser is
   * the one that has to act on it. `--from` and `--to` are where it walks
   * between, `--face` which way it is pointing when it sets off, `--dur` how
   * long the crossing takes, and `--step` how fast its legs go -- a trot is the
   * same walk with less time between paces.
   */
  function roll(critter, lane, behaviour) {
    const span = Math.max(40, lane - 40);
    const width = critter.offsetWidth || 34;
    const far = Math.max(0, lane - width);

    let from;
    let to;
    let seconds;
    let step;

    switch (behaviour) {
      case 'rest': {
        from = rand(0, far);
        to = from;
        seconds = rand(4, 9);
        step = 0; // nothing walking anywhere
        break;
      }
      case 'wander': {
        from = rand(0, far - 60);
        to = from + rand(50, Math.min(200, span));
        seconds = rand(5, 8);
        step = rand(0.42, 0.52);
        break;
      }
      case 'dash': {
        // The one that is being chased, or doing the chasing: same walk, half
        // the time, and it crosses most of the line.
        from = rand(0, far * 0.35);
        to = rand(far * 0.65, far);
        seconds = rand(2.2, 3.2);
        step = rand(0.16, 0.2);
        break;
      }
      case 'patrol':
      default: {
        from = rand(0, far * 0.4);
        to = rand(far * 0.6, far);
        seconds = rand(6, 10);
        step = rand(0.26, 0.34);
        break;
      }
    }

    critter.style.setProperty('--from', `${from.toFixed(1)}px`);
    critter.style.setProperty('--to', `${to.toFixed(1)}px`);
    critter.style.setProperty('--dur', `${seconds.toFixed(2)}s`);
    critter.style.setProperty('--turn', `${(seconds * 2).toFixed(2)}s`);
    critter.style.setProperty('--step', step ? `${step.toFixed(2)}s` : '0s');
    critter.style.setProperty('--face', to >= from ? '1' : '-1');
    critter.dataset.behaviour = behaviour;

    return seconds;
  }

  /**
   * A chase: two animals, one path, one of them a moment behind the other.
   *
   * The delay is what makes it read as a chase rather than as two animals
   * happening to run the same way -- the one in front is always the same
   * distance ahead, and they turn at the same moment.
   */
  function chase(front, back, lane) {
    const seconds = roll(front, lane, 'dash');
    for (const key of ['--from', '--to', '--dur', '--turn', '--step', '--face']) {
      back.style.setProperty(key, front.style.getPropertyValue(key));
    }
    back.dataset.behaviour = 'dash';
    back.style.setProperty('--lag', `-${(seconds * 0.12).toFixed(2)}s`);
    front.style.setProperty('--lag', '0s');
    return seconds;
  }

  /* ------------------------------------------------------------- the lanes */

  const lanes = new Map();

  function populate(lane) {
    // Whatever was here has its own chain of timers, and they would go on
    // rolling behaviours for elements that are no longer in the document.
    const previous = lanes.get(lane);
    if (previous) {
      for (const timer of previous.timers) clearTimeout(timer);
      lanes.delete(lane);
    }

    const width = lane.clientWidth;
    if (!width) return;

    const choice = chosen();
    if (choice === 'off') {
      lane.replaceChildren();
      return;
    }

    // Enough to look like company, few enough to stay out of the way.
    const count = Math.min(4, Math.max(2, Math.round(width / 320) + 1));
    const species = choice === 'mixed' ? null : choice;

    lane.replaceChildren();
    const made = [];

    for (let i = 0; i < count; i++) {
      const kind = species || pick(SPECIES);
      const critter = document.createElement('span');
      critter.className = `critter critter-${kind}`;
      critter.innerHTML = draw(kind);
      lane.appendChild(critter);
      made.push(critter);
    }

    const state = { lane, critters: made, timers: [] };
    lanes.set(lane, state);
    schedule(state);
  }

  /** Give every animal something to do, then arrange to ask again later. */
  function schedule(state) {
    for (const timer of state.timers) clearTimeout(timer);
    state.timers = [];

    const width = state.lane.clientWidth;
    const idle = [...state.critters];

    // A chase needs two, and should not happen every time, or the line turns
    // into a racetrack and stops being somewhere anything lives.
    if (idle.length >= 2 && Math.random() < 0.45) {
      const front = idle.splice(Math.floor(Math.random() * idle.length), 1)[0];
      const back = idle.splice(Math.floor(Math.random() * idle.length), 1)[0];
      const seconds = chase(front, back, width);
      state.timers.push(setTimeout(() => schedule(state), (seconds * 2 + rand(1, 3)) * 1000));
    }

    for (const critter of idle) {
      critter.style.setProperty('--lag', `-${rand(0, 4).toFixed(2)}s`);
      roll(critter, width, pick(['patrol', 'patrol', 'wander', 'rest']));
    }

    if (state.timers.length === 0) {
      state.timers.push(setTimeout(() => schedule(state), rand(7, 13) * 1000));
    }
  }

  function mount() {
    for (const lane of document.querySelectorAll('.critters')) {
      populate(lane);
    }
  }

  /* The lane is inside a hidden container until a scan starts, so it has no
     width to measure until then. Watching for the size is simpler than
     watching for the scan, and it re-populates a window that was resized. */
  let pending = null;
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          clearTimeout(pending);
          pending = setTimeout(mount, 180);
        })
      : null;

  function observe() {
    if (!observer) return;
    for (const lane of document.querySelectorAll('.critters')) observer.observe(lane);
  }

  /* --------------------------------------------------------------- the API */

  window.CleanDriveCritters = {
    choices: CHOICES,
    chosen,
    set(choice) {
      if (!CHOICES.includes(choice)) return;
      remember(choice);
      mount();
    },
  };

  /** The control in Settings, which is the only way to change any of this. */
  function wireSetting() {
    const select = document.getElementById('critter-choice');
    if (!select) return;
    select.value = chosen();
    select.addEventListener('change', () => {
      window.CleanDriveCritters.set(select.value);
    });
  }

  function start() {
    wireSetting();
    observe();
    mount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
