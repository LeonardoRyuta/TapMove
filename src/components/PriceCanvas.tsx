import { useRef, useEffect, useState, useCallback } from 'react';

interface PricePoint {
  timestamp: number;
  price: number;
}

interface CanvasState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface Bet {
  col: number;           // Grid column
  row: number;           // Grid row
  multiplier: number;    // Locked multiplier
  placedAt: number;      // Timestamp when bet was placed
  hit: boolean;          // Whether the price has reached this cell
  hitAt?: number;        // Timestamp when the price reached this cell
}

const INITIAL_PRICE = 2000;
const PRICE_VOLATILITY = 1;
const UPDATE_INTERVAL = 100; // ms between price updates
const GRID_SIZE = 50; // pixels per grid cell (both width and height for square cells)
const PRICE_PER_GRID = 1; // $1 per grid cell in Y axis
const TIME_PER_GRID = 1000; // 1 second per grid cell in X axis (matches GRID_SIZE for square cells)
const BET_EXPIRY_TIME = 30000; // 30 seconds after price reaches the column

// Calculate multiplier based on distance from current price
const getMultiplier = (rowsFromCurrent: number): number => {
  const distance = Math.abs(rowsFromCurrent);
  if (distance === 0) return 1.1;
  if (distance === 1) return 1.5;
  if (distance === 2) return 2.0;
  if (distance === 3) return 3.0;
  if (distance === 4) return 5.0;
  return 5.0 + (distance - 4) * 2.0; // Increases by 2x for each row beyond 4
};

export function PriceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [canvasState, setCanvasState] = useState<CanvasState>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const startTimeRef = useRef<number>(Date.now());

  // Generate initial price data and simulate real-time updates
  useEffect(() => {
    const startTime = startTimeRef.current;
    
    // Generate some historical data
    const initialData: PricePoint[] = [];
    let currentPrice = INITIAL_PRICE;
    for (let i = -50; i <= 0; i++) {
      currentPrice += (Math.random() - 0.5) * PRICE_VOLATILITY;
      initialData.push({
        timestamp: startTime + i * UPDATE_INTERVAL,
        price: currentPrice,
      });
    }
    setPriceData(initialData);

    // Simulate real-time price updates
    const interval = setInterval(() => {
      setPriceData((prev) => {
        const lastPrice = prev[prev.length - 1]?.price || INITIAL_PRICE;
        const newPrice = lastPrice + (Math.random() - 0.5) * PRICE_VOLATILITY;
        return [
          ...prev,
          {
            timestamp: Date.now(),
            price: newPrice,
          },
        ];
      });
    }, UPDATE_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  // Check for bet hits and expire old bets
  useEffect(() => {
    if (priceData.length === 0) return;
    
    const latestPoint = priceData[priceData.length - 1];
    const startTime = startTimeRef.current;
    const currentTime = latestPoint.timestamp;
    const currentPrice = latestPoint.price;
    
    // Calculate current position in grid coordinates
    const currentPriceY = ((INITIAL_PRICE - currentPrice) / PRICE_PER_GRID) * GRID_SIZE;
    const currentPriceRow = Math.floor(currentPriceY / GRID_SIZE);
    const currentTimeX = ((currentTime - startTime) / TIME_PER_GRID) * GRID_SIZE;
    const currentTimeColumn = Math.floor(currentTimeX / GRID_SIZE);
    
    setBets(prevBets => {
      return prevBets
        .map(bet => {
          // Check if price has reached this bet's cell
          if (!bet.hit && bet.col === currentTimeColumn && bet.row === currentPriceRow) {
            return { ...bet, hit: true, hitAt: Date.now() };
          }
          return bet;
        })
        // Remove bets that have expired (30 seconds after hit or after price passed their column)
        .filter(bet => {
          if (bet.hit && bet.hitAt) {
            return Date.now() - bet.hitAt < BET_EXPIRY_TIME;
          }
          // Remove bets whose column the price has passed (with some buffer)
          if (currentTimeColumn > bet.col + 30) {
            return false;
          }
          return true;
        });
    });
  }, [priceData]);

  // Set initial viewport position once when component mounts
  const initializedRef = useRef(false);
  useEffect(() => {
    if (priceData.length > 0 && !initializedRef.current) {
      const latestPoint = priceData[priceData.length - 1];
      const canvas = canvasRef.current;
      if (!canvas) return;

      const startTime = startTimeRef.current;
      const timeX = ((latestPoint.timestamp - startTime) / TIME_PER_GRID) * GRID_SIZE;
      const priceY = ((INITIAL_PRICE - latestPoint.price) / PRICE_PER_GRID) * GRID_SIZE;

      // Center the view on the latest price point only on initial load
      setCanvasState((prev) => ({
        ...prev,
        offsetX: -timeX + canvas.width / 2 - 100,
        offsetY: -priceY + canvas.height / 2,
      }));
      initializedRef.current = true;
    }
  }, [priceData]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { offsetX, offsetY, scale } = canvasState;
    const width = canvas.width;
    const height = canvas.height;
    const startTime = startTimeRef.current;

    // Clear canvas
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // Apply transformations
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Calculate visible area
    const visibleLeft = -offsetX / scale;
    const visibleRight = (width - offsetX) / scale;
    const visibleTop = -offsetY / scale;
    const visibleBottom = (height - offsetY) / scale;

    // Draw grid
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;

    // Vertical grid lines (time) - same size as horizontal for square cells
    const startGridX = Math.floor(visibleLeft / GRID_SIZE) * GRID_SIZE;
    for (let x = startGridX; x < visibleRight; x += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, visibleTop);
      ctx.lineTo(x, visibleBottom);
      ctx.stroke();
    }

    // Horizontal grid lines (price)
    const startGridY = Math.floor(visibleTop / GRID_SIZE) * GRID_SIZE;
    for (let y = startGridY; y < visibleBottom; y += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(visibleLeft, y);
      ctx.lineTo(visibleRight, y);
      ctx.stroke();
    }

    // Draw price labels
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    for (let y = startGridY; y < visibleBottom; y += GRID_SIZE) {
      const price = INITIAL_PRICE - (y / GRID_SIZE) * PRICE_PER_GRID;
      ctx.fillText(`$${price.toFixed(2)}`, visibleLeft + 5, y - 5);
    }

    // Draw time labels (every 10 grid cells)
    for (let x = startGridX; x < visibleRight; x += GRID_SIZE * 10) {
      const timeOffset = (x / GRID_SIZE) * TIME_PER_GRID;
      const date = new Date(startTime + timeOffset);
      const timeStr = date.toLocaleTimeString();
      ctx.fillText(timeStr, x + 5, visibleBottom - 10);
    }

    // Draw betting grid ahead of current price
    if (priceData.length > 0) {
      const latestPoint = priceData[priceData.length - 1];
      const currentTime = latestPoint.timestamp;
      const currentPrice = latestPoint.price;
      
      // Calculate the current price row (in grid coordinates)
      const currentPriceY = ((INITIAL_PRICE - currentPrice) / PRICE_PER_GRID) * GRID_SIZE;
      const currentPriceRow = Math.floor(currentPriceY / GRID_SIZE);
      
      // Calculate the current time column (in 1-second intervals for square cells)
      const currentTimeX = ((currentTime - startTime) / TIME_PER_GRID) * GRID_SIZE;
      const currentTimeColumn = Math.floor(currentTimeX / GRID_SIZE);
      
      // Start betting grid from the next column after current price
      const startBetColumn = currentTimeColumn + 1;
      
      // Draw betting cells
      for (let col = startBetColumn; col < startBetColumn + 50; col++) {
        const cellX = col * GRID_SIZE;
        
        // Only draw if visible
        if (cellX + GRID_SIZE < visibleLeft || cellX > visibleRight) continue;
        
        // Draw cells for each price row
        const startRow = Math.floor(visibleTop / GRID_SIZE) - 1;
        const endRow = Math.ceil(visibleBottom / GRID_SIZE) + 1;
        
        for (let row = startRow; row < endRow; row++) {
          const cellY = row * GRID_SIZE;
          const rowsFromCurrent = row - currentPriceRow;
          const multiplier = getMultiplier(rowsFromCurrent);
          
          // Check if there's a bet on this cell
          const bet = bets.find(b => b.col === col && b.row === row);
          
          // Color based on multiplier (green for low, yellow for medium, red for high)
          let bgColor: string;
          let textColor: string;
          const displayMultiplier = bet ? bet.multiplier : multiplier;
          
          if (displayMultiplier <= 1.5) {
            bgColor = bet ? 'rgba(0, 255, 136, 0.4)' : 'rgba(0, 255, 136, 0.15)';
            textColor = '#00ff88';
          } else if (displayMultiplier <= 3.0) {
            bgColor = bet ? 'rgba(255, 200, 0, 0.4)' : 'rgba(255, 200, 0, 0.15)';
            textColor = '#ffc800';
          } else if (displayMultiplier <= 5.0) {
            bgColor = bet ? 'rgba(255, 100, 0, 0.4)' : 'rgba(255, 100, 0, 0.15)';
            textColor = '#ff6400';
          } else {
            bgColor = bet ? 'rgba(255, 50, 50, 0.4)' : 'rgba(255, 50, 50, 0.15)';
            textColor = '#ff3232';
          }
          
          // Draw cell background
          ctx.fillStyle = bgColor;
          ctx.fillRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
          
          // Draw cell border (highlight if bet is placed)
          if (bet) {
            ctx.strokeStyle = bet.hit ? 'rgba(255, 255, 255, 0.9)' : textColor;
            ctx.lineWidth = bet.hit ? 3 : 2;
          } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
          }
          ctx.strokeRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
          
          // Draw glow effect if bet was hit
          if (bet?.hit) {
            // Pulsing glow
            const glowIntensity = 0.3 + 0.2 * Math.sin(Date.now() / 200);
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 20;
            ctx.fillStyle = `rgba(255, 255, 255, ${glowIntensity})`;
            ctx.fillRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
            ctx.shadowBlur = 0;
          }
          
          // Draw multiplier text
          ctx.fillStyle = textColor;
          ctx.font = bet ? 'bold 12px monospace' : 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            `${displayMultiplier.toFixed(1)}x`,
            cellX + GRID_SIZE / 2,
            cellY + GRID_SIZE / 2
          );
        }
      }
      
      // Draw placed bets that are behind the current price (still visible until expired)
      for (const bet of bets) {
        if (bet.col >= startBetColumn) continue; // Already drawn above
        
        const cellX = bet.col * GRID_SIZE;
        const cellY = bet.row * GRID_SIZE;
        
        // Only draw if visible
        if (cellX + GRID_SIZE < visibleLeft || cellX > visibleRight) continue;
        if (cellY + GRID_SIZE < visibleTop || cellY > visibleBottom) continue;
        
        let textColor: string;
        if (bet.multiplier <= 1.5) {
          textColor = '#00ff88';
        } else if (bet.multiplier <= 3.0) {
          textColor = '#ffc800';
        } else if (bet.multiplier <= 5.0) {
          textColor = '#ff6400';
        } else {
          textColor = '#ff3232';
        }
        
        // Draw hit bet with glow
        if (bet.hit) {
          const glowIntensity = 0.3 + 0.2 * Math.sin(Date.now() / 200);
          ctx.fillStyle = `rgba(255, 255, 255, ${glowIntensity})`;
          ctx.fillRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
          
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.lineWidth = 3;
          ctx.strokeRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
        } else {
          ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
          ctx.fillRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
          
          ctx.strokeStyle = textColor;
          ctx.lineWidth = 2;
          ctx.strokeRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
        }
        
        // Draw multiplier text
        ctx.fillStyle = bet.hit ? '#ffffff' : textColor;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `${bet.multiplier.toFixed(1)}x`,
          cellX + GRID_SIZE / 2,
          cellY + GRID_SIZE / 2
        );
      }
      
      // Reset text alignment
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // Draw price line
    if (priceData.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      let started = false;
      for (const point of priceData) {
        const x = ((point.timestamp - startTime) / TIME_PER_GRID) * GRID_SIZE;
        const y = ((INITIAL_PRICE - point.price) / PRICE_PER_GRID) * GRID_SIZE;

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Draw glow effect
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.3)';
      ctx.lineWidth = 6;
      ctx.stroke();

      // Draw current price indicator
      const latestPoint = priceData[priceData.length - 1];
      const latestX = ((latestPoint.timestamp - startTime) / TIME_PER_GRID) * GRID_SIZE;
      const latestY = ((INITIAL_PRICE - latestPoint.price) / PRICE_PER_GRID) * GRID_SIZE;

      // Pulsing dot
      ctx.beginPath();
      ctx.arc(latestX, latestY, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#00ff88';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(latestX, latestY, 12, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Current price label
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`$${latestPoint.price.toFixed(2)}`, latestX + 20, latestY + 5);
    }

    ctx.restore();
  }, [canvasState, priceData, bets]);

  // Draw on canvas
  useEffect(() => {
    draw();
  }, [draw]);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      draw();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [draw]);

  // Mouse event handlers for panning
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
    setDragStartPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    const deltaX = e.clientX - lastMousePos.x;
    const deltaY = e.clientY - lastMousePos.y;

    setCanvasState((prev) => ({
      ...prev,
      offsetX: prev.offsetX + deltaX,
      offsetY: prev.offsetY + deltaY,
    }));

    setLastMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // Check if this was a click (not a drag)
    const dragDistance = Math.sqrt(
      Math.pow(e.clientX - dragStartPos.x, 2) + Math.pow(e.clientY - dragStartPos.y, 2)
    );
    
    if (dragDistance < 5) {
      // This is a click - try to place a bet
      handleCanvasClick(e);
    }
    
    setIsDragging(false);
  };
  
  const handleCanvasClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || priceData.length === 0) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const { offsetX, offsetY, scale } = canvasState;
    const startTime = startTimeRef.current;
    
    // Convert screen coordinates to world coordinates
    const worldX = (mouseX - offsetX) / scale;
    const worldY = (mouseY - offsetY) / scale;
    
    // Get the grid cell that was clicked
    const col = Math.floor(worldX / GRID_SIZE);
    const row = Math.floor(worldY / GRID_SIZE);
    
    // Get current price position
    const latestPoint = priceData[priceData.length - 1];
    const currentTime = latestPoint.timestamp;
    const currentPrice = latestPoint.price;
    const currentPriceY = ((INITIAL_PRICE - currentPrice) / PRICE_PER_GRID) * GRID_SIZE;
    const currentPriceRow = Math.floor(currentPriceY / GRID_SIZE);
    const currentTimeX = ((currentTime - startTime) / TIME_PER_GRID) * GRID_SIZE;
    const currentTimeColumn = Math.floor(currentTimeX / GRID_SIZE);
    
    // Only allow betting on cells ahead of the current price
    if (col <= currentTimeColumn) return;
    
    // Check if a bet already exists on this cell
    const existingBet = bets.find(b => b.col === col && b.row === row);
    if (existingBet) return; // Can't bet on the same cell twice
    
    // Calculate multiplier based on distance from current price row
    const rowsFromCurrent = row - currentPriceRow;
    const multiplier = getMultiplier(rowsFromCurrent);
    
    // Place the bet
    const newBet: Bet = {
      col,
      row,
      multiplier,
      placedAt: Date.now(),
      hit: false,
    };
    
    setBets(prev => [...prev, newBet]);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  // Wheel event for zooming
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setCanvasState((prev) => {
      const newScale = Math.max(0.1, Math.min(5, prev.scale * zoomFactor));
      
      // Zoom towards mouse position
      const scaleChange = newScale / prev.scale;
      const newOffsetX = mouseX - (mouseX - prev.offsetX) * scaleChange;
      const newOffsetY = mouseY - (mouseY - prev.offsetY) * scaleChange;

      return {
        offsetX: newOffsetX,
        offsetY: newOffsetY,
        scale: newScale,
      };
    });
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        cursor: isDragging ? 'grabbing' : 'grab',
        backgroundColor: '#0a0a0f',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    />
  );
}
