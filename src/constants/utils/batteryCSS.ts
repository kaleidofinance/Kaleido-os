
export const batteryCSS = (figure: number | string) => {
  const value = typeof figure === "string" ? parseFloat(figure) : figure;

  if (figure === "∞" || value > 1.0) {
    return "above1 h-full"; // Safe
  } else if (value === 1.0) {
    return "one h-10"; // Borderline
  } else if (value >= 0.51) {
    return "btw051_099 h-6"; // Fair
  } else if (value >= 0.3) {
    return "btw03_05 h-3"; // Warning
  } else {
    return "below03 h-1"; // Danger
  }
};
