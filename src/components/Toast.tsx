/**
 * Toast notification system
 */

import { useEffect } from "react";
import { CheckCircleIcon, AlertCircleIcon, XCircleIcon } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export interface ToastProps {
  message: string;
  type: ToastType;
  duration?: number;
  onClose: () => void;
}

export function Toast({ message, type, duration = 5000, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const icons = {
    success: <CheckCircleIcon size={20} className="text-emerald-400" />,
    error: <XCircleIcon size={20} className="text-red-400" />,
    info: <AlertCircleIcon size={20} className="text-blue-400" />,
  };

  const colors = {
    success: "from-emerald-900/80 to-emerald-800/60 border-emerald-500/50",
    error: "from-red-900/80 to-red-800/60 border-red-500/50",
    info: "from-blue-900/80 to-blue-800/60 border-blue-500/50",
  };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 bg-gradient-to-r ${colors[type]} border rounded-lg backdrop-blur-xl shadow-xl animate-in slide-in-from-bottom-5 duration-300`}
    >
      {icons[type]}
      <span className="text-sm text-white flex-1">{message}</span>
      <button
        onClick={onClose}
        className="text-white/60 hover:text-white transition-colors"
      >
        ×
      </button>
    </div>
  );
}

export interface ToastContainerProps {
  toasts: Array<{ id: string; message: string; type: ToastType }>;
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[60] w-full max-w-md px-4 space-y-2">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );
}
