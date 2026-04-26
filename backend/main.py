import asyncio
import json
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import List, Dict

app = FastAPI()

VERSION = "1.1.0-SYMMETRIC"
print(f"--- Starting Lotka-Volterra Backend {VERSION} ---")

SPEED_MIN = 0.05
SPEED_MAX = 5.0
MIN_POPULATION = 1e-12

def speed_to_dt(speed: float) -> float:
    speed = max(SPEED_MIN, min(SPEED_MAX, float(speed)))
    return speed * 0.005

class Simulation:
    def __init__(self):
        self.species = [] 
        self.interaction_matrix = [] 
        self.log_populations = np.array([], dtype=float)
        self.time = 0.0
        self.is_running = False
        self.dt = 0.005 

    @property
    def current_populations(self):
        if len(self.log_populations) == 0:
            return np.array([], dtype=float)
        return np.exp(self.log_populations)

    def update_config(self, data):
        new_species = data.get("species", [])
        self.interaction_matrix = np.array(data.get("interaction_matrix", []), dtype=float)
        
        # If species count changed or nothing initialized, (re)initialize log_populations
        if len(self.log_populations) != len(new_species):
            initial_pops = np.array([s["initial_pop"] for s in new_species], dtype=float)
            self.log_populations = np.log(np.maximum(initial_pops, MIN_POPULATION))
        
        self.species = new_species
        speed = data.get("speed", 0.5)
        self.dt = speed_to_dt(speed)

    def step(self):
        if len(self.log_populations) == 0 or len(self.species) == 0:
            return

        eps = np.array([s["eps"] for s in self.species], dtype=float)
        matrix = self.interaction_matrix
        
        # We use a Symmetric (Symplectic) Midpoint Rule to preserve 
        # the Hamiltonian-like structure of the GLV system in log-space.
        # This eliminates the "spiraling" drift seen in Euler/standard RK.
        
        # Substepping for numerical robustness at high speeds
        total_dt = self.dt
        target_substep_dt = 0.0005
        n_steps = max(1, int(np.ceil(total_dt / target_substep_dt)))
        h = total_dt / n_steps
        
        L = self.log_populations
        for _ in range(n_steps):
            L_old = L
            # Fixed-point iteration for the implicit midpoint rule
            # L_next = L_old + h * f((L_old + L_next)/2)
            L_next = L_old + h * (eps + (matrix @ np.exp(L_old))) # Euler guess
            for _ in range(4):
                L_mid = (L_old + L_next) / 2.0
                L_next = L_old + h * (eps + (matrix @ np.exp(L_mid)))
            L = L_next

        self.log_populations = L
        self.time += total_dt

sim = Simulation()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            try:
                # Check for incoming messages
                raw_data = await asyncio.wait_for(websocket.receive_text(), timeout=0.01)
                msg = json.loads(raw_data)
                
                if msg["type"] == "CONFIG":
                    sim.update_config(msg["payload"])
                elif msg["type"] == "SET_SPEED":
                    sim.dt = speed_to_dt(msg["payload"])
                elif msg["type"] == "START":
                    sim.is_running = True
                    await websocket.send_json({"type": "STATUS", "payload": {"is_running": True, "version": VERSION}})
                elif msg["type"] == "PAUSE":
                    sim.is_running = False
                    await websocket.send_json({"type": "STATUS", "payload": {"is_running": False, "version": VERSION}})
                elif msg["type"] == "RESET":
                    sim.time = 0.0
                    initial_pops = np.array([s["initial_pop"] for s in sim.species], dtype=float)
                    sim.log_populations = np.log(np.maximum(initial_pops, MIN_POPULATION))
                    sim.is_running = False
                    await websocket.send_json({"type": "STATUS", "payload": {"is_running": False, "version": VERSION}})

            except asyncio.TimeoutError:
                pass

            if sim.is_running:
                sim.step()
                await websocket.send_json({
                    "type": "UPDATE",
                    "payload": {
                        "time": sim.time,
                        "populations": sim.current_populations.tolist()
                    }
                })
                # High-frequency updates for smooth phase space visualization
                await asyncio.sleep(0.001) 
            else:
                await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Error: {e}")
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
