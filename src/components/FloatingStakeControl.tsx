/**
 * FloatingStakeControl - Draggable circular button with compact stake configuration popover
 */

import { useState, useRef, useEffect, type PointerEvent } from "react";
import { X } from "lucide-react";

interface FloatingStakeControlProps {
  stakeAmount: bigint;
  onStakeChange: (amount: bigint) => void;
  minBet: bigint;
  maxBet: bigint;
  balance: bigint | null;
}

const OCTAS_PER_MOVE = 100_000_000n;

export function FloatingStakeControl({
  stakeAmount,
  onStakeChange,
  minBet,
  maxBet,
  balance,
}: FloatingStakeControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 50, y: 85 }); // % from left/top
  const [isDragging, setIsDragging] = useState(false);
  const [inputValue, setInputValue] = useState("");
  
  const buttonRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  // Format stake for display
  const stakeInMove = Number(stakeAmount) / Number(OCTAS_PER_MOVE);
  const displayStake = stakeInMove < 1 
    ? stakeInMove.toFixed(4) 
    : stakeInMove.toFixed(2);

  // Update input when stake changes externally
  useEffect(() => {
    if (!isOpen) {
      setInputValue((Number(stakeAmount) / Number(OCTAS_PER_MOVE)).toString());
    }
  }, [stakeAmount, isOpen]);

  // Handle pointer down on button
  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
    
    setIsDragging(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  // Handle pointer move
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Start dragging after 3px movement
    if (!isDragging && distance > 3) {
      setIsDragging(true);
      setIsOpen(false); // Close popover when dragging
    }
    
    if (isDragging && buttonRef.current) {
      const parent = buttonRef.current.offsetParent as HTMLElement;
      if (!parent) return;
      
      const parentRect = parent.getBoundingClientRect();
      const deltaXPercent = (dx / parentRect.width) * 100;
      const deltaYPercent = (dy / parentRect.height) * 100;
      
      const newX = Math.max(5, Math.min(95, dragStartRef.current.posX + deltaXPercent));
      const newY = Math.max(5, Math.min(95, dragStartRef.current.posY + deltaYPercent));
      
      setPosition({ x: newX, y: newY });
    }
  };

  // Handle pointer up
  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    
    if (!isDragging) {
      // Was a click, toggle popover
      setIsOpen(!isOpen);
    }
    
    setIsDragging(false);
  };

  // Handle quick stake buttons
  const setQuickStake = (amount: bigint) => {
    onStakeChange(amount);
    setInputValue((Number(amount) / Number(OCTAS_PER_MOVE)).toString());
  };

  // Handle max button
  const setMaxStake = () => {
    const max = balance && balance < maxBet ? balance : maxBet;
    onStakeChange(max);
    setInputValue((Number(max) / Number(OCTAS_PER_MOVE)).toString());
  };

  // Handle input change
  const handleInputChange = (value: string) => {
    setInputValue(value);
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      const octas = BigInt(Math.floor(num * Number(OCTAS_PER_MOVE)));
      const clamped = octas < minBet ? minBet : octas > maxBet ? maxBet : octas;
      onStakeChange(clamped);
    }
  };

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        popoverRef.current &&
        buttonRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <>
      {/* Floating circular button */}
      <div
        ref={buttonRef}
        className={`fixed z-40 w-14 h-14 rounded-full bg-purple-700/90 border-2 border-purple-300/60 shadow-lg flex flex-col items-center justify-center text-xs font-bold text-white backdrop-blur-sm transition-all ${
          isDragging ? "cursor-grabbing scale-110" : "cursor-grab hover:scale-105"
        } ${isOpen ? "ring-2 ring-purple-400/50" : ""}`}
        style={{
          left: `${position.x}%`,
          top: `${position.y}%`,
          transform: "translate(-50%, -50%)",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div className="text-[10px] text-purple-200">STAKE</div>
        <div className="text-xs">{displayStake}</div>
        <div className="text-[9px] text-purple-300">MOVE</div>
      </div>

      {/* Compact popover */}
      {isOpen && (
        <div
          ref={popoverRef}
          className="fixed z-50 rounded-xl bg-[#12041f]/95 border border-purple-500/40 shadow-2xl p-3 flex flex-col gap-2 backdrop-blur-md"
          style={{
            left: `${position.x}%`,
            top: `${position.y}%`,
            transform: position.y > 50 ? "translate(-50%, calc(-100% - 60px))" : "translate(-50%, 60px)",
            minWidth: "220px",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-purple-200">Configure Stake</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-purple-400 hover:text-purple-200 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Input */}
          <div className="flex flex-col gap-1">
            <input
              type="number"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              step="0.001"
              min={Number(minBet) / Number(OCTAS_PER_MOVE)}
              max={Number(maxBet) / Number(OCTAS_PER_MOVE)}
              className="w-full px-2 py-1.5 bg-purple-950/50 border border-purple-500/30 rounded-lg text-white text-sm focus:outline-none focus:ring-1 focus:ring-purple-400/50"
              placeholder="Amount in MOVE"
            />
            <div className="flex items-center justify-between text-[10px] text-purple-400">
              <span>Min: {(Number(minBet) / Number(OCTAS_PER_MOVE)).toFixed(4)}</span>
              <span>Max: {(Number(maxBet) / Number(OCTAS_PER_MOVE)).toFixed(2)}</span>
            </div>
          </div>

          {/* Quick buttons */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setQuickStake(100_000n)}
              className="flex-1 px-2 py-1 bg-purple-600/60 hover:bg-purple-600/80 rounded-md text-[11px] font-medium text-white transition-colors"
            >
              0.001
            </button>
            <button
              onClick={() => setQuickStake(1_000_000n)}
              className="flex-1 px-2 py-1 bg-purple-600/60 hover:bg-purple-600/80 rounded-md text-[11px] font-medium text-white transition-colors"
            >
              0.01
            </button>
            <button
              onClick={() => setQuickStake(10_000_000n)}
              className="flex-1 px-2 py-1 bg-purple-600/60 hover:bg-purple-600/80 rounded-md text-[11px] font-medium text-white transition-colors"
            >
              0.1
            </button>
            <button
              onClick={setMaxStake}
              className="flex-1 px-2 py-1 bg-pink-600/60 hover:bg-pink-600/80 rounded-md text-[11px] font-medium text-white transition-colors"
            >
              Max
            </button>
          </div>

          {/* Balance info */}
          {balance !== null && (
            <div className="text-[10px] text-purple-300 text-center pt-1 border-t border-purple-500/20">
              Balance: {(Number(balance) / Number(OCTAS_PER_MOVE)).toFixed(4)} MOVE
            </div>
          )}
        </div>
      )}
    </>
  );
}
