import { useEffect, useState } from "react";

interface Props {
  onDone: () => void;
}

export function SplashScreen({ onDone }: Props) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 50);
    const t2 = setTimeout(() => setPhase("out"), 2200);
    const t3 = setTimeout(() => onDone(), 2700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, #047857 0%, #022C22 100%)",
        transition: phase === "out" ? "opacity 0.5s ease" : "none",
        opacity: phase === "out" ? 0 : 1,
        userSelect: "none",
      }}
    >
      {/* Decorative background rings */}
      <div style={{
        position: "absolute",
        width: 420,
        height: 420,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.06)",
        top: "50%",
        left: "50%",
        transform: "translate(-50%,-50%)",
        pointerEvents: "none",
      }}/>
      <div style={{
        position: "absolute",
        width: 280,
        height: 280,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.08)",
        top: "50%",
        left: "50%",
        transform: "translate(-50%,-50%)",
        pointerEvents: "none",
      }}/>

      {/* Logo */}
      <div style={{
        width: 96,
        height: 96,
        borderRadius: 22,
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)",
        transition: "transform 0.6s cubic-bezier(0.34,1.56,0.64,1), opacity 0.5s ease",
        transform: phase === "in" ? "scale(0.72)" : "scale(1)",
        opacity: phase === "in" ? 0 : 1,
      }}>
        <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "100%" }}>
          <defs>
            <linearGradient id="sbg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#047857"/>
              <stop offset="100%" stopColor="#022C22"/>
            </linearGradient>
            <linearGradient id="saw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FB923C"/>
              <stop offset="100%" stopColor="#EA580C"/>
            </linearGradient>
          </defs>
          <rect width="100" height="100" rx="22" fill="url(#sbg)"/>
          <path d="M14 40 L50 24 L86 40 L82 49 L18 49 Z" fill="url(#saw)"/>
          <rect x="18" y="47" width="64" height="34" rx="3" fill="white" opacity="0.97"/>
          <rect x="23" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
          <rect x="43" y="55" width="14" height="26" rx="2" fill="#065F46"/>
          <rect x="62" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
          <rect x="12" y="79" width="76" height="4" rx="2" fill="#F97316" opacity="0.45"/>
        </svg>
      </div>

      {/* Wordmark */}
      <div style={{
        marginTop: 20,
        transition: "transform 0.55s cubic-bezier(0.34,1.56,0.64,1) 0.12s, opacity 0.45s ease 0.12s",
        transform: phase === "in" ? "translateY(12px)" : "translateY(0)",
        opacity: phase === "in" ? 0 : 1,
        textAlign: "center",
      }}>
        <div style={{
          fontFamily: "'Outfit', system-ui, sans-serif",
          fontWeight: 900,
          fontSize: 30,
          color: "white",
          letterSpacing: "-0.5px",
          lineHeight: 1,
        }}>
          BizMtaani
        </div>
        <div style={{
          fontFamily: "'Outfit', system-ui, sans-serif",
          fontWeight: 400,
          fontSize: 13,
          color: "rgba(255,255,255,0.55)",
          marginTop: 6,
          letterSpacing: "0.04em",
        }}>
          Kenya's local marketplace
        </div>
      </div>

      {/* Bottom dot loader */}
      <div style={{
        position: "absolute",
        bottom: 52,
        display: "flex",
        gap: 7,
        transition: "opacity 0.4s ease 0.3s",
        opacity: phase === "in" ? 0 : 1,
      }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.35)",
              animation: `bm-bounce 1.1s ${i * 0.18}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes bm-bounce {
          0%, 80%, 100% { transform: scale(1); opacity: 0.35; }
          40% { transform: scale(1.5); opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
