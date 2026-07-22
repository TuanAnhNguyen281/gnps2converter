import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Line, Sparkles } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

function Molecule() {
  const group = useRef<THREE.Group>(null);
  const nodes = useMemo(() => [
    [-2.4, .2, 0], [-1.2, 1.15, .2], [.2, .7, -.2], [1.35, 1.5, .1], [2.35, .45, 0],
    [1.65, -.9, .15], [.2, -1.2, -.1], [-1.25, -.85, .15], [0, 0, .45],
  ] as [number, number, number][], []);
  const edges = [[0,1],[0,7],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[2,8],[6,8],[8,3]];
  useFrame((state, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * .06;
    group.current.rotation.x = Math.sin(state.clock.elapsedTime * .15) * .07;
  });
  return <group ref={group}>
    {edges.map(([a,b], index) => <Line key={index} points={[nodes[a], nodes[b]]} color="#35d8e5" transparent opacity={.32} lineWidth={1} />)}
    {nodes.map((position, index) => <Float key={index} speed={1 + index % 3 * .2} floatIntensity={.25}>
      <mesh position={position}>
        <sphereGeometry args={[index === 8 ? .21 : .13, 24, 24]} />
        <meshStandardMaterial color={index % 3 === 0 ? '#a78bfa' : '#43e6d2'} emissive={index % 3 === 0 ? '#6d28d9' : '#0891b2'} emissiveIntensity={1.5} roughness={.25} />
      </mesh>
    </Float>)}
  </group>;
}

export default function MoleculeScene() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return <div className="scene-fallback" />;
  return <div className="scene" aria-hidden="true"><Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 7], fov: 46 }} gl={{ antialias: true, alpha: true }}>
    <ambientLight intensity={.5} /><pointLight position={[3, 4, 5]} intensity={15} color="#67e8f9" />
    <Molecule /><Sparkles count={70} scale={[10, 6, 4]} size={1.2} speed={.18} color="#a5f3fc" opacity={.45} />
  </Canvas></div>;
}
