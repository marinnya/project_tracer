import axios from "axios";
import { MAX_PHOTO_FILE_LABEL } from "../constants/uploads";

function normalizeMessage(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const parts = raw.filter((x): x is string => typeof x === "string" && x.trim());
    if (parts.length) return parts.join(" ");
  }
  return null;
}

/**
 * Текст ошибки от Nest/axios для показа пользователю.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 413) {
      return `Файл слишком большой (максимум ${MAX_PHOTO_FILE_LABEL}).`;
    }
    const data = error.response?.data as { message?: unknown } | undefined;
    const fromBody = normalizeMessage(data?.message);
    if (fromBody) {
      if (/file too large|limit file size|LIMIT_FILE_SIZE|Field value too long/i.test(fromBody)) {
        return `Файл слишком большой (максимум ${MAX_PHOTO_FILE_LABEL}).`;
      }
      return fromBody;
    }

    const text = typeof error.response?.data === "string" ? error.response.data.trim() : "";
    if (text) return text;

    if (error.code === "ERR_NETWORK" || !error.response) {
      return "Не удалось связаться с сервером. Проверьте подключение.";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
