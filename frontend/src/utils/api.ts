import axios from "axios";

// создаём экземпляр axios, который будет использоваться для всех запросов к API
// api.get("/users") станет http://localhost:3000/users
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000'
});

// interceptor - перехватчик запроса (срабатывает перед отправкой любого запроса)
// каждый запрос автоматически получает jwt-токен
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token"); // получаем токен из localStorage
  if (token) config.headers.Authorization = `Bearer ${token}`; // добавляем токен в заголовок Authorization
  return config; // возвращаем config (запрос)?
});

// interceptor - перехватчик ответа (срабатывает после получения ответа от сервера)
api.interceptors.response.use(
  // если ответ успешный, возвращаем response
  (response) => response,
  // если ответ не успешный, то очищаем localStorage и перенаправляем на страницу login
  (error) => {
    if (error.response?.status === 401) {
      localStorage.clear();
      window.location.href = "/login"; // полный reload страницы
    }
    // пробрасываем ошибку дальше, чтобы другие catch() могли её обработать
    return Promise.reject(error);
  }
);

// экспортируем "умный" api, чтобы его можно было использовать в других файлах
export default api;