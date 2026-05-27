// 深呼吸している場所 — single-screen web app
// 中心: 非線形に呼吸する不安定な形 (JS駆動)
// 周囲: 他者の気配 (orbs) + 沈殿した言葉 (slow drift)
// 説明は ? を押した時だけ立ち上がる

const { useState, useEffect, useRef, useMemo, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "atmosphere": "night",
  "breathSpeed": 8,
  "presence": "thin",
  "instability": 0.6
}/*EDITMODE-END*/;

// ─── seeded sediment words — drift around the breath, occasionally surface ──
const SEED_WORDS = [
  "また、来た。",
  "夜のほうが正直になれる",
  "おかえり",
  "ことばを降ろす",
  "今日は読むだけ",
  "湿度",
  "ぼんやりしていてもいい",
  "夜更けに、輪郭がやわらかい",
  "ここは、何もしない練習",
  "息",
  "誰もいない、わけではない",
];

// ─── breath engine ─────────────────────────────────────────────────────────
// Drives --bx / --by / --bo / --bw on document.documentElement.
// Combines multiple sin waves at incommensurate frequencies + tiny noise so
// the cycle never quite repeats — "少し生っぽい / 一定速度ではない".
function useBreathEngine({ speed, instability }) {
  const stateRef = useRef({ speed, instability });
  useEffect(() => { stateRef.current = { speed, instability }; }, [speed, instability]);

  useEffect(() => {
    let raf;
    let start = performance.now();
    let nx = 0, ny = 0, nw = 0;
    const root = document.documentElement;

    const tick = (now) => {
      const t = (now - start) / 1000;
      const { speed: sp, instability: inst } = stateRef.current;

      const w = (2 * Math.PI) / Math.max(2, sp);
      const b =
        0.62 * Math.sin(t * w)
      + 0.22 * Math.sin(t * w * 0.7 + 0.4)
      + 0.10 * Math.sin(t * w * 2.3 + 1.1);

      const bx =
        0.60 * Math.sin(t * w + 0.18)
      + 0.22 * Math.sin(t * w * 0.73 + 0.6);
      const by =
        0.60 * Math.sin(t * w - 0.18)
      + 0.22 * Math.sin(t * w * 0.81 + 1.3);

      nx += (Math.random() * 2 - 1 - nx) * 0.04;
      ny += (Math.random() * 2 - 1 - ny) * 0.04;
      nw += (Math.random() * 2 - 1 - nw) * 0.02;

      const amp = 0.18;
      const jit = 0.06 * inst;

      const sx = 1 + (bx * amp + nx * jit);
      const sy = 1 + (by * amp + ny * jit);
      const op = 0.5 + b * 0.5;
      const warp = nw * 0.6 * inst;

      root.style.setProperty('--bx', sx.toFixed(4));
      root.style.setProperty('--by', sy.toFixed(4));
      root.style.setProperty('--bo', op.toFixed(4));
      root.style.setProperty('--bw', warp.toFixed(4));

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

// ─── chrome: presence count + dots ────────────────────────────────────────
function PresenceChrome({ count }) {
  const dots = useMemo(() => Array.from({ length: count }, (_, i) => ({
    s: 0.8 + (i * 0.17) % 0.5,
    o: 0.35 + (i * 0.23) % 0.4,
    you: i === count - 1,
  })), [count]);
  // breathe dots in step with body but with offsets
  const elRef = useRef(null);
  useEffect(() => {
    let raf;
    const tick = (now) => {
      const els = elRef.current?.querySelectorAll('.pd');
      if (els) {
        const t = now / 1000;
        els.forEach((el, i) => {
          const phase = t * 0.6 + i * 1.7;
          const s = 0.85 + 0.35 * (0.5 + 0.5 * Math.sin(phase));
          const o = 0.30 + 0.50 * (0.5 + 0.5 * Math.sin(phase + 0.4));
          el.style.setProperty('--s', s.toFixed(3));
          el.style.setProperty('--o', o.toFixed(3));
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);
  return (
    <span ref={elRef}>
      <span className="presence-dots">
        {dots.map((d, i) => (
          <span key={i} className={`pd ${d.you ? 'you' : ''}`} />
        ))}
      </span>
      <span className="label">いま、{count}人が居合わせている</span>
    </span>
  );
}

// ─── breathing form ────────────────────────────────────────────────────────
// Three nested layers, all driven by the same breath state:
//   ring — outer, a clear thin line circle
//   glow — middle, a soft blurred halo
//   core — inner, a small bright light
function BreathForm() {
  return (
    <div className="breath" aria-hidden="true">
      <div className="ring"></div>
      <div className="glow"></div>
      <div className="core"></div>
    </div>
  );
}

// ─── ambient orbs (others, scattered far from center) ─────────────────────
function Orbs({ count }) {
  const orbs = useMemo(() => {
    const rng = (i) => {
      const x = Math.sin(31 + i * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    // distribute around the perimeter, avoiding the center
    return Array.from({ length: count }, (_, i) => {
      const angle = rng(i) * Math.PI * 2;
      const dist = 36 + rng(i + 50) * 14; // % from center
      return {
        x: 50 + Math.cos(angle) * dist,
        y: 50 + Math.sin(angle) * dist * 0.78,
        phase: rng(i + 100) * 6,
        rate: 0.7 + rng(i + 150) * 0.6,
        you: i === count - 1,
      };
    });
  }, [count]);

  const ref = useRef(null);
  useEffect(() => {
    let raf;
    const tick = (now) => {
      const t = now / 1000;
      const els = ref.current?.querySelectorAll('.orb');
      if (els) {
        els.forEach((el, i) => {
          const o = orbs[i];
          const phase = t * 0.5 * o.rate + o.phase;
          const s = 0.7 + 0.7 * (0.5 + 0.5 * Math.sin(phase));
          const op = 0.18 + 0.45 * (0.5 + 0.5 * Math.sin(phase + 0.3));
          el.style.setProperty('--s', s.toFixed(3));
          el.style.setProperty('--o', op.toFixed(3));
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [orbs]);

  return (
    <div className="orbs" ref={ref}>
      {orbs.map((o, i) => (
        <div
          key={i}
          className={`orb ${o.you ? 'you' : ''}`}
          style={{ left: `${o.x}%`, top: `${o.y}%` }}
        />
      ))}
    </div>
  );
}

// ─── drifting sediment — short words surface, drift, fade ─────────────────
function DriftField({ words }) {
  const [drifts, setDrifts] = useState([]);
  const counter = useRef(0);

  // schedule next word
  useEffect(() => {
    let cancelled = false;
    const surface = () => {
      if (cancelled) return;
      const word = words[Math.floor(Math.random() * words.length)];
      if (!word) return;
      const id = ++counter.current;
      // origin: near a random edge, avoiding the very center
      const side = Math.random();
      let x, y, dx, dy;
      if (side < 0.5) {
        // come up from below the form, drift up
        x = 8 + Math.random() * 84;
        y = 60 + Math.random() * 25;
        dx = (Math.random() - 0.5) * 40;
        dy = -120 - Math.random() * 60;
      } else {
        // drift sideways at upper-mid band
        x = Math.random() < 0.5 ? 4 : 70;
        y = 18 + Math.random() * 50;
        dx = (x < 40 ? 1 : -1) * (60 + Math.random() * 50);
        dy = -30 + Math.random() * 20;
      }
      setDrifts((d) => [...d, { id, word, x, y, dx, dy }]);
      // remove after animation
      setTimeout(() => {
        setDrifts((d) => d.filter((it) => it.id !== id));
      }, 6200);
      // next one
      const wait = 2400 + Math.random() * 4500;
      setTimeout(surface, wait);
    };
    const initial = setTimeout(surface, 1500);
    return () => { cancelled = true; clearTimeout(initial); };
  }, [words]);

  return (
    <div className="driftfield" aria-hidden="true">
      {drifts.map((d) => (
        <div
          key={d.id}
          className="driftword"
          style={{
            left: `${d.x}%`,
            top:  `${d.y}%`,
            '--dx': `${d.dx}px`,
            '--dy': `${d.dy}px`,
          }}
        >
          {d.word}
        </div>
      ))}
    </div>
  );
}

// ─── help overlay (revealed by ?) ─────────────────────────────────────────
function HelpOverlay({ open, onClose }) {
  // close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`help-overlay ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <div className="help-eyebrow">about</div>
        <div className="help-title">
          ここでは、何もしなくていい。<br />
          ただ、息が戻るまで、居ていい。
        </div>
        <div className="help-body">
          <p className="lead">
            中心の形は、呼吸している。<br />
            あなたに何かを促すためではなく、ただ、息をしている。
          </p>
          <ul>
            <li>急かされない</li>
            <li>評価されない</li>
            <li>何者かにならなくていい</li>
            <li>沈黙が許される</li>
          </ul>
          <p>
            時おり、ほかの人の置いていった短い言葉が、滲んでは消える。<br />
            画面の隅にある小さな点は、いま居合わせている誰か。<br />
            互いに、見ない。
          </p>
          <p className="help-foot">
            キーボードを叩くと、ひとこと置いていける。<br />
            esc または ? で閉じる。
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── place-a-word (keyboard-revealed) ─────────────────────────────────────
function WordBar({ onPlace }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  // open on first keypress (a-z, ぁ-ん, etc), close on Esc
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); setValue(""); return; }
      if (open) return;
      // ignore modifier-only / nav keys / help shortcut
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?' || e.key === '/') return;
      if (e.key.length !== 1) return;
      // capture this initial keystroke
      setOpen(true);
      setValue(e.key);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      // wait for transition tick, then focus
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  function submit() {
    const v = value.trim();
    if (v.length > 0 && v.length <= 24) {
      onPlace(v);
    }
    setValue("");
    setOpen(false);
  }

  function onKey(e) {
    if (e.key === 'Enter') { submit(); e.preventDefault(); }
    if (e.key === 'Escape') { setValue(""); setOpen(false); }
  }

  return (
    <>
      <div className={`word-bar ${open ? 'open' : ''}`}>
        <input
          ref={inputRef}
          className="word-input"
          type="text"
          maxLength={24}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => { if (!value.trim()) setOpen(false); }}
          placeholder="ひとこと、降ろす"
          spellCheck={false}
        />
        <div className="word-hint">
          enter で置く <span className="esc">· esc で消す</span>
        </div>
      </div>
      <div className="type-hint">— キーボードを叩くと、ひとこと置いていける</div>
    </>
  );
}

// ─── app ───────────────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [words, setWords] = useState(SEED_WORDS);
  const [helpOpen, setHelpOpen] = useState(false);

  // apply atmosphere + speed to root
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-atmos', t.atmosphere);
    el.style.setProperty('--breath-speed-num', String(t.breathSpeed));
  }, [t.atmosphere, t.breathSpeed]);

  // verbose class toggles small explanatory labels (chrome titles, type hint)
  useEffect(() => {
    document.body.classList.toggle('verbose', helpOpen);
  }, [helpOpen]);

  useBreathEngine({ speed: t.breathSpeed, instability: t.instability });

  // ? shortcut to toggle help
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        // only when not typing inside an input
        if (document.activeElement?.tagName === 'INPUT') return;
        setHelpOpen((v) => !v);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // presence chrome (rendered outside react root, via portal-style mount)
  useEffect(() => {
    const host = document.getElementById('presence-chrome');
    if (!host) return;
    const count = t.presence === 'thin' ? 4 : t.presence === 'soft' ? 7 : 11;
    const root = ReactDOM.createRoot(host);
    root.render(<PresenceChrome count={count} />);
    return () => root.unmount();
  }, [t.presence]);

  const orbCount = t.presence === 'thin' ? 5 : t.presence === 'soft' ? 9 : 14;

  function handlePlace(word) {
    setWords((prev) => [word, ...prev].slice(0, 40));
  }

  return (
    <>
      <Orbs count={orbCount} />
      <DriftField words={words} />

      <div className="stage" data-screen-label="深呼吸している場所">
        <BreathForm />
      </div>

      <WordBar onPlace={handlePlace} />

      <button
        className="help-toggle"
        aria-label={helpOpen ? '説明を閉じる' : '説明を表示'}
        onClick={() => setHelpOpen((v) => !v)}
      >
        {helpOpen ? '×' : '?'}
      </button>

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="空気" />
        <TweakRadio
          label="アトモスフィア"
          value={t.atmosphere}
          options={['night', 'dusk', 'dawn']}
          onChange={(v) => setTweak('atmosphere', v)}
        />
        <TweakSlider
          label="呼吸の周期"
          value={t.breathSpeed}
          min={4} max={14} step={0.5} unit="s"
          onChange={(v) => setTweak('breathSpeed', v)}
        />
        <TweakSlider
          label="揺らぎ"
          value={t.instability}
          min={0} max={1.4} step={0.05}
          onChange={(v) => setTweak('instability', v)}
        />
        <TweakSection label="気配" />
        <TweakRadio
          label="他者の濃さ"
          value={t.presence}
          options={['thin', 'soft', 'denser']}
          onChange={(v) => setTweak('presence', v)}
        />
      </TweaksPanel>
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
