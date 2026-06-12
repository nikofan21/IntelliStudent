import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type RenameModalProps = {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
};

export default function RenameModal({
  open,
  title,
  label = "Новое название",
  placeholder = "Введите название",
  initialValue = "",
  confirmText = "Сохранить",
  cancelText = "Отмена",
  loading = false,
  onConfirm,
  onClose,
}: RenameModalProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) {
      setValue(initialValue || "");
    }
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        onClose();
      }

      if (e.key === "Enter" && !loading) {
        e.preventDefault();
        onConfirm(value);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, loading, onClose, onConfirm, value]);

  if (!open) return null;

  const modal = (
    <div
      onClick={!loading ? onClose : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        background: "rgba(3, 8, 20, 0.72)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "560px",
          borderRadius: "20px",
          border: "1px solid rgba(59, 130, 246, 0.35)",
          background:
            "linear-gradient(180deg, rgba(20, 25, 39, 0.98) 0%, rgba(12, 16, 27, 0.98) 100%)",
          boxShadow:
            "0 24px 80px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(59, 130, 246, 0.28), 0 0 24px rgba(59, 130, 246, 0.14)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "22px 22px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              color: "#f8fafc",
              fontSize: "20px",
              fontWeight: 700,
              lineHeight: 1.25,
              marginBottom: "14px",
            }}
          >
            {title}
          </div>

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              color: "rgba(226, 232, 240, 0.82)",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            {label}
          </label>

          <input
            autoFocus
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            disabled={loading}
            className="input"
          />
        </div>

        <div
          style={{
            padding: "18px 22px 22px",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="btn btn-secondary"
          >
            {cancelText}
          </button>

          <button
            type="button"
            onClick={() => onConfirm(value)}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? "Сохраняем..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}