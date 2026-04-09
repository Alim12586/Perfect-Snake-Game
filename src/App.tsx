import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";
import type { Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";
import {
  Trophy,
  Users,
  Zap,
  MousePointer2,
  Settings,
  X,
  Save,
  Sparkles,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { sounds } from "./lib/sounds";
import { db } from "./firebase";
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  Timestamp
} from "firebase/firestore";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SEGMENT_SPACING = 15;

interface GameConfig {
  gridSize: number;
  maxFood: number;
  maxPowerups: number;
  maxObstacles: number;
  initialSegments: number;
  baseSpeed: number;
  boostSpeed: number;
  isTeamMode: boolean;
}

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
  team?: "red" | "blue";
}

interface Food {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
}

interface Powerup {
  id: string;
  x: number;
  y: number;
  type: "speed" | "invincibility" | "magnet" | "multiplier";
  color: string;
}

interface GlobalHighScore {
  id: string;
  playerName: string;
  score: number;
  timestamp: any;
  team?: string;
}

interface Obstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMoving: boolean;
  color: string;
}

interface ActivePowerup {
  type: string;
  endTime: number;
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

export default function App() {
  const [socket, setSocket] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [foods, setFoods] = useState<Food[]>([]);
  const [powerups, setPowerups] = useState<Powerup[]>([]);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [activePowerups, setActivePowerups] = useState<Record<string, number>>({});
  const [teamScores, setTeamScores] = useState<Record<string, number>>({ red: 0, blue: 0 });
  const [globalHighScores, setGlobalHighScores] = useState<GlobalHighScore[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<"red" | "blue">("red");
  const [me, setMe] = useState<Player | null>(null);
  const [gameState, setGameState] = useState<"menu" | "playing" | "dead" | "spectating">("menu");
  const [isPaused, setIsPaused] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [leaderboard, setLeaderboard] = useState<Player[]>([]);
  const [spectateTargetId, setSpectateTargetId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isPlayerChatVisible, setIsPlayerChatVisible] = useState(false);
  const [geminiTip, setGeminiTip] = useState<string | null>(null);
  const [isGeneratingTip, setIsGeneratingTip] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [gameConfig, setGameConfig] = useState<GameConfig>({
    gridSize: 2000,
    maxFood: 100,
    maxPowerups: 5,
    maxObstacles: 15,
    initialSegments: 5,
    baseSpeed: 3,
    boostSpeed: 6,
    isTeamMode: true,
  });
  const [tempConfig, setTempConfig] = useState<GameConfig>(gameConfig);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const mouseRef = useRef<Point>({ x: 0, y: 0 });
  const lastUpdateTime = useRef<number>(0);
  const gameStateRef = useRef(gameState);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Initialize socket
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("connect", () => setIsConnected(true));
    newSocket.on("disconnect", () => setIsConnected(false));

    newSocket.on("init", ({ players, foods, powerups, obstacles, config, teamScores }) => {
      setPlayers(players);
      setFoods(foods);
      setPowerups(powerups || []);
      setObstacles(obstacles || []);
      if (teamScores) setTeamScores(teamScores);
      if (config) {
        setGameConfig(config);
        setTempConfig(config);
      }
    });

    newSocket.on("settingsUpdated", (config: GameConfig) => {
      setGameConfig(config);
      setTempConfig(config);
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

    newSocket.on("powerupUpdated", ({ removedId, added }) => {
      setPowerups((prev) => {
        const next = prev.filter((p) => p.id !== removedId);
        if (added) next.push(added);
        return next;
      });
    });

    newSocket.on("obstaclesUpdated", (updatedObstacles) => {
      setObstacles(updatedObstacles);
    });

    newSocket.on("powerupCollected", (type) => {
      sounds.playPowerup();
      setActivePowerups((prev) => ({
        ...prev,
        [type]: Date.now() + 10000, // 10 seconds duration
      }));
    });

    newSocket.on("teamScoresUpdated", (scores) => {
      setTeamScores(scores);
    });

    newSocket.on("chatMessage", (message: ChatMessage) => {
      setChatMessages((prev) => [...prev.slice(-49), message]);
    });

    // Global High Scores Listener
    const q = query(collection(db, "high_scores"), orderBy("score", "desc"), limit(10));
    const unsubscribeScores = onSnapshot(q, (snapshot) => {
      const scores: GlobalHighScore[] = [];
      snapshot.forEach((doc) => {
        scores.push({ id: doc.id, ...doc.data() } as GlobalHighScore);
      });
      setGlobalHighScores(scores);
    }, (error) => {
      console.error("Firestore Error (GET high_scores):", error);
    });

    return () => {
      newSocket.close();
      unsubscribeScores();
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

  const generateGeminiTip = async (score: number) => {
    if (!process.env.GEMINI_API_KEY) return;
    
    setIsGeneratingTip(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `I just played a multiplayer snake game and got a score of ${score}. Give me a very short, witty, and encouraging tip (max 15 words) on how to improve or just a funny comment about my performance.`,
      });
      
      // Only set tip if we are still in the dead state
      setGeminiTip((prev) => {
        if (gameStateRef.current === "dead") {
          return response.text || "Keep growing, little snake!";
        }
        return prev;
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Gemini request was aborted');
        return;
      }
      console.error("Gemini Error:", error);
      setGeminiTip("The arena is tough, but you're tougher!");
    } finally {
      setIsGeneratingTip(false);
    }
  };

  useEffect(() => {
    if (gameState === "dead" && me) {
      generateGeminiTip(me.score);
    } else if (gameState !== "dead") {
      setGeminiTip(null);
    }
  }, [gameState, me?.score]);

  useEffect(() => {
    sounds.setMuted(isMuted);
  }, [isMuted]);

  const joinGame = () => {
    sounds.playClick();
    if (!socket || !playerName.trim()) return;
    const color = gameConfig.isTeamMode 
      ? (selectedTeam === "red" ? "#ef4444" : "#3b82f6")
      : `hsl(${Math.random() * 360}, 70%, 50%)`;
      
    const startPos = { x: Math.random() * gameConfig.gridSize, y: Math.random() * gameConfig.gridSize };
    const segments = Array.from({ length: gameConfig.initialSegments }, (_, i) => ({
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
      team: gameConfig.isTeamMode ? selectedTeam : undefined,
    };

    setMe(initialPlayer);
    setGameState("playing");
    setSpectateTargetId(null);
    socket.emit("join", initialPlayer);
  };

  const startSpectating = () => {
    sounds.playClick();
    setGameState("spectating");
    if (leaderboard.length > 0) {
      setSpectateTargetId(leaderboard[0].id);
    }
  };

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !chatInput.trim()) return;
    socket.emit("chatMessage", chatInput);
    setChatInput("");
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

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
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Escape" || e.code === "KeyP") {
      if (gameState === "playing") {
        setIsPaused((prev) => !prev);
      }
    }
    if (e.code === "KeyC") {
      if (gameState === "playing") {
        setIsPlayerChatVisible((prev) => !prev);
      }
    }
    if (e.code === "Space" || e.code === "ShiftLeft") {
      setMe((prev) => prev ? { ...prev, isBoosting: true } : null);
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space" || e.code === "ShiftLeft") {
      setMe((prev) => prev ? { ...prev, isBoosting: false } : null);
    }
  };

  const recordHighScore = async (player: Player) => {
    if (player.score <= 0) return;
    
    try {
      await addDoc(collection(db, "high_scores"), {
        playerName: player.name,
        score: player.score,
        timestamp: serverTimestamp(),
        team: player.team || null
      });
    } catch (error) {
      console.error("Firestore Error (WRITE high_scores):", error);
    }
  };

  const gameLoop = useCallback((time: number) => {
    if (gameState === "menu" || !socket || isPaused) return;

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
      let speed = me.isBoosting ? gameConfig.boostSpeed : gameConfig.baseSpeed;
      if (activePowerups["speed"] && activePowerups["speed"] > Date.now()) {
        speed *= 1.5;
      }
      const head = me.segments[0];
      const newHead = {
        x: (head.x + Math.cos(newAngle) * speed + gameConfig.gridSize) % gameConfig.gridSize,
        y: (head.y + Math.sin(newAngle) * speed + gameConfig.gridSize) % gameConfig.gridSize,
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
      const isMagnetActive = activePowerups["magnet"] && activePowerups["magnet"] > Date.now();
      const scoreMultiplier = activePowerups["multiplier"] && activePowerups["multiplier"] > Date.now() ? 2 : 1;

      foods.forEach((food) => {
        const dx = newHead.x - food.x;
        const dy = newHead.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Magnet effect
        if (isMagnetActive && dist < 150) {
          const angle = Math.atan2(dy, dx);
          food.x += Math.cos(angle + Math.PI) * 5;
          food.y += Math.sin(angle + Math.PI) * 5;
        }

        if (dist < 20 + food.size) {
          sounds.playEat();
          socket.emit("eatFood", food.id);
          newScore += Math.floor(food.size) * scoreMultiplier;
          segmentsToAdd += 1;
        }
      });

      if (segmentsToAdd > 0) {
        for (let i = 0; i < segmentsToAdd; i++) {
          const last = newSegments[newSegments.length - 1];
          newSegments.push({ ...last });
        }
      }

      // Check collisions with powerups
      powerups.forEach((p) => {
        const dx = newHead.x - p.x;
        const dy = newHead.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 30) {
          socket.emit("collectPowerup", p.id);
        }
      });

      // Check collisions with obstacles
      let died = false;
      obstacles.forEach((obs) => {
        if (
          newHead.x > obs.x &&
          newHead.x < obs.x + obs.width &&
          newHead.y > obs.y &&
          newHead.y < obs.y + obs.height
        ) {
          died = true;
        }
      });

      // Check collisions with other players
      const isInvincible = activePowerups["invincibility"] && activePowerups["invincibility"] > Date.now();
      if (!isInvincible) {
        Object.entries(players).forEach(([id, player]) => {
          if (id === socket.id) return;
          const p = player as Player;

          // Team mode: Teammates don't kill each other
          if (gameConfig.isTeamMode && me.team === p.team) return;

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
      }

      if (died) {
        sounds.playDeath();
        setGameState("dead");
        socket.emit("playerDied");
        if (me) recordHighScore(me);
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
        for (let i = 0; i <= gameConfig.gridSize; i += 100) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, gameConfig.gridSize);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(gameConfig.gridSize, i);
          ctx.stroke();
        }

        // Draw obstacles
        obstacles.forEach((obs) => {
          ctx.fillStyle = obs.color;
          ctx.shadowBlur = obs.isMoving ? 15 : 0;
          ctx.shadowColor = obs.color;
          ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
          
          // Add some texture/border to obstacles
          ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
          ctx.lineWidth = 2;
          ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
          ctx.shadowBlur = 0;
        });

        // Draw powerups
        powerups.forEach((p) => {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
          ctx.fill();
          
          // Glow
          ctx.shadowBlur = 20;
          ctx.shadowColor = p.color;
          ctx.fill();
          ctx.shadowBlur = 0;

          // Icon representation
          ctx.fillStyle = "white";
          ctx.font = "bold 12px sans-serif";
          ctx.textAlign = "center";
          let icon = "";
          if (p.type === "speed") icon = "⚡";
          if (p.type === "invincibility") icon = "🛡️";
          if (p.type === "magnet") icon = "🧲";
          if (p.type === "multiplier") icon = "2x";
          ctx.fillText(icon, p.x, p.y + 4);
        });

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
    const isMe = player.id === socket?.id;
    const isInvincible = isMe ? (activePowerups["invincibility"] && activePowerups["invincibility"] > Date.now()) : false;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 20;
    ctx.strokeStyle = player.color;

    if (isInvincible) {
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#8b5cf6";
      ctx.strokeStyle = "#a78bfa";
    }

    ctx.beginPath();
    ctx.moveTo(player.segments[0].x, player.segments[0].y);
    player.segments.forEach((seg) => {
      ctx.lineTo(seg.x, seg.y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

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
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    const textWidth = ctx.measureText(player.name).width;
    const nameX = player.segments[0].x;
    const nameY = player.segments[0].y - 28;
    
    // Subtle background pill for readability
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    const bgWidth = textWidth + 12;
    const bgHeight = 18;
    ctx.beginPath();
    // Use roundRect if available, fallback to rect
    if (ctx.roundRect) {
      ctx.roundRect(nameX - bgWidth / 2, nameY - 13, bgWidth, bgHeight, 9);
    } else {
      ctx.rect(nameX - bgWidth / 2, nameY - 13, bgWidth, bgHeight);
    }
    ctx.fill();

    ctx.fillStyle = "white";
    ctx.fillText(player.name, nameX, nameY);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameLoop]);

  const saveSettings = () => {
    sounds.playClick();
    if (!socket) return;
    socket.emit("updateSettings", tempConfig);
    setIsSettingsOpen(false);
  };

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
        <button
          onClick={() => {
            sounds.playClick();
            setIsMuted(!isMuted);
          }}
          className="pointer-events-auto flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-2 rounded-lg border border-white/10 w-fit hover:bg-white/10 transition-all group"
        >
          {isMuted ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 text-red-400">🔇</div>
              <span className="text-[10px] uppercase tracking-widest font-bold text-red-400/70">Audio Muted</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 text-green-400">🔊</div>
              <span className="text-[10px] uppercase tracking-widest font-bold text-green-400/70">Audio Active</span>
            </div>
          )}
        </button>
      </div>

      <div className="absolute top-4 right-4 w-64 pointer-events-none space-y-4">
        {gameConfig.isTeamMode && (
          <div className="bg-black/50 backdrop-blur-md p-4 rounded-xl border border-white/10 space-y-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-white/40 border-b border-white/10 pb-2">Team Scores</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-xs font-bold text-red-400">RED</span>
                </div>
                <span className="text-xs font-mono">{teamScores.red}</span>
              </div>
              <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-red-500 transition-all duration-500" 
                  style={{ width: `${(teamScores.red / (teamScores.red + teamScores.blue || 1)) * 100}%` }}
                />
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-xs font-bold text-blue-400">BLUE</span>
                </div>
                <span className="text-xs font-mono">{teamScores.blue}</span>
              </div>
              <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-500" 
                  style={{ width: `${(teamScores.blue / (teamScores.red + teamScores.blue || 1)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="bg-black/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
          <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <span className="font-bold uppercase tracking-wider text-sm">Leaderboard</span>
          </div>
          <div className="space-y-2">
            {leaderboard.map((player, i) => (
              <div key={`leaderboard-${player.id}-${i}`} className={cn("flex justify-between items-center text-sm", player.id === socket?.id && "text-yellow-400 font-bold")}>
                <span className="truncate max-w-[120px]">{i + 1}. {player.name}</span>
                <span>{player.score}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-black/50 backdrop-blur-md p-4 rounded-xl border border-white/10">
          <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
            <Sparkles className="w-5 h-5 text-blue-400" />
            <span className="font-bold uppercase tracking-wider text-sm">Hall of Fame</span>
          </div>
          <div className="space-y-2">
            {globalHighScores.length === 0 ? (
              <div className="text-[10px] text-white/20 italic text-center py-2">No legends yet...</div>
            ) : (
              globalHighScores.map((score, i) => (
                <div key={`global-${score.id}-${i}`} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-white/30 font-mono">{i + 1}.</span>
                    <span className="truncate max-w-[100px] font-medium">{score.playerName}</span>
                    {score.team && (
                      <div className={cn("w-1.5 h-1.5 rounded-full", score.team === "red" ? "bg-red-500" : "bg-blue-500")} />
                    )}
                  </div>
                  <span className="font-bold text-white/70">{score.score}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {me && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-4">
          {/* Active Powerups UI */}
          <div className="flex gap-2">
            {Object.entries(activePowerups).map(([type, endTime]) => {
              const timeLeft = Math.max(0, Math.floor(((endTime as number) - Date.now()) / 1000));
              if (timeLeft <= 0) return null;
              
              const colors: Record<string, string> = {
                speed: "bg-yellow-500",
                invincibility: "bg-purple-500",
                magnet: "bg-pink-500",
                multiplier: "bg-green-500"
              };
              
              const icons: Record<string, string> = {
                speed: "⚡",
                invincibility: "🛡️",
                magnet: "🧲",
                multiplier: "2x"
              };

              return (
                <motion.div
                  key={type}
                  initial={{ scale: 0, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0, y: 20 }}
                  className={cn("px-3 py-1.5 rounded-full flex items-center gap-2 border border-white/20 shadow-lg backdrop-blur-md", colors[type])}
                >
                  <span className="text-sm">{icons[type]}</span>
                  <span className="text-[10px] font-black uppercase tracking-widest">{type}</span>
                  <span className="text-xs font-bold bg-black/20 px-1.5 py-0.5 rounded-md">{timeLeft}s</span>
                </motion.div>
              );
            })}
          </div>

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
        {isSettingsOpen && (
          <motion.div
            key="settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-[100] p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-neutral-900 border border-white/10 rounded-[2.5rem] w-full max-w-xl overflow-hidden"
            >
              <div className="p-8 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/5 rounded-xl">
                    <Settings className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black tracking-tight">Arena Settings</h2>
                    <p className="text-white/40 text-xs uppercase tracking-widest font-bold">Global Configuration</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto scrollbar-hide">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-white/40">Grid Size</label>
                    <input
                      type="number"
                      value={tempConfig.gridSize}
                      onChange={(e) => setTempConfig({ ...tempConfig, gridSize: parseInt(e.target.value) || 0 })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-white/40">Team Mode</label>
                    <button
                      onClick={() => {
                        sounds.playClick();
                        setTempConfig({ ...tempConfig, isTeamMode: !tempConfig.isTeamMode });
                      }}
                      className={cn(
                        "w-full py-3 rounded-xl border transition-all text-xs font-black uppercase tracking-widest",
                        tempConfig.isTeamMode ? "bg-green-500/20 border-green-500 text-green-400" : "bg-white/5 border-white/10 text-white/40"
                      )}
                    >
                      {tempConfig.isTeamMode ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-white/40">Food Count</label>
                    <input
                      type="number"
                      value={tempConfig.maxFood}
                      onChange={(e) => setTempConfig({ ...tempConfig, maxFood: parseInt(e.target.value) || 0 })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-white/40">Powerups</label>
                    <input
                      type="number"
                      value={tempConfig.maxPowerups}
                      onChange={(e) => setTempConfig({ ...tempConfig, maxPowerups: parseInt(e.target.value) || 0 })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-white/40">Obstacles</label>
                    <input
                      type="number"
                      value={tempConfig.maxObstacles}
                      onChange={(e) => setTempConfig({ ...tempConfig, maxObstacles: parseInt(e.target.value) || 0 })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-white/40">Initial Length</label>
                    <input
                      type="number"
                      value={tempConfig.initialSegments}
                      onChange={(e) => setTempConfig({ ...tempConfig, initialSegments: parseInt(e.target.value) || 0 })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-white/40">Base Speed</label>
                    <input
                      type="number"
                      step="0.1"
                      value={tempConfig.baseSpeed}
                      onChange={(e) => setTempConfig({ ...tempConfig, baseSpeed: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-white/40">Boost Speed</label>
                    <input
                      type="number"
                      step="0.1"
                      value={tempConfig.boostSpeed}
                      onChange={(e) => setTempConfig({ ...tempConfig, boostSpeed: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="p-8 bg-white/5 border-t border-white/5 flex gap-4">
                <button
                  onClick={() => {
                    sounds.playClick();
                    setIsSettingsOpen(false);
                  }}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all border border-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSettings}
                  className="flex-1 bg-white text-black font-bold py-4 rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  Save Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {isPaused && gameState === "playing" && (
          <motion.div
            key="paused-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60]"
          >
            <div className="text-center space-y-6">
              <h2 className="text-7xl font-black tracking-tighter text-white drop-shadow-2xl">PAUSED</h2>
              <button
                onClick={() => setIsPaused(false)}
                className="bg-white text-black font-bold px-12 py-4 rounded-2xl text-xl hover:scale-105 transition-all"
              >
                Resume Game
              </button>
              <div className="space-y-1">
                <p className="text-white/50 text-sm uppercase tracking-widest">Press ESC or P to Resume</p>
                <p className="text-white/30 text-[10px] uppercase tracking-widest">Press C to toggle Chat</p>
              </div>
            </div>
          </motion.div>
        )}

        {gameState === "menu" && (
          <motion.div
            key="menu-overlay"
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

                {gameConfig.isTeamMode && (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        sounds.playClick();
                        setSelectedTeam("red");
                      }}
                      className={cn(
                        "py-3 rounded-xl border transition-all flex flex-col items-center gap-1",
                        selectedTeam === "red" 
                          ? "bg-red-500/20 border-red-500 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]" 
                          : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                      )}
                    >
                      <span className="text-[10px] font-black uppercase tracking-widest">Team Red</span>
                    </button>
                    <button
                      onClick={() => {
                        sounds.playClick();
                        setSelectedTeam("blue");
                      }}
                      className={cn(
                        "py-3 rounded-xl border transition-all flex flex-col items-center gap-1",
                        selectedTeam === "blue" 
                          ? "bg-blue-500/20 border-blue-500 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]" 
                          : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                      )}
                    >
                      <span className="text-[10px] font-black uppercase tracking-widest">Team Blue</span>
                    </button>
                  </div>
                )}

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
                <button
                  onClick={() => {
                    sounds.playClick();
                    setIsSettingsOpen(true);
                  }}
                  className="w-full bg-white/5 text-white/70 font-bold text-sm py-3 rounded-xl hover:bg-white/10 transition-all border border-white/5 flex items-center justify-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  Arena Settings
                </button>
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
            key="dead-overlay"
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

              {geminiTip && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white/5 p-6 rounded-2xl border border-white/10 relative overflow-hidden group"
                >
                  <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
                  <div className="flex items-start gap-3 text-left">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                      <Sparkles className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-1">Gemini Coach</div>
                      <p className="text-sm text-white/80 italic leading-relaxed">"{geminiTip}"</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {isGeneratingTip && (
                <div className="flex items-center justify-center gap-2 text-white/30 py-4">
                  <div className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce" />
                  <span className="text-[10px] font-bold uppercase tracking-widest ml-2">Consulting the Oracle...</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => {
                    sounds.playClick();
                    setGameState("menu");
                  }}
                  className="bg-white text-black font-bold text-xl py-4 rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Try Again
                </button>
                <button
                  onClick={() => {
                    sounds.playClick();
                    startSpectating();
                  }}
                  className="bg-white/10 text-white font-bold text-xl py-4 rounded-2xl hover:bg-white/20 transition-all border border-white/10"
                >
                  Spectate
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {(gameState === "spectating" || (gameState === "playing" && (isPaused || isPlayerChatVisible))) && (
          <motion.div
            key="chat-overlay"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute top-20 right-4 w-80 h-96 bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl flex flex-col overflow-hidden z-50"
          >
              <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                <span className="text-xs font-black uppercase tracking-widest text-white/50">
                  {gameState === "spectating" ? "Spectator Chat" : "Arena Chat"}
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-green-500/70">Live</span>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-white/20 text-xs italic">
                    No messages yet...
                  </div>
                ) : (
                  chatMessages.map((msg, i) => (
                    <div key={`chat-${msg.id}-${i}`} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-white/40 uppercase tracking-tighter">
                          {msg.sender}
                        </span>
                        <span className="text-[8px] text-white/20">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm text-white/80 leading-relaxed break-words bg-white/5 p-2 rounded-xl rounded-tl-none border border-white/5">
                        {msg.text}
                      </p>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={sendChatMessage} className="p-4 bg-black/40 border-t border-white/10">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                />
              </form>
            </motion.div>
        )}

        {gameState === "spectating" && (
          <motion.div
            key="spectator-ui"
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
