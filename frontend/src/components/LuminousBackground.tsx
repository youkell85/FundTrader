import { useRef, useMemo, useEffect, useState, lazy, Suspense } from "react";
import type { ShaderMaterial } from "three";

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

// Static CSS fallback background for low-end devices
function StaticBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0"
      style={{
        zIndex: 0,
        background: `
          radial-gradient(ellipse at 20% 50%, rgba(59, 108, 255, 0.12) 0%, transparent 60%),
          radial-gradient(ellipse at 80% 30%, rgba(0, 240, 255, 0.08) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 80%, rgba(163, 255, 19, 0.06) 0%, transparent 50%),
          linear-gradient(180deg, #000513 0%, #01081a 40%, #00020a 100%)
        `,
      }}
    />
  );
}

// Lazy-load the entire Three.js background component with error fallback
const ThreeBackground = lazy(async () => {
  try {
    const THREE = await import("three");
    const { Canvas, useFrame, useThree } = await import("@react-three/fiber");

  const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

  const fragmentShader = `
precision mediump float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float f = 0.0; float amp = 0.5; float freq = 1.0;
  for (int i = 0; i < 3; i++) { f += amp * noise(p * freq); amp *= 0.5; freq *= 2.0; }
  return f;
}
void main() {
  float t = uTime;
  vec2 uv = vUv;
  float aspectRatio = uResolution.x / uResolution.y;
  uv.y -= 0.5; uv.x -= 0.5; uv.x *= aspectRatio;
  float radius = length(uv);
  float angle = atan(uv.y, uv.x);
  float n1 = fbm(uv * 1.5 + vec2(t * 0.03, t * 0.02));
  float n2 = fbm(uv * 2.0 - vec2(t * 0.025, t * 0.015));
  vec3 color1 = vec3(0.0, 0.0078, 0.0706);
  vec3 color2 = vec3(0.231, 0.424, 1.0);
  vec3 color3 = vec3(0.639, 1.0, 0.075);
  vec3 color4 = vec3(0.0, 0.941, 1.0);
  vec3 color5 = vec3(0.02, 0.031, 0.102);
  vec3 bgColor = mix(color1, color5, vUv.y);
  bgColor += exp(-radius * radius * 8.0) * color2 * 0.4;
  bgColor += exp(-radius * radius * 3.0) * color2 * 0.1;
  bgColor += exp(-radius * radius * 14.0) * color4 * 0.1;
  float ribbonCount = 3.0;
  float angularSpacing = 6.28318 / ribbonCount;
  float ribbonSpace = angularSpacing * 0.7;
  float currentRibbonIndex = floor((angle + 3.14159) / angularSpacing);
  float ribbonAngleCenter = (currentRibbonIndex * angularSpacing) - 3.14159 + angularSpacing * 0.5;
  float inRibbonSpace = angle - ribbonAngleCenter;
  float animTime = t * 0.15;
  vec3 ribbonColor = vec3(0.0);
  float totalHalo = 0.0;
  for (int r = 0; r < 3; r++) {
    float ribbonIdx = float(r);
    float ribbonSeed = ribbonIdx * 47.31;
    float ribbonAngleOffset = hash(ribbonSeed) * 6.28318;
    float ribbonSpeed = (0.5 + hash(ribbonSeed + 1.0) * 0.8) * (mod(ribbonIdx, 2.0) < 1.0 ? 1.0 : -1.0);
    float ribbonAngle = ribbonAngleOffset + ribbonSpeed * animTime * 0.3;
    float lineDist = abs(sin(angle - ribbonAngle + n1 * 0.5)) * radius;
    float lineGlow = exp(-lineDist * lineDist * 20.0);
    vec3 rColor = mod(ribbonIdx, 3.0) < 1.0 ? mix(color3, color4, hash(ribbonSeed + 10.0)) : mix(color2, color4, hash(ribbonSeed + 11.0));
    ribbonColor += rColor * lineGlow * 0.5;
    totalHalo += lineGlow;
  }
  vec3 color = bgColor;
  color += ribbonColor * (1.0 + n2 * 0.5);
  color += color4 * totalHalo * 0.2;
  color += color2 * totalHalo * 0.4 * (0.5 + n1);
  color *= (0.7 + n1 * 0.8);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

  function RibbonMesh() {
    const materialRef = useRef<ShaderMaterial>(null);
    const { size } = useThree();
    const uniforms = useMemo(
      () => ({
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(size.width, size.height) },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      }),
      [size]
    );
    const lastTimeRef = useRef(0);
    useFrame(({ clock, pointer }) => {
      if (!materialRef.current) return;
      const elapsed = clock.getElapsedTime();
      if (elapsed - lastTimeRef.current < 0.033) return;
      lastTimeRef.current = elapsed;
      materialRef.current.uniforms.uTime.value = elapsed;
      materialRef.current.uniforms.uMouse.value.lerp(pointer, 0.05);
    });
    return (
      <mesh>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    );
  }

    return {
      default: function ThreeBackgroundInner() {
        return (
          <Canvas
            orthographic
            camera={{ zoom: 1, position: [0, 0, 1], near: 0, far: 1 }}
            dpr={[1, 1]}
            gl={{ antialias: false, alpha: false, powerPreference: "low-power" }}
            style={{ width: "100%", height: "100%", display: "block" }}
            frameloop="always"
          >
            <RibbonMesh />
          </Canvas>
        );
      },
    };
  } catch {
    return { default: StaticBackground };
  }
});

function useShouldUseWebGL(): boolean {
  const [shouldUse, setShouldUse] = useState(() => {
    if (typeof window === "undefined") return false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const hardwareConcurrency = navigator.hardwareConcurrency || 4;
    const deviceMemory = (navigator as NavigatorWithMemory).deviceMemory ?? 4;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    if (isMobile) return false;
    if (hardwareConcurrency <= 4) return false;
    if (deviceMemory <= 4) return false;
    return true;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setShouldUse(!mediaQuery.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return shouldUse;
}

export default function LuminousBackground() {
  const shouldUseWebGL = useShouldUseWebGL();

  if (!shouldUseWebGL) {
    return <StaticBackground />;
  }

  return (
    <div aria-hidden="true" className="fixed inset-0" style={{ zIndex: 0 }}>
      <Suspense fallback={<StaticBackground />}>
        <ThreeBackground />
      </Suspense>
    </div>
  );
}
