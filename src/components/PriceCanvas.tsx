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
  getCurrentBucket,
} from '../config/tapMarket';
import { computeMultiplierBps } from '../lib/multipliers';
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
  priceBucket: number;   // Absolute price bucket index (0 to NUM_PRICE_BUCKETS-1)
  timeBucket: number;    // Absolute time bucket index (expiryBucket from contract)
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
  const { placeBet, settleBetNoPyth, isSettling, isPlacing, queueLength } = useTapMarket(
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
  const [showWinNotification, setShowWinNotification] = useState<{ 
    show: boolean; 
    won: boolean; 
    payout: string;
    betId: string;
  } | null>(null);
  const [stakeAmount, setStakeAmount] = useState<number>(0.01); // Default 0.01 APT
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
  const [canvasState, setCanvasState] = useState<CanvasState>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });

  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  
  // Reference price for Y-axis scaling (rounded UP to next 0.5 to ensure initial price is in middle bucket)
  // This ensures: initialPrice <= referencePrice < initialPrice + PRICE_PER_GRID
  const referencePriceRef = useRef<number>(Math.ceil((priceHistory[0]?.price || 100) / PRICE_PER_GRID) * PRICE_PER_GRID);
  
  // Update reference price when data first arrives
  useEffect(() => {
    if (priceHistory.length > 0 && referencePriceRef.current === Math.ceil(100 / PRICE_PER_GRID) * PRICE_PER_GRID) {
      referencePriceRef.current = Math.ceil(priceHistory[0].price / PRICE_PER_GRID) * PRICE_PER_GRID;
    }
  }, [priceHistory]);

  /**
   * Convert a price value to its static price bucket using the grid coordinate system
   * This uses the SAME formula as the grid drawing to ensure consistency
   */
  const convertPriceToPriceBucket = useCallback((price: number): number => {
    const referencePrice = referencePriceRef.current;
    
    // Calculate world Y coordinate for this price
    const worldY = ((referencePrice - price) / PRICE_PER_GRID) * GRID_SIZE;
    
    // Convert to grid row using Math.floor to align with visual cell boundaries
    // Each cell owns y from [n*GRID_SIZE, (n+1)*GRID_SIZE)
    const gridRow = Math.floor(worldY / GRID_SIZE);
    
    // Calculate which price bucket this grid row represents
    const priceBucket = MID_PRICE_BUCKET - gridRow;
    
    console.log('🎯 Converting price to bucket:', {
      price: price.toFixed(4),
      referencePrice,
      worldY: worldY.toFixed(2),
      gridRow,
      priceBucket,
      cellBoundary: `y=${gridRow * GRID_SIZE} to ${(gridRow + 1) * GRID_SIZE}`,
    });
    
    return priceBucket;
  }, []);
  
  /**
   * Check if current price intersects with a bet's cell
   * A bet should be settled when:
   * 1. The bet's time bucket has expired (current time >= expiryTimestampSecs)
   * 2. The current price's priceBucket matches the bet's priceBucket
   */
  const doesPriceIntersectBet = useCallback((bet: BetState): boolean => {
    if (!currentPrice) return false;
    
    // Convert current price to price bucket using static grid formula
    const currentPriceBucket = convertPriceToPriceBucket(currentPrice.price);
    
    // ONLY exact match - no tolerance
    // Settlement determines win/loss, so we must be precise
    const exactMatch = currentPriceBucket === bet.priceBucket;
    
    if (exactMatch) {
      console.log(`✅ EXACT MATCH: Price in bet bucket ${bet.priceBucket} (current price: $${currentPrice.price.toFixed(4)}, calculated bucket: ${currentPriceBucket})`);
    }
    
    return exactMatch;
  }, [currentPrice, convertPriceToPriceBucket]);

  /**
   * Settle a single bet on-chain using no-pyth method
   */
  const handleSettleBet = useCallback(async (bet: BetState) => {
    console.log(`Settling bet at price bucket ${bet.priceBucket}, time bucket ${bet.timeBucket}...`);
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
      b.priceBucket === bet.priceBucket && b.timeBucket === bet.timeBucket
        ? { ...b, status: 'settling' }
        : b
    ));
    
    try {
      // Use no-pyth settlement with current price
      console.log('🔴 Attempting to settle bet:', {
        betId: bet.betId,
        betPriceBucket: bet.priceBucket,
        betTimeBucket: bet.timeBucket,
        currentPrice: currentPrice.price,
        referencePrice: referencePriceRef.current,
      });
      
      const settlementResult = await settleBetNoPyth({
        betId: bet.betId!,  // Non-null assertion - we checked above
        currentPrice: currentPrice.price,
        referencePrice: referencePriceRef.current,
      });
      
      console.log('✅ Bet settled successfully:', settlementResult);
      
      // Show win/loss notification if we have the result
      if (settlementResult) {
        const payoutInMove = Number(settlementResult.payout) / 100_000_000; // Convert octas to MOVE
        setShowWinNotification({
          show: true,
          won: settlementResult.won,
          payout: payoutInMove.toFixed(4),
          betId: settlementResult.betId,
        });
        
        // Auto-hide notification after 5 seconds
        setTimeout(() => {
          setShowWinNotification(null);
        }, 5000);
      }
      
      // Update bet status to settled
      setBets(prev => prev.map(b => 
        b.priceBucket === bet.priceBucket && b.timeBucket === bet.timeBucket
          ? { 
              ...b, 
              status: settlementResult?.won ? 'won' : 'lost',
            }
          : b
      ));
      
      // Refresh wallet balance
      wallet.refreshBalance();
    } catch (error: unknown) {
      console.error('Failed to settle bet:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to settle bet';
      
      // Check for common error patterns
      if (errorMessage.includes('E_EXPIRY_TOO_SOON') || errorMessage.includes('0x10006')) {
        // Bet not expired yet - silently keep in 'placed' status for auto-retry
        console.log(`⏳ Bet ${bet.betId} not expired yet, will retry later`);
        
        // Revert to placed status without showing alert (will auto-retry)
        setBets(prev => prev.map(b => 
          b.priceBucket === bet.priceBucket && b.timeBucket === bet.timeBucket
            ? { ...b, status: 'placed' }
            : b
        ));
        return; // Exit without showing alert
      }
      
      // For other errors, show alerts
      if (errorMessage.includes('0x6507')) {
        alert(
          `Settlement failed: Bet ID ${bet.betId} not found on-chain.\n\n` +
          `This could mean:\n` +
          `• The bet was already settled\n` +
          `• The bet ID was extracted incorrectly\n` +
          `• Transaction: ${bet.txHash}\n\n` +
          `Check the explorer to verify the bet status.`
        );
      } else if (errorMessage.includes('E_BET_ALREADY_SETTLED') || errorMessage.includes('0x10009')) {
        // Bet already settled - just log it, don't alert
        console.log(`✅ Bet ${bet.betId} already settled`);
        // Remove from active bets or mark as settled
        setBets(prev => prev.filter(b => 
          !(b.priceBucket === bet.priceBucket && b.timeBucket === bet.timeBucket)
        ));
        return;
      } else {
        alert(`Settlement failed: ${errorMessage}`);
      }
      
      // Revert to placed status on error
      setBets(prev => prev.map(b => 
        b.priceBucket === bet.priceBucket && b.timeBucket === bet.timeBucket
          ? { ...b, status: 'placed', errorMessage }
          : b
      ));
    }
  }, [settleBetNoPyth, wallet, currentPrice]);

  
  // Auto-trigger settlement when price moves and intersects with bet cells
  // This effect runs on EVERY price update to check for settlements
  // NOTE: This auto-settles when CURRENT price enters the bet bucket after expiry
  // In a real production app, you'd want to settle based on price AT expiry time
  useEffect(() => {
    if (!currentBucket || !wallet.authenticated || !currentPrice) return;
    
    const nowSec = Math.floor(Date.now() / 1000);
    
    console.log('🔍 Settlement check:', {
      currentPrice: currentPrice.price,
      currentPriceBucket: convertPriceToPriceBucket(currentPrice.price),
      currentBucket,
      totalBets: bets.length,
      placedBets: bets.filter(b => b.status === 'placed').length,
    });
    
    // Find bets that should be settled:
    // 1. Status is 'placed' (not already settled/settling)
    // 2. Past their expiry time (with safety buffer)
    // 3. Have a bet ID from the blockchain
    // 4. Current price is within their cell (price bucket matches EXACTLY)
    const betsToSettle = bets.filter(bet => {
      if (bet.status !== 'placed') return false;
      if (!bet.expiryTimestampSecs || !bet.betId) return false;
      
      // Check if bet has expired (with 5 second safety buffer)
      const hasExpired = bet.expiryTimestampSecs + 5 <= nowSec;
      if (!hasExpired) {
        console.log(`⏳ Bet ${bet.betId} not expired yet (expires at ${bet.expiryTimestampSecs}, now is ${nowSec})`);
        return false;
      }
      
      // Check if current price intersects with this bet's cell (EXACT match only)
      const intersects = doesPriceIntersectBet(bet);
      if (intersects) {
        console.log(`🎯 Bet ${bet.betId} at bucket ${bet.priceBucket} is ready to settle!`);
      }
      return intersects;
    });
    
    if (betsToSettle.length > 0) {
      console.log(`🎯 Found ${betsToSettle.length} bet(s) ready for settlement at current price $${currentPrice.price.toFixed(4)}`);
    }
    
    // Settle one bet at a time (to avoid overwhelming the network)
    if (betsToSettle.length > 0 && !isSettling) {
      const betToSettle = betsToSettle[0];
      console.log('🔄 Auto-settling bet:', {
        priceBucket: betToSettle.priceBucket,
        timeBucket: betToSettle.timeBucket,
        betId: betToSettle.betId,
        currentPrice: currentPrice.price,
      });
      handleSettleBet(betToSettle).catch(err => {
        console.error('Auto-settlement failed:', err);
      });
    }
  }, [currentPrice, currentBucket, bets, wallet.authenticated, isSettling, handleSettleBet, doesPriceIntersectBet]);

  // Clean up old bets periodically
  useEffect(() => {
    if (!currentBucket) return;
    
    setBets(prevBets => {
      return prevBets.filter(bet => {
        // Keep pending, error, and settling bets
        if (bet.status === 'pending' || bet.status === 'error' || bet.status === 'settling') return true;
        
        // Remove settled/won/lost bets that are more than 2 time buckets behind current
        const bucketsBehind = currentBucket - bet.timeBucket;
        return bucketsBehind <= 2;
      });
    });
  }, [currentBucket]);

  // Set initial viewport position when price data arrives (one-time only)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (priceHistory.length > 0 && !initializedRef.current && currentPrice) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const startTime = priceHistory[0].timestamp;
      const timeX = ((currentPrice.timestamp - startTime) / TIME_PER_GRID) * GRID_SIZE;
      const priceY = ((referencePriceRef.current - currentPrice.price) / PRICE_PER_GRID) * GRID_SIZE;

      // Set initial position (center on current price)
      setCanvasState((prev) => ({
        ...prev,
        offsetX: -timeX + canvas.width / 2 - 100,
        offsetY: -priceY + canvas.height / 2,
      }));
      initializedRef.current = true;
    }
  }, [priceHistory, currentPrice]);

  // Free viewport - no automatic following of price
  // Users can pan around freely using mouse drag

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
    
    // Show loading state for wallet initialization
    if (!wallet.ready || (wallet.authenticated && !wallet.aptosSigner)) {
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#666';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Initializing wallet...', width / 2, height / 2);
      return;
    }
    
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

    // Draw grid with integrated betting cells
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;

    // Draw grid squares with betting information integrated
    // Loop through visible grid cells
    const startGridX = Math.floor(visibleLeft / GRID_SIZE) * GRID_SIZE;
    const startGridY = Math.floor(visibleTop / GRID_SIZE) * GRID_SIZE;
    const endGridX = Math.ceil(visibleRight / GRID_SIZE) * GRID_SIZE;
    const endGridY = Math.ceil(visibleBottom / GRID_SIZE) * GRID_SIZE;

    // Draw each grid cell
    for (let x = startGridX; x < endGridX; x += GRID_SIZE) {
      for (let y = startGridY; y < endGridY; y += GRID_SIZE) {
        // Draw cell border
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, GRID_SIZE, GRID_SIZE);

        // Only process betting logic if we have current data
        if (currentBucket && earliestBettableBucket && currentPrice) {
          // Calculate what time bucket this X position represents
          const timeOffset = (x / GRID_SIZE) * TIME_PER_GRID;
          const cellTimestamp = startTime + timeOffset;
          const timeBucket = Math.floor(cellTimestamp / (TIME_BUCKET_SECONDS * 1000));

          // Calculate what price bucket this Y position represents (STATIC mapping)
          // Use Math.floor to align with visual cell boundaries
          const gridRow = Math.floor(y / GRID_SIZE);
          const priceBucket = MID_PRICE_BUCKET - gridRow;

          // Calculate the price at this cell for range checking
          const priceAtThisY = referencePrice - (gridRow * PRICE_PER_GRID);

          // Check if this is a valid betting cell
          const isValidPriceBucket = priceBucket >= 0 && priceBucket < NUM_PRICE_BUCKETS;
          const isInFuture = timeBucket >= earliestBettableBucket;
          const currentPriceValue = currentPrice.price;
          const isPriceInRange = Math.abs(priceAtThisY - currentPriceValue) < (NUM_PRICE_BUCKETS / 2) * PRICE_PER_GRID;

          if (isValidPriceBucket && (isInFuture || timeBucket >= currentBucket - 5)) {
            // Calculate multiplier
            const multBps = computeMultiplierBps({
              numPriceBuckets: NUM_PRICE_BUCKETS,
              midPriceBucket: MID_PRICE_BUCKET,
              lockedColumnsAhead: LOCKED_COLUMNS_AHEAD,
              priceBucket: priceBucket,
              expiryBucket: timeBucket,
              currentBucket,
            });
            const multiplier = multBps / 10_000;

            // Check if there's a bet on this cell
            const bet = bets.find(b => b.timeBucket === timeBucket && b.priceBucket === priceBucket);

            // Determine cell styling based on state
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
            } else if (!isInFuture || !isPriceInRange) {
              // Past cells or out of range - dimmed (don't draw background)
              bgColor = '';
              textColor = '';
              strokeColor = '';
            } else {
              // Available cells - emerald with varying intensity
              const distanceFromMid = Math.abs(priceBucket - MID_PRICE_BUCKET);
              const opacity = Math.min(0.15 + distanceFromMid * 0.02, 0.25);
              bgColor = `rgba(16, 185, 129, ${opacity})`;
              textColor = '#10b981';
              strokeColor = 'rgba(16, 185, 129, 0.30)';
            }

            // Draw cell background if there's color
            if (bgColor) {
              ctx.fillStyle = bgColor;
              ctx.fillRect(x, y, GRID_SIZE, GRID_SIZE);
            }

            // Draw enhanced border for bets
            if (strokeColor) {
              ctx.strokeStyle = strokeColor;
              ctx.lineWidth = (bet?.status === 'won' || bet?.status === 'placed' ? 2 : 1) / scale;
              ctx.strokeRect(x, y, GRID_SIZE, GRID_SIZE);
            }

            // Draw glow effect if bet was won
            if (bet?.status === 'won' || bet?.status === 'settled') {
              const glowIntensity = 0.2 + 0.15 * Math.sin(Date.now() / 300);
              ctx.shadowColor = '#22c55e';
              ctx.shadowBlur = 15 / scale;
              ctx.fillStyle = `rgba(34, 197, 94, ${glowIntensity})`;
              ctx.fillRect(x, y, GRID_SIZE, GRID_SIZE);
              ctx.shadowBlur = 0;
            }

            // Draw multiplier text - only if zoomed in enough and there's text color
            const shouldDrawMultiplier = scale > 0.3 && textColor;
            if (shouldDrawMultiplier) {
              ctx.fillStyle = textColor;
              const fontSize = Math.max(8, Math.min(14, 12 / scale));
              const fontWeight = bet?.status === 'won' ? 'bold' : 'normal';
              ctx.font = `${fontWeight} ${fontSize}px Inter, system-ui, monospace`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(
                `${displayMultiplier.toFixed(2)}x`,
                x + GRID_SIZE / 2,
                y + GRID_SIZE / 2
              );
            }
          }
        }
      }
    }

    // Draw price labels on left side
    ctx.fillStyle = '#666';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (let y = startGridY; y < endGridY; y += GRID_SIZE) {
      const price = referencePrice - (y / GRID_SIZE) * PRICE_PER_GRID;
      ctx.fillText(`$${price.toFixed(2)}`, visibleLeft + 5, y - 5);
    }

    // Draw time labels at bottom (every 10 grid cells)
    for (let x = startGridX; x < endGridX; x += GRID_SIZE * 10) {
      const timeOffset = (x / GRID_SIZE) * TIME_PER_GRID;
      const date = new Date(startTime + timeOffset);
      const timeStr = date.toLocaleTimeString();
      ctx.fillText(timeStr, x + 5, visibleBottom - 10);
    }

    // Draw price line
    if (priceHistory.length > 1 && currentPrice) {
      ctx.beginPath();
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2 / scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw smooth bezier curves through price points
      if (priceHistory.length > 0) {
        const points = priceHistory.map(point => ({
          x: ((point.timestamp - startTime) / TIME_PER_GRID) * GRID_SIZE,
          y: ((referencePrice - point.price) / PRICE_PER_GRID) * GRID_SIZE,
        }));

        ctx.moveTo(points[0].x, points[0].y);

        if (points.length === 2) {
          // Just draw a line for 2 points
          ctx.lineTo(points[1].x, points[1].y);
        } else if (points.length > 2) {
          // Use quadratic curves for smooth interpolation
          for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i + 1];
            
            if (i === points.length - 2) {
              // Last segment - draw directly to end point
              ctx.lineTo(p1.x, p1.y);
            } else {
              // Create smooth curve using quadratic bezier
              const p2 = points[i + 2];
              const cpX = p1.x;
              const cpY = p1.y;
              const endX = (p1.x + p2.x) / 2;
              const endY = (p1.y + p2.y) / 2;
              
              ctx.quadraticCurveTo(cpX, cpY, endX, endY);
            }
          }
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
      
      // Highlight the cell that the current price is in
      if (currentBucket && earliestBettableBucket) {
        const currentPriceBucket = convertPriceToPriceBucket(currentPrice.price);
        const currentTimeBucket = Math.floor(currentPrice.timestamp / (TIME_BUCKET_SECONDS * 1000));
        
        // Calculate cell position using EXACT same formula as grid drawing
        // Convert price bucket back to world coordinates
        const bucketsFromMid = MID_PRICE_BUCKET - currentPriceBucket;
        const worldY = bucketsFromMid * GRID_SIZE; // Direct conversion - no extra calculation
        
        // Snap to grid cell (floor to get top-left corner of cell)
        const cellGridRow = Math.floor(worldY / GRID_SIZE);
        const cellY = cellGridRow * GRID_SIZE;
        
        // Calculate X position - snap to grid cell
        const cellTimestamp = currentTimeBucket * TIME_BUCKET_SECONDS * 1000;
        const worldX = ((cellTimestamp - startTime) / TIME_PER_GRID) * GRID_SIZE;
        const cellGridCol = Math.floor(worldX / GRID_SIZE);
        const cellX = cellGridCol * GRID_SIZE;
        
        // Draw a glowing border around the current price cell
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
        ctx.lineWidth = 3 / scale;
        ctx.strokeRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
        
        // Draw subtle fill
        ctx.fillStyle = 'rgba(0, 255, 136, 0.1)';
        ctx.fillRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
        
        // Debug log
        console.log('🟩 Current price cell:', {
          price: currentPrice.price.toFixed(4),
          priceBucket: currentPriceBucket,
          timeBucket: currentTimeBucket,
          bucketsFromMid,
          cellY,
          cellX,
          worldY,
          worldX,
        });
      }

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

    // Draw hovered cell highlight
    if (hoveredCell && currentPrice && currentBucket && earliestBettableBucket) {
      const { row: priceBucket, col: timeBucket } = hoveredCell;
      
      // Calculate cell position - must snap to grid boundaries
      // Y position: priceBucket -> gridRow -> snap to GRID_SIZE
      const gridRow = MID_PRICE_BUCKET - priceBucket;
      const cellY = gridRow * GRID_SIZE;
      
      // X position: timeBucket -> timestamp -> world position -> snap to GRID_SIZE
      const cellTimestamp = timeBucket * TIME_BUCKET_SECONDS * 1000;
      const timeOffset = cellTimestamp - startTime;
      const worldX = (timeOffset / TIME_PER_GRID) * GRID_SIZE;
      const cellX = Math.floor(worldX / GRID_SIZE) * GRID_SIZE; // Snap to grid boundaries
      
      // Draw glowing border
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.8)'; // Purple glow
      ctx.lineWidth = 3 / scale;
      ctx.strokeRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
      
      // Draw inner highlight
      ctx.fillStyle = 'rgba(139, 92, 246, 0.15)';
      ctx.fillRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
      
      // Draw animated glow effect
      const glowIntensity = 0.3 + 0.2 * Math.sin(Date.now() / 200);
      ctx.shadowColor = '#8b5cf6';
      ctx.shadowBlur = 20 / scale;
      ctx.strokeStyle = `rgba(139, 92, 246, ${glowIntensity})`;
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(cellX, cellY, GRID_SIZE, GRID_SIZE);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }, [canvasState, priceHistory, currentPrice, bets, currentBucket, earliestBettableBucket, isLoading, error, hoveredCell, convertPriceToPriceBucket]);

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
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isDragging) {
      const deltaX = e.clientX - lastMousePos.x;
      const deltaY = e.clientY - lastMousePos.y;

      setCanvasState((prev) => ({
        ...prev,
        offsetX: prev.offsetX + deltaX,
        offsetY: prev.offsetY + deltaY,
      }));

      setLastMousePos({ x: e.clientX, y: e.clientY });
    } else {
      // Update hovered cell when not dragging
      if (priceHistory.length > 0 && currentPrice && currentBucket && earliestBettableBucket) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const { offsetX, offsetY, scale } = canvasState;
        
        // Convert screen coordinates to world coordinates
        const worldX = (mouseX - offsetX) / scale;
        const worldY = (mouseY - offsetY) / scale;
        
        // Convert worldX to time bucket (absolute bucket index)
        const clickedTimestamp = (worldX / GRID_SIZE) * TIME_PER_GRID + priceHistory[0].timestamp;
        const timeBucket = Math.floor(clickedTimestamp / (TIME_BUCKET_SECONDS * 1000));
        
        // Convert worldY to price bucket using STATIC grid mapping (Math.floor for cell boundaries)
        const gridRow = Math.floor(worldY / GRID_SIZE);
        const priceBucket = MID_PRICE_BUCKET - gridRow;
        
        // Only show hover if it's a valid, bettable cell
        if (
          priceBucket >= 0 && 
          priceBucket < NUM_PRICE_BUCKETS &&
          timeBucket >= earliestBettableBucket &&
          !bets.find(b => b.timeBucket === timeBucket && b.priceBucket === priceBucket)
        ) {
          setHoveredCell({ row: priceBucket, col: timeBucket });
        } else {
          setHoveredCell(null);
        }
      } else {
        setHoveredCell(null);
      }
    }
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
    
    // Check wallet authentication and signer availability
    if (!wallet.authenticated || !wallet.ready || !wallet.aptosSigner) {
      if (!wallet.authenticated) {
        await wallet.login();
      } else {
        console.log('Wallet not fully initialized yet, please wait...');
        alert('Wallet is still initializing. Please wait a moment and try again.');
      }
      return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const { offsetX, offsetY, scale } = canvasState;
    
    // Convert screen coordinates to world coordinates
    const worldX = (mouseX - offsetX) / scale;
    const worldY = (mouseY - offsetY) / scale;
    
    // Snap to grid cell for X (which cell are we clicking in?)
    const gridCol = Math.floor(worldX / GRID_SIZE);
    const cellX = gridCol * GRID_SIZE;
    
    // Convert cellX to time bucket
    const timeOffset = (cellX / GRID_SIZE) * TIME_PER_GRID;
    const clickedTimestamp = priceHistory[0].timestamp + timeOffset;
    const timeBucket = Math.floor(clickedTimestamp / (TIME_BUCKET_SECONDS * 1000));
    
    // Convert worldY to price bucket using STATIC grid mapping (Math.floor for cell boundaries)
    const gridRow = Math.floor(worldY / GRID_SIZE);
    const priceBucket = MID_PRICE_BUCKET - gridRow;
    
    // Validate price bucket is in range
    if (priceBucket < 0 || priceBucket >= NUM_PRICE_BUCKETS) {
      console.log('Clicked outside valid price bucket range');
      return;
    }
    
    // Double-check with fresh calculation to avoid race conditions
    const freshCurrentBucket = getCurrentBucket();
    const freshEarliestBettable = freshCurrentBucket + LOCKED_COLUMNS_AHEAD + 1;
    
    // Only allow betting on cells in the bettable range (with safety check)
    if (timeBucket < earliestBettableBucket || timeBucket < freshEarliestBettable) {
      console.log('Cell is in the past or too close to current time', {
        timeBucket,
        earliestBettableBucket,
        freshEarliestBettable,
      });
      alert('This cell is too close to the current time. Please select a cell further in the future.');
      return;
    }
    
    // Check if a bet already exists on this cell using STATIC coordinates
    const existingBet = bets.find(b => b.timeBucket === timeBucket && b.priceBucket === priceBucket);
    if (existingBet) {
      console.log('Bet already exists on this cell');
      return;
    }
    
    // Calculate multiplier using contract-accurate function
    // timeBucket IS the expiryBucket (they're the same in our static model)
    const multBps = computeMultiplierBps({
      numPriceBuckets: NUM_PRICE_BUCKETS,
      midPriceBucket: MID_PRICE_BUCKET,
      lockedColumnsAhead: LOCKED_COLUMNS_AHEAD,
      priceBucket: priceBucket,
      expiryBucket: timeBucket, // Use timeBucket directly as expiryBucket
      currentBucket,
    });
    const multiplier = multBps / 10_000;
    
    // Calculate the relative column index for the contract call
    // Contract expects columnIndex relative to first bettable bucket
    const relativeColumnIndex = timeBucket - earliestBettableBucket;
    
    // Calculate expiry timestamp for settlement
    const expiryTimestampSecs = computeExpiryTimestampSecs(relativeColumnIndex);
    
    // Create pending bet with STATIC coordinates
    const pendingBet: BetState = {
      priceBucket: priceBucket,      // Static price bucket index
      timeBucket: timeBucket,         // Static time bucket index (absolute)
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
        columnIndex: relativeColumnIndex, // Use relative column index for contract
        stakeAmount: stakeInOctas.toString(),
      });

      wallet.refreshBalance();
      
      // Update bet with success and automatically extracted bet ID
      setBets(prev => prev.map(b => 
        b.priceBucket === priceBucket && b.timeBucket === timeBucket
          ? { 
              ...b, 
              status: 'placed', 
              txHash: result.txHash,
              betId: result.betId || undefined, // Store bet ID if extracted
            }
          : b
      ));
      
      if (result.betId) {
        console.log(`✅ Bet placed with ID: ${result.betId}`);
      } else {
        console.warn('⚠️ Bet ID not yet extracted - will poll for it...');
        
        // Poll for bet ID in background
        let attempts = 0;
        const maxAttempts = 10; // Try for ~10 seconds
        const pollInterval = setInterval(async () => {
          attempts++;
          try {
            const { extractBetIdFromTransaction } = await import('../lib/aptosClient');
            const betId = await extractBetIdFromTransaction(result.txHash);
            
            if (betId) {
              console.log(`✅ Bet ID extracted via polling: ${betId}`);
              clearInterval(pollInterval);
              
              // Update bet with extracted ID
              setBets(prev => prev.map(b => 
                b.txHash === result.txHash && !b.betId
                  ? { ...b, betId }
                  : b
              ));
            } else if (attempts >= maxAttempts) {
              console.warn('⚠️ Could not extract bet ID after polling');
              clearInterval(pollInterval);
            }
          } catch (err) {
            console.error('Error polling for bet ID:', err);
            if (attempts >= maxAttempts) {
              clearInterval(pollInterval);
            }
          }
        }, 1000); // Poll every second
      }
    } catch (error: unknown) {
      console.error('Failed to place bet:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to place bet';
      
      // Update bet with error
      setBets(prev => prev.map(b => 
        b.priceBucket === priceBucket && b.timeBucket === timeBucket
          ? { ...b, status: 'error', errorMessage }
          : b
      ));
      
      // Remove error bets after 3 seconds
      setTimeout(() => {
        setBets(prev => prev.filter(b => !(b.priceBucket === priceBucket && b.timeBucket === timeBucket && b.status === 'error')));
      }, 3000);
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoveredCell(null);
  };
  
  /**
   * Auto-settle all eligible bets
   */
  const handleAutoSettle = async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    console.log('Auto-settling bets at', new Date().toISOString());
    
    // Find all bets that are placed (not settled), past their expiry time, AND price intersects their cell
    // Add 5 second buffer to ensure bets are truly expired
    const eligibleBets = bets.filter(bet => 
      bet.status === 'placed' && // Only settle bets that haven't been settled yet
      bet.expiryTimestampSecs && 
      bet.expiryTimestampSecs + 5 <= nowSec && // Add 5 second safety buffer
      doesPriceIntersectBet(bet) // Only settle if current price intersects this bet's cell
    );
    
    if (eligibleBets.length === 0) {
      alert('No eligible bets to settle');
      return;
    }
    
    console.log(`Auto-settling ${eligibleBets.length} eligible bets...`);
    
    // Settle sequentially to avoid overwhelming the network
    for (const bet of eligibleBets) {
      try {
        console.log(`Settling bet at price bucket ${bet.priceBucket}, time bucket ${bet.timeBucket}...`);
        await handleSettleBet(bet);
        // Small delay between settlements
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to settle bet at price bucket ${bet.priceBucket}, time bucket ${bet.timeBucket}:`, error);
        // Continue with next bet
      }
    }
  };

  // Calculate eligible bets for settlement
  const nowSec = Math.floor(Date.now() / 1000);
  const eligibleForSettlement = bets.filter(bet => 
    bet.status === 'placed' && // Only include bets that haven't been settled yet
    bet.expiryTimestampSecs && 
    bet.expiryTimestampSecs + 5 <= nowSec && // Add 5 second safety buffer
    doesPriceIntersectBet(bet) // Only settle if current price intersects this bet's cell
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
      
      {/* Transaction in Progress Indicator */}
      {(isPlacing || queueLength > 0) && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-xl border backdrop-blur-md z-50 bg-gradient-to-r from-blue-900/95 to-indigo-900/95 border-blue-500/50">
          <div className="flex items-center space-x-3">
            <div className="animate-spin h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full"></div>
            <span className="text-white font-medium">
              {queueLength > 0 
                ? `Processing bets... (${queueLength} in queue)` 
                : 'Placing bet...'}
            </span>
          </div>
        </div>
      )}
      
      {/* Win/Loss Notification */}
      {showWinNotification && showWinNotification.show && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 px-8 py-6 rounded-xl shadow-2xl border-2 backdrop-blur-md transition-all z-50 ${
          showWinNotification.won 
            ? 'bg-gradient-to-br from-green-900/95 to-emerald-900/95 border-green-500/50' 
            : 'bg-gradient-to-br from-red-900/95 to-rose-900/95 border-red-500/50'
        }`}>
          <div className="text-center">
            <div className="text-5xl mb-3">
              {showWinNotification.won ? '🎉' : '😔'}
            </div>
            <div className="text-2xl font-bold text-white mb-2">
              {showWinNotification.won ? 'YOU WON!' : 'Better Luck Next Time'}
            </div>
            {showWinNotification.won && (
              <div className="text-3xl font-bold text-green-300 mb-2">
                +{showWinNotification.payout} MOVE
              </div>
            )}
            <div className="text-sm text-gray-300">
              Bet ID: {showWinNotification.betId}
            </div>
          </div>
        </div>
      )}
      
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
              const isEligible = bet.status === 'placed' && bet.expiryTimestampSecs && bet.expiryTimestampSecs + 5 <= nowSec && doesPriceIntersectBet(bet);
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
                    Price Bucket {bet.priceBucket} • Time Bucket {bet.timeBucket}
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