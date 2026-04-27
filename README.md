# Lotka-Volterra Equations Toy Model

An interactive predator-prey ecosystem simulator with:

- A Python FastAPI backend that integrates a generalized Lotka-Volterra system in real time.
- A React + TypeScript frontend with live controls and visualizations.
- WebSocket streaming between backend and frontend for low-latency updates.

Current release:

- Version: 1.1.1-STABLE

## What This Project Does

You can define multiple species, tune intrinsic growth/decay rates and pairwise interactions, and watch how populations evolve.

The app provides three synchronized views:

1. Dot simulation (left): intuitive spatial animation of species populations.
2. Phase-space plot (top-right): prey population on x-axis vs predator population on y-axis.
3. Time-series plot (bottom): each species population as a function of time.

## Mathematical Model

The backend simulates a generalized Lotka-Volterra (GLV) system:

- For species r with population N_r:

  dN_r/dt = (eps_r + sum_s A_rs * N_s) * N_r

Where:

- eps_r is the intrinsic growth/decay rate.
- A_rs is the interaction matrix entry (effect of species s on species r).

## Numerical Integration

The solver is implemented in backend/main.py.

### Current approach

- Speed from UI is converted to dt by:
  - dt = speed * 0.005
  - speed is clamped to [0.05, 5.0]
- Integration uses a symmetric (symplectic) midpoint rule in log-space with fixed-point iterations:
  - Integrates L = log(N) instead of N directly.
  - Implicit midpoint update is solved by short fixed-point iteration each substep.
  - Internal substep target: 0.02

Runtime update cadence:

- While running, backend emits UPDATE frames approximately every 0.01 seconds.

### Why log-space symmetric midpoint

- Preserves positivity naturally (N = exp(L)).
- Significantly reduces high-speed drift compared to plain Euler.
- More stable for oscillatory predator-prey behavior over long runs.

## Project Structure

- backend/
  - main.py: FastAPI app, WebSocket endpoint, simulation loop, GLV integrator
  - requirements.txt: Python dependencies
- frontend/
  - src/App.tsx: main UI, charts, controls, WebSocket client
  - package.json: frontend scripts and dependencies
- run.ps1: starts backend and frontend, opens browser
- run.bat: Windows wrapper for run.ps1

## Runtime Architecture

### Backend (FastAPI + WebSocket)

- Accepts a WebSocket connection at /ws
- Receives control/config messages from frontend:
  - CONFIG
  - SET_SPEED
  - START
  - PAUSE
  - RESET
- Sends:
  - UPDATE (time + populations)
  - STATUS (running/paused state + backend version)

### Frontend (React + Recharts)

- Opens ws://localhost:8000/ws
- Streams updates into local state:
  - populations for current values
  - history for charts
- Sends user edits and control actions back to backend

## Dot Simulation vs Graphs

The dot simulation is intentionally visual/approximate:

- Uses floor(population) for integer dot counts.
- Uses a per-species visual cap for performance.

The graphs are intended to reflect numerical state more faithfully:

- History now stores unrounded backend values.
- Axis ticks/tooltips are formatted for readability only.

## Interaction Matrix Behavior

The interaction matrix is edited directly in the UI. Entries are not auto-mirrored, so asymmetric interactions are supported.

## Speed Control

UI speed input:

- Min: 0.05
- Max: 5.0
- Step: 0.05
- Default: 1.0

Backend mapping:

- dt = speed * 0.005

Higher speed means larger external dt, but internal substepping in the solver helps maintain numerical quality.

## How To Run

## Option A: one-command runner (Windows)

1. From project root, run:
   - .\run.bat
   - or .\run.ps1
2. The script starts backend and frontend and opens http://localhost:5173

## Option B: manual

### Backend

1. Open a terminal in backend/
2. Install dependencies:
   - pip install -r requirements.txt
3. Start server:
   - python main.py

### Frontend

1. Open another terminal in frontend/
2. Install dependencies:
   - npm install
3. Start dev server:
   - npm run dev
4. Open the shown local URL (usually http://localhost:5173)

## Dependencies

### Backend

- fastapi
- uvicorn
- numpy
- scipy
- websockets
- python-multipart

### Frontend

Key runtime dependencies:

- react
- react-dom
- recharts
- lucide-react

## Troubleshooting

### Frontend shows Disconnected

- Ensure backend is running on port 8000.
- Check WebSocket URL in frontend/src/App.tsx (ws://localhost:8000/ws).

### No browser opens from run.ps1

- Start frontend manually with npm run dev and open the URL directly.

### Drift or strange high-speed behavior

- Lower speed first to validate baseline dynamics.
- The current solver is already stabilized (log-space symmetric midpoint + substeps), but extremely stiff parameter sets can still require tighter internal step caps.

## Notes and Limitations

- This is an interactive toy model focused on intuition and experimentation.
- The dot animation is not meant to be a strict particle simulation of the ODE state.
- Very aggressive parameters can produce stiff dynamics that challenge fixed-step integrators.

## Credits

UI subtitle credits:

- Tulip Kadri
- Guy Dar
- Tom Kushilevitz
