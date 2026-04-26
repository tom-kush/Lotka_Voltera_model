import asyncio
import json
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import List, Dict

app = FastAPI()

SPEED_MIN = 0.05
SPEED_MAX = 5.0


def speed_to_dt(speed: float) -> float:
    speed = max(SPEED_MIN, min(SPEED_MAX, float(speed)))
    return speed * 0.005

# Simulation State
class Simulation:
    def __init__(self):
        self.species = [] 
        self.interaction_matrix = [] 
        self.current_populations = []
        self.time = 0.0
        self.is_running = False
        self.dt = 0.005 # Fixed delta-time for stability and slowness

    def update_config(self, data):
        self.species = data.get("species", [])
        self.interaction_matrix = np.array(data.get("interaction_matrix", []), dtype=float)
        
        if len(self.current_populations) == 0:
            self.current_populations = np.array([s["initial_pop"] for s in self.species], dtype=float)
        
        # Speed directly scales the delta-time
        speed = data.get("speed", 0.5)
        self.dt = speed_to_dt(speed)

    def step(self):
        if len(self.current_populations) == 0 or len(self.species) == 0:
            return
        
        # Simple Euler Step for extreme slowness and control
        # dNr/dt = (eps_r + sum(A_sr * N_s)) * N_r
        N = self.current_populations
        eps = np.array([s["eps"] for s in self.species])
        
        # Matrix multiplication for interaction effects
        interactions = self.interaction_matrix @ N
        
        # Calculate derivative
        dN_dt = (eps + interactions) * N
        
        # Apply step
        self.current_populations = N + dN_dt * self.dt
        
        # Floor at zero (extinction)
        self.current_populations = np.maximum(self.current_populations, 0)
        self.time += self.dt

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
                    await websocket.send_json({"type": "STATUS", "payload": {"is_running": True}})
                elif msg["type"] == "PAUSE":
                    sim.is_running = False
                    await websocket.send_json({"type": "STATUS", "payload": {"is_running": False}})
                elif msg["type"] == "RESET":
                    sim.time = 0.0
                    sim.current_populations = np.array([s["initial_pop"] for s in sim.species], dtype=float)
                    sim.is_running = False
                    await websocket.send_json({"type": "STATUS", "payload": {"is_running": False}})

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
