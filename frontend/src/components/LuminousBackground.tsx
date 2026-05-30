export default function LuminousBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0"
      style={{
        zIndex: 0,
        background: `
          radial-gradient(ellipse at 20% 50%, rgba(59, 108, 255, 0.08) 0%, transparent 60%),
          radial-gradient(ellipse at 80% 30%, rgba(0, 240, 255, 0.05) 0%, transparent 50%),
          linear-gradient(180deg, #000110 0%, #01081a 40%, #00020a 100%)
        `,
      }}
    />
  );
}
