import { useEffect, useRef } from 'react';

type Theme = 'dark' | 'light';
type Dot = { x: number; y: number; size: number; phase: number; speed: number };
type MoleculeNode = { x: number; y: number; r: number; phase: number; color: 0 | 1 | 2 };

const TAU = Math.PI * 2;
const moleculeNodes: MoleculeNode[] = [
  {x:.70,y:.34,r:7,phase:.2,color:0},{x:.76,y:.27,r:10,phase:1.1,color:0},{x:.82,y:.36,r:8,phase:2.3,color:2},
  {x:.87,y:.26,r:11,phase:3.1,color:1},{x:.92,y:.36,r:9,phase:.8,color:0},{x:.95,y:.25,r:12,phase:2,color:0},
  {x:.90,y:.46,r:16,phase:4.1,color:2},{x:.97,y:.48,r:9,phase:5.2,color:2},{x:.84,y:.47,r:8,phase:1.7,color:0},
  {x:.78,y:.43,r:6,phase:2.8,color:1},{x:.98,y:.37,r:7,phase:4.6,color:0},{x:.73,y:.48,r:5,phase:3.6,color:1},
];
const moleculeBonds = [[0,1],[0,2],[1,2],[1,3],[2,3],[2,8],[3,4],[3,5],[3,6],[4,5],[4,6],[4,10],[5,10],[6,7],[6,8],[7,10],[8,9],[9,11]];

function seededDots(count: number): Dot[] {
  let seed = 81427;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({length:count}, () => ({ x:random(), y:random()*.78, size:.35+random()*1.35, phase:random()*TAU, speed:.12+random()*.45 }));
}

export default function SciFiBackground({ theme }: { theme: Theme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha:true });
    if (!context) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dots = seededDots(window.innerWidth <= 700 ? 90 : 210);
    const carpetDots = seededDots(window.innerWidth <= 700 ? 360 : 920).map((dot, index) => ({
      ...dot,
      x: (dot.x + (index % 29) / 29) % 1,
      y: Math.min(1, dot.y / .78),
      speed: .018 + (index % 9) * .0025,
    }));
    let width = 1;
    let height = 1;
    let frame = 0;
    let running = !document.hidden;
    let last = performance.now();
    let elapsed = 0;

    const colors = theme === 'dark'
      ? {cyan:'39,229,238',blue:'40,137,255',violet:'162,62,255',bg:'#01050b',star:'120,211,255',alpha:1}
      : {cyan:'0,137,157',blue:'31,112,190',violet:'112,74,169',bg:'#edf7f8',star:'35,116,143',alpha:.68};
    const composite: GlobalCompositeOperation = theme === 'dark' ? 'lighter' : 'source-over';

    const resize = () => {
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 700 ? 1.15 : 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr,0,0,dpr,0,0);
    };

    const rgba = (value: string, alpha: number) => `rgba(${value},${alpha * colors.alpha})`;

    const drawStars = (time: number) => {
      for (const dot of dots) {
        const twinkle = .25 + .75 * (.5 + .5 * Math.sin(time * dot.speed + dot.phase));
        const x = dot.x * width;
        const y = dot.y * height;
        const radius = dot.size * twinkle;
        context.fillStyle = rgba(colors.star, twinkle * .7);
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fill();
      }
    };

    const drawAurora = (time: number) => {
      context.save();
      context.globalCompositeOperation = composite;
      context.filter = `blur(${Math.max(12,width*.009)}px)`;
      for (let layer=0; layer<7; layer+=1) {
        const y = height * (.24 + layer * .025) + Math.sin(time*.22 + layer) * 18;
        const gradient = context.createLinearGradient(0,y,width*.58,y+30);
        gradient.addColorStop(0,rgba(colors.cyan,0));
        gradient.addColorStop(.13,rgba(colors.cyan,.1));
        gradient.addColorStop(.35,rgba(colors.cyan,.28-layer*.022));
        gradient.addColorStop(.67,rgba(colors.blue,.08));
        gradient.addColorStop(1,rgba(colors.violet,0));
        context.strokeStyle = gradient;
        context.lineWidth = 22 + layer * 6;
        context.beginPath();
        context.moveTo(-width*.06,y+Math.sin(time*.32+layer)*24);
        context.bezierCurveTo(width*.08,y-115-layer*5,width*.09,y+105,width*.22,y+25);
        context.bezierCurveTo(width*.33,y-65,width*.42,y+60,width*.59,y+5);
        context.stroke();
      }
      context.filter = 'none';
      context.restore();
    };

    const drawWaves = (time: number) => {
      context.save();
      context.globalCompositeOperation = composite;
      const waveColors = [colors.cyan,colors.blue,colors.violet];
      for (let layer=0; layer<11; layer+=1) {
        const base = height*(.43+layer*.012);
        const amplitude = height*(.026+(layer%4)*.008);
        context.beginPath();
        for (let x=-20; x<=width+20; x+=7) {
          const normalized=x/width;
          const envelope=.45+.75*Math.sin(normalized*Math.PI);
          const y=base+Math.sin(normalized*TAU*(1.3+layer*.035)+time*(.28+layer*.012)+layer*.72)*amplitude*envelope
            +Math.sin(normalized*TAU*3.1-time*.19+layer)*5;
          if (x===-20) context.moveTo(x,y); else context.lineTo(x,y);
        }
        context.strokeStyle=rgba(waveColors[layer%3], layer<3?.62:.2);
        context.lineWidth=layer<3?1.25:.55;
        context.shadowColor=rgba(waveColors[layer%3],.8);
        context.shadowBlur=layer<3?13:4;
        context.stroke();
      }
      context.shadowBlur=0;
      context.restore();
    };

    const carpetPoint = (u: number,z: number,time:number,out:{x:number;y:number}) => {
      const horizon=height*.685;
      const depth=Math.pow(z,.72);
      const waveA=Math.sin(u*TAU*2.2+z*9-time*.62);
      const waveB=Math.sin(u*TAU*4.7-z*5+time*.34)*.42;
      const ridge=(waveA+waveB)*height*.032*z;
      out.x=width*.5+(u-.5)*width*1.28*depth;
      out.y=horizon+depth*height*.35+ridge;
    };

    const drawCarpet = (time:number) => {
      context.save();
      context.globalCompositeOperation=composite;
      const point={x:0,y:0};
      for (let i=0;i<carpetDots.length;i+=1) {
        const dot=carpetDots[i];
        const z=(dot.y+time*dot.speed)%1;
        const u=(dot.x+Math.sin(time*.11+dot.phase)*.008)%1;
        carpetPoint(u,z,time,point);
        const crest=Math.max(0,Math.sin(u*TAU*2.2+z*9-time*.62));
        const launch=i%17===0?Math.pow(crest,5)*(12+dot.size*18)*(z*.7+.3):0;
        const floatUp=i%41===0?((time*11+dot.phase*13)%34)*z:0;
        const py=point.y-launch-floatUp;
        const depth=.25+z*.75;
        const pulse=.4+.6*(.5+.5*Math.sin(time*1.15+dot.phase));
        const color=u>.53?colors.violet:colors.cyan;
        const radius=(.35+dot.size*.72)*depth;
        if ((launch>4||floatUp>5)&&z>.28) {
          const trail=4+Math.min(22,launch*.45+floatUp*.3);
          context.strokeStyle=rgba(color,.38*pulse);
          context.lineWidth=Math.max(.45,radius*.65);
          context.beginPath();context.moveTo(point.x,py);context.lineTo(point.x,py+trail);context.stroke();
        }
        context.fillStyle=rgba(color,(.2+z*.58)*pulse);
        context.beginPath();context.arc(point.x,py,radius,0,TAU);context.fill();
      }
      context.shadowBlur=0;
      context.restore();
    };

    const drawSpectralBars = (time:number) => {
      context.save();
      context.globalCompositeOperation=composite;
      const horizon=height*.72;
      for (let i=0;i<150;i+=1) {
        const x=i/(149)*width;
        const edge=Math.abs(x/width-.5)*2;
        const signal=Math.pow(Math.abs(Math.sin(i*2.731)),9);
        const bar=(7+signal*(25+edge*92))*(.9+.1*Math.sin(time*.7+i));
        const color=x<width*.56?colors.cyan:colors.violet;
        context.fillStyle=rgba(color,.11+signal*.38);
        context.fillRect(x,horizon-bar,Math.max(.55,width/2200),bar);
      }
      context.restore();
    };

    const drawMolecules = (time:number) => {
      if (width<650) return;
      const projected=moleculeNodes.map(node=>({
        ...node,
        px:node.x*width+Math.sin(time*.26+node.phase)*11,
        py:node.y*height+Math.cos(time*.22+node.phase)*8,
      }));
      context.save();
      context.globalCompositeOperation=composite;
      for (const [a,b] of moleculeBonds) {
        const from=projected[a],to=projected[b];
        const gradient=context.createLinearGradient(from.px,from.py,to.px,to.py);
        gradient.addColorStop(0,rgba(from.color===2?colors.violet:colors.cyan,.42));
        gradient.addColorStop(1,rgba(to.color===2?colors.violet:colors.blue,.25));
        context.strokeStyle=gradient;
        context.lineWidth=.65;
        context.beginPath();context.moveTo(from.px,from.py);context.lineTo(to.px,to.py);context.stroke();
      }
      for (const node of projected) {
        const radius=node.r*(.92+.08*Math.sin(time*.52+node.phase));
        const color=node.color===0?colors.cyan:node.color===1?colors.blue:colors.violet;
        context.shadowColor=rgba(color,.9);context.shadowBlur=radius*1.35;
        const gradient=context.createRadialGradient(node.px-radius*.35,node.py-radius*.42,1,node.px,node.py,radius);
        gradient.addColorStop(0,'rgba(255,255,255,.95)');gradient.addColorStop(.2,rgba(color,.95));gradient.addColorStop(1,rgba(color,.16));
        context.fillStyle=gradient;context.beginPath();context.arc(node.px,node.py,radius,0,TAU);context.fill();
      }
      context.shadowBlur=0;
      context.restore();
    };

    const draw = (now:number) => {
      const delta=Math.min(32,now-last);last=now;
      if (!reduced) elapsed+=delta/1000;
      context.clearRect(0,0,width,height);
      context.globalCompositeOperation='source-over';
      const background=context.createLinearGradient(0,0,0,height);
      if (theme === 'dark') {
        background.addColorStop(0,'#01040a');background.addColorStop(.54,'#03101b');background.addColorStop(1,'#02050a');
      } else {
        background.addColorStop(0,'#f5fbfc');background.addColorStop(.52,'#e8f5f7');background.addColorStop(1,'#dceef2');
      }
      context.fillStyle=background;context.fillRect(0,0,width,height);
      drawStars(elapsed);drawAurora(elapsed);drawWaves(elapsed);drawMolecules(elapsed);drawSpectralBars(elapsed);drawCarpet(elapsed);
      if (running&&!reduced) frame=requestAnimationFrame(draw);
    };
    const visibility = () => {
      running=!document.hidden;
      if (running&&!reduced) { last=performance.now();cancelAnimationFrame(frame);frame=requestAnimationFrame(draw); }
    };
    resize();draw(last);
    window.addEventListener('resize',resize);
    document.addEventListener('visibilitychange',visibility);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);};
  },[theme]);

  return <div className="landing-sci-fi" aria-hidden="true"><canvas ref={canvasRef}/></div>;
}
