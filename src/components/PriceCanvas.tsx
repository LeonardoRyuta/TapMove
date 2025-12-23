import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { usePrivyMovementWallet } from '../hooks/usePrivyMovementWallet';
import { useTapMarket, useGridState } from '../hooks/useTapMarket';
import { usePythPriceStream } from '../hooks/usePythPriceStream';
import { PYTH_PRICE_IDS } from '../lib/pythHermesClient';
import {
  TIME_BUCKET_SECONDS,
  NUM_PRICE_BUCKETS,
  MID_PRICE_BUCKET,
  LOCKED_COLUMNS_AHEAD,
  computeExpiryTimestampSecs,
} from '../config/tapMarket';
import { computeMultiplierBps, getExpiryBucket } from '../lib/multipliers';
import { FloatingBetButton } from './FloatingBetButton';

interface PricePoint {
  timestamp: number;
  price: number;
}

interface CanvasState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface BetState {
  rowIndex: number;      // Blockchain row index
  columnIndex: number;   // Blockchain column index
  multiplier: number;    // Locked multiplier
  stake: number;         // Stake amount in APT
  status: 'pending' | 'placed' | 'won' | 'lost' | 'error' | 'settling' | 'settled';
  txHash?: string;
  errorMessage?: string;
  placedAt: number;      // Timestamp when bet was placed
  betId?: string | number; // On-chain bet ID (if known)
  expiryTimestampSecs?: number; // Unix timestamp when bet expires
  priceFeedId?: string;  // Pyth price feed ID for settlement
}

// Visual configuration
const GRID_SIZE = 50; // pixels per grid cell (both width and height for square cells)
const PRICE_PER_GRID = 0.5; // $0.50 per grid cell in Y axis
const TIME_PER_GRID = TIME_BUCKET_SECONDS * 1000; // ms per grid cell

export function PriceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Hooks for blockchain integration
  const wallet = usePrivyMovementWallet();
  const { placeBet, settleBetNoPyth, isSettling } = useTapMarket(
    wallet.address,
    wallet.aptosSigner
  );
  const { currentBucket, earliestBettableBucket } = useGridState();
  
  // Pyth price streaming
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { latestPrice, publishTime, history, isLoading, isConnected, error } = usePythPriceStream(
    PYTH_PRICE_IDS.ETH_USD  // Using ETH/USD as default
  );
  
  // Convert Pyth data to our format - memoize to prevent infinite loops
  const currentPrice = useMemo<PricePoint | null>(
    () => latestPrice && publishTime
      ? { price: latestPrice, timestamp: publishTime * 1000 }
      : null,
    [latestPrice, publishTime]
  );
  
  const priceHistory = useMemo<PricePoint[]>(
    () => history.map(h => ({
      price: h.price,
      timestamp: h.timestamp * 1000  // Convert to milliseconds
    })),
    [history]
  );
  
  // State management
  const [bets, setBets] = useState<BetState[]>([]);
  const [stakeAmount, setStakeAmount] = useState<number>(0.1); // Default 0.1 APT
  const [canvasState, setCanvasState] = useState<CanvasState>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  
  // Reference price for Y-axis scaling (rounded to nearest whole number for cleaner grid intervals)
  const referencePriceRef = useRef<number>(Math.round(priceHistory[0]?.price || 100));
  
  // Update reference price when data first arrives
  useEffect(() => {
    if (priceHistory.length > 0 && referencePriceRef.current === 100) {
      referencePriceRef.current = Math.round(priceHistory[0].price);
    }
  }, [priceHistory]);

  /**
   * Settle a single bet on-chain using no-pyth method
   */
  const handleSettleBet = useCallback(async (bet: BetState) => {
    console.log(`Settling bet at row ${bet.rowIndex}, col ${bet.columnIndex}...`);
    console.log(`Bet ID: ${bet.betId}, Tx: ${bet.txHash}`);

    if (!bet.betId) {
      // Fallback: prompt user to enter bet ID manually
      const betIdInput = prompt(
        `Bet ID not found (this shouldn't happen often).\n\n` +
        `Please check the transaction in the block explorer and enter the bet ID:\n` +
        `Transaction: ${bet.txHash || 'unknown'}`
      );
      if (!betIdInput) return;
      
      // Update bet with the ID
      setBets(prev => prev.map(b => 
        b === bet ? { ...b, betId: betIdInput } : b
      ));
      
      bet = { ...bet, betId: betIdInput };
    }
    
    // Get current price for settlement
    if (!currentPrice) {
      console.error('Current price not available');
      alert('Cannot settle: Current price data not available');
      return;
    }
    
    // Mark as settling
    setBets(prev => prev.map(b => 
      b.rowIndex === bet.rowIndex && b.columnIndex === bet.columnIndex
        ? { ...b, status: 'settling' }
        : b
    ));
    
    try {
      // Use no-pyth settlement with current price
      const txHash = await settleBetNoPyth({
        betId: bet.betId!,  // Non-null assertion - we checked above
        currentPrice: currentPrice.price,
        referencePrice: referencePriceRef.current,
      });
      
      console.log('Bet settled:', txHash);
      
      // Update bet status to settled
      setBets(prev => prev.map(b => 
        b.rowIndex === bet.rowIndex && b.columnIndex === bet.columnIndex
          ? { ...b, status: 'settled', txHash }
          : b
      ));
      
      // Refresh wallet balance
      wallet.refreshBalance();
    } catch (error: unknown) {
      console.error('Failed to settle bet:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to settle bet';
      
      // Check for common error patterns
      if (errorMessage.includes('0x6507')) {
        alert(
          `Settlement failed: Bet ID ${bet.betId} not found on-chain.\n\n` +
          `This could mean:\n` +
          `• The bet was already settled\n` +
          `• The bet ID was extracted incorrectly\n` +
          `• Transaction: ${bet.txHash}\n\n` +
          `Check the explorer to verify the bet status.`
        );
      } else if (errorMessage.includes('E_EXPIRY_TOO_SOON')) {
        alert(`Settlement failed: Bet has not expired yet. Wait until after ${new Date((bet.expiryTimestampSecs || 0) * 1000).toLocaleString()}`);
      } else {
        alert(`Settlement failed: ${errorMessage}`);
      }
      
      // Revert to placed status on error
      setBets(prev => prev.map(b => 
        b.rowIndex === bet.rowIndex && b.columnIndex === bet.columnIndex
          ? { ...b, status: 'placed', errorMessage }
          : b
      ));
    }
  }, [settleBetNoPyth, wallet, currentPrice]);

  
  // Auto-trigger settlement for eligible bets
  useEffect(() => {
    if (!currentBucket || !wallet.authenticated) return;
    
    const nowSec = Math.floor(Date.now() / 1000);
    
    // Find bets that are placed/won/lost and past their expiry time
    const betsToSettle = bets.filter(bet => 
      (bet.status === 'placed' || bet.status === 'won' || bet.status === 'lost') &&
      bet.expiryTimestampSecs && 
      bet.expiryTimestampSecs <= nowSec &&
      bet.betId // Only settle if we have a bet ID
    );
    
    // Settle one bet at a time (to avoid overwhelming the network)
    if (betsToSettle.length > 0 && !isSettling) {
      const betToSettle = betsToSettle[0];
      console.log('🔄 Auto-settling bet:', betToSettle);
      handleSettleBet(betToSettle).catch(err => {
        console.error('Auto-settlement failed:', err);
      });
    }
  }, [currentBucket, bets, wallet.authenticated, isSettling, handleSettleBet]);

  // Clean up old bets periodically
  useEffect(() => {
    if (!currentBucket) return;
    
    setBets(prevBets => {
      return prevBets.filter(bet => {
        // Keep pending, error, and settling bets
        if (bet.status === 'pending' || bet.status === 'error' || bet.status === 'settling') return true;
        
        // Remove settled/won/lost bets that are more than 2 columns behind current
        const columnsBehind = currentBucket - bet.columnIndex;
        return columnsBehind <= 2;
      });
    });
  }, [currentBucket]);

  // Set initial viewport position when price data arrives
  const initializedRef = useRef(false);
  useEffect(() => {
    if (priceHistory.length > 0 && !initializedRef.current && currentPrice) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const startTime = priceHistory[0].timestamp;
      const timeX = ((currentPrice.timestamp - startTime) / TIME_PER_GRID) * GRID_SIZE;
      const priceY = ((referencePriceRef.current - currentPrice.price) / PRICE_PER_GRID) * GRID_SIZE;

      // Center the view on the latest price point
      setCanvasState((prev) => ({
        ...prev,
        offsetX: -timeX + canvas.width / 2 - 100,
        offsetY: -priceY + canvas.height / 2,
      }));
      initializedRef.current = true;
    }
  }, [priceHistory, currentPrice]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { offsetX, offsetY, scale } = canvasState;
    const width = canvas.width;
    const height = canvas.height;
    const startTime = priceHistory.length > 0 ? priceHistory[0].timestamp : Date.now();
    const referencePrice = referencePriceRef.current;
    
    // Show loading or error state
    if (isLoading || priceHistory.length === 0) {
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#666';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(isLoading ? 'Loading Pyth price feed...' : 'Initializing...', width / 2, height / 2);
      return;
    }
    
    if (error) {
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ff3232';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Error loading price feed', width / 2, height / 2 - 10);
      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.fillText(error.message, width / 2, height / 2 + 10);
      return;
    }

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
      const price = referencePrice - (y / GRID_SIZE) * PRICE_PER_GRID;
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
    if (currentBucket && earliestBettableBucket && currentPrice) {
      const currentPriceValue = currentPrice.price;
      
      // Calculate the current price Y position in the fixed grid
      const currentPriceY = ((referencePrice - currentPriceValue) / PRICE_PER_GRID) * GRID_SIZE;
      
      // Determine which grid row contains the current price
      const currentPriceGridRow = Math.floor(currentPriceY / GRID_SIZE);
      
      // Current time column is the currentBucket
      const currentTimeColumn = currentBucket;
      
      // Find the earliest column that has a bet to ensure we render all active bets
      const earliestBetColumn = bets.length > 0 
        ? Math.min(...bets.map(b => b.columnIndex), earliestBettableBucket)
        : earliestBettableBucket;
      
      const startBetColumn = Math.min(earliestBetColumn, earliestBettableBucket);
      const numColumns = 50; // Show 50 columns ahead
      
      // Draw betting cells
      for (let col = startBetColumn; col < startBetColumn + numColumns; col++) {
        // Convert bucket number to timestamp, then to grid X coordinate
        const bucketTimestamp = col * TIME_BUCKET_SECONDS * 1000; // milliseconds
        const cellX = ((bucketTimestamp - startTime) / TIME_PER_GRID) * GRID_SIZE;
        
        // Only draw if visible
        if (cellX + GRID_SIZE < visibleLeft || cellX > visibleRight) continue;
        
        // Draw cells for each price bucket
        const startRow = Math.floor(visibleTop / GRID_SIZE) - 1;
        const endRow = Math.ceil(visibleBottom / GRID_SIZE) + 1;
        
        for (let gridRow = startRow; gridRow < endRow; gridRow++) {
          const cellY = gridRow * GRID_SIZE;
          
          // Calculate which price bucket this grid row represents
          const rowOffsetFromCurrentPrice = gridRow - currentPriceGridRow;
          const priceBucket = MID_PRICE_BUCKET - rowOffsetFromCurrentPrice;
          
          // Only draw if this is a valid price bucket
          if (priceBucket < 0 || priceBucket >= NUM_PRICE_BUCKETS) continue;
          
          // Calculate expiry bucket for this column
          const expiryBucket = getExpiryBucket(currentBucket, LOCKED_COLUMNS_AHEAD, col - earliestBettableBucket);
          
          // Calculate multiplier using contract-accurate function
          const multBps = computeMultiplierBps({
            numPriceBuckets: NUM_PRICE_BUCKETS,
            midPriceBucket: MID_PRICE_BUCKET,
            lockedColumnsAhead: LOCKED_COLUMNS_AHEAD,
            priceBucket: priceBucket,
            expiryBucket,
            currentBucket,
          });
          const multiplier = multBps / 10_000;
          
          // Check if there's a bet on this cell
          const bet = bets.find(b => b.columnIndex === col && b.rowIndex === priceBucket);
          
          // Color based on state
          let bgColor: string;
          let textColor: string;
          let strokeColor: string;
          const displayMultiplier = bet ? bet.multiplier : multiplier;
          
          if (bet?.status === 'won' || bet?.status === 'settled') {
            // Winning cell - bright green
            bgColor = 'rgba(34, 197, 94, 0.50)';
            textColor = '#22c55e';
            strokeColor = 'rgba(34, 197, 94, 1)';
          } else if (bet?.status === 'pending') {
            // Pending bet - yellow/orange
            bgColor = 'rgba(251, 191, 36, 0.30)';
            textColor = '#fbbf24';
            strokeColor = 'rgba(251, 191, 36, 0.80)';
          } else if (bet?.status === 'settling') {
            // Settling - pulsing blue
            bgColor = 'rgba(59, 130, 246, 0.30)';
            textColor = '#3b82f6';
            strokeColor = 'rgba(59, 130, 246, 0.80)';
          } else if (bet?.status === 'placed') {
            // Placed bet - cyan
            bgColor = 'rgba(6, 182, 212, 0.30)';
            textColor = '#06b6d4';
            strokeColor = 'rgba(6, 182, 212, 0.80)';
          } else if (bet?.status === 'error' || bet?.status === 'lost') {
            // Error/Lost - red
            bgColor = 'rgba(239, 68, 68, 0.30)';
            textColor = '#ef4444';
            strokeColor = 'rgba(239, 68, 68, 0.80)';
          } else if (col < currentTimeColumn && !bet) {
            // Past cells without bets - dimmed
            bgColor = 'rgba(71, 85, 105, 0.10)';
            textColor = '#64748b';
            strokeColor = 'rgba(71, 85, 105, 0.15)';
          } else {
            // Available cells - emerald with varying intensity
            const distanceFromMid = Math.abs(priceBucket - MID_PRICE_BUCKET);
            const opacity = Math.min(0.15 + distanceFromMid * 0.02, 0.25);
            bgColor = `rgba(16, 185, 129, ${opacity})`;
            textColor = '#10b981';
            strokeColor = 'rgba(16, 185, 129, 0.30)';
          }
          
          // Draw cell background
          ctx.fillStyle = bgColor;
          ctx.fillRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
          
          // Draw cell border
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = (bet?.status === 'won' || bet?.status === 'placed' ? 2 : 1) / scale;
          ctx.strokeRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
          
          // Draw glow effect if bet was won
          if (bet?.status === 'won' || bet?.status === 'settled') {
            const glowIntensity = 0.2 + 0.15 * Math.sin(Date.now() / 300);
            ctx.shadowColor = '#22c55e';
            ctx.shadowBlur = 15 / scale;
            ctx.fillStyle = `rgba(34, 197, 94, ${glowIntensity})`;
            ctx.fillRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
            ctx.shadowBlur = 0;
          }
          
          // Draw multiplier text - only if zoomed in enough
          const shouldDrawMultiplier = scale > 0.3;
          if (shouldDrawMultiplier) {
            ctx.fillStyle = textColor;
            const fontSize = Math.max(8, Math.min(14, 12 / scale));
            const fontWeight = bet?.status === 'won' ? 'bold' : 'normal';
            ctx.font = `${fontWeight} ${fontSize}px Inter, system-ui, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(
              `${displayMultiplier.toFixed(2)}x`,
              cellX + GRID_SIZE / 2,
              cellY + GRID_SIZE / 2
            );
          }
        }
      }
      
      // Reset text alignment
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // Draw price line
    if (priceHistory.length > 1 && currentPrice) {
      ctx.beginPath();
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2 / scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      let started = false;
      for (const point of priceHistory) {
        const x = ((point.timestamp - startTime) / TIME_PER_GRID) * GRID_SIZE;
        const y = ((referencePrice - point.price) / PRICE_PER_GRID) * GRID_SIZE;

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
      ctx.lineWidth = 6 / scale;
      ctx.stroke();

      // Draw current price indicator
      const latestX = ((currentPrice.timestamp - startTime) / TIME_PER_GRID) * GRID_SIZE;
      const latestY = ((referencePrice - currentPrice.price) / PRICE_PER_GRID) * GRID_SIZE;

      // Pulsing dot
      ctx.beginPath();
      ctx.arc(latestX, latestY, 6 / scale, 0, Math.PI * 2);
      ctx.fillStyle = '#00ff88';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(latestX, latestY, 10 / scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
      ctx.lineWidth = 2 / scale;
      ctx.stroke();

      // Current price label
      const fontSize = Math.max(10, Math.min(16, 14 / scale));
      ctx.fillStyle = '#00ff88';
      ctx.font = `bold ${fontSize}px Inter, system-ui, monospace`;
      const labelOffset = Math.max(15, 20 / scale);
      ctx.fillText(`$${currentPrice.price.toFixed(2)}`, latestX + labelOffset, latestY + 5 / scale);
    }

    ctx.restore();
  }, [canvasState, priceHistory, currentPrice, bets, currentBucket, earliestBettableBucket, isLoading, error]);

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
  
  const handleCanvasClick = async (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || priceHistory.length === 0 || !currentPrice || !currentBucket || !earliestBettableBucket) return;
    
    // Check wallet authentication
    if (!wallet.authenticated || !wallet.ready) {
      await wallet.login();
      return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const { offsetX, offsetY, scale } = canvasState;
    
    // Convert screen coordinates to world coordinates
    const worldX = (mouseX - offsetX) / scale;
    const worldY = (mouseY - offsetY) / scale;
    
    // Convert worldX to bucket number
    const clickedTimestamp = (worldX / GRID_SIZE) * TIME_PER_GRID + priceHistory[0].timestamp;
    const col = Math.floor(clickedTimestamp / (TIME_BUCKET_SECONDS * 1000));
    
    // Convert worldY to price bucket
    // Calculate where mid bucket is positioned
    const currentPriceValue = currentPrice.price;
    const currentPriceY = ((referencePriceRef.current - currentPriceValue) / PRICE_PER_GRID) * GRID_SIZE;
    const midBucketY = currentPriceY;
    
    // Calculate which price bucket was clicked
    const bucketOffsetFromMid = -Math.round((worldY - midBucketY) / GRID_SIZE);
    const priceBucket = MID_PRICE_BUCKET + bucketOffsetFromMid;
    
    // Validate price bucket is in range
    if (priceBucket < 0 || priceBucket >= NUM_PRICE_BUCKETS) {
      console.log('Clicked outside valid price bucket range');
      return;
    }
    
    // Only allow betting on cells in the bettable range
    if (col < earliestBettableBucket) {
      console.log('Cell is in the past or too close to current time');
      return;
    }
    
    // Check if a bet already exists on this cell
    const existingBet = bets.find(b => b.columnIndex === col && b.rowIndex === priceBucket);
    if (existingBet) {
      console.log('Bet already exists on this cell');
      return;
    }
    
    // Calculate expiry bucket for this column
    const expiryBucket = getExpiryBucket(currentBucket, LOCKED_COLUMNS_AHEAD, col - earliestBettableBucket);
    
    // Calculate multiplier using contract-accurate function
    const multBps = computeMultiplierBps({
      numPriceBuckets: NUM_PRICE_BUCKETS,
      midPriceBucket: MID_PRICE_BUCKET,
      lockedColumnsAhead: LOCKED_COLUMNS_AHEAD,
      priceBucket: priceBucket,
      expiryBucket,
      currentBucket,
    });
    const multiplier = multBps / 10_000;
    
    // Calculate the relative column index (column offset from first bettable bucket)
    const columnIndex = col - earliestBettableBucket;
    
    // Calculate expiry timestamp for settlement
    const expiryTimestampSecs = computeExpiryTimestampSecs(columnIndex);
    
    // Create pending bet
    const pendingBet: BetState = {
      rowIndex: priceBucket,
      columnIndex: col,
      multiplier,
      stake: stakeAmount,
      status: 'pending',
      placedAt: Date.now(),
      expiryTimestampSecs,
      priceFeedId: PYTH_PRICE_IDS.ETH_USD, // Store price feed for later settlement
    };
    
    setBets(prev => [...prev, pendingBet]);
    
    try {
      // Convert APT to octas (1 APT = 100,000,000 octas)
      const stakeInOctas = Math.floor(stakeAmount * 100_000_000);
      
      // Place bet on chain using relative column index
      const result = await placeBet({
        rowIndex: priceBucket,
        columnIndex: columnIndex, // Use relative column index
        stakeAmount: stakeInOctas.toString(),
      });

      wallet.refreshBalance();
      
      // Update bet with success and automatically extracted bet ID
      setBets(prev => prev.map(b => 
        b.rowIndex === priceBucket && b.columnIndex === col
          ? { 
              ...b, 
              status: 'placed', 
              txHash: result.txHash,
              betId: result.betId || undefined, // Store bet ID if extracted
            }
          : b
      ));
      
      if (result.betId) {
        console.log(`\u2705 Bet placed with ID: ${result.betId}`);
      } else {
        console.warn('\u26a0\ufe0f Bet placed but ID not extracted - will need manual entry for settlement');
      }
    } catch (error: unknown) {
      console.error('Failed to place bet:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to place bet';
      
      // Update bet with error
      setBets(prev => prev.map(b => 
        b.rowIndex === priceBucket && b.columnIndex === col
          ? { ...b, status: 'error', errorMessage }
          : b
      ));
      
      // Remove error bets after 3 seconds
      setTimeout(() => {
        setBets(prev => prev.filter(b => !(b.rowIndex === priceBucket && b.columnIndex === col && b.status === 'error')));
      }, 3000);
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };
  
  /**
   * Auto-settle all eligible bets
   */
  const handleAutoSettle = async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    console.log('Auto-settling bets at', new Date().toISOString());
    
    // Find all bets that are placed/won/lost and past their expiry time
    const eligibleBets = bets.filter(bet => 
      (bet.status === 'placed' || bet.status === 'won' || bet.status === 'lost') &&
      bet.expiryTimestampSecs && 
      bet.expiryTimestampSecs <= nowSec
    );
    
    if (eligibleBets.length === 0) {
      alert('No eligible bets to settle');
      return;
    }
    
    console.log(`Auto-settling ${eligibleBets.length} eligible bets...`);
    
    // Settle sequentially to avoid overwhelming the network
    for (const bet of eligibleBets) {
      try {
        console.log(`Settling bet at row ${bet.rowIndex}, col ${bet.columnIndex}...`);
        await handleSettleBet(bet);
        // Small delay between settlements
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to settle bet at row ${bet.rowIndex}, col ${bet.columnIndex}:`, error);
        // Continue with next bet
      }
    }
  };

  // Calculate eligible bets for settlement
  const nowSec = Math.floor(Date.now() / 1000);
  const eligibleForSettlement = bets.filter(bet => 
    (bet.status === 'placed' || bet.status === 'won' || bet.status === 'lost') &&
    bet.expiryTimestampSecs && 
    bet.expiryTimestampSecs <= nowSec
  );

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
    <>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100vw',
          height: '100vh',
          cursor: isDragging ? 'grabbing' : 'grab',
          backgroundColor: '#0a0a0f',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />
      <FloatingBetButton
        stakeAmount={stakeAmount}
        onStakeChange={setStakeAmount}
        minBet={0.01}
        maxBet={100}
      />
      
      {/* Bets Panel - Shows active bets with settlement options */}
      {bets.length > 0 && (
        <div className="fixed top-20 right-4 w-80 max-h-[70vh] bg-gradient-to-br from-purple-900/90 to-indigo-900/90 backdrop-blur-md rounded-xl shadow-2xl border border-purple-500/30 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-purple-500/30">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-white font-bold text-lg">Active Bets ({bets.length})</h3>
              {eligibleForSettlement.length > 0 && (
                <button
                  onClick={handleAutoSettle}
                  disabled={isSettling}
                  className="px-3 py-1 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-semibold transition-all shadow-lg"
                >
                  {isSettling ? 'Settling...' : `Settle ${eligibleForSettlement.length}`}
                </button>
              )}
            </div>
          </div>
          
          {/* Bet List */}
          <div className="overflow-y-auto p-2 space-y-2">
            {bets.map((bet, idx) => {
              const isEligible = (bet.status === 'placed' || bet.status === 'won' || bet.status === 'lost') && bet.expiryTimestampSecs && bet.expiryTimestampSecs <= nowSec;
              const needsBetId = isEligible && !bet.betId;
              
              return (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border backdrop-blur-sm ${
                    bet.status === 'won' 
                      ? 'bg-green-500/20 border-green-500/50'
                      : bet.status === 'lost'
                      ? 'bg-red-500/20 border-red-500/50'
                      : bet.status === 'settling'
                      ? 'bg-blue-500/20 border-blue-500/50'
                      : bet.status === 'settled'
                      ? 'bg-blue-400/20 border-blue-400/50'
                      : bet.status === 'pending'
                      ? 'bg-yellow-500/20 border-yellow-500/50'
                      : isEligible
                      ? 'bg-purple-500/20 border-purple-400/50'
                      : 'bg-purple-500/10 border-purple-500/30'
                  }`}
                >
                  {/* Bet Info */}
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-white font-semibold text-sm">
                        ${(bet.stake * bet.multiplier).toFixed(2)} potential
                      </div>
                      <div className="text-purple-200 text-xs">
                        {bet.stake.toFixed(3)} APT × {bet.multiplier.toFixed(2)}x
                      </div>
                    </div>
                    <div className={`text-xs font-bold px-2 py-1 rounded ${
                      bet.status === 'won' ? 'bg-green-500 text-white'
                      : bet.status === 'lost' ? 'bg-red-500 text-white'
                      : bet.status === 'settling' ? 'bg-blue-500 text-white'
                      : bet.status === 'settled' ? 'bg-blue-400 text-white'
                      : bet.status === 'pending' ? 'bg-yellow-500 text-white'
                      : isEligible ? 'bg-purple-500 text-white'
                      : 'bg-purple-700 text-purple-200'
                    }`}>
                      {bet.status === 'settling' ? 'SETTLING...' 
                       : bet.status === 'settled' ? 'SETTLED'
                       : isEligible ? 'READY'
                       : bet.status.toUpperCase()}
                    </div>
                  </div>
                  
                  {/* Position */}
                  <div className="text-purple-300 text-xs mb-2">
                    Row {bet.rowIndex} • Col {bet.columnIndex - (earliestBettableBucket || 0)}
                    {bet.expiryTimestampSecs && (
                      <span className="ml-2">
                        • Expires: {new Date(bet.expiryTimestampSecs * 1000).toLocaleTimeString()}
                      </span>
                    )}
                    {needsBetId && (
                      <div className="mt-1 text-yellow-400 font-semibold">
                        ⚠️ Needs Bet ID to settle
                      </div>
                    )}
                  </div>
                  
                  {/* Actions */}
                  {isEligible && (
                    <button
                      onClick={() => handleSettleBet(bet)}
                      disabled={isSettling || bet.status === 'settling'}
                      className="w-full mt-2 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-xs font-semibold transition-all"
                    >
                      {bet.status === 'settling' ? 'Settling...' : needsBetId ? 'Enter Bet ID & Settle' : 'Settle Bet'}
                    </button>
                  )}
                  
                  {/* Transaction Hash */}
                  {bet.txHash && (
                    <div className="mt-2 text-xs text-purple-300 truncate">
                      Tx: {bet.txHash.slice(0, 8)}...{bet.txHash.slice(-6)}
                    </div>
                  )}
                  
                  {/* Error Message */}
                  {bet.errorMessage && (
                    <div className="mt-2 text-xs text-red-400">
                      Error: {bet.errorMessage}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {/* Footer */}
          <div className="p-3 border-t border-purple-500/30 text-xs text-purple-300 text-center">
            {eligibleForSettlement.length > 0 
              ? `${eligibleForSettlement.length} bet(s) ready to settle`
              : 'No bets ready to settle yet'}
          </div>
        </div>
      )}
    </>
  );
}