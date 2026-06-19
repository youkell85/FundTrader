export default function LuminousBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0"
      style={{
        zIndex: 0,
        background: `
          linear-gradient(180deg, #050706 0%, #07110c 42%, #030504 100%),
          linear-gradient(90deg, rgba(69, 176, 132, 0.08), transparent 34%, rgba(214, 157, 99, 0.055) 72%, transparent),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 40px),
          repeating-linear-gradient(90deg, rgba(255,255,255,0.014) 0 1px, transparent 1px 40px)
        `,
      }}
    />
  );
}
