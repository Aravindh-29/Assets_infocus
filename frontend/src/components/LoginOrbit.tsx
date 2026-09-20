import { useEffect, useId, useRef } from 'react';
import { Laptop, Monitor, RotateCcw, Router, Smartphone } from 'lucide-react';
import './login-orbit.css';

type Point3 = { x: number; y: number; z: number };
type OrbitState = { yaw: number; pitch: number; velocityX: number; velocityY: number };
type Ring = { radius: number; tilt: number; twist: number; color: string };

const INITIAL = { yaw: -0.12, pitch: 0.08, velocityX: 0, velocityY: 0 };
const RINGS: Ring[] = [
  { radius: 204, tilt: 0.9, twist: -0.23, color: '100, 228, 200' },
  { radius: 177, tilt: 1.05, twist: 0.69, color: '146, 167, 241' },
  { radius: 233, tilt: 1.12, twist: -0.56, color: '121, 202, 204' },
];
const DEVICES = [
  {
    name: 'Workstations',
    label: 'Built for your team',
    icon: Laptop,
    point: { x: -184, y: -77, z: -55 },
    tone: 'mint',
  },
  {
    name: 'Displays',
    label: 'Every detail, connected',
    icon: Monitor,
    point: { x: 146, y: -109, z: 105 },
    tone: 'aqua',
  },
  {
    name: 'Mobile devices',
    label: 'Ready for anywhere',
    icon: Smartphone,
    point: { x: 178, y: 79, z: -100 },
    tone: 'lavender',
  },
  {
    name: 'Network',
    label: 'Keeping teams together',
    icon: Router,
    point: { x: -123, y: 112, z: 65 },
    tone: 'aqua',
  },
];
const STARS = Array.from({ length: 46 }, (_, index) => ({
  x: ((index * 137.508 + 19) % 100) / 100,
  y: ((index * 71.13 + 7) % 100) / 100,
  radius: index % 7 === 0 ? 1.3 : 0.6,
  phase: index * 1.72,
}));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function ringPoint(ring: Ring, angle: number): Point3 {
  const x = Math.cos(angle) * ring.radius;
  const y = Math.sin(angle) * ring.radius * Math.cos(ring.tilt);
  return {
    x: x * Math.cos(ring.twist) - y * Math.sin(ring.twist),
    y: x * Math.sin(ring.twist) + y * Math.cos(ring.twist),
    z: Math.sin(angle) * ring.radius * Math.sin(ring.tilt),
  };
}

/** An illustrative asset constellation. All animation stays local to this canvas. */
export function LoginOrbit({ paused, reducedMotion }: { paused: boolean; reducedMotion: boolean }) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const stateRef = useRef<OrbitState>({ ...INITIAL });
  const phaseRef = useRef(0);
  const resetRef = useRef<() => void>(() => undefined);
  const instructionsId = useId();
  const gradientId = useId().replace(/:/g, '');

  useEffect(() => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let width = 0;
    let height = 0;
    let scale = 1;
    let frameId = 0;
    let lastFrame = 0;
    let elapsed = phaseRef.current;
    let dragging = false;
    let activePointer: number | null = null;
    let pointerX = 0;
    let pointerY = 0;
    let pointerTime = 0;
    let parallaxX = 0;
    let parallaxY = 0;
    let targetParallaxX = 0;
    let targetParallaxY = 0;
    const motionAllowed = () => !paused && !reducedMotion && !document.hidden;

    function project(point: Point3) {
      const { yaw, pitch } = stateRef.current;
      const x = point.x * Math.cos(yaw) + point.z * Math.sin(yaw);
      const z = -point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
      const y = point.y * Math.cos(pitch) - z * Math.sin(pitch);
      const depth = point.y * Math.sin(pitch) + z * Math.cos(pitch);
      const perspective = 720 / (720 - depth);
      return {
        x: width / 2 + x * scale * perspective + parallaxX,
        y: height * 0.48 + y * scale * perspective + parallaxY,
        z: depth,
        perspective,
      };
    }

    function draw(timestamp: number) {
      frameId = 0;
      if (!width || !height) return;
      const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, 0.04) : 0;
      lastFrame = timestamp;
      const moving = motionAllowed();
      const state = stateRef.current;
      if (moving) {
        elapsed += dt;
        phaseRef.current = elapsed;
        if (!dragging) {
          state.yaw += (0.045 + state.velocityX) * dt;
          state.pitch = clamp(state.pitch + state.velocityY * dt, -0.64, 0.64);
          state.velocityX *= Math.exp(-4.6 * dt);
          state.velocityY *= Math.exp(-4.6 * dt);
        }
        parallaxX += (targetParallaxX - parallaxX) * Math.min(dt * 5, 1);
        parallaxY += (targetParallaxY - parallaxY) * Math.min(dt * 5, 1);
      }
      scene!.dataset.rotationX = state.pitch.toFixed(4);
      scene!.dataset.rotationY = state.yaw.toFixed(4);
      context!.clearRect(0, 0, width, height);

      // Quiet, fixed stars make the moving constellation easier to perceive.
      for (const star of STARS) {
        const alpha = 0.17 + (Math.sin(elapsed * 0.8 + star.phase) + 1) * 0.13;
        context!.fillStyle = `rgba(184, 238, 226, ${alpha})`;
        context!.beginPath();
        context!.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2);
        context!.fill();
      }

      for (let index = 0; index < RINGS.length; index++) {
        const ring = RINGS[index];
        for (let step = 0; step < 144; step++) {
          const from = project(ringPoint(ring, (step / 144) * Math.PI * 2));
          const to = project(ringPoint(ring, ((step + 1) / 144) * Math.PI * 2));
          const alpha = 0.09 + ((from.z + ring.radius) / (ring.radius * 2)) * 0.31;
          context!.beginPath();
          context!.strokeStyle = `rgba(${ring.color}, ${alpha})`;
          context!.lineWidth = index === 0 ? 1.1 : 0.7;
          context!.moveTo(from.x, from.y);
          context!.lineTo(to.x, to.y);
          context!.stroke();
        }

        // A short luminous trail glides along each orbital rail.
        const angle = elapsed * (0.17 + index * 0.035) + index * 2.1;
        for (let trail = 16; trail >= 0; trail--) {
          const dot = project(ringPoint(ring, angle - trail * 0.018));
          context!.fillStyle = `rgba(${ring.color}, ${(1 - trail / 17) * 0.85})`;
          context!.beginPath();
          context!.arc(dot.x, dot.y, trail === 0 ? 2.4 : 1.15, 0, Math.PI * 2);
          context!.fill();
        }
      }

      DEVICES.forEach((device, index) => {
        const point = project(device.point);
        const center = project({ x: 0, y: 0, z: 0 });
        context!.beginPath();
        context!.setLineDash([2, 5]);
        context!.strokeStyle = 'rgba(126, 201, 194, 0.14)';
        context!.lineWidth = 0.7;
        context!.moveTo(center.x, center.y);
        context!.lineTo(point.x, point.y);
        context!.stroke();
        context!.setLineDash([]);
        const card = cardRefs.current[index];
        if (card) {
          const cardScale = clamp(scale * 0.98, 0.77, 1) * clamp(point.perspective, 0.85, 1.07);
          const halfWidth = (card.offsetWidth / 2) * cardScale;
          const x = clamp(point.x, halfWidth + 4, width - halfWidth - 4);
          const y = clamp(point.y, 36, height - 40);
          card.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${cardScale})`;
          card.style.opacity = String(clamp(0.91 + point.z / 700, 0.7, 1));
          card.style.zIndex = point.z > 0 ? '4' : '2';
        }
      });

      if (hubRef.current) {
        const center = project({ x: 0, y: 0, z: 0 });
        hubRef.current.style.left = `${center.x}px`;
        hubRef.current.style.top = `${center.y}px`;
        hubRef.current.style.setProperty('--hub-turn', `${Math.sin(state.yaw) * 14}deg`);
        hubRef.current.style.setProperty('--hub-tilt', `${state.pitch * -18}deg`);
      }
      if (moving) frameId = window.requestAnimationFrame(draw);
    }

    function requestFrame() {
      if (!frameId) frameId = window.requestAnimationFrame(draw);
    }

    function resize() {
      width = scene!.clientWidth;
      height = scene!.clientHeight;
      scale = Math.min(width / 595, height / 380);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      requestFrame();
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || activePointer !== null || (event.target as HTMLElement).closest('button'))
        return;
      dragging = true;
      activePointer = event.pointerId;
      pointerX = event.clientX;
      pointerY = event.clientY;
      pointerTime = event.timeStamp;
      stateRef.current.velocityX = 0;
      stateRef.current.velocityY = 0;
      scene!.dataset.dragging = 'true';
      scene!.setPointerCapture(event.pointerId);
      scene!.focus({ preventScroll: true });
      requestFrame();
    }

    function onPointerMove(event: PointerEvent) {
      if (!dragging) {
        if (!motionAllowed()) return;
        const rect = scene!.getBoundingClientRect();
        targetParallaxX = ((event.clientX - rect.left) / width - 0.5) * 14;
        targetParallaxY = ((event.clientY - rect.top) / height - 0.5) * 10;
        return;
      }
      if (event.pointerId !== activePointer) return;
      const deltaX = (event.clientX - pointerX) * 0.006;
      const deltaY = (event.clientY - pointerY) * 0.005;
      const dt = Math.max((event.timeStamp - pointerTime) / 1000, 0.008);
      stateRef.current.yaw += deltaX;
      stateRef.current.pitch = clamp(stateRef.current.pitch + deltaY, -0.64, 0.64);
      stateRef.current.velocityX = motionAllowed() ? clamp(deltaX / dt, -2.4, 2.4) : 0;
      stateRef.current.velocityY = motionAllowed() ? clamp(deltaY / dt, -1.5, 1.5) : 0;
      pointerX = event.clientX;
      pointerY = event.clientY;
      pointerTime = event.timeStamp;
      requestFrame();
    }

    function endDrag(event: PointerEvent) {
      if (event.pointerId !== activePointer) return;
      if (event.timeStamp - pointerTime > 100 || event.type === 'pointercancel') {
        stateRef.current.velocityX = 0;
        stateRef.current.velocityY = 0;
      }
      dragging = false;
      activePointer = null;
      scene!.dataset.dragging = 'false';
      if (scene!.hasPointerCapture(event.pointerId)) scene!.releasePointerCapture(event.pointerId);
      requestFrame();
    }

    function pointerLeave() {
      targetParallaxX = 0;
      targetParallaxY = 0;
    }

    function reset() {
      stateRef.current = { ...INITIAL };
      parallaxX = targetParallaxX = 0;
      parallaxY = targetParallaxY = 0;
      elapsed = 0;
      phaseRef.current = 0;
      requestFrame();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.target !== scene || event.altKey || event.ctrlKey || event.metaKey) return;
      const state = stateRef.current;
      switch (event.key) {
        case 'ArrowLeft':
          state.yaw -= 0.13;
          break;
        case 'ArrowRight':
          state.yaw += 0.13;
          break;
        case 'ArrowUp':
          state.pitch = clamp(state.pitch - 0.1, -0.64, 0.64);
          break;
        case 'ArrowDown':
          state.pitch = clamp(state.pitch + 0.1, -0.64, 0.64);
          break;
        case 'Home':
          reset();
          break;
        default:
          return;
      }
      event.preventDefault();
      state.velocityX = 0;
      state.velocityY = 0;
      requestFrame();
    }

    function onVisibilityChange() {
      if (document.hidden) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      } else {
        lastFrame = 0;
        requestFrame();
      }
    }

    resetRef.current = reset;
    const observer = new ResizeObserver(resize);
    observer.observe(scene);
    scene.addEventListener('pointerdown', onPointerDown);
    scene.addEventListener('pointermove', onPointerMove);
    scene.addEventListener('pointerup', endDrag);
    scene.addEventListener('pointercancel', endDrag);
    scene.addEventListener('lostpointercapture', endDrag);
    scene.addEventListener('pointerleave', pointerLeave);
    scene.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    resize();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
      scene.removeEventListener('pointerdown', onPointerDown);
      scene.removeEventListener('pointermove', onPointerMove);
      scene.removeEventListener('pointerup', endDrag);
      scene.removeEventListener('pointercancel', endDrag);
      scene.removeEventListener('lostpointercapture', endDrag);
      scene.removeEventListener('pointerleave', pointerLeave);
      scene.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (activePointer !== null && scene.hasPointerCapture(activePointer))
        scene.releasePointerCapture(activePointer);
      scene.dataset.dragging = 'false';
    };
  }, [paused, reducedMotion]);

  return (
    <div
      ref={sceneRef}
      className="login-orbit login-orbit-scene"
      role="region"
      aria-label="Interactive asset orbit"
      aria-describedby={instructionsId}
      tabIndex={0}
      data-dragging="false"
      data-rotation-x={INITIAL.pitch}
      data-rotation-y={INITIAL.yaw}
      data-motion={paused || reducedMotion ? 'paused' : 'playing'}
    >
      <p id={instructionsId} className="login-orbit-instructions">
        Illustrative asset constellation. Drag to rotate, or use arrow keys when focused. Press Home to reset
        the view.
      </p>
      <div className="login-orbit-aura" aria-hidden="true" />
      <canvas ref={canvasRef} className="login-orbit-canvas" aria-hidden="true" />
      <div className="login-orbit-hub" ref={hubRef} aria-hidden="true">
        <div className="login-orbit-hub-halo" />
        <svg className="login-orbit-cube" viewBox="0 0 160 172" fill="none">
          <defs>
            <linearGradient
              id={`${gradientId}-top`}
              x1="34"
              y1="37"
              x2="119"
              y2="86"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#c8ffe3" />
              <stop offset="1" stopColor="#64cbb3" />
            </linearGradient>
            <linearGradient
              id={`${gradientId}-left`}
              x1="26"
              y1="75"
              x2="82"
              y2="135"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#4dcbb2" stopOpacity=".77" />
              <stop offset="1" stopColor="#163f43" />
            </linearGradient>
            <linearGradient
              id={`${gradientId}-right`}
              x1="136"
              y1="73"
              x2="81"
              y2="140"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#7ddbc1" stopOpacity=".9" />
              <stop offset="1" stopColor="#24847c" stopOpacity=".5" />
            </linearGradient>
          </defs>
          <path d="M80 15 146 53v77l-66 38-66-38V53L80 15Z" stroke="#8de6c6" strokeOpacity=".12" />
          <path d="m80 31 52 30v60l-52 30-52-30V61l52-30Z" stroke="#8de6c6" strokeOpacity=".24" />
          <path d="m80 40 44 25-44 26-44-26 44-25Z" fill={`url(#${gradientId}-top)`} />
          <path
            d="m36 65 44 26v51l-44-26V65Z"
            fill={`url(#${gradientId}-left)`}
            stroke="#83ebcb"
            strokeOpacity=".5"
          />
          <path
            d="m124 65-44 26v51l44-26V65Z"
            fill={`url(#${gradientId}-right)`}
            stroke="#a1f0d1"
            strokeOpacity=".6"
          />
          <path d="m36 65 44 26 44-26M80 91v51" stroke="#bdffe0" strokeWidth="1.4" />
          <path d="m63 50 44 25v18l-11 6V81L52 56l11-6Z" fill="#123938" fillOpacity=".25" />
          <path
            d="m46 104 18 11m-18-5 11 7"
            stroke="#a5f3d7"
            strokeWidth="2"
            strokeLinecap="round"
            strokeOpacity=".7"
          />
          <path
            d="m92 119 7 4 13-20"
            stroke="#cdfae2"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="80" cy="15" r="2" fill="#a3efd4" />
          <circle cx="146" cy="130" r="2" fill="#a3efd4" fillOpacity=".6" />
          <circle cx="14" cy="130" r="2" fill="#a3efd4" fillOpacity=".6" />
        </svg>
        <span className="login-orbit-hub-label">YOUR WORKSPACE</span>
      </div>
      {DEVICES.map(({ name, label, icon: Icon, tone }, index) => (
        <div
          key={name}
          ref={(element) => {
            cardRefs.current[index] = element;
          }}
          className={`login-orbit-device login-orbit-device-${tone}`}
          aria-hidden="true"
        >
          <span className="login-orbit-device-icon">
            <Icon size={22} strokeWidth={1.35} />
          </span>
          <span className="login-orbit-device-copy">
            <strong>{name}</strong>
            <small>{label}</small>
          </span>
          <span className="login-orbit-device-node" />
        </div>
      ))}
      <button
        type="button"
        className="login-orbit-reset"
        aria-label="Reset orbit"
        onClick={() => resetRef.current()}
      >
        <RotateCcw size={13} />
        <span>Reset view</span>
      </button>
    </div>
  );
}

export default LoginOrbit;
