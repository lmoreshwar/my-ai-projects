/**
 * Zephyr Scale wing logo (blue feather icon).
 * Props: size (px, default 24), className (optional extra classes)
 */
export default function ZephyrLogo({ size = 24, className = '' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      aria-label="Zephyr Scale"
    >
      {/* Three stylized wind/feather strokes */}
      <path
        d="M30 90 C40 70, 70 50, 100 20 C80 35, 55 55, 45 80Z"
        fill="#4AB8D8"
      />
      <path
        d="M20 75 C30 55, 55 35, 90 12 C70 25, 48 42, 35 65Z"
        fill="#5CC4E0"
      />
      <path
        d="M14 58 C22 42, 45 25, 78 8 C60 18, 40 32, 28 50Z"
        fill="#72D0E8"
      />
    </svg>
  );
}
