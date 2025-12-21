import { useState, useRef, useCallback, useEffect } from 'react';

interface FloatingBetButtonProps {
  stakeAmount: number;
  onStakeChange: (amount: number) => void;
  minBet?: number;
  maxBet?: number;
}

export function FloatingBetButton({
  stakeAmount,
  onStakeChange,
  minBet = 0.01,
  maxBet = 100,
}: FloatingBetButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: window.innerHeight - 100 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, btnX: 0, btnY: 0 });
  const buttonRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      btnX: position.x,
      btnY: position.y,
    };
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    
    const newX = dragStartRef.current.btnX + deltaX;
    const newY = dragStartRef.current.btnY + deltaY;
    
    // Keep button within viewport
    const maxX = window.innerWidth - 60;
    const maxY = window.innerHeight - 60;
    
    setPosition({
      x: Math.max(20, Math.min(newX, maxX)),
      y: Math.max(20, Math.min(newY, maxY)),
    });
  }, [isDragging]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setIsDragging(false);
      
      // Only open if drag distance was minimal (it was a click)
      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;
      const dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      if (dragDistance < 5) {
        setIsOpen(prev => !prev);
      }
    }
  }, [isDragging]);

  // Attach/detach global mouse handlers
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleStakeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= minBet && value <= maxBet) {
      onStakeChange(value);
    }
  };

  const quickAmounts = [0.1, 0.5, 1, 5, 10];

  return (
    <>
      {/* Floating Button */}
      <div
        ref={buttonRef}
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 1000,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
        className="select-none"
      >
        <div className="w-14 h-14 bg-gradient-to-br from-purple-600 to-pink-600 rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all flex items-center justify-center text-white font-bold">
          <span className="text-sm">{stakeAmount.toFixed(2)}</span>
        </div>
      </div>

      {/* Popup Modal */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            left: `${position.x + 70}px`,
            top: `${position.y}px`,
            zIndex: 999,
          }}
          className="bg-[#0b1020] border border-purple-500/30 rounded-xl shadow-2xl p-4 min-w-[250px]"
        >
          <div className="mb-4">
            <h3 className="text-white font-semibold mb-2">Bet Amount (APT)</h3>
            <input
              type="number"
              value={stakeAmount}
              onChange={handleStakeChange}
              min={minBet}
              max={maxBet}
              step={0.01}
              className="w-full px-3 py-2 bg-[#050816] border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <div className="mb-3">
            <p className="text-purple-300 text-xs mb-2">Quick amounts:</p>
            <div className="flex flex-wrap gap-2">
              {quickAmounts.map(amount => (
                <button
                  key={amount}
                  onClick={() => onStakeChange(amount)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                    stakeAmount === amount
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/40'
                  }`}
                >
                  {amount} APT
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setIsOpen(false)}
            className="w-full px-3 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-lg text-white font-medium transition-all"
          >
            Done
          </button>
        </div>
      )}

      {/* Backdrop to close modal when clicking outside */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-998"
          style={{ zIndex: 998 }}
        />
      )}
    </>
  );
}
