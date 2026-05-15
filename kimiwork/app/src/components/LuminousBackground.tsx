import { useRef, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uFluidSpeed;
uniform float uRibbonCount;
uniform float uCurveIntensity;

varying vec2 vUv;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

float hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 4; i++) {
    f += amp * noise(p * freq);
    amp *= 0.5;
    freq *= 2.0;
  }
  return f;
}

vec4 sampleFluidState(vec2 uv, float t) {
  float slowT = t * 0.08 * uFluidSpeed;
  float n1 = fbm(uv * 1.5 + vec2(slowT * 0.3, slowT * 0.2));
  float n2 = fbm(uv * 2.0 - vec2(slowT * 0.25, slowT * 0.15));
  float fluidX = sin(uv.y * 4.0 + slowT + n1 * 2.0) * 0.3 + sin(uv.x * 6.0 - slowT * 1.2 + n2 * 1.5) * 0.2;
  float fluidY = cos(uv.x * 4.0 + slowT * 0.9 + n2 * 2.0) * 0.3 + cos(uv.y * 5.0 - slowT + n1 * 1.5) * 0.2;
  float pressure = (sin(uv.x * 3.0 + uv.y * 2.5 + slowT * 0.7 + n1 * 1.8) * 0.5 + 0.5) * 0.4;
  float advectionTrail = (sin(uv.x * 2.0 - uv.y * 3.0 + slowT * 0.5 + n2 * 2.2) * 0.5 + 0.5) * 0.3;
  return vec4(fluidX, fluidY, pressure, advectionTrail);
}

vec2 perturbUvByFluid(vec2 uv, float t) {
  vec4 fluid = sampleFluidState(uv, t);
  return uv + fluid.xy * uCurveIntensity * 0.15;
}

float lineSegmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

vec2 glowLine(vec2 uv, vec2 p1, vec2 p2, float width, float glow) {
  float dist = lineSegmentDistance(uv, p1, p2);
  float core = smoothstep(width, 0.0, dist);
  float halo = exp(-dist * dist / (width * glow * 4.0));
  return vec2(core, halo);
}

vec2 angularToCartesian(float angle, float radius) {
  return vec2(cos(angle) * radius, sin(angle) * radius);
}

void main() {
  float t = uTime;
  vec2 uv = vUv;
  float aspectRatio = uResolution.x / uResolution.y;
  float scale = min(uResolution.x, uResolution.y) / 420.0;
  uv.y -= 0.5;
  uv.x -= 0.5;
  uv.x *= aspectRatio;
  float angle = atan(uv.y, uv.x);
  float radius = length(uv);
  vec4 fluid = sampleFluidState(vUv, t);

  vec2 fluidDistortedUV = perturbUvByFluid(uv, t);
  float fluidDistortedAngle = atan(fluidDistortedUV.y, fluidDistortedUV.x);
  float fluidDistortedRadius = length(fluidDistortedUV);

  vec3 color1 = vec3(0.0, 0.0078, 0.0706);
  vec3 color2 = vec3(0.231, 0.424, 1.0);
  vec3 color3 = vec3(0.639, 1.0, 0.075);
  vec3 color4 = vec3(0.0, 0.941, 1.0);
  vec3 color5 = vec3(0.02, 0.031, 0.102);

  vec3 bgColor = mix(color1, color5, vUv.y);
  bgColor += exp(-radius * radius * 8.0) * color2 * 0.4;
  bgColor += exp(-radius * radius * 3.0) * color2 * 0.1;
  bgColor += exp(-radius * radius * 14.0) * color4 * 0.1;

  float ribbonCount = max(uRibbonCount, 1.0);
  float angularSpacing = 6.28318 / ribbonCount;
  float ribbonSpace = angularSpacing * 0.7;
  float currentRibbonIndex = floor((fluidDistortedAngle + 3.14159) / angularSpacing);
  float ribbonAngleCenter = (currentRibbonIndex * angularSpacing) - 3.14159 + angularSpacing * 0.5;
  float inRibbonSpace = fluidDistortedAngle - ribbonAngleCenter;
  float normalizedRibbonCoord = clamp(inRibbonSpace / ribbonSpace, -0.5, 0.5) + 0.5;
  float animTime = t * 0.15 * uFluidSpeed;

  vec3 ribbonColor = vec3(0.0);
  float totalCore = 0.0;
  float totalHalo = 0.0;
  float ribbonDepth = 0.0;
  float depthVariation = 0.0;

  for (int r = 0; r < 5; r++) {
    float ribbonIdx = float(r);
    float ribbonSeed = ribbonIdx * 47.31;
    float ribbonAngleOffset = hash(ribbonSeed) * 6.28318;
    float ribbonSpeed = (0.5 + hash(ribbonSeed + 1.0) * 0.8) * (mod(ribbonIdx, 2.0) < 1.0 ? 1.0 : -1.0);
    float ribbonAngle = ribbonAngleOffset + ribbonSpeed * animTime * 0.3;
    float maxRadius = 0.8 + hash(ribbonSeed + 3.0) * 0.15;
    int segments = 6;

    vec2 pts[7];
    float thickness[6];

    for (int s = 0; s < 7; s++) {
      float segAngle = ribbonAngle + float(s) * 1.0472 + sin(animTime * 0.4 + ribbonSeed + float(s) * 2.1) * 0.3;
      float segRadius = 0.1 + (float(s) / 6.0) * maxRadius + sin(animTime * 0.35 + ribbonSeed * 2.0 + float(s) * 1.7) * 0.06;
      vec2 segUV = angularToCartesian(segAngle, segRadius);
      vec4 segFluid = sampleFluidState(segUV * 0.5 + vec2(0.5, 0.5), t);
      vec2 segFluidInfluence = segFluid.xy * 0.2;
      pts[s] = segUV + segFluidInfluence;
      if (s < 6) {
        thickness[s] = (0.002 + hash(ribbonSeed + float(s) * 10.0) * 0.002) * scale;
      }
    }

    float ribbonCore = 0.0;
    float ribbonHalo = 0.0;
    float ribbonProximity = 0.0;

    for (int seg = 0; seg < 5; seg++) {
      vec2 lw = glowLine(uv, pts[seg], pts[seg + 1], thickness[seg], 3.0);
      ribbonCore += lw.x;
      ribbonHalo += lw.y;
      ribbonProximity += lw.y;
    }

    float pt0Dist = length(uv - pts[0]);
    float ptNDist = length(uv - pts[6]);
    ribbonHalo += exp(-pt0Dist * pt0Dist / (thickness[0] * thickness[0] * 18.0)) * 0.08;
    ribbonHalo += exp(-ptNDist * ptNDist / (thickness[5] * thickness[5] * 18.0)) * 0.08;

    vec3 rColor;
    if (mod(ribbonIdx, 3.0) < 1.0) {
      rColor = mix(color3, color4, hash(ribbonSeed + 10.0));
    } else {
      rColor = mix(color2, color4, hash(ribbonSeed + 11.0));
    }

    ribbonColor += rColor * ribbonHalo * 0.3;
    totalCore += ribbonCore;
    totalHalo += ribbonHalo;
    ribbonDepth += hash(ribbonSeed + 20.0);
    depthVariation += ribbonProximity * hash(ribbonSeed + 20.0);
  }

  float fluidVisibility = 0.2 + fluid.z * 2.0 + fluid.w * 1.5;
  totalCore *= fluidVisibility;
  totalHalo *= fluidVisibility;

  float aberrationStrength = 0.015 * uCurveIntensity;
  vec2 chromaticUV = uv * (1.0 + aberrationStrength);
  chromaticUV -= aberrationStrength * 0.5;
  float chromaticAngle = atan(chromaticUV.y, chromaticUV.x);
  float chromaticRadius = length(chromaticUV);
  float chromaticRibbonIndex = floor((chromaticAngle + 3.14159) / angularSpacing);
  vec3 chromaticRibbonColor = mix(color2, color4, mod(chromaticRibbonIndex, 2.0));

  vec3 color = bgColor;
  color += ribbonColor * (1.0 + fluid.z * 2.0);
  color += color4 * totalHalo * 0.2;
  color += mix(color2, color3, depthVariation) * totalHalo * 0.3;
  color += chromaticRibbonColor * totalHalo * 0.15;
  color += color5 * totalCore * 2.5;
  color += mix(color2, color3, fluid.w) * totalCore * 1.5;
  color += color2 * totalHalo * 0.4 * (0.5 + fluid.z);

  color *= (0.7 + fluid.z * 1.5);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function RibbonMesh() {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uFluidSpeed: { value: 1.0 },
      uRibbonCount: { value: 5.0 },
      uCurveIntensity: { value: 1.0 },
    }),
    []
  );

  useFrame(({ clock, pointer }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
      materialRef.current.uniforms.uMouse.value.lerp(pointer, 0.05);
    }
  });

  return (
    <mesh ref={meshRef}>
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

export default function LuminousBackground() {
  return (
    <div className="fixed inset-0" style={{ zIndex: 0 }}>
      <Canvas
        orthographic
        camera={{ zoom: 1, position: [0, 0, 1], near: 0, far: 1 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: false }}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <RibbonMesh />
      </Canvas>
    </div>
  );
}
