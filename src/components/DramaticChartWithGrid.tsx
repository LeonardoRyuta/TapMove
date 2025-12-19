/**
 * DramaticChartWithGrid - Full-screen price chart with 2D panning and betting grid overlay
 */

import { useMemo, useRef, useEffect, type PointerEvent } from "react";
import { LockIcon } from "lucide-react";
import { usePanZoom } from "../hooks/usePanZoom";

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface GridCell {
  rowIndex: number;
  columnIndex: number;
  multiplier: number;
  isLocked: boolean;
  isSelected: boolean;
  isPending: boolean;
  isPlaced: boolean;
}

interface DramaticChartWithGridProps {
  priceData: PricePoint[];
  latestPrice: number | null;
  publishTime: number | null;
  numPriceBuckets: number;
  numTimeColumns: number;
  timeBucketSeconds: number;
  gridCells: GridCell[];
  onCellClick: (rowIndex: number, columnIndex: number, multiplier: number) => void;
  currentBucket: number;
}

// Constants for world coordinate system
const WORLD_WIDTH = 2000;  // Logical width for world space
const WORLD_HEIGHT = 1000; // Logical height for world space
const VIEWPORT_WIDTH = 1000;
const VIEWPORT_HEIGHT = 600;

export function DramaticChartWithGrid({
  priceData,
  latestPrice,
  numPriceBuckets,
  numTimeColumns,
  gridCells,
  onCellClick,
}: DramaticChartWithGridProps) {
  // Calculate world coordinate ranges and scaling functions
  const worldData = useMemo(() => {
    if (priceData.length < 2) {
      return {
        minPrice: 0,
        maxPrice: 100,
        avgPrice: 50,
        minTime: 0,
        maxTime: 100,
        priceRange: 100,
        timeRange: 100,
      };
    }

    const prices = priceData.map(p => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    
    const timestamps = priceData.map(p => p.timestamp);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);

    return {
      minPrice,
      maxPrice,
      avgPrice,
      minTime,
      maxTime,
      priceRange: maxPrice - minPrice,
      timeRange: maxTime - minTime,
    };
  }, [priceData]);

  // Transform functions: data → world coordinates
  const dataToWorld = useMemo(() => {
    const { minPrice, maxPrice, avgPrice, minTime, maxTime } = worldData;
    
    // Exaggerate price movement for visual drama
    const DRAMA_FACTOR = 2.5;
    const dramaticRange = (maxPrice - minPrice) * DRAMA_FACTOR;
    const worldMinPrice = avgPrice - dramaticRange / 2;
    const worldMaxPrice = avgPrice + dramaticRange / 2;

    // Map time to world X (centered around 0)
    const timeToWorldX = (timestamp: number) => {
      if (maxTime === minTime) return 0;
      const normalized = (timestamp - minTime) / (maxTime - minTime);
      return (normalized - 0.5) * WORLD_WIDTH; // Center at 0
    };

    // Map price to world Y (inverted: higher price = lower Y, centered around 0)
    const priceToWorldY = (price: number) => {
      if (worldMaxPrice === worldMinPrice) return 0;
      const normalized = (price - worldMinPrice) / (worldMaxPrice - worldMinPrice);
      return (0.5 - normalized) * WORLD_HEIGHT; // Invert and center at 0
    };

    // Calculate world position for "now" (latest data point)
    const nowWorldX = priceData.length > 0 
      ? timeToWorldX(priceData[priceData.length - 1].timestamp)
      : 0;

    return {
      timeToWorldX,
      priceToWorldY,
      nowWorldX,
      worldMinPrice,
      worldMaxPrice,
    };
  }, [worldData, priceData]);

  // Calculate initial offsets to center the chart
  // We want the NOW line at ~40% from the left (400px in 1000px viewport)
  const initialOffsets = useMemo(() => {
    const targetNowScreenX = VIEWPORT_WIDTH * 0.4; // 40% from left
    const { nowWorldX } = dataToWorld;
    
    // worldToScreenX = (worldX + offsetX) * zoom
    // Solve for offsetX when worldX = nowWorldX and screenX = targetNowScreenX
    // targetNowScreenX = (nowWorldX + offsetX) * 1
    // offsetX = targetNowScreenX - nowWorldX
    const initialOffsetX = targetNowScreenX - nowWorldX;
    
    // Center vertically (VIEWPORT_HEIGHT / 2 = 300)
    // We want worldY = 0 to appear at screenY = 300
    const initialOffsetY = VIEWPORT_HEIGHT / 2;
    
    return { initialOffsetX, initialOffsetY };
  }, [dataToWorld]);

  // Initialize pan/zoom with calculated centered view
  const panZoom = usePanZoom({
    initialOffsetX: initialOffsets.initialOffsetX,
    initialOffsetY: initialOffsets.initialOffsetY,
    initialZoom: 1,
    minZoom: 0.1,
    maxZoom: 10,
    worldBounds: {
      minX: -WORLD_WIDTH * 5,
      maxX: WORLD_WIDTH * 5,
      minY: -WORLD_HEIGHT * 5,
      maxY: WORLD_HEIGHT * 5,
    },
    enableBounds: true,
  });

  // Build price line path in world coordinates, then transform to screen
  const chartPath = useMemo(() => {
    if (priceData.length < 2) return "";

    const { timeToWorldX, priceToWorldY } = dataToWorld;
    
    // Convert data points to world coordinates
    const worldPoints = priceData.map(p => ({
      worldX: timeToWorldX(p.timestamp),
      worldY: priceToWorldY(p.price),
    }));

    // Transform to screen coordinates
    const screenPoints = worldPoints.map(wp => ({
      x: panZoom.worldToScreenX(wp.worldX),
      y: panZoom.worldToScreenY(wp.worldY),
    }));

    // Build SVG path with smooth curves
    let path = `M ${screenPoints[0].x} ${screenPoints[0].y}`;
    
    for (let i = 1; i < screenPoints.length; i++) {
      const prev = screenPoints[i - 1];
      const curr = screenPoints[i];
      const midX = (prev.x + curr.x) / 2;
      const midY = (prev.y + curr.y) / 2;
      path += ` Q ${prev.x} ${prev.y}, ${midX} ${midY}`;
    }
    
    if (screenPoints.length > 1) {
      const last = screenPoints[screenPoints.length - 1];
      path += ` L ${last.x} ${last.y}`;
    }

    return path;
  }, [priceData, dataToWorld, panZoom]);

  // Calculate NOW line screen position
  const nowLineScreenX = panZoom.worldToScreenX(dataToWorld.nowWorldX);

  // Calculate grid positioning in world space
  // Grid should be FIXED based on price buckets, not moving with current price
  const gridWorldLayout = useMemo(() => {
    const { nowWorldX } = dataToWorld;
    
    // Grid starts after NOW line (horizontal position)
    const gridStartWorldX = nowWorldX + WORLD_WIDTH * 0.05;
    const gridEndWorldX = gridStartWorldX + WORLD_WIDTH * 0.3;
    const columnWidth = (gridEndWorldX - gridStartWorldX) / numTimeColumns;
    
    // Fixed grid height - each bucket gets equal space
    // Grid is centered vertically in world space
    const totalGridHeight = WORLD_HEIGHT * 0.8; // Use 80% of world height for grid
    const rowHeight = totalGridHeight / numPriceBuckets;
    
    // Grid Y range: centered at worldY = 0
    const gridStartWorldY = -totalGridHeight / 2;  // Top of grid
    const gridEndWorldY = totalGridHeight / 2;     // Bottom of grid
    
    // Helper: convert row index to world Y
    // Row 0 = bottom bucket, Row 20 = top bucket
    const rowToWorldY = (rowIndex: number) => {
      // Invert: row 0 at bottom (positive Y), row 20 at top (negative Y)
      return gridEndWorldY - rowIndex * rowHeight;
    };
    
    // Helper: convert price to world Y using the same scale as the price line
    const priceToWorldY = dataToWorld.priceToWorldY;
    
    return {
      gridStartWorldX,
      gridEndWorldX,
      columnWidth,
      rowHeight,
      gridStartWorldY,
      gridEndWorldY,
      rowToWorldY,
      priceToWorldY,
    };
  }, [dataToWorld, numTimeColumns, numPriceBuckets]);

  // Organize cells by position
  const cellsByPosition = useMemo(() => {
    const map = new Map<string, GridCell>();
    gridCells.forEach(cell => {
      map.set(`${cell.rowIndex}-${cell.columnIndex}`, cell);
    });
    return map;
  }, [gridCells]);

  // Handle pointer events with panning check
  const handleCellPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // Prevent panning when clicking cells
  };

  const cursorClass = panZoom.isPanning ? "cursor-grabbing" : "cursor-grab";
  const userSelectClass = panZoom.isPanning ? "select-none" : "";

  // Ref for the container to attach wheel listener with passive: false
  const containerRef = useRef<HTMLDivElement>(null);

  // Attach wheel event listener manually with passive: false
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      panZoom.handleWheel(e);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [panZoom]);

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-full bg-linear-to-br from-[#050816] via-[#0b1020] to-[#0a0618] overflow-hidden ${cursorClass} ${userSelectClass}`}
      onPointerDown={panZoom.handlePointerDown}
      onPointerMove={panZoom.handlePointerMove}
      onPointerUp={panZoom.handlePointerUp}
      onPointerLeave={panZoom.handlePointerLeave}
    >
      {/* Debug Info */}
      <div className="absolute top-4 left-4 z-50 text-white text-xs bg-black/50 p-2 rounded pointer-events-none">
        <div>Data points: {priceData.length}</div>
        <div>Path length: {chartPath.length}</div>
        <div>Price: ${latestPrice?.toFixed(2) ?? 'N/A'}</div>
        <div>Pan: ({panZoom.worldOffsetX.toFixed(0)}, {panZoom.worldOffsetY.toFixed(0)})</div>
        <div>Zoom: {panZoom.zoom.toFixed(2)}x</div>
      </div>
      
      {/* Background Grid Lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
        <defs>
          <linearGradient id="priceLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ec4899" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#a855f7" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        
        {/* Horizontal grid lines */}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <line
            key={i}
            x1="0"
            y1={`${(i / 6) * 100}%`}
            x2="100%"
            y2={`${(i / 6) * 100}%`}
            stroke="rgba(139, 92, 246, 0.08)"
            strokeWidth="1"
          />
        ))}
        
        {/* Vertical grid lines */}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <line
            key={i}
            x1={`${(i / 8) * 100}%`}
            y1="0"
            x2={`${(i / 8) * 100}%`}
            y2="100%"
            stroke="rgba(139, 92, 246, 0.05)"
            strokeWidth="1"
          />
        ))}
      </svg>

      {/* Main Chart SVG */}
      <svg 
        className="absolute inset-0 w-full h-full pointer-events-none" 
        viewBox={`0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`}
        preserveAspectRatio="none"
      >
        {/* Glow filter */}
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Price line with glow */}
        <g filter="url(#glow)">
          <path
            d={chartPath}
            fill="none"
            stroke="url(#priceLineGradient)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        
        {/* NOW line */}
        {priceData.length > 0 && (
          <line
            x1={nowLineScreenX}
            y1="0"
            x2={nowLineScreenX}
            y2={VIEWPORT_HEIGHT}
            stroke="#10b981"
            strokeWidth="2"
            strokeDasharray="5,5"
            opacity="0.6"
          />
        )}
      </svg>

      {/* NOW label */}
      {priceData.length > 0 && (
        <div 
          className="absolute bottom-4 text-emerald-400 text-xs font-bold tracking-wider pointer-events-none"
          style={{ 
            left: `${(nowLineScreenX / VIEWPORT_WIDTH) * 100}%`, 
            transform: 'translateX(-50%)' 
          }}
        >
          NOW
        </div>
      )}

      {/* Current price pill on NOW line */}
      {latestPrice && priceData.length > 0 && (
        <div
          className="absolute px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/50 rounded-lg backdrop-blur-sm pointer-events-none z-20"
          style={{ 
            left: `${(nowLineScreenX / VIEWPORT_WIDTH) * 100}%`,
            top: `${(panZoom.worldToScreenY(dataToWorld.priceToWorldY(latestPrice)) / VIEWPORT_HEIGHT) * 100}%`,
            transform: 'translate(-50%, -50%)' 
          }}
        >
          <span className="text-emerald-300 font-mono text-sm font-bold">
            ${latestPrice.toFixed(2)}
          </span>
        </div>
      )}

      {/* Betting Grid Overlay - positioned in world space */}
      <div className="absolute inset-0">
        {Array.from({ length: numPriceBuckets }).map((_, rowIndex) =>
          Array.from({ length: numTimeColumns }).map((_, colIndex) => {
            const cell = cellsByPosition.get(`${rowIndex}-${colIndex}`);
            if (!cell) return null;

            const { isLocked, isSelected, isPending, isPlaced, multiplier } = cell;

            // Calculate world position for this cell
            const { gridStartWorldX, columnWidth, rowToWorldY } = gridWorldLayout;
            const cellWorldX = gridStartWorldX + colIndex * columnWidth;
            const cellWorldY = rowToWorldY(rowIndex);

            // Transform to screen coordinates
            const screenX = panZoom.worldToScreenX(cellWorldX);
            const screenY = panZoom.worldToScreenY(cellWorldY);
            const screenWidth = columnWidth * panZoom.zoom;
            const screenHeight = gridWorldLayout.rowHeight * panZoom.zoom;

            // Only render if visible in viewport
            if (
              screenX + screenWidth < 0 || 
              screenX > VIEWPORT_WIDTH ||
              screenY + screenHeight < 0 || 
              screenY > VIEWPORT_HEIGHT
            ) {
              return null;
            }

            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                onClick={() => !isLocked && onCellClick(rowIndex, colIndex, multiplier)}
                onPointerDown={handleCellPointerDown}
                disabled={isLocked || isPending}
                className={`
                  absolute rounded-lg border transition-all duration-200
                  ${isLocked 
                    ? 'bg-purple-950/20 border-purple-900/30 cursor-not-allowed opacity-40' 
                    : isSelected
                    ? 'bg-linear-to-br from-yellow-500/40 to-pink-500/40 border-yellow-400 ring-2 ring-yellow-400/50 scale-105 shadow-lg shadow-yellow-500/30'
                    : isPending
                    ? 'bg-linear-to-br from-blue-500/30 to-purple-500/30 border-blue-400 animate-pulse'
                    : isPlaced
                    ? 'bg-linear-to-br from-cyan-500/30 to-blue-500/30 border-cyan-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-400/50 hover:scale-105 hover:shadow-lg hover:shadow-emerald-500/20 cursor-pointer'
                  }
                `}
                style={{
                  left: `${(screenX / VIEWPORT_WIDTH) * 100}%`,
                  top: `${(screenY / VIEWPORT_HEIGHT) * 100}%`,
                  width: `${(screenWidth / VIEWPORT_WIDTH) * 100}%`,
                  height: `${(screenHeight / VIEWPORT_HEIGHT) * 100}%`,
                }}
              >
                {isLocked ? (
                  <LockIcon size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-purple-600" />
                ) : (
                  <span className={`
                    absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-bold whitespace-nowrap
                    ${isSelected ? 'text-yellow-200' : isPlaced ? 'text-cyan-200' : isPending ? 'text-blue-200' : 'text-emerald-200'}
                  `}>
                    {multiplier.toFixed(2)}x
                  </span>
                )}
                
                {isSelected && (
                  <div className="absolute inset-0 rounded-lg bg-linear-to-br from-yellow-400/20 to-pink-400/20 blur-sm -z-10" />
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Reset View Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          panZoom.resetView();
        }}
        className="absolute top-4 right-4 z-50 px-3 py-1.5 bg-purple-600/80 hover:bg-purple-500/80 text-white text-xs rounded-lg backdrop-blur-sm transition-colors"
      >
        Reset View
      </button>
    </div>
  );
}
