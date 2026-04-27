import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Plus, Settings2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';

interface Species {
  name: string;
  color: string;
  initial_pop: number;
  eps: number;
}

interface HistoryPoint {
  time: number;
  [key: string]: number;
}

const SPEED_MIN = 0.05;
const SPEED_MAX = 5;
const SPEED_STEP = 0.05;

const clampSpeed = (value: number) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));

const App: React.FC = () => {
  const [species, setSpecies] = useState<Species[]>([
    { name: 'Prey', color: '#22c55e', initial_pop: 40, eps: 2.0 },
    { name: 'Predator', color: '#ef4444', initial_pop: 10, eps: -2.0 }
  ]);
  const [matrix, setMatrix] = useState<(number | string)[][]>([
    [0, -0.1],
    [0.1, 0]
  ]);
  const [populations, setPopulations] = useState<number[]>([40, 9]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeed] = useState(1); 
  const [status, setStatus] = useState('Disconnected');
  const [backendVersion, setBackendVersion] = useState('');
  
  const ws = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<{x: number, y: number, vx: number, vy: number, speciesIdx: number}[]>([]);

  // Safety check for populations and matrix array
  useEffect(() => {
    if (matrix.length !== species.length) {
      const newMatrix = Array(species.length).fill(0).map((_, r) => 
        Array(species.length).fill(0).map((_, c) => {
          if (matrix[r] && matrix[r][c] !== undefined) return matrix[r][c];
          return 0;
        })
      );
      setMatrix(newMatrix);
    }
  }, [species]);

  // Canvas Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrame: number;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Scale the visual cap with canvas size so species can show many more dots
      // while keeping rendering cost bounded.
      const speciesCount = Math.max(species.length, 1);
      const totalParticleCap = Math.max(1200, Math.floor((canvas.width * canvas.height) / 220));
      const perSpeciesCap = Math.max(300, Math.floor(totalParticleCap / speciesCount));
      
      species.forEach((_s, idx) => {
        const targetCount = Math.min(Math.floor(populations[idx] || 0), perSpeciesCap);
        const currentParticles = particles.current.filter(p => p.speciesIdx === idx);
        
        if (currentParticles.length < targetCount) {
          for (let i = 0; i < targetCount - currentParticles.length; i++) {
            particles.current.push({
              x: Math.random() * canvas.width,
              y: Math.random() * canvas.height,
              vx: (Math.random() - 0.5) * 0.25,
              vy: (Math.random() - 0.5) * 0.25,
              speciesIdx: idx
            });
          }
        } else if (currentParticles.length > targetCount) {
          let removed = 0;
          particles.current = particles.current.filter(p => {
            if (p.speciesIdx === idx && removed < currentParticles.length - targetCount) {
              removed++;
              return false;
            }
            return true;
          });
        }
      });

      particles.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        ctx.fillStyle = species[p.speciesIdx]?.color || '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationFrame);
  }, [populations, species]);

  const sendConfig = (socket: WebSocket | null = ws.current) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const sanitizedMatrix = matrix.map(row => 
        row.map(val => {
          const num = typeof val === 'string' ? parseFloat(val) : val;
          return isNaN(num) ? 0 : num;
        })
      );
      socket.send(JSON.stringify({
        type: 'CONFIG',
        payload: { species, interaction_matrix: sanitizedMatrix, speed }
      }));
    }
  };

  // WebSocket Setup
  useEffect(() => {
    const connect = () => {
      const socket = new WebSocket('ws://localhost:8000/ws');
      socket.onopen = () => {
        setStatus('Connected');
        ws.current = socket;
        sendConfig(socket);
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'UPDATE') {
          setPopulations(msg.payload.populations);
          const newPoint: HistoryPoint = { time: msg.payload.time };
          msg.payload.populations.forEach((p: number, i: number) => {
            if (species[i]) newPoint[species[i].name] = p;
          });
          setHistory(prev => {
            // 1. Throttle: Only add to history if simulation time has advanced significantly
            // This prevents the graph from being "over-saturated" at slow speeds.
            const lastPoint = prev[prev.length - 1];
            if (lastPoint && msg.payload.time - lastPoint.time < 0.01) {
              return prev;
            }

            const next = [...prev, newPoint];
            // 2. Progressive Downsampling: When full, keep every 2nd point.
            // This doubles the time span while keeping the point count at ~2500.
            if (next.length > 5000) {
              return next.filter((_, i) => i % 2 === 0);
            }
            return next;
          });
        } else if (msg.type === 'STATUS') {
          setIsRunning(msg.payload.is_running);
          if (msg.payload.version) setBackendVersion(msg.payload.version);
        }
      };
      socket.onclose = () => {
        setStatus('Disconnected');
        setTimeout(connect, 2000);
      };
    };
    connect();
    return () => ws.current?.close();
  }, []);

  // Debounced config sync
  useEffect(() => {
    const timer = setTimeout(() => {
      sendConfig();
    }, 300);
    return () => clearTimeout(timer);
  }, [species, matrix]);

  // Immediate speed sync
  useEffect(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'SET_SPEED', payload: speed }));
    }
  }, [speed]);

  const handleStart = () => {
    setIsRunning(true);
    ws.current?.send(JSON.stringify({ type: 'START' }));
  };
  const handlePause = () => {
    setIsRunning(false);
    ws.current?.send(JSON.stringify({ type: 'PAUSE' }));
  };
  const handleReset = () => {
    setIsRunning(false);
    ws.current?.send(JSON.stringify({ type: 'RESET' }));
    setHistory([]);
    setPopulations(species.map(s => s.initial_pop));
  };

  const addSpecies = () => {
    const newSpecies = [...species, { name: `Specie ${species.length + 1}`, color: '#ffffff', initial_pop: 10, eps: 0.5 }];
    setSpecies(newSpecies);
  };

  const updateSpecies = (idx: number, field: keyof Species, val: any) => {
    const next = [...species];
    next[idx] = { ...next[idx], [field]: val };
    setSpecies(next);
  };

  const updateMatrix = (r: number, c: number, val: number | string) => {
    const next = matrix.map(row => [...row]);
    next[r][c] = val;
    setMatrix(next);
  };

  return (
    <div className="h-screen bg-slate-900 text-slate-100 flex flex-col p-4 overflow-hidden text-xs md:text-sm">
      <header className="flex justify-between items-center mb-3 shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            Lotka-Volterra Equations Toy Model
          </h1>
          <p className="text-base text-slate-400 mt-1">by Tulip Kadri, Guy Dar, and Tom Kushilevitz</p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex flex-col items-end">
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${status === 'Connected' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
              {status}
            </span>
            {backendVersion && <span className="text-xs text-slate-500 mt-1">Backend: {backendVersion}</span>}
          </div>
          <div className="flex bg-slate-800 rounded-lg p-1 gap-1 items-center shadow-inner">
            <div className="flex items-center px-2 gap-2 border-r border-slate-700 mr-1">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-tighter">Speed</span>
              <input 
                type="number"
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={SPEED_STEP}
                value={speed}
                onChange={e => {
                  const next = parseFloat(e.target.value);
                  if (!isNaN(next)) {
                    setSpeed(clampSpeed(next));
                  }
                }}
                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm focus:border-blue-500 outline-none"
              />
              <span className="text-xs text-slate-500">x</span>
            </div>
            <button 
              onClick={handleStart} 
              className={`p-1.5 rounded transition-all ${isRunning ? 'bg-emerald-500/30 text-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.3)]' : 'hover:bg-slate-700 text-slate-400'}`}
              title="Start Simulation"
            >
              <Play size={14} fill={isRunning ? "currentColor" : "none"} />
            </button>
            <button 
              onClick={handlePause} 
              className={`p-1.5 rounded transition-all ${!isRunning && history.length > 0 ? 'bg-amber-500/30 text-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.3)]' : 'hover:bg-slate-700 text-slate-400'}`}
              title="Pause Simulation"
            >
              <Pause size={14} fill={!isRunning && history.length > 0 ? "currentColor" : "none"} />
            </button>
            <button onClick={handleReset} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 transition-colors" title="Reset Simulation"><RotateCcw size={14} /></button>
          </div>
        </div>
      </header>

      <main className="flex gap-4 md:gap-6 flex-1 min-h-0">
        <div className="flex-[2] flex flex-col gap-4 min-w-0">
          <div className="flex gap-4 flex-1 min-h-0 max-h-[42vh]">
            <div className="flex-1 bg-slate-800 rounded-xl overflow-hidden border border-slate-700 relative shadow-xl">
              <canvas ref={canvasRef} width={800} height={400} className="w-full h-full object-contain" />
              <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[90%] pointer-events-none">
                {species.map((s, i) => (
                  <div key={i} className="bg-slate-900/90 backdrop-blur px-2 py-0.5 rounded border border-slate-700 flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shadow-[0_0_5px_currentColor]" style={{ backgroundColor: s.color, color: s.color }} />
                    <span className="text-xs font-bold uppercase tracking-tight">{s.name}: {Math.floor(populations[i] || 0)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 bg-slate-800 rounded-xl p-3 border border-slate-700 shadow-xl flex flex-col min-h-0">
              <h3 className="text-sm font-bold text-slate-300 mb-2 text-center">Prey vs Predator</h3>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart data={history} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis type="number" dataKey={species[0]?.name || 'Prey'} stroke="#acacd0" fontSize={11} tickFormatter={(value: number) => value.toFixed(1)} name={species[0]?.name || 'Prey'} label={{ value: species[0]?.name || 'Prey', position: 'insideBottomRight', offset: -5, fill: '#64748b', fontSize: 11 }} />
                    <YAxis type="number" dataKey={species[1]?.name || 'Predator'} stroke="#acacd0" fontSize={11} tickFormatter={(value: number) => value.toFixed(1)} name={species[1]?.name || 'Predator'} label={{ value: species[1]?.name || 'Predator', angle: -90, position: 'insideLeft', offset: 5, fill: '#64748b', fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) => value.toFixed(2)}
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <Scatter
                      name="Phase Space"
                      dataKey={species[1]?.name || 'Predator'}
                      fill="#8b5cf6"
                      shape={(props: any) => <circle {...props} r={1.5} />}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 shadow-xl flex-1 min-h-0 max-h-[38vh] flex flex-col">
            <h3 className="text-sm font-bold text-slate-300 mb-2 text-center">Population over Time</h3>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickCount={8} domain={[0, 'dataMax']} type="number" tickFormatter={(value: number) => value.toFixed(1)} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(value: number) => value.toFixed(1)} />
                  <Tooltip
                    labelFormatter={(label: number) => `t=${label.toFixed(2)}`}
                    formatter={(value: number) => value.toFixed(2)}
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '4px', fontSize: '12px' }}
                  />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  {species.map((s, i) => (
                    <Line key={i} type="monotone" dataKey={s.name} stroke={s.color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="flex-1 bg-slate-800 rounded-xl p-4 border border-slate-700 shadow-xl flex flex-col gap-4 overflow-y-auto min-w-[280px]">
          <div className="flex justify-between items-center shrink-0">
            <h2 className="text-base font-bold flex items-center gap-2 uppercase tracking-widest text-slate-400"><Settings2 size={16} /> Config</h2>
            <button onClick={addSpecies} className="p-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm"><Plus size={14} /></button>
          </div>

          <div className="flex flex-col gap-2">
            {species.map((s, i) => (
              <div key={i} className="p-3 bg-slate-900/50 rounded-lg border border-slate-700 flex flex-col gap-3 transition-colors hover:border-slate-600">
                <div className="flex gap-2">
                  <input type="color" value={s.color} onChange={e => updateSpecies(i, 'color', e.target.value)} className="w-8 h-8 bg-transparent cursor-pointer rounded shrink-0 overflow-hidden" />
                  <input type="text" value={s.name} onChange={e => updateSpecies(i, 'name', e.target.value)} className="bg-slate-800/50 border-none rounded px-2 py-1.5 flex-1 text-base font-semibold focus:ring-1 focus:ring-blue-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-slate-500 mb-1 block uppercase font-bold tracking-tighter text-xs">Initial Pop</label>
                    <input type="number" value={s.initial_pop} onChange={e => updateSpecies(i, 'initial_pop', parseFloat(e.target.value))} className="w-full bg-slate-800/50 border border-slate-700 rounded px-2 py-1.5 text-sm focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-slate-500 mb-1 block uppercase font-bold tracking-tighter text-xs">Rate (ε)</label>
                    <input type="number" step="0.1" value={s.eps} onChange={e => updateSpecies(i, 'eps', parseFloat(e.target.value))} className="w-full bg-slate-800/50 border border-slate-700 rounded px-2 py-1.5 text-sm focus:border-blue-500 outline-none" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 shrink-0 border-t border-slate-700 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-3 text-center">Interactions (A)</h3>
            <div className="overflow-x-auto pb-2">
              <table className="w-full text-xs text-center border-collapse">
                <thead>
                  <tr>
                    <th className="p-1.5 opacity-40 font-normal italic">On ↓ / By →</th>
                    {species.map((s, i) => <th key={i} className="p-1.5" style={{ color: s.color }}>{s.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {species.map((s_r, r) => (
                    <tr key={r} className="hover:bg-slate-800/30">
                      <td className="p-1.5 font-bold text-left" style={{ color: s_r.color }}>{s_r.name}</td>
                      {species.map((_s_s, s) => (
                        <td key={s} className="p-1.5">
                          <input 
                            type="text" 
                            value={matrix[r]?.[s] ?? ''} 
                            onChange={e => {
                              const v = e.target.value;
                              if (v === '' || v === '-' || v === '.' || v === '-.' || v.endsWith('.')) {
                                const next = matrix.map(row => [...row]);
                                next[r][s] = v;
                                setMatrix(next);
                              } else {
                                const num = parseFloat(v);
                                if (!isNaN(num)) updateMatrix(r, s, v);
                              }
                            }}
                            className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-sm text-center focus:border-blue-500 outline-none"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 p-4 bg-slate-900/50 rounded-xl border border-slate-700 shadow-inner group hover:border-blue-500/50 transition-colors">
              <div className="text-lg md:text-xl font-serif text-slate-300 text-center italic tracking-wide">
                <span className="inline-flex flex-col items-center align-middle leading-none mx-1 not-italic">
                  <span>dN<sub>r</sub></span>
                  <span className="w-full border-t border-slate-400 mt-0.5 pt-0.5 text-[0.9em]">dt</span>
                </span>
                <span className="ml-1">= (ε<sub>r</sub> + Σ<sub>s</sub> A<sub>rs</sub> N<sub>s</sub>) N<sub>r</sub></span>
              </div>
              <div className="text-[10px] text-slate-500 text-center mt-2 uppercase tracking-[0.2em] font-bold opacity-50">
                Lotka-Volterra equations
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
