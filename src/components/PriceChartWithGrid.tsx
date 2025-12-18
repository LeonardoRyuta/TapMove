/**
 * PriceChartWithGrid - Main trading visualization component
 * 
 * Displays a live line chart of asset price with an overlaid betting grid
 * for future time buckets. Supports pan/zoom interactions.
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { ZoomInIcon, ZoomOutIcon, MoveHorizontalIcon } from "lucide-react";

export interface PricePoint {
  timestamp: number; // Unix timestamp in seconds
  price: number;
}

export interface GridCellState {
  rowIndex: number;
  columnIndex: number;
  multiplier: number;
  isLocked: boolean;
  isCurrent: boolean;
  isSelected: boolean;
  isPending: boolean;
  isPlaced: boolean;
}

export interface PriceChartWithGridProps {
  // Price data for the chart
  priceData: PricePoint[];
  
  // Grid configuration
  numPriceBuckets: number;
  numTimeColumns: number;
  lockedColumnsAhead: number;
  timeBucketSeconds: number;
  
  // Multipliers for each cell [row][column]
  multipliers: number[][];
  
  // Cell states
  selectedCells: Set<string>; // Format: "row-col"
  pendingCells: Set<string>;
  placedCells: Map<string, { stake: string; txHash?: string }>;
  
  // Interaction handlers
  onCellClick: (rowIndex: number, columnIndex: number, multiplier: number) => void;
  
  // Current state
  currentBucket: number;
  earliestBettableBucket: number;
}

export function PriceChartWithGrid({
  priceData,
  numPriceBuckets,
  numTimeColumns,
  timeBucketSeconds,
  multipliers,
  selectedCells,
  pendingCells,
  placedCells,
  onCellClick,
  currentBucket,
  earliestBettableBucket,
}: PriceChartWithGridProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartDimensions, setChartDimensions] = useState({ width: 1200, height: 600 });
  const [panOffset, setPanOffset] = useState(0); // Horizontal pan offset in pixels
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = normal, >1 = zoomed in
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);

  // Update chart dimensions on mount and resize
  useEffect(() => {
    const updateDimensions = () => {
      if (chartRef.current) {
        const rect = chartRef.current.getBoundingClientRect();
        setChartDimensions({ width: rect.width, height: rect.height });
      }
    };
    
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Calculate chart dimensions and scales
  const { width, height } = chartDimensions;
  const padding = { top: 40, right: 200, bottom: 60, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate price range
  const currentPrice = priceData.length > 0 ? priceData[priceData.length - 1].price : 100;
  const priceRangePercent = 0.15; // Show ±15% of current price
  const minPrice = currentPrice * (1 - priceRangePercent);
  const maxPrice = currentPrice * (1 + priceRangePercent);
  const priceRange = maxPrice - minPrice;

  // Calculate time range
  const currentTime = Math.floor(Date.now() / 1000);
  const gridStartTime = earliestBettableBucket * timeBucketSeconds;
  const gridEndTime = gridStartTime + numTimeColumns * timeBucketSeconds;
  
  // Extend chart to show some history (e.g., 5 minutes)
  const historySeconds = 300;
  const minTime = currentTime - historySeconds;
  const maxTime = gridEndTime;
  const timeRange = maxTime - minTime;

  // Scale functions with pan and zoom
  const xScale = (timestamp: number) => {
    const baseX = ((timestamp - minTime) / timeRange) * chartWidth * zoomLevel;
    return baseX + panOffset;
  };

  const yScale = (price: number) => {
    return chartHeight - ((price - minPrice) / priceRange) * chartHeight;
  };

  // Generate SVG path for price line
  const linePath = useMemo(() => {
    if (priceData.length === 0) return "";
    
    const points = priceData.map(point => {
      const x = xScale(point.timestamp);
      const y = yScale(point.price);
      return `${x},${y}`;
    });
    
    return `M ${points.join(" L ")}`;
  }, [priceData, panOffset, zoomLevel, minTime, maxTime, minPrice, maxPrice]);

  // Calculate grid positioning
  const midBucketIndex = Math.floor(numPriceBuckets / 2);
  const pricePerBucket = priceRange / numPriceBuckets;
  
  const getRowPrice = (rowIndex: number) => {
    // Row 0 = highest price, midBucket = current price, last row = lowest price
    const distanceFromMid = midBucketIndex - rowIndex;
    return currentPrice + distanceFromMid * pricePerBucket;
  };

  // Pan controls
  const handlePanLeft = () => {
    setPanOffset(prev => Math.min(prev + 100, 0));
  };

  const handlePanRight = () => {
    setPanOffset(prev => prev - 100);
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev * 1.2, 4));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev / 1.2, 0.5));
  };

  // Mouse drag for panning
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const delta = e.clientX - dragStart;
    setPanOffset(prev => prev + delta);
    setDragStart(e.clientX);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Render grid cells
  const renderGridCells = () => {
    const cells: React.JSX.Element[] = [];
    const cellWidth = (chartWidth * zoomLevel) / (numTimeColumns + 10); // Slightly wider spacing
    const cellHeight = chartHeight / numPriceBuckets;

    for (let row = 0; row < numPriceBuckets; row++) {
      const rowPrice = getRowPrice(row);
      const rowY = yScale(rowPrice);

      for (let col = 0; col < numTimeColumns; col++) {
        const colBucket = earliestBettableBucket + col;
        const colTime = colBucket * timeBucketSeconds;
        const colX = xScale(colTime);

        // Skip if cell is off-screen
        if (colX < -cellWidth || colX > chartWidth + 200) continue;

        const cellKey = `${row}-${col}`;
        const isLocked = colBucket < earliestBettableBucket;
        const isCurrent = colBucket === currentBucket;
        const isSelected = selectedCells.has(cellKey);
        const isPending = pendingCells.has(cellKey);
        const isPlaced = placedCells.has(cellKey);
        const multiplier = multipliers[row]?.[col] ?? 1.0;

        // Determine cell styling
        let fillColor = "rgba(34, 197, 94, 0.15)"; // green-500 with low opacity
        let strokeColor = "rgba(34, 197, 94, 0.4)";
        let textColor = "#16a34a"; // green-600

        if (isLocked) {
          fillColor = "rgba(71, 85, 105, 0.3)"; // slate-600
          strokeColor = "rgba(71, 85, 105, 0.5)";
          textColor = "#64748b"; // slate-500
        } else if (isPlaced) {
          fillColor = "rgba(59, 130, 246, 0.4)"; // blue-500
          strokeColor = "rgba(59, 130, 246, 0.8)";
          textColor = "#2563eb"; // blue-600
        } else if (isPending) {
          fillColor = "rgba(234, 179, 8, 0.4)"; // yellow-500
          strokeColor = "rgba(234, 179, 8, 0.8)";
          textColor = "#ca8a04"; // yellow-600
        } else if (isSelected) {
          fillColor = "rgba(234, 179, 8, 0.6)"; // yellow-500 brighter
          strokeColor = "rgba(234, 179, 8, 1)";
          textColor = "#a16207"; // yellow-700
        } else if (isCurrent) {
          fillColor = "rgba(251, 191, 36, 0.3)"; // amber-400
          strokeColor = "rgba(251, 191, 36, 0.6)";
          textColor = "#f59e0b"; // amber-500
        }

        cells.push(
          <g
            key={cellKey}
            className={`grid-cell ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
            onClick={() => !isLocked && onCellClick(row, col, multiplier)}
          >
            <rect
              x={colX}
              y={rowY - cellHeight / 2}
              width={cellWidth - 2}
              height={cellHeight - 2}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={isSelected || isPending || isPlaced ? 2 : 1}
              rx={4}
              className="transition-all duration-150"
            />
            
            {/* Multiplier text */}
            <text
              x={colX + cellWidth / 2}
              y={rowY}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={textColor}
              fontSize={cellWidth > 60 ? 14 : 11}
              fontWeight={isSelected || isPending || isPlaced ? "bold" : "normal"}
              className="pointer-events-none select-none font-mono"
            >
              {isLocked ? (
                <tspan fontSize={cellWidth > 60 ? 16 : 12}>🔒</tspan>
              ) : (
                `${multiplier.toFixed(2)}x`
              )}
            </text>

            {/* Pending spinner */}
            {isPending && (
              <g>
                <circle
                  cx={colX + cellWidth - 12}
                  cy={rowY - cellHeight / 2 + 12}
                  r={6}
                  fill="rgba(234, 179, 8, 0.8)"
                  className="animate-pulse"
                />
              </g>
            )}

            {/* Placed checkmark */}
            {isPlaced && (
              <text
                x={colX + cellWidth - 12}
                y={rowY - cellHeight / 2 + 12}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#22c55e"
                fontSize={14}
                fontWeight="bold"
              >
                ✓
              </text>
            )}
          </g>
        );
      }
    }

    return cells;
  };

  // Render price axis labels
  const renderPriceAxis = () => {
    const labels: React.JSX.Element[] = [];
    const numLabels = 8;
    
    for (let i = 0; i <= numLabels; i++) {
      const price = minPrice + (priceRange * i) / numLabels;
      const y = yScale(price);
      
      labels.push(
        <g key={`price-${i}`}>
          <line
            x1={0}
            y1={y}
            x2={chartWidth}
            y2={y}
            stroke="rgba(148, 163, 184, 0.2)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={-10}
            y={y}
            textAnchor="end"
            dominantBaseline="middle"
            fill="#94a3b8"
            fontSize={12}
          >
            ${price.toFixed(2)}
          </text>
        </g>
      );
    }
    
    return labels;
  };

  // Render time axis labels
  const renderTimeAxis = () => {
    const labels: React.JSX.Element[] = [];
    const labelInterval = Math.max(1, Math.floor(numTimeColumns / 8));
    
    // Current time line
    const currentX = xScale(currentTime);
    labels.push(
      <g key="current-time">
        <line
          x1={currentX}
          y1={0}
          x2={currentX}
          y2={chartHeight}
          stroke="rgba(239, 68, 68, 0.6)"
          strokeWidth={2}
        />
        <text
          x={currentX}
          y={chartHeight + 25}
          textAnchor="middle"
          fill="#ef4444"
          fontSize={13}
          fontWeight="bold"
        >
          NOW
        </text>
      </g>
    );
    
    // Future time labels
    for (let col = 0; col < numTimeColumns; col += labelInterval) {
      const colBucket = earliestBettableBucket + col;
      const colTime = colBucket * timeBucketSeconds;
      const x = xScale(colTime);
      
      if (x < -50 || x > chartWidth + 100) continue;
      
      const secondsFromNow = colTime - currentTime;
      
      labels.push(
        <text
          key={`time-${col}`}
          x={x}
          y={chartHeight + 40}
          textAnchor="middle"
          fill="#94a3b8"
          fontSize={11}
        >
          +{secondsFromNow}s
        </text>
      );
    }
    
    return labels;
  };

  // Render row labels (price buckets)
  const renderRowLabels = () => {
    const labels: React.JSX.Element[] = [];
    const midBucket = Math.floor(numPriceBuckets / 2);
    
    for (let row = 0; row < numPriceBuckets; row++) {
      const rowPrice = getRowPrice(row);
      const y = yScale(rowPrice);
      const distanceFromMid = row - midBucket;
      
      labels.push(
        <text
          key={`row-${row}`}
          x={chartWidth + 10}
          y={y}
          textAnchor="start"
          dominantBaseline="middle"
          fill={distanceFromMid === 0 ? "#f59e0b" : "#94a3b8"}
          fontSize={11}
          fontWeight={distanceFromMid === 0 ? "bold" : "normal"}
        >
          {distanceFromMid === 0 ? "MID" : `${distanceFromMid > 0 ? "-" : "+"}${Math.abs(distanceFromMid)}`}
        </text>
      );
    }
    
    return labels;
  };

  return (
    <div className="relative w-full h-full bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
      {/* Control panel */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-lg p-2 border border-slate-700">
          <div className="flex gap-1">
            <button
              onClick={handleZoomIn}
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
              title="Zoom In"
            >
              <ZoomInIcon size={16} className="text-slate-300" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
              title="Zoom Out"
            >
              <ZoomOutIcon size={16} className="text-slate-300" />
            </button>
          </div>
        </div>
        
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-lg p-2 border border-slate-700">
          <div className="flex gap-1">
            <button
              onClick={handlePanLeft}
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
              title="Pan Left"
            >
              <MoveHorizontalIcon size={16} className="text-slate-300 rotate-180" />
            </button>
            <button
              onClick={handlePanRight}
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
              title="Pan Right"
            >
              <MoveHorizontalIcon size={16} className="text-slate-300" />
            </button>
          </div>
        </div>
      </div>

      {/* Chart legend */}
      <div className="absolute top-4 left-4 z-10 bg-slate-900/80 backdrop-blur-sm rounded-lg p-3 border border-slate-700">
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500/20 border border-green-500/50 rounded"></div>
            <span className="text-slate-300">Bettable</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-slate-600/30 border border-slate-600/50 rounded"></div>
            <span className="text-slate-300">Locked</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-500/40 border border-yellow-500/80 rounded"></div>
            <span className="text-slate-300">Selected</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-500/40 border border-blue-500/80 rounded"></div>
            <span className="text-slate-300">Placed</span>
          </div>
        </div>
      </div>

      {/* Main chart area */}
      <div
        ref={chartRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg width={width} height={height} className="overflow-visible">
          <g transform={`translate(${padding.left}, ${padding.top})`}>
            {/* Background grid */}
            {renderPriceAxis()}
            
            {/* Price line */}
            <path
              d={linePath}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={2}
              className="drop-shadow-lg"
            />
            
            {/* Current price indicator */}
            {priceData.length > 0 && (
              <g>
                <circle
                  cx={xScale(currentTime)}
                  cy={yScale(currentPrice)}
                  r={5}
                  fill="#3b82f6"
                  stroke="#1e40af"
                  strokeWidth={2}
                  className="animate-pulse"
                />
                <rect
                  x={xScale(currentTime) + 10}
                  y={yScale(currentPrice) - 12}
                  width={80}
                  height={24}
                  fill="#1e293b"
                  rx={4}
                  stroke="#3b82f6"
                  strokeWidth={1}
                />
                <text
                  x={xScale(currentTime) + 50}
                  y={yScale(currentPrice)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#3b82f6"
                  fontSize={12}
                  fontWeight="bold"
                  className="font-mono"
                >
                  ${currentPrice.toFixed(2)}
                </text>
              </g>
            )}
            
            {/* Betting grid overlay */}
            {renderGridCells()}
            
            {/* Time axis */}
            {renderTimeAxis()}
            
            {/* Row labels */}
            {renderRowLabels()}
          </g>
        </svg>
      </div>
    </div>
  );
}
