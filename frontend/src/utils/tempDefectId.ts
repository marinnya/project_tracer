let seq = 0;

/**
 * Временный отрицательный id нового дефекта до сохранения черновика.
 * Должен помещаться в PostgreSQL INT4 (в отличие от -Date.now()).
 */
export function nextTempDefectId(): number {
  seq += 1;
  return -seq;
}
