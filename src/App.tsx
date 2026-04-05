import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";
import type { Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, Users, Zap, MousePointer2 } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const GRID_SIZE = 2000;
const INITIAL_SEGMENTS = 5;
const SEGMENT_SPACING = 15;
const BASE_SPEED = 3;
const BOOST_SPEED = 6;

interface Point {
  x: number;
  y: number;
}

interface Player {
  id: string;
  name: string;
  color: string;
  score: number;
  segments: Point[];
  angle: number;
  isBoosting: boolean;
}

interface Food {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
}

export default function App() {
  const [socket, setSocket] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [foods, setFoods] = useState<Food[]>([]);
  const [me, setMe] = useState<Player | null>(null);
  const [gameState, setGameState] = useState<"menu" | "playing" | "dead" | "spectating">("menu");
  const [playerName, setPlayerName] = useState("");
  const [leaderboard, setLeaderboard] = useState<Player[]>([]);
  const [spectateTargetId, setSpectateTargetId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const mouseRef = useRef<Point>({ x: 0, y: 0 });
  const lastUpdateTime = useRef<number>(0);

  // Initialize socket
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("connect", () => setIsConnected(true));
    newSocket.on("disconnect", () => setIsConnected(false));

    newSocket.on("init", ({ players, foods }) => {
      setPlayers(players);
      setFoods(foods);
    });

    newSocket.on("playerJoined", (player) => {
      setPlayers((prev) => ({ ...prev, [player.id]: player }));
    });

    newSocket.on("playerUpdated", (player) => {
      setPlayers((prev) => ({ ...prev, [player.id]: player }));
    });

    newSocket.on("playerLeft", (id) => {
      setPlayers((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });

    newSocket.on("foodUpdated", ({ removedId, added }) => {
      setFoods((prev) => {
        const next = prev.filter((f) => f.id !== removedId);
        if (added) next.push(added);
        return next;
      });
    });

    newSocket.on("foodAdded", (food) => {
      setFoods((prev) => [...prev, food]);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Handle spectate target changes without reconnecting
  useEffect(() => {
    if (gameState === "spectating" && spectateTargetId && !players[spectateTargetId]) {
      setSpectateTargetId(null);
    }
  }, [players, gameState, spectateTargetId]);

  // Update leaderboard
  useEffect(() => {
    const sorted = (Object.values(players) as Player[]).sort((a, b) => b.score - a.score);
    setLeaderboard(sorted.slice(0, 10));
    
    // Auto-follow leader if spectating and no target
    if (gameState === "spectating" && !spectateTargetId && sorted.length > 0) {
      setSpectateTargetId(sorted[0].id);
    }
  }, [players, gameState, spectateTargetId]);

  const joinGame = () => {
    if (!socket || !playerName.trim()) return;
    const color = `hsl(${Math.random() * 360}, 70%, 50%)`;
    const startPos = { x: Math.random() * GRID_SIZE, y: Math.random() * GRID_SIZE };
    const segments = Array.from({ length: INITIAL_SEGMENTS }, (_, i) => ({
      x: startPos.x - i * SEGMENT_SPACING,
      y: startPos.y,
    }));

    const initialPlayer: Player = {
      id: socket.id!,
      name: playerName,
      color,
      score: 0,
      segments,
      angle: 0,
      isBoosting: false,
    };

    setMe(initialPlayer);
    setGameState("playing");
    setSpectateTargetId(null);
    socket.emit("join", initialPlayer);
  };

  const startSpectating = () => {
    setGameState("spectating");
    if (leaderboard.length > 0) {
      setSpectateTargetId(leaderboard[0].id);
    }
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = clientX - rect.left - canvas.width / 2;
    const y = clientY - rect.top - canvas.height / 2;
    mouseRef.current = { x, y };
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.code === "Space" || e.code === "ShiftLeft") {
      setMe((prev) => prev ? { ...prev, isBoosting: true } : null);
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.code === "Space" || e.code === "ShiftLeft") {
      setMe((prev) => prev ? { ...prev, isBoosting: false } : null);
    }
  };

  const gameLoop = useCallback((time: number) => {
    if (gameState === "menu" || !socket) return;

    const dt = time - (lastUpdateTime.current || time);
    lastUpdateTime.current = time;

    let cameraTarget: Point | null = null;

    if (gameState === "playing" && me) {
      // Update angle based on mouse
      const targetAngle = Math.atan2(mouseRef.current.y, mouseRef.current.x);
      const angleDiff = targetAngle - me.angle;
      const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      const newAngle = me.angle + normalizedDiff * 0.1;

      // Move head
      const speed = me.isBoosting ? BOOST_SPEED : BASE_SPEED;
      const head = me.segments[0];
      const newHead = {
        x: (head.x + Math.cos(newAngle) * speed + GRID_SIZE) % GRID_SIZE,
        y: (head.y + Math.sin(newAngle) * speed + GRID_SIZE) % GRID_SIZE,
      };

      // Update segments
      const newSegments = [newHead];
      let lastPos = newHead;
      for (let i = 1; i < me.segments.length; i++) {
        const seg = me.segments[i];
        const dx = lastPos.x - seg.x;
        const dy = lastPos.y - seg.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > SEGMENT_SPACING) {
          const angle = Math.atan2(dy, dx);
          newSegments.push({
            x: lastPos.x - Math.cos(angle) * SEGMENT_SPACING,
            y: lastPos.y - Math.sin(angle) * SEGMENT_SPACING,
          });
        } else {
          newSegments.push(seg);
        }
        lastPos = newSegments[i];
      }

      // Check collisions with food
      let newScore = me.score;
      let segmentsToAdd = 0;
      foods.forEach((food) => {
        const dx = newHead.x - food.x;
        const dy = newHead.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 20 + food.size) {
          socket.emit("eatFood", food.id);
          newScore += Math.floor(food.size);
          segmentsToAdd += 1;
        }
      });

      if (segmentsToAdd > 0) {
        for (let i = 0; i < segmentsToAdd; i++) {
          const last = newSegments[newSegments.length - 1];
          newSegments.push({ ...last });
        }
      }

      // Check collisions with other players
      let died = false;
      Object.entries(players).forEach(([id, player]) => {
        if (id === socket.id) return;
        const p = player as Player;

        p.segments.forEach((seg, idx) => {
          const dx = newHead.x - seg.x;
          const dy = newHead.y - seg.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 20) {
            // Collision! Check size
            if (me.segments.length < p.segments.length) {
              died = true;
            }
          }
        });
      });

      if (died) {
        setGameState("dead");
        socket.emit("playerDied");
        return;
      }

      const updatedMe = { ...me, segments: newSegments, angle: newAngle, score: newScore };
      setMe(updatedMe);
      socket.emit("update", updatedMe);
      cameraTarget = newHead;
    } else if (gameState === "spectating" && spectateTargetId) {
      const target = players[spectateTargetId];
      if (target) {
        cameraTarget = target.segments[0];
      } else {
        // If target lost, try to find new one
        if (leaderboard.length > 0) {
          setSpectateTargetId(leaderboard[0].id);
        }
      }
    } else if (gameState === "dead" && me) {
      cameraTarget = me.segments[0];
    }

    // Draw
    const canvas = canvasRef.current;
    if (canvas && cameraTarget) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Camera follow
        ctx.save();
        ctx.translate(canvas.width / 2 - cameraTarget.x, canvas.height / 2 - cameraTarget.y);

        // Draw grid
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        for (let i = 0; i <= GRID_SIZE; i += 100) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, GRID_SIZE);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(GRID_SIZE, i);
          ctx.stroke();
        }

        // Draw food
        foods.forEach((food) => {
          ctx.fillStyle = food.color;
          ctx.beginPath();
          ctx.arc(food.x, food.y, food.size, 0, Math.PI * 2);
          ctx.fill();
          // Glow
          ctx.shadowBlur = 10;
          ctx.shadowColor = food.color;
          ctx.fill();
          ctx.shadowBlur = 0;
        });

        // Draw other players
        Object.values(players).forEach((player) => {
          const p = player as Player;
          if (p.id === socket.id && gameState === "playing") return;
          drawSnake(ctx, p);
        });

        // Draw me if dead or playing
        if (gameState === "playing" && me) {
          drawSnake(ctx, me);
        }

        ctx.restore();
      }
    }

    requestRef.current = requestAnimationFrame(gameLoop);
  }, [gameState, me, socket, players, foods, spectateTargetId, leaderboard]);

  const drawSnake = (ctx: CanvasRenderingContext2D, player: Player) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 20;
    ctx.strokeStyle = player.color;

    ctx.beginPath();
    ctx.moveTo(player.segments[0].x, player.segments[0].y);
    player.segments.forEach((seg) => {
      ctx.lineTo(seg.x, seg.y);
    });
    ctx.stroke();

    // Head
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.segments[0].x, player.segments[0].y, 12, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = "white";
    const eyeOffset = 6;
    const eyeAngle = player.angle;
    ctx.beginPath();
    ctx.arc(
      player.segments[0].x + Math.cos(eyeAngle + 0.5) * eyeOffset,
      player.segments[0].y + Math.sin(eyeAngle + 0.5) * eyeOffset,
      3, 0, Math.PI * 2
    );
    ctx.arc(
      player.segments[0].x + Math.cos(eyeAngle - 0.5) * eyeOffset,
      player.segments[0].y + Math.sin(eyeAngle - 0.5) * eyeOffset,
      3, 0, Math.PI * 2
    );
    ctx.fill();

    // Name
    ctx.fillStyle = "white";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.name, player.segments[0].x, player.segments[0].y - 25);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameLoop]);

  return (
    <div className="relative w-full h-screen bg-neutral-950 overflow-hidden font-sans text-white" onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} tabIndex={0}>
      {/* Game Canvas */}
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="block cursor-none"
        onMouseMove={handleMouseMove}
        onTouchMove={handleMouseMove}
      />

      {/* UI Overlays */}
      <div className="absolute top-4 left-4 pointer-events-none flex flex-col gap-2">
        <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10">
          <Users className="w-5 h-5 text-blue-400" />
          <span className="font-bold">{Object.keys(players).length} Players Online</span>
        </div>
        <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 w-fit">
          <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-green-500" : "bg-red-500 animate-pulse")} />
          <span className="text-[10px] uppercase tracking-widest font-bold text-white/50">
            {isConnected ? "Server Connected" : "Connecting..."}
          </span>
        </div>
      </div>

      <div className="absolute top-4 right-4 w-64 pointer-events-none">
        <div className="bg-black/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
          <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <span className="font-bold uppercase tracking-wider text-sm">Leaderboard</span>
          </div>
          <div className="space-y-2">
            {leaderboard.map((player, i) => (
              <div key={player.id} className={cn("flex justify-between items-center text-sm", player.id === socket?.id && "text-yellow-400 font-bold")}>
                <span className="truncate max-w-[120px]">{i + 1}. {player.name}</span>
                <span>{player.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {me && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <div className="text-4xl font-black tracking-tighter drop-shadow-lg">
              {me.score}
            </div>
            <div className="flex items-center gap-4 text-xs uppercase tracking-widest text-white/50">
              <div className="flex items-center gap-1">
                <Zap className={cn("w-3 h-3", me.isBoosting ? "text-yellow-400" : "text-white/30")} />
                <span>Space to Boost</span>
              </div>
              <div className="flex items-center gap-1">
                <MousePointer2 className="w-3 h-3 text-white/30" />
                <span>Mouse to Move</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Menus */}
      <AnimatePresence>
        {gameState === "menu" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-neutral-950/80 backdrop-blur-xl flex items-center justify-center p-6 z-50"
          >
            <div className="max-w-md w-full space-y-8 text-center">
              <div className="space-y-2">
                <h1 className="text-6xl font-black tracking-tighter bg-gradient-to-br from-white to-white/50 bg-clip-text text-transparent">
                  SNAKE ARENA
                </h1>
                <p className="text-white/50">Multiplayer survival of the longest.</p>
              </div>

              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Enter your name..."
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value.slice(0, 15))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-xl focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                  onKeyDown={(e) => e.key === "Enter" && joinGame()}
                />
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={joinGame}
                    className="bg-white text-black font-bold text-xl py-4 rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Start Game
                  </button>
                  <button
                    onClick={startSpectating}
                    className="bg-white/10 text-white font-bold text-xl py-4 rounded-2xl hover:bg-white/20 transition-all border border-white/10"
                  >
                    Spectate
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-left text-sm text-white/40">
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                  <div className="font-bold text-white/60 mb-1">Eat Food</div>
                  Grow longer and increase your score.
                </div>
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                  <div className="font-bold text-white/60 mb-1">Avoid Giants</div>
                  Small snakes die if they hit larger ones.
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {gameState === "dead" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-red-950/80 backdrop-blur-xl flex items-center justify-center p-6 z-50"
          >
            <div className="max-w-md w-full space-y-8 text-center">
              <div className="space-y-2">
                <h2 className="text-6xl font-black tracking-tighter text-white">
                  YOU DIED
                </h2>
                <p className="text-white/50">You were consumed by a larger predator.</p>
              </div>

              <div className="bg-white/5 p-8 rounded-3xl border border-white/10 space-y-2">
                <div className="text-sm uppercase tracking-widest text-white/40">Final Score</div>
                <div className="text-5xl font-black">{me?.score}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setGameState("menu")}
                  className="bg-white text-black font-bold text-xl py-4 rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Try Again
                </button>
                <button
                  onClick={startSpectating}
                  className="bg-white/10 text-white font-bold text-xl py-4 rounded-2xl hover:bg-white/20 transition-all border border-white/10"
                >
                  Spectate
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {gameState === "spectating" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 z-50"
          >
            <div className="bg-black/80 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm font-bold uppercase tracking-widest text-white/70">Spectating</span>
              </div>
              <div className="h-4 w-[1px] bg-white/10" />
              <span className="text-sm font-medium">
                {spectateTargetId ? (players[spectateTargetId]?.name || "Loading...") : "Finding target..."}
              </span>
              <button
                onClick={() => setGameState("menu")}
                className="ml-4 text-xs font-bold uppercase tracking-widest bg-white text-black px-4 py-1.5 rounded-full hover:scale-105 transition-all"
              >
                Exit
              </button>
            </div>
            
            {leaderboard.length > 1 && (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const idx = leaderboard.findIndex(p => p.id === spectateTargetId);
                    const nextIdx = (idx + 1) % leaderboard.length;
                    setSpectateTargetId(leaderboard[nextIdx].id);
                  }}
                  className="bg-white/5 hover:bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-xs font-bold uppercase tracking-widest transition-all"
                >
                  Next Player
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
