import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = 3000;

  // Game state
  const players: Record<string, any> = {};
  const foods: any[] = [];
  const powerups: any[] = [];
  const obstacles: any[] = [];
  const teamScores: Record<string, number> = { red: 0, blue: 0 };
  
  let config = {
    gridSize: 2000,
    maxFood: 100,
    maxPowerups: 5,
    maxObstacles: 15,
    initialSegments: 5,
    baseSpeed: 3,
    boostSpeed: 6,
    isTeamMode: true,
  };

  function spawnFood() {
    return {
      id: Math.random().toString(36).substring(2, 9),
      x: Math.floor(Math.random() * config.gridSize),
      y: Math.floor(Math.random() * config.gridSize),
      color: `hsl(${Math.random() * 360}, 70%, 50%)`,
      size: 5 + Math.random() * 5,
    };
  }

  function spawnPowerup() {
    const types = ["speed", "invincibility", "magnet", "multiplier"];
    const type = types[Math.floor(Math.random() * types.length)];
    return {
      id: Math.random().toString(36).substring(2, 9),
      x: Math.floor(Math.random() * config.gridSize),
      y: Math.floor(Math.random() * config.gridSize),
      type,
      color: type === "speed" ? "#fbbf24" : type === "invincibility" ? "#8b5cf6" : type === "magnet" ? "#ec4899" : "#10b981",
    };
  }

  function spawnObstacle() {
    const isMoving = Math.random() > 0.7;
    const size = 40 + Math.random() * 60;
    return {
      id: Math.random().toString(36).substring(2, 9),
      x: Math.floor(Math.random() * (config.gridSize - size)),
      y: Math.floor(Math.random() * (config.gridSize - size)),
      width: size,
      height: size,
      isMoving,
      velocity: isMoving ? { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4 } : { x: 0, y: 0 },
      color: isMoving ? "#ef4444" : "#4b5563",
    };
  }

  // Initial state
  for (let i = 0; i < config.maxFood; i++) {
    foods.push(spawnFood());
  }
  for (let i = 0; i < config.maxPowerups; i++) {
    powerups.push(spawnPowerup());
  }
  for (let i = 0; i < config.maxObstacles; i++) {
    obstacles.push(spawnObstacle());
  }

  // Update moving obstacles
  setInterval(() => {
    obstacles.forEach(obs => {
      if (obs.isMoving) {
        obs.x += obs.velocity.x;
        obs.y += obs.velocity.y;

        // Bounce off walls
        if (obs.x <= 0 || obs.x + obs.width >= config.gridSize) obs.velocity.x *= -1;
        if (obs.y <= 0 || obs.y + obs.height >= config.gridSize) obs.velocity.y *= -1;
      }
    });
    io.emit("obstaclesUpdated", obstacles);
  }, 50);

  io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    socket.on("join", (playerData) => {
      players[socket.id] = {
        ...playerData,
        id: socket.id,
      };
      socket.emit("init", { players, foods, powerups, obstacles, config, teamScores });
      socket.broadcast.emit("playerJoined", players[socket.id]);
    });

    socket.on("updateSettings", (newConfig) => {
      config = { ...config, ...newConfig };
      
      // Adjust food
      while (foods.length < config.maxFood) {
        const food = spawnFood();
        foods.push(food);
        io.emit("foodAdded", food);
      }
      while (foods.length > config.maxFood) {
        const removed = foods.pop();
        io.emit("foodUpdated", { removedId: removed.id });
      }

      // Adjust powerups
      while (powerups.length < config.maxPowerups) {
        const p = spawnPowerup();
        powerups.push(p);
        io.emit("powerupUpdated", { added: p });
      }
      while (powerups.length > config.maxPowerups) {
        const removed = powerups.pop();
        io.emit("powerupUpdated", { removedId: removed.id });
      }

      // Adjust obstacles
      while (obstacles.length < config.maxObstacles) {
        obstacles.push(spawnObstacle());
      }
      while (obstacles.length > config.maxObstacles) {
        obstacles.pop();
      }

      io.emit("settingsUpdated", config);
    });

    socket.on("update", (playerData) => {
      if (players[socket.id]) {
        players[socket.id] = { ...players[socket.id], ...playerData };
        socket.broadcast.emit("playerUpdated", players[socket.id]);
      }
    });

    socket.on("eatFood", (foodId) => {
      const index = foods.findIndex((f) => f.id === foodId);
      if (index !== -1) {
        const food = foods[index];
        foods.splice(index, 1);
        const newFood = spawnFood();
        foods.push(newFood);
        
        // Update team score if in team mode
        if (config.isTeamMode && players[socket.id]?.team) {
          teamScores[players[socket.id].team] += Math.floor(food.size);
          io.emit("teamScoresUpdated", teamScores);
        }

        io.emit("foodUpdated", { removedId: foodId, added: newFood });
      }
    });

    socket.on("collectPowerup", (powerupId) => {
      const index = powerups.findIndex((p) => p.id === powerupId);
      if (index !== -1) {
        const type = powerups[index].type;
        powerups.splice(index, 1);
        const newPowerup = spawnPowerup();
        powerups.push(newPowerup);
        io.emit("powerupUpdated", { removedId: powerupId, added: newPowerup });
        socket.emit("powerupCollected", type);
      }
    });

    socket.on("playerDied", (killerId) => {
      if (players[socket.id]) {
        const deadPlayer = players[socket.id];
        // Turn dead player segments into food
        deadPlayer.segments.forEach((seg: any) => {
          if (Math.random() > 0.5) {
            const food = {
              id: Math.random().toString(36).substring(2, 9),
              x: seg.x,
              y: seg.y,
              color: deadPlayer.color,
              size: 8,
            };
            foods.push(food);
            io.emit("foodAdded", food);
          }
        });

        delete players[socket.id];
        io.emit("playerLeft", socket.id);
      }
    });

    socket.on("chatMessage", (message) => {
      const chatMsg = {
        id: Math.random().toString(36).substring(2, 9),
        sender: players[socket.id]?.name || "Spectator",
        text: message.slice(0, 200),
        timestamp: Date.now(),
      };
      io.emit("chatMessage", chatMsg);
    });

    socket.on("disconnect", () => {
      console.log("Player disconnected:", socket.id);
      delete players[socket.id];
      io.emit("playerLeft", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
