import { HsAssistant } from "@/components/hs-assistant";

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-1 items-stretch overflow-hidden p-3 sm:p-5 lg:p-7">
      {/* Warm landscape blur — Raft marketing console atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div
          className="absolute inset-0 scale-110"
          style={{
            background: `
              radial-gradient(ellipse 90% 70% at 20% 75%, #c4a574 0%, transparent 55%),
              radial-gradient(ellipse 70% 60% at 80% 30%, #e8b86d 0%, transparent 50%),
              radial-gradient(ellipse 50% 40% at 50% 10%, #f0d9a8 0%, transparent 45%),
              linear-gradient(165deg, #d4b896 0%, #b8956a 35%, #8a6b45 70%, #6b5338 100%)
            `,
            filter: "blur(28px)",
          }}
        />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background: `
              radial-gradient(circle at 15% 80%, rgba(255,145,40,0.45), transparent 40%),
              radial-gradient(circle at 85% 25%, rgba(255,200,120,0.35), transparent 35%)
            `,
          }}
        />
      </div>
      <HsAssistant />
    </main>
  );
}
