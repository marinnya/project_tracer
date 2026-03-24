const API_URL = "http://localhost:3000";

export async function apiFetch(endpoint: string, options: any = {}) {
  const token = localStorage.getItem("token");

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error("Ошибка запроса");
  }

  return response.json();
}
