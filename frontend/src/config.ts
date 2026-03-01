// Global frontend configuration for API endpoints and backend URL
// Uses NEXT_PUBLIC_BACKEND_URL so it can be overridden in Docker / production.

export const BACKEND_URL: string =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export const apiUrl = (path: string): string => {
  // Ensure path starts with a single leading slash
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BACKEND_URL}${normalizedPath}`;
};


