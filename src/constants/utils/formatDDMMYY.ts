export const formatDate = (timestamp: any) => {
  const date = new Date(Number(timestamp) * 1000); // Convert to milliseconds
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-based
  const year = String(date.getFullYear()).slice(2); // Get last 2 digits of year
  return `${day}/${month}/${year}`;
};
