/**
 * usePanZoom - Hook for managing 2D pan and zoom state for a chart
 * 
 * Provides a world coordinate system with camera/viewport control.
 * Supports mouse and touch dragging for free 2D panning.
 */

import { useState, useCallback, useRef, type PointerEvent } from 'react';

export interface PanZoomState {
  worldOffsetX: number;
  worldOffsetY: number;
  zoom: number;
  isPanning: boolean;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface UsePanZoomResult {
  // Current state
  worldOffsetX: number;
  worldOffsetY: number;
  zoom: number;
  isPanning: boolean;
  
  // Transform functions
  worldToScreenX: (worldX: number) => number;
  worldToScreenY: (worldY: number) => number;
  screenToWorldX: (screenX: number) => number;
  screenToWorldY: (screenY: number) => number;
  
  // Event handlers
  handlePointerDown: (e: PointerEvent<SVGElement | HTMLDivElement>) => void;
  handlePointerMove: (e: PointerEvent<SVGElement | HTMLDivElement>) => void;
  handlePointerUp: () => void;
  handlePointerLeave: () => void;
  handleWheel: (e: WheelEvent) => void;
  
  // Manual control
  setWorldOffset: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  resetView: () => void;
}

export interface UsePanZoomOptions {
  initialOffsetX?: number;
  initialOffsetY?: number;
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  worldBounds?: WorldBounds;
  enableBounds?: boolean;
}

export function usePanZoom(options: UsePanZoomOptions = {}): UsePanZoomResult {
  const {
    initialOffsetX = 0,
    initialOffsetY = 0,
    initialZoom = 1,
    minZoom = 0.1,
    maxZoom = 10,
    worldBounds,
    enableBounds = true,
  } = options;

  // Pan/zoom state
  const [worldOffsetX, setWorldOffsetX] = useState(initialOffsetX);
  const [worldOffsetY, setWorldOffsetY] = useState(initialOffsetY);
  const [zoom, setZoomState] = useState(initialZoom);
  const [isPanning, setIsPanning] = useState(false);

  // Refs for drag tracking
  const dragStartRef = useRef({
    pointerX: 0,
    pointerY: 0,
    worldOffsetX: 0,
    worldOffsetY: 0,
    pointerId: -1,
    hasMoved: false,
  });
  const containerRef = useRef<Element | null>(null);

  // Clamp offset to bounds if enabled
  const clampOffset = useCallback((x: number, y: number): [number, number] => {
    if (!enableBounds || !worldBounds) {
      return [x, y];
    }

    const { minX, maxX, minY, maxY } = worldBounds;
    const clampedX = Math.max(minX, Math.min(maxX, x));
    const clampedY = Math.max(minY, Math.min(maxY, y));
    
    return [clampedX, clampedY];
  }, [enableBounds, worldBounds]);

  // Transform functions: world → screen
  const worldToScreenX = useCallback((worldX: number): number => {
    return (worldX + worldOffsetX) * zoom;
  }, [worldOffsetX, zoom]);

  const worldToScreenY = useCallback((worldY: number): number => {
    return (worldY + worldOffsetY) * zoom;
  }, [worldOffsetY, zoom]);

  // Transform functions: screen → world
  const screenToWorldX = useCallback((screenX: number): number => {
    return screenX / zoom - worldOffsetX;
  }, [worldOffsetX, zoom]);

  const screenToWorldY = useCallback((screenY: number): number => {
    return screenY / zoom - worldOffsetY;
  }, [worldOffsetY, zoom]);

  // Pointer event handlers
  const handlePointerDown = useCallback((e: PointerEvent<SVGElement | HTMLDivElement>) => {
    // Only handle left mouse button or touch
    if (e.button !== undefined && e.button !== 0) return;

    e.preventDefault(); // Prevent text selection
    
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      worldOffsetX,
      worldOffsetY,
      pointerId: e.pointerId,
      hasMoved: false,
    };
    containerRef.current = e.currentTarget;

    // Capture pointer for smooth dragging
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [worldOffsetX, worldOffsetY]);

  const handlePointerMove = useCallback((e: PointerEvent<SVGElement | HTMLDivElement>) => {
    // Check if pointer is captured (button is down)
    if (dragStartRef.current.pointerId === -1) return;

    const dx = e.clientX - dragStartRef.current.pointerX;
    const dy = e.clientY - dragStartRef.current.pointerY;

    // Only start panning if moved more than 2 pixels (threshold to distinguish click from drag)
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (!dragStartRef.current.hasMoved && distance > 2) {
      dragStartRef.current.hasMoved = true;
      setIsPanning(true);
    }

    if (!dragStartRef.current.hasMoved) return;

    // Update offset based on drag delta
    // Note: we ADD delta because we're moving the world, not the camera
    const newOffsetX = dragStartRef.current.worldOffsetX + dx / zoom;
    const newOffsetY = dragStartRef.current.worldOffsetY + dy / zoom;

    const [clampedX, clampedY] = clampOffset(newOffsetX, newOffsetY);
    setWorldOffsetX(clampedX);
    setWorldOffsetY(clampedY);
  }, [zoom, clampOffset]);

  const handlePointerUp = useCallback(() => {
    // Always release pointer capture if we have one
    if (containerRef.current && dragStartRef.current.pointerId !== -1) {
      try {
        if ('releasePointerCapture' in containerRef.current) {
          (containerRef.current as any).releasePointerCapture(dragStartRef.current.pointerId);
        }
      } catch (e) {
        // Ignore errors if pointer capture was already released
      }
    }
    
    // Always reset state
    setIsPanning(false);
    dragStartRef.current.pointerId = -1;
    dragStartRef.current.hasMoved = false;
    containerRef.current = null;
  }, []);

  const handlePointerLeave = useCallback(() => {
    // Always release pointer capture if we have one
    if (containerRef.current && dragStartRef.current.pointerId !== -1) {
      try {
        if ('releasePointerCapture' in containerRef.current) {
          (containerRef.current as any).releasePointerCapture(dragStartRef.current.pointerId);
        }
      } catch (e) {
        // Ignore errors if pointer capture was already released
      }
    }
    
    // Always reset state
    setIsPanning(false);
    dragStartRef.current.pointerId = -1;
    dragStartRef.current.hasMoved = false;
    containerRef.current = null;
  }, []);

  // Wheel event handler for zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    // Calculate zoom factor from wheel delta
    const zoomSpeed = 0.001;
    const delta = -e.deltaY * zoomSpeed;
    const newZoom = Math.max(minZoom, Math.min(maxZoom, zoom * (1 + delta)));
    
    if (newZoom === zoom) return;
    
    // Get mouse position relative to container
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate world position at mouse before zoom
    const worldXBefore = screenToWorldX(mouseX);
    const worldYBefore = screenToWorldY(mouseY);
    
    // Apply zoom
    setZoomState(newZoom);
    
    // Calculate world position at mouse after zoom
    const worldXAfter = mouseX / newZoom - worldOffsetX;
    const worldYAfter = mouseY / newZoom - worldOffsetY;
    
    // Adjust offset to keep the world point under the mouse fixed
    const offsetDeltaX = worldXAfter - worldXBefore;
    const offsetDeltaY = worldYAfter - worldYBefore;
    
    const [clampedX, clampedY] = clampOffset(
      worldOffsetX - offsetDeltaX,
      worldOffsetY - offsetDeltaY
    );
    
    setWorldOffsetX(clampedX);
    setWorldOffsetY(clampedY);
  }, [zoom, minZoom, maxZoom, worldOffsetX, worldOffsetY, screenToWorldX, screenToWorldY, clampOffset]);

  // Manual control functions
  const setWorldOffset = useCallback((x: number, y: number) => {
    const [clampedX, clampedY] = clampOffset(x, y);
    setWorldOffsetX(clampedX);
    setWorldOffsetY(clampedY);
  }, [clampOffset]);

  const setZoom = useCallback((newZoom: number) => {
    const clampedZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));
    setZoomState(clampedZoom);
  }, [minZoom, maxZoom]);

  const resetView = useCallback(() => {
    setWorldOffsetX(initialOffsetX);
    setWorldOffsetY(initialOffsetY);
    setZoomState(initialZoom);
    setIsPanning(false);
  }, [initialOffsetX, initialOffsetY, initialZoom]);

  return {
    worldOffsetX,
    worldOffsetY,
    zoom,
    isPanning,
    worldToScreenX,
    worldToScreenY,
    screenToWorldX,
    screenToWorldY,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleWheel,
    setWorldOffset,
    setZoom,
    resetView,
  };
}
