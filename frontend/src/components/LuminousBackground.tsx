export default function LuminousBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0"
      style={{
        zIndex: 0,
        background: `
          radial-gradient(ellipse at 18% 16%, rgba(69, 176, 132, 0.18) 0%, transparent 42%),
          radial-gradient(ellipse at 82% 20%, rgba(214, 157, 99, 0.13) 0%, transparent 36%),
          linear-gradient(180deg, #050706 0%, #07110c 38%, #030504 100%)
        `,
      }}
    />
  );
}
