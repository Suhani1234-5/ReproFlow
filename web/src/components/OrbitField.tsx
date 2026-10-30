import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

const TAU = Math.PI * 2;

const ORBITS = 500;
const POINTS_PER_ORBIT = 120;
const MOBILE_ORBITS = 200;
const MOBILE_POINTS_PER_ORBIT = 60;

/** Quality tier probe: the first N frames decide whether the field is too heavy for this GPU. */
const SAMPLE_FRAMES = 60;
const MIN_FPS = 45;
/** Share of the orbits kept when the probe comes back slow. */
const LOW_TIER_RATIO = 0.45;
/** A frame longer than this is a stall, not a slow machine, so it is clamped in the average. */
const MAX_SAMPLE_FRAME_S = 1 / 30;

const DEG = Math.PI / 180;

/** Point size caps in CSS pixels. */
const MAX_POINT_SIZE = 7;
const MOBILE_MAX_POINT_SIZE = 4;

/** The whole disc is tilted 18 degrees and spins slowly, so it reads as a volume, not a ring. */
const GROUP_TILT_X = 18 * DEG;
const GROUP_SPIN = 0.06;
/** World units the right-aligned hero variant is pushed right of centre. */
const GROUP_OFFSET_X = 1.2;
/** The disc is scaled up so the outer orbits reach the edges of the right 60% of the viewport. */
const SWIRL_SCALE = 1.8;

/** One soft additive glow stands in for the points that used to pile up at the core. */
const CORE_GLOW_SCALE = 1.2;
const CORE_GLOW_OPACITY = 0.35;
const CORE_GLOW_COLOR = '#cfe6f2';

/** Semi-major axis distribution. Above 1 it thins the centre out instead of piling orbits up. */
const AXIS_BIAS = 1.6;
const MIN_AXIS = 0.4;
const MAX_AXIS = 4.8;

const MIN_ECC = 0.2;
const MAX_ECC = 0.75;
/** 0-75 degrees about a random node, so some orbits come out nearly vertical. */
const MAX_INCLINATION = 75 * DEG;

const BASE_SPEED = 0.51;

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec2 uMouse;
  uniform float uSpeed;
  uniform float uSpread;
  uniform float uFocus;
  uniform float uCollapse;
  uniform float uPixelRatio;
  uniform float uMaxPointSize;

  attribute float aAxis;
  attribute float aEcc;
  attribute float aIncl;
  attribute float aNode;
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aIndex;

  varying float vAlpha;
  varying float vDof;
  varying float vHead;

  const float TAU = 6.28318530718;
  /** Comet trail length as a share of the orbit. */
  const float TAIL_LENGTH = 0.35;
  /** Alpha on the focus plane, at rest, and far out of focus. */
  const float ALPHA_NEAR = 0.9;
  const float ALPHA_BASE = 0.45;
  const float ALPHA_FAR = 0.15;
  const float MIN_POINT_SIZE = 2.0;
  /** Mouse bend strength, and the distance over which it fades out. */
  const float BEND = 0.25;
  const float BEND_RADIUS = 2.5;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  void main() {
    // uSpread throws the disc open and shuffles the points; 0 is the settled orbit.
    float a = aAxis * (1.0 + uSpread * 1.6) * (0.9 + 0.3 * uProgress) * (1.0 - uCollapse * 0.72);
    float b = a * sqrt(1.0 - aEcc * aEcc);

    float seed = aNode * 1.37 + aPhase * 7.13 + aIndex * 3.71;
    float offset = mix(aIndex, hash11(seed + 5.1), uSpread);
    float head = aPhase + uTime * aSpeed * uSpeed;
    float angle = (offset + head) * TAU;

    // The point sits on the ellipse; only the comet travels along it.
    vec3 local = vec3(cos(angle) * a, 0.0, sin(angle) * b);

    // uProgress orders the planes: 0 keeps every orbit tilted and turned, 1 flattens them onto one disc.
    float incl = aIncl * (1.0 - uProgress * 0.94);
    float node = mix(aNode, uProgress * 1.2, uProgress);
    float ci = cos(incl);
    float si = sin(incl);
    vec3 tilted = vec3(local.x, -local.z * si, local.z * ci);

    float cn = cos(node);
    float sn = sin(node);
    vec3 p = vec3(tilted.x * cn - tilted.z * sn, tilted.y, tilted.x * sn + tilted.z * cn);

    // Comet: 1.0 at the head, decaying exponentially over the last third of the orbit.
    float tail = fract(head - offset);
    float trail = exp(-tail / TAIL_LENGTH * 2.0);
    float brightness = 0.22 + 0.78 * trail;
    vHead = smoothstep(0.0, 1.0, trail);

    // Noise: every point drifts off its orbit, then slides back in.
    vec3 noise = vec3(hash11(seed), hash11(seed + 19.7), hash11(seed + 41.3)) - 0.5;
    p += noise * (uSpread * 4.5);

    // Bend the field towards the cursor, fading out at the bend radius.
    vec3 attractor = vec3(uMouse.x * 3.4, uMouse.y * 2.1, 0.0);
    vec3 toMouse = attractor - p;
    float pull = BEND * (1.0 - smoothstep(0.0, BEND_RADIUS * BEND_RADIUS, dot(toMouse, toMouse)));
    p += toMouse * pull;

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float depth = -viewPosition.z;

    // Depth of field: 0.15 far from the focus plane, 0.45 base, up to 0.9 in focus.
    vDof = smoothstep(0.0, 1.0, 1.0 - abs(depth - uFocus) * 0.6);
    float dofAlpha = ALPHA_BASE * mix(ALPHA_FAR / ALPHA_BASE, ALPHA_NEAR / ALPHA_BASE, vDof);
    vAlpha = clamp(dofAlpha * brightness + uCollapse * 0.35, 0.0, ALPHA_NEAR);

    // Size follows 1/depth and grows towards the head of the comet, capped in device pixels.
    float size = uMaxPointSize * (0.45 + 1.05 * trail) * (5.0 / max(depth, 0.6));
    gl_PointSize = clamp(size * uPixelRatio, MIN_POINT_SIZE * uPixelRatio, uMaxPointSize * uPixelRatio);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uColorMix;
  uniform float uPulse;
  uniform float uFlash;

  varying float vAlpha;
  varying float vDof;
  varying float vHead;

  void main() {
    // Round, soft point.
    vec2 offset = gl_PointCoord - 0.5;
    float radius = length(offset) * 2.0;

    // Out-of-focus dots get a softer edge as well as a dimmer one.
    float edge = mix(0.6, 0.05, vDof);
    float mask = 1.0 - smoothstep(edge, 1.0, radius);
    float alpha = mask * vAlpha;
    if (alpha < 0.004) discard;

    // Linear forms of the palette tokens: white, blue-grey, cyan, plus the bug red.
    const vec3 WHITE = vec3(0.913, 0.930, 0.956);
    const vec3 BLUE_GREY = vec3(0.246, 0.288, 0.381);
    const vec3 CYAN = vec3(0.010, 0.651, 0.855);
    const vec3 RED = vec3(1.0, 0.224, 0.176);

    // Heads are 45% cyan and 55% white; the tail fades from the head colour into blue-grey.
    vec3 head = mix(WHITE, CYAN, 0.45);
    vec3 tail = mix(head, BLUE_GREY, clamp(0.35 + 0.65 * uColorMix, 0.0, 1.0));
    vec3 color = mix(tail, head, vHead);
    // Stage 1 marks the bug on the comet heads; stage 3 fires one cyan pulse.
    color = mix(color, RED, uFlash * vHead);
    color = mix(color, CYAN, uPulse * (0.35 + 0.65 * vHead));
    alpha = clamp(alpha * (1.0 + uPulse * 0.6), 0.0, 1.0);

    // Nothing is allowed to clip to solid white.
    gl_FragColor = vec4(min(color, vec3(0.9)), alpha);
  }
`;

const GLOW_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  varying vec2 vUv;

  void main() {
    // Radial gradient: opaque at the centre of the quad, gone at its rim.
    float d = length(vUv - 0.5) * 2.0;
    float glow = pow(1.0 - clamp(d, 0.0, 1.0), 2.5);
    gl_FragColor = vec4(uColor, glow * uOpacity);
  }
`;

/**
 * Mutable values a scroll scrub can tween without re-rendering React.
 * Every field is written into the uniforms once per frame.
 */
export interface FieldControls {
  /** 0 = chaotic tilted planes, 1 = one flattened, aligned disc. */
  progress: number;
  /** Scatter: 1 is thrown wide and noisy, 0 is settled. */
  spread: number;
  speed: number;
  /** Depth-of-field focus distance, and the resting camera distance. */
  focus: number;
  colorMix: number;
  /** 0..1 squeeze towards a tight, bright core. */
  collapse: number;
  /** 0..1 single cyan pulse. */
  pulse: number;
  /** 0..1 red flare on the comet heads. */
  flash: number;
  camera: { x: number; y: number; z: number };
}

export type FieldControlsRef = { readonly current: FieldControls | null };

interface OrbitFieldProps {
  /** Live controls; when present they win over the static props below. */
  controls?: FieldControlsRef;
  progress?: number;
  speed?: number;
  spread?: number;
  colorMix?: number;
  focus?: number;
  /** `right` pushes the swirl out of the headline's way; `center` is the story's framing. */
  align?: 'center' | 'right';
}

interface Density {
  orbits: number;
  pointsPerOrbit: number;
  mobile: boolean;
}

interface FieldData {
  positions: Float32Array;
  axis: Float32Array;
  ecc: Float32Array;
  incl: Float32Array;
  node: Float32Array;
  speed: Float32Array;
  phase: Float32Array;
  index: Float32Array;
}

/** Mobile and low-core devices get a third of the points. */
function pickDensity(): Density {
  const narrow = window.matchMedia('(max-width: 767px)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  const light = narrow || coarse || fewCores;
  return light
    ? { orbits: MOBILE_ORBITS, pointsPerOrbit: MOBILE_POINTS_PER_ORBIT, mobile: narrow || coarse }
    : { orbits: ORBITS, pointsPerOrbit: POINTS_PER_ORBIT, mobile: false };
}

function buildField({ orbits, pointsPerOrbit }: Density): FieldData {
  const count = orbits * pointsPerOrbit;
  const data: FieldData = {
    positions: new Float32Array(count * 3),
    axis: new Float32Array(count),
    ecc: new Float32Array(count),
    incl: new Float32Array(count),
    node: new Float32Array(count),
    speed: new Float32Array(count),
    phase: new Float32Array(count),
    index: new Float32Array(count),
  };

  for (let orbit = 0; orbit < orbits; orbit += 1) {
    // The exponent thins the middle of the disc out, so the core stays a glow rather than a mass.
    const axis = MIN_AXIS + Math.pow(Math.random(), AXIS_BIAS) * (MAX_AXIS - MIN_AXIS);
    const ecc = MIN_ECC + Math.random() * (MAX_ECC - MIN_ECC);
    // 0-75 degrees about a random node: a 3D swirl, and some orbits come out nearly vertical.
    const incl = Math.random() * MAX_INCLINATION;
    const node = Math.random() * TAU;
    const minor = axis * Math.sqrt(1 - ecc * ecc);
    // Inner orbits run faster, so the disc swirls instead of spinning rigidly.
    const speed = (BASE_SPEED / Math.pow(axis + 0.8, 0.65)) * (0.8 + Math.random() * 0.45);
    const phase = Math.random();

    for (let point = 0; point < pointsPerOrbit; point += 1) {
      const at = orbit * pointsPerOrbit + point;
      const index = point / pointsPerOrbit;
      const angle = index * TAU;

      // Bounds only: the vertex shader recomputes every position.
      data.positions[at * 3] = Math.cos(angle) * axis;
      data.positions[at * 3 + 1] = 0;
      data.positions[at * 3 + 2] = Math.sin(angle) * minor;

      data.axis[at] = axis;
      data.ecc[at] = ecc;
      data.incl[at] = incl;
      data.node[at] = node;
      data.speed[at] = speed;
      data.phase[at] = phase;
      data.index[at] = index;
    }
  }

  return data;
}

/** Single additive glow sprite for the core. */
function CoreGlow() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERTEX_SHADER,
        fragmentShader: GLOW_FRAGMENT_SHADER,
        uniforms: {
          uColor: { value: new THREE.Color(CORE_GLOW_COLOR) },
          uOpacity: { value: CORE_GLOW_OPACITY },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh scale={CORE_GLOW_SCALE}>
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

const NO_CAMERA = { x: 0, y: 0, z: 0 };

interface FieldProps {
  density: Density;
  controls?: FieldControlsRef;
  progress: number;
  speed: number;
  spread: number;
  colorMix: number;
  focus: number;
  align: 'center' | 'right';
}

function Field({ density, controls, progress, speed, spread, colorMix, focus, align }: FieldProps) {
  const data = useMemo(() => buildField(density), [density]);

  const geometry = useMemo(() => {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    result.setAttribute('aAxis', new THREE.BufferAttribute(data.axis, 1));
    result.setAttribute('aEcc', new THREE.BufferAttribute(data.ecc, 1));
    result.setAttribute('aIncl', new THREE.BufferAttribute(data.incl, 1));
    result.setAttribute('aNode', new THREE.BufferAttribute(data.node, 1));
    result.setAttribute('aSpeed', new THREE.BufferAttribute(data.speed, 1));
    result.setAttribute('aPhase', new THREE.BufferAttribute(data.phase, 1));
    result.setAttribute('aIndex', new THREE.BufferAttribute(data.index, 1));
    return result;
  }, [data]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uMouse: { value: new THREE.Vector2() },
          uFocus: { value: 8 },
          uSpeed: { value: 1 },
          uSpread: { value: 0 },
          uColorMix: { value: 0.45 },
          uCollapse: { value: 0 },
          uPulse: { value: 0 },
          uFlash: { value: 0 },
          uPixelRatio: { value: 1 },
          uMaxPointSize: { value: density.mobile ? MOBILE_MAX_POINT_SIZE : MAX_POINT_SIZE },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [density],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // Quality probe state. Draw range, not geometry, so trimming costs one buffer update.
  const probe = useRef({ frames: 0, seconds: 0, done: false });
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    // A scrub writes into this object, so nothing here needs a React render.
    const live = controls === undefined ? null : controls.current;
    const uniforms = material.uniforms;
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uProgress.value = live?.progress ?? progress;
    uniforms.uSpeed.value = live?.speed ?? speed;
    uniforms.uSpread.value = live?.spread ?? spread;
    uniforms.uColorMix.value = live?.colorMix ?? colorMix;
    uniforms.uFocus.value = live?.focus ?? focus;
    uniforms.uCollapse.value = live?.collapse ?? 0;
    uniforms.uPulse.value = live?.pulse ?? 0;
    uniforms.uFlash.value = live?.flash ?? 0;
    // gl_PointSize is in device pixels, so it has to follow the renderer's ratio.
    uniforms.uPixelRatio.value = state.gl.getPixelRatio();
    (uniforms.uMouse.value as THREE.Vector2).lerp(state.pointer, 0.05);

    // The disc drifts round on Y while the group tilt keeps it off the flat plane.
    const group = groupRef.current;
    if (group !== null) group.rotation.y = state.clock.elapsedTime * GROUP_SPIN;

    // Camera: a slow drift plus mouse parallax, pulled around by the live controls.
    const time = state.clock.elapsedTime;
    const offset = live?.camera ?? NO_CAMERA;
    const camera = state.camera;
    camera.position.x +=
      (Math.sin(time * 0.07) * 0.5 + state.pointer.x * 0.9 + offset.x - camera.position.x) * 0.06;
    camera.position.y +=
      (Math.cos(time * 0.06) * 0.28 + state.pointer.y * 0.55 + offset.y - camera.position.y) * 0.06;
    camera.position.z +=
      ((live?.focus ?? focus) + offset.z + Math.sin(time * 0.05) * 0.35 - camera.position.z) * 0.04;
    camera.lookAt(0, 0, 0);

    // Auto quality tier: average the first 60 frames and drop orbits if this GPU cannot hold 45 fps.
    const watch = probe.current;
    if (watch.done) return;
    watch.frames += 1;
    watch.seconds += Math.min(delta, MAX_SAMPLE_FRAME_S);
    if (watch.frames < SAMPLE_FRAMES) return;
    watch.done = true;
    if (watch.frames / watch.seconds < MIN_FPS) {
      // Points are laid out orbit by orbit, so cutting the range keeps whole orbits.
      const orbits = Math.max(1, Math.round(density.orbits * LOW_TIER_RATIO));
      geometry.setDrawRange(0, orbits * density.pointsPerOrbit);
    }
  });

  const shifted = align === 'right' && !density.mobile;

  return (
    <group
      ref={groupRef}
      rotation-x={GROUP_TILT_X}
      position-x={shifted ? GROUP_OFFSET_X : 0}
      scale={SWIRL_SCALE}
    >
      <CoreGlow />
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}

/** Lazy-loadable R3F field: `import('./OrbitField')`. */
export default function OrbitField({
  controls,
  progress = 0,
  speed = 1,
  spread = 0,
  colorMix = 0.45,
  focus = 8,
  align = 'center',
}: OrbitFieldProps) {
  const [visible, setVisible] = useState(() => !document.hidden);
  const [onScreen, setOnScreen] = useState(true);
  const density = useMemo(pickDensity, []);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = (): void => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  useEffect(() => {
    const element = wrapRef.current;
    if (element === null || typeof IntersectionObserver === 'undefined') return;
    // Off-screen fields stop rendering, so the hero and the story never both run.
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // On a phone the swirl has nowhere to move, so it sits behind the text and steps back.
  const faded = align === 'right' && density.mobile;

  return (
    // The field is decoration: it carries no content, and the sections around it describe it in text.
    <div
      ref={wrapRef}
      aria-hidden="true"
      className="absolute inset-0"
      style={faded ? { opacity: 0.4 } : undefined}
    >
      <Canvas
        flat
        dpr={[1, 2]}
        // Nothing renders while the tab is hidden or the canvas is off-screen.
        frameloop={visible && onScreen ? 'always' : 'never'}
        camera={{ position: [0, 0.4, focus], fov: 48, near: 0.1, far: 120 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Field
          density={density}
          controls={controls}
          progress={progress}
          speed={speed}
          spread={spread}
          colorMix={colorMix}
          focus={focus}
          align={align}
        />
      </Canvas>
    </div>
  );
}
