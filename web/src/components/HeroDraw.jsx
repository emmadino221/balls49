import React, { useEffect, useRef } from 'react';

// The home hero's looping "draw": balls drift in the background, six of them are picked,
// roll into a row, glow, then fall away. Drawn on two canvases (behind and in front of the
// hero content). Purely decorative: the numbers are random, not draw results.

const PALETTE = {
  red: ['#ff9a8f', '#d94a43', '#7d1f1b'],
  blue: ['#8cc2ff', '#2f7de1', '#123c7c'],
  green: ['#86e6ae', '#25a565', '#0d5733'],
  yellow: ['#ffe89a', '#e9b93a', '#8e6510'],
};
const colorOf = n => n === 49 ? 'yellow' : n % 3 === 1 ? 'red' : n % 3 === 2 ? 'blue' : 'green';
const CYCLE = 11.5; // seconds
const LAUNCH_AT = 0.6;
const LAUNCH_GAP = 0.42;
const FLIGHT = 1.15;
const EXIT_AT = 9.4;
const clamp01 = v => Math.min(1, Math.max(0, v));
const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeOutBack = t => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

function paintBall(ctx, x, y, r, number, rotation, alpha, withShadow) {
  if (alpha <= 0.01 || r < 2) return;
  const [light, base, dark] = PALETTE[colorOf(number)];
  ctx.save();
  ctx.globalAlpha = alpha;
  if (withShadow) {
    ctx.fillStyle = 'rgba(0, 0, 0, .3)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 1.12, r * .78, r * .2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const body = ctx.createRadialGradient(x - r * .3, y - r * .36, r * .08, x, y, r);
  body.addColorStop(0, light);
  body.addColorStop(.55, base);
  body.addColorStop(1, dark);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const shine = ctx.createRadialGradient(x - r * .36, y - r * .44, 0, x - r * .36, y - r * .44, r * .42);
  shine.addColorStop(0, 'rgba(255, 255, 255, .9)');
  shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (r >= 9) {
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.font = `800 ${Math.round(r * .84)}px Sora, Manrope, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (number === 49) ctx.fillStyle = '#2a1d02';
    else {
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0, 0, 0, .45)';
      ctx.shadowBlur = 2;
      ctx.shadowOffsetY = 1;
    }
    ctx.fillText(String(number), 0, r * .05);
  }
  ctx.restore();
}

export default function HeroDraw() {
  const backRef = useRef(null);
  const frontRef = useRef(null);

  useEffect(() => {
    const back = backRef.current;
    const front = frontRef.current;
    const banner = back?.closest('.welcome-banner');
    const art = banner?.querySelector('.welcome-ball-art');
    if (!banner || !art || !front.getContext
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const backCtx = back.getContext('2d');
    const frontCtx = front.getContext('2d');
    if (!backCtx || !frontCtx) return undefined;

    let width = 0;
    let height = 0;
    let slots = [];
    let floaters = [];
    let picks = [];
    let cycleStart = performance.now() - 200;
    let frame = 0;
    let running = false;
    let visible = true;

    const measure = () => {
      const box = banner.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (Math.round(box.width) !== width || Math.round(box.height) !== height) {
        width = Math.round(box.width);
        height = Math.round(box.height);
        for (const [canvas, ctx] of [[back, backCtx], [front, frontCtx]]) {
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
      }
      slots = [...art.children].slice(0, 6).map(slot => {
        const rect = slot.getBoundingClientRect();
        return { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2, r: rect.width / 2 };
      });
    };

    const seedFloaters = () => {
      const count = width < 620 ? 9 : 15;
      const numbers = Array.from({ length: 49 }, (_, i) => i + 1).sort(() => Math.random() - .5).slice(0, count);
      floaters = numbers.map((number, index) => {
        const depth = .35 + Math.random() * .65;
        return {
          number, depth,
          x: (index + Math.random()) / count * width,
          y: Math.random() * height,
          r: (width < 620 ? 9 : 11) + depth * (width < 620 ? 13 : 21),
          vx: (Math.random() - .5) * 9 * depth,
          vy: -(5 + Math.random() * 10) * depth,
          phase: Math.random() * Math.PI * 2,
          spin: .5 + Math.random() * .6,
          fade: 1,
          picked: false,
        };
      });
    };

    const startCycle = now => {
      cycleStart = now;
      for (const floater of floaters) {
        if (!floater.picked) continue;
        // A picked ball comes back as a new number, rising from the bottom.
        const used = new Set(floaters.map(f => f.number));
        let number = floater.number;
        for (let tries = 0; tries < 60 && used.has(number); tries++) number = 1 + Math.floor(Math.random() * 49);
        Object.assign(floater, { number, picked: false, fade: 0, x: Math.random() * width, y: height + floater.r });
      }
      picks = [];
    };

    const draw = now => {
      frame = 0;
      if (!running) return;
      const t = (now - cycleStart) / 1000;
      if (t >= CYCLE) startCycle(now);
      const seconds = now / 1000;

      backCtx.clearRect(0, 0, width, height);
      for (const floater of floaters) {
        floater.x += floater.vx / 60;
        floater.y += floater.vy / 60;
        if (floater.y < -floater.r * 2) { floater.y = height + floater.r; floater.x = Math.random() * width; }
        if (floater.x < -floater.r * 2) floater.x = width + floater.r;
        if (floater.x > width + floater.r * 2) floater.x = -floater.r;
        floater.fade = Math.min(1, floater.fade + .012);
        if (floater.picked) continue;
        const sway = Math.sin(seconds * .6 + floater.phase) * 7 * floater.depth;
        paintBall(backCtx, floater.x + sway, floater.y, floater.r, floater.number,
          Math.sin(seconds * floater.spin + floater.phase) * .4, (.12 + floater.depth * .26) * floater.fade, false);
      }

      // Pick the next ball when its launch time arrives.
      while (picks.length < slots.length && picks.length < 6 && t >= LAUNCH_AT + picks.length * LAUNCH_GAP) {
        const pool = floaters.filter(f => !f.picked && f.fade > .9 && f.y > 0 && f.y < height && f.x > 0 && f.x < width);
        const source = pool[Math.floor(Math.random() * pool.length)];
        if (!source) break;
        source.picked = true;
        picks.push({ number: source.number, fromX: source.x, fromY: source.y, fromR: source.r,
          fromAlpha: .12 + source.depth * .26, startedAt: LAUNCH_AT + picks.length * LAUNCH_GAP });
      }

      frontCtx.clearRect(0, 0, width, height);
      const allLanded = LAUNCH_AT + 5 * LAUNCH_GAP + FLIGHT;
      picks.forEach((pick, index) => {
        const slot = slots[index];
        if (!slot) return;
        const p = clamp01((t - pick.startedAt) / FLIGHT);
        const move = easeOutCubic(p);
        // Curved path: lift above the straight line, then settle into the slot.
        const lift = Math.sin(p * Math.PI) * Math.min(120, height * .28);
        let x = pick.fromX + (slot.x - pick.fromX) * move;
        let y = pick.fromY + (slot.y - pick.fromY) * move - lift * (1 - move * .4);
        let r = pick.fromR + (slot.r - pick.fromR) * easeOutBack(p);
        let alpha = pick.fromAlpha + (1 - pick.fromAlpha) * clamp01(p * 3);
        const rotation = (1 - move) * Math.PI * 3 * (index % 2 ? -1 : 1);
        if (p >= 1) {
          y += Math.sin(seconds * 1.6 + index * .7) * 2.5;
          // One bright pulse runs along the finished row.
          const pulse = clamp01(1 - Math.abs(t - (allLanded + .25 + index * .09)) / .22);
          r *= 1 + pulse * .14;
          const exit = clamp01((t - EXIT_AT - index * .07) / .9);
          y += exit * exit * (height - slot.y + slot.r * 3);
          alpha *= 1 - exit;
          const ring = clamp01((t - pick.startedAt - FLIGHT) / .7);
          if (ring < 1) {
            frontCtx.save();
            frontCtx.strokeStyle = `rgba(246, 213, 131, ${(1 - ring) * .8})`;
            frontCtx.lineWidth = 2;
            frontCtx.beginPath();
            frontCtx.arc(slot.x, slot.y, slot.r * (1.05 + ring * .75), 0, Math.PI * 2);
            frontCtx.stroke();
            frontCtx.restore();
          }
        }
        paintBall(frontCtx, x, y, r, pick.number, rotation, alpha, p >= 1);
      });

      frame = requestAnimationFrame(draw);
    };

    const sync = () => {
      const shouldRun = visible && !document.hidden;
      if (shouldRun === running) return;
      running = shouldRun;
      if (running && !frame) frame = requestAnimationFrame(draw);
    };

    measure();
    seedFloaters();
    art.classList.add('is-live');
    const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const before = width;
      measure();
      if (Math.abs(width - before) > 80) seedFloaters();
    }) : null;
    resizer?.observe(banner);
    resizer?.observe(art);
    const watcher = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }) : null;
    watcher?.observe(banner);
    const slotTimer = setInterval(measure, 1500);
    document.addEventListener('visibilitychange', sync);
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      clearInterval(slotTimer);
      resizer?.disconnect();
      watcher?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      art.classList.remove('is-live');
    };
  }, []);

  return <>
    <span className="hero-aurora" aria-hidden="true"><i /><i /></span>
    <canvas className="hero-draw hero-draw-back" ref={backRef} aria-hidden="true" />
    <canvas className="hero-draw hero-draw-front" ref={frontRef} aria-hidden="true" />
  </>;
}
