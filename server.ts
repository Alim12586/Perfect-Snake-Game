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
  const MAX_FOOD = 100;
  const GRID_SIZE = 2000;

  function spawnFood() {
    return {
      id: Math.random().toString(36).substring(2, 9),
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
      color: `hsl(${Math.random() * 360}, 70%, 50%)`,
      size: 5 + Math.random() * 5,
    };
  }

  // Initial food
  for (let i = 0; i < MAX_FOOD; i++) {
    foods.push(spawnFood());
  }

  io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    socket.on("join", (playerData) => {
      players[socket.id] = {
        ...playerData,
        id: socket.id,
      };
      socket.emit("init", { players, foods });
      socket.broadcast.emit("playerJoined", players[socket.id]);
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
        foods.splice(index, 1);
        const newFood = spawnFood();
        foods.push(newFood);
        io.emit("foodUpdated", { removedId: foodId, added: newFood });
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
